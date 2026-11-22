// Spletni delavec (Web Worker), ki poganja Supertonic 3 v brskalniku.
// Teče ločeno od uporabniškega vmesnika, zato se označevanje besed ne zatika med računanjem.
// Sklepanje je prirejeno po uradnem primeru Supertonic (MIT licenca, © 2025 Supertone Inc.).

const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.webgpu.min.mjs';
const MODEL_BASE = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';
const CACHE_NAME = 'supertonic-3-v1';

let ort = null;
let mock = false;
let cfgs, indexer, sessions, provider;
const styles = new Map();

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

// ---------- Prenos z lokalnim predpomnilnikom ----------
async function cachedFetch(url, label) {
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); } catch (_) { /* brez predpomnilnika */ }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      post({ type: 'progress', label, loaded: 1, total: 1, cached: true });
      return new Uint8Array(await hit.arrayBuffer());
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Prenos ni uspel (${res.status}): ${label}`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0, lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    const now = Date.now();
    if (now - lastPost > 150) { post({ type: 'progress', label, loaded, total }); lastPost = now; }
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  post({ type: 'progress', label, loaded, total: total || loaded });
  if (cache) {
    try { await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); }
    catch (_) { /* premalo prostora – nadaljujemo brez shranjevanja */ }
  }
  return buf;
}

async function fetchJson(url, label) {
  const bytes = await cachedFetch(url, label);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ---------- Nalaganje modela ----------
async function init(opts) {
  mock = !!opts.mock;
  if (mock) { post({ type: 'ready', provider: 'demo (brez modela)' }); return; }

  ort = await import(ORT_URL);
  ort.env.wasm.numThreads = 1;

  cfgs = await fetchJson(`${MODEL_BASE}/onnx/tts.json`, 'nastavitve');
  indexer = await fetchJson(`${MODEL_BASE}/onnx/unicode_indexer.json`, 'abeceda');

  const files = [
    ['dp', 'duration_predictor.onnx', 'trajanje (4 MB)'],
    ['enc', 'text_encoder.onnx', 'besedilo (36 MB)'],
    ['est', 'vector_estimator.onnx', 'glas (257 MB)'],
    ['voc', 'vocoder.onnx', 'zvok (101 MB)'],
  ];
  const buffers = {};
  for (const [key, file, label] of files) buffers[key] = await cachedFetch(`${MODEL_BASE}/onnx/${file}`, label);

  const tryCreate = async (ep) => {
    const s = {};
    for (const [key] of files) s[key] = await ort.InferenceSession.create(buffers[key], { executionProviders: [ep], graphOptimizationLevel: 'all' });
    return s;
  };
  const wantGpu = opts.allowGpu !== false && typeof navigator !== 'undefined' && navigator.gpu;
  if (wantGpu) {
    try { sessions = await tryCreate('webgpu'); provider = 'WebGPU'; }
    catch (e) { console.warn('WebGPU ni na voljo, uporabim WASM', e); }
  }
  if (!sessions) { sessions = await tryCreate('wasm'); provider = 'WASM (procesor)'; }
  post({ type: 'ready', provider });
}

async function getStyle(voice) {
  if (styles.has(voice)) return styles.get(voice);
  const j = await fetchJson(`${MODEL_BASE}/voice_styles/${voice}.json`, `glas ${voice}`);
  const st = {
    ttl: new ort.Tensor('float32', Float32Array.from(j.style_ttl.data.flat(Infinity)), j.style_ttl.dims),
    dp: new ort.Tensor('float32', Float32Array.from(j.style_dp.data.flat(Infinity)), j.style_dp.dims),
  };
  styles.set(voice, st);
  return st;
}

// ---------- Predobdelava besedila (kot v uradnem primeru) ----------
function preprocess(text, lang) {
  text = text.normalize('NFKD');
  const rep = { '–': '-', '‑': '-', '—': '-', '_': ' ', '“': '"', '”': '"', '‘': "'", '’': "'",
    '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ' };
  for (const [k, v] of Object.entries(rep)) text = text.replaceAll(k, v);
  text = text.replace(/[♥☆♡©\\]/g, '');
  text = text.replace(/ ([,.!?;:'])/g, '$1');
  text = text.replace(/\s+/g, ' ').trim();
  if (!/[.!?;:,'"')\]}…»]$/.test(text)) text += '.';
  return `<${lang}>${text}</${lang}>`;
}

function textToIds(text) {
  const ids = new BigInt64Array(text.length);
  for (let j = 0; j < text.length; j++) {
    const cp = text.codePointAt(j);
    ids[j] = BigInt(cp < indexer.length ? indexer[cp] : -1);
  }
  return ids;
}

function randn(n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(1e-4, Math.random()), u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    out[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

async function synthesize(text, voice, speed, steps) {
  const style = await getStyle(voice);
  const processed = preprocess(text, 'sl');
  const ids = textToIds(processed);
  const L = ids.length;
  const idsT = new ort.Tensor('int64', ids, [1, L]);
  const maskT = new ort.Tensor('float32', new Float32Array(L).fill(1), [1, 1, L]);

  const dpOut = await sessions.dp.run({ text_ids: idsT, style_dp: style.dp, text_mask: maskT });
  const duration = dpOut.duration.data[0] / speed;

  const encOut = await sessions.enc.run({ text_ids: idsT, style_ttl: style.ttl, text_mask: maskT });
  const textEmb = encOut.text_emb;

  const sr = cfgs.ae.sample_rate;
  const chunk = cfgs.ae.base_chunk_size * cfgs.ttl.chunk_compress_factor;
  const wavLen = Math.floor(duration * sr);
  const latLen = Math.max(1, Math.floor((wavLen + chunk - 1) / chunk));
  const latDim = cfgs.ttl.latent_dim * cfgs.ttl.chunk_compress_factor;

  let xt = randn(latDim * latLen);
  const latMaskT = new ort.Tensor('float32', new Float32Array(latLen).fill(1), [1, 1, latLen]);
  const totalT = new ort.Tensor('float32', new Float32Array([steps]), [1]);

  for (let step = 0; step < steps; step++) {
    const out = await sessions.est.run({
      noisy_latent: new ort.Tensor('float32', xt, [1, latDim, latLen]),
      text_emb: textEmb,
      style_ttl: style.ttl,
      latent_mask: latMaskT,
      text_mask: maskT,
      current_step: new ort.Tensor('float32', new Float32Array([step]), [1]),
      total_step: totalT,
    });
    xt = out.denoised_latent.data instanceof Float32Array ? out.denoised_latent.data : Float32Array.from(out.denoised_latent.data);
  }
  const vocOut = await sessions.voc.run({ latent: new ort.Tensor('float32', xt, [1, latDim, latLen]) });
  let wav = vocOut.wav_tts.data;
  wav = wav instanceof Float32Array ? wav.slice(0, Math.min(wav.length, wavLen || wav.length)) : Float32Array.from(wav);
  return { wav, sr };
}

// Demo način: brez modela, "pisk" na vsak zlog – za preizkus vmesnika in označevanja.
function mockSynth(text, speed) {
  const sr = 24000;
  const words = text.split(/\s+/).filter(Boolean);
  const parts = [];
  for (const w of words) {
    const syl = Math.max(1, (w.match(/[aeiouAEIOU]/g) || []).length);
    for (let s = 0; s < syl; s++) parts.push({ tone: true, d: 0.16 / speed });
    parts.push({ tone: false, d: (/[,.;:!?]$/.test(w) ? 0.25 : 0.08) / speed });
  }
  const total = parts.reduce((a, p) => a + p.d, 0) + 0.2;
  const wav = new Float32Array(Math.floor(total * sr));
  let t = 0.1;
  for (const p of parts) {
    const n = Math.floor(p.d * sr), o = Math.floor(t * sr);
    if (p.tone) for (let i = 0; i < n * 0.8; i++) wav[o + i] = 0.2 * Math.sin(2 * Math.PI * 330 * i / sr);
    t += p.d;
  }
  return { wav, sr };
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') await init(msg);
    else if (msg.type === 'synth') {
      const t0 = performance.now();
      const { wav, sr } = mock ? mockSynth(msg.text, msg.speed) : await synthesize(msg.text, msg.voice, msg.speed, msg.steps);
      const ms = performance.now() - t0;
      post({ type: 'audio', id: msg.id, wav, sr, ms }, [wav.buffer]);
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: String(err && err.message || err) });
  }
};
