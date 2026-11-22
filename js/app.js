import { prepareText } from './text-prep.js';
import { estimateWordTimes } from './timing.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');

const SAMPLE = `Polarna kovalentna vez
Polarna kovalentna vez nastane med atomi različnih nekovin. Ko atom ene nekovine bolj pritegne vezni elektronski par kot atom druge nekovine, nastane polarna kovalentna vez. Naboj med atomoma ni enakomerno porazdeljen.
Primer: molekula vodikovega klorida (HCl)
Molekulo vodikovega klorida tvorita različna atoma, atom klora in atom vodika. Atom vodika ima en zunanji elektron. Atom klora ima 7 zunanjih elektronov. Da bi imel klorov atom zunanjo lupino zapolnjeno, potrebuje še en elektron.
Primer: molekula amonijaka (NH₃)
V molekuli amonijaka so atomi razporejeni v oglišča piramide. Koti med vezmi so 107°, oblika molekule pa piramidalna.`;

const COLORS = ['#ffd84d', '#7ee0a1', '#7cc7ff', '#ff9ecf', '#ffb36b', '#c9a7ff'];

// ---------- Nastavitve ----------
const DEFAULTS = { voice: 'F1', speed: 1.0, steps: 5, color: '#ffd84d', opacity: 0.55, sentence: true, follow: true,
  font: 'Lexend', size: 24, line: 1.8, letter: 0.02, theme: 'krem' };
let S = { ...DEFAULTS };
try { S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('bralnik.settings') || '{}') }; } catch (_) {}
const save = () => { try { localStorage.setItem('bralnik.settings', JSON.stringify(S)); } catch (_) {} };

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return `${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}`; }
const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');

function applySettings() {
  const r = document.documentElement.style;
  r.setProperty('--hl', hexToRgb(S.color));
  r.setProperty('--hl-a', S.opacity);
  r.setProperty('--font', `'${S.font}', system-ui, sans-serif`);
  r.setProperty('--size', S.size + 'px');
  r.setProperty('--line', S.line);
  r.setProperty('--letter', S.letter + 'em');
  document.body.dataset.theme = S.theme;
  $('readerText').classList.toggle('no-sentence', !S.sentence);
  $('setVoice').value = S.voice; $('setSpeed').value = S.speed; $('setSteps').value = S.steps;
  $('setColor').value = S.color; $('setOpacity').value = S.opacity; $('setSentence').checked = S.sentence;
  $('setFollow').checked = S.follow; $('setFont').value = S.font; $('setSize').value = S.size;
  $('setLine').value = S.line; $('setLetter').value = S.letter; $('setTheme').value = S.theme;
  $('outSpeed').textContent = fmt(S.speed, 2) + '×'; $('speedLabel').textContent = fmt(S.speed) + '×';
  $('outOpacity').textContent = Math.round(S.opacity * 100) + ' %'; $('outSize').textContent = S.size + ' px';
  $('outLine').textContent = fmt(S.line); $('outLetter').textContent = fmt(S.letter, 2);
  document.querySelectorAll('.swatch').forEach(b => b.classList.toggle('on', b.dataset.c === S.color));
  save();
}

// ---------- Glasovni stroj (delavec) ----------
class Engine {
  constructor() {
    this.worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.seq = 0;
    this.chain = Promise.resolve();
    this.ready = new Promise((res, rej) => { this._ready = res; this._fail = rej; });
    this.progress = {};
    this.worker.onmessage = (e) => this.onMsg(e.data);
    this.worker.onerror = (e) => this._fail(new Error(e.message || 'Napaka v delavcu'));
    this.worker.postMessage({ type: 'init', mock: DEMO });
  }
  onMsg(m) {
    if (m.type === 'progress') { this.progress[m.label] = m; onLoadProgress(this.progress); }
    else if (m.type === 'ready') { this.provider = m.provider; this._ready(m); }
    else if (m.type === 'audio') { this.pending.get(m.id)?.res(m); this.pending.delete(m.id); }
    else if (m.type === 'error') {
      if (this.pending.has(m.id)) { this.pending.get(m.id).rej(new Error(m.message)); this.pending.delete(m.id); }
      else this._fail(new Error(m.message));
    }
  }
  // Zahtevki si sledijo po vrsti (model naenkrat računa en stavek)
  synth(text, voice, speed, steps) {
    const id = ++this.seq;
    const p = this.chain.then(() => new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.worker.postMessage({ type: 'synth', id, text, voice, speed, steps });
    }));
    this.chain = p.catch(() => {});
    return p;
  }
}

function onLoadProgress(prog) {
  let loaded = 0, total = 0, label = '';
  for (const p of Object.values(prog)) { loaded += p.loaded; total += p.total || p.loaded; if (p.loaded < (p.total || 1)) label = p.label; }
  const big = total > 1e6;
  const pct = total ? Math.min(100, loaded / total * 100) : 0;
  showStatus(big ? `Prvič prenašam glas na napravo (${Math.round(loaded / 1e6)} / ~400 MB)${label ? ' – ' + label : ''}. Naslednjič bo takoj pripravljen.` : 'Nalagam glas …', pct);
}

function showStatus(text, pct) {
  $('status').classList.remove('hidden');
  $('statusText').textContent = text;
  if (pct != null) $('statusBar').style.width = pct + '%';
}
const hideStatus = () => $('status').classList.add('hidden');

// ---------- Bralnik ----------
let engine = null;
let doc = null;          // pripravljeno besedilo
let ctx = null;          // AudioContext
const cache = new Map(); // ključ → Promise<{buffer, times, ms}>
const state = { playing: false, sentence: 0, source: null, startAt: 0, activeWord: -1, token: 0 };

function keyFor(s) { return `${S.voice}|${S.speed}|${S.steps}|${s.spokenText}`; }

function getAudio(i) {
  const s = doc.sentences[i];
  if (!s) return null;
  const k = keyFor(s);
  if (!cache.has(k)) {
    const p = engine.synth(s.spokenText, S.voice, S.speed, S.steps).then(({ wav, sr, ms }) => {
      const buffer = ctx.createBuffer(1, wav.length, sr);
      buffer.copyToChannel(wav, 0);
      const times = estimateWordTimes(wav, sr, s.words.map(w => ({ weight: w.weight, pause: w.pause })));
      updateTech(ms, wav.length / sr);
      return { buffer, times };
    });
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return cache.get(k);
}

let lastStats = '';
function updateTech(ms, dur) {
  lastStats = `Zadnji stavek: ${fmt(ms / 1000, 2)} s računanja za ${fmt(dur, 2)} s govora.`;
  renderTech();
}
function renderTech() {
  $('techInfo').textContent = `Glas: Supertonic 3 (odprt model, teče na tej napravi). Pogon: ${engine?.provider || '…'}. ${lastStats}`;
}

function renderDoc() {
  const root = $('readerText');
  root.innerHTML = '';
  for (const p of doc.paragraphs) {
    const pe = document.createElement('p');
    for (const s of p.sentences) {
      const se = document.createElement('span');
      se.className = 's';
      s.el = se;
      s.words.forEach((w, wi) => {
        const we = document.createElement('span');
        we.className = 'w';
        we.textContent = w.display;
        we.dataset.i = w.index;
        w.el = we; w.pos = wi;
        se.appendChild(we);
        se.appendChild(document.createTextNode(' '));
      });
      pe.appendChild(se);
    }
    root.appendChild(pe);
  }
}

function setPlayingUI(playing, busy = false) {
  $('icoPlay').classList.toggle('hidden', playing);
  $('icoPause').classList.toggle('hidden', !playing);
  $('btnPlay').classList.toggle('busy', busy);
  $('btnPlay').setAttribute('aria-label', playing ? 'Ustavi' : 'Predvajaj');
}

function stopSource() {
  state.token++;
  if (state.source) { try { state.source.onended = null; state.source.stop(); } catch (_) {} state.source = null; }
}

async function playSentence(i, offset = 0) {
  stopSource();
  const token = state.token;
  if (i >= doc.sentences.length) { finish(); return; }
  state.sentence = i;
  markSentence(i);
  setPlayingUI(true, true);
  let audio;
  try { audio = await getAudio(i); }
  catch (e) { showStatus('Napaka pri branju: ' + e.message); state.playing = false; setPlayingUI(false); return; }
  if (token !== state.token || !state.playing) return;
  setPlayingUI(true, false);
  // vnaprej pripravimo naslednja dva stavka
  getAudio(i + 1); getAudio(i + 2);
  if (ctx.state === 'suspended') await ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = audio.buffer;
  src.connect(ctx.destination);
  const off = Math.max(0, Math.min(offset, audio.buffer.duration - 0.05));
  state.startAt = ctx.currentTime - off;
  state.times = audio.times;
  src.onended = () => {
    if (token !== state.token || !state.playing) return;
    setTimeout(() => { if (token === state.token && state.playing) playSentence(i + 1); }, 180);
  };
  src.start(0, off);
  state.source = src;
}

function markSentence(i) {
  doc.sentences.forEach((s, k) => s.el.classList.toggle('active', k === i));
}
function markWord(globalIndex) {
  if (state.activeWord === globalIndex) return;
  if (state.activeWord >= 0) doc.words[state.activeWord]?.el.classList.remove('active');
  state.activeWord = globalIndex;
  const w = doc.words[globalIndex];
  if (!w) return;
  w.el.classList.add('active');
  if (S.follow) {
    const r = w.el.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.top < 80 || r.bottom > vh - 150) w.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function tick() {
  if (state.playing && state.source && state.times && ctx.state === 'running') {
    const t = ctx.currentTime - state.startAt;
    const s = doc.sentences[state.sentence];
    let k = 0;
    for (let j = 0; j < state.times.length; j++) if (state.times[j].start <= t + 0.03) k = j;
    markWord(s.words[k].index);
  }
  requestAnimationFrame(tick);
}

function finish() {
  state.playing = false;
  setPlayingUI(false);
  markWord(-1);
  state.sentence = 0;
}

function ensureCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
}

async function ensureEngine() {
  if (!engine) {
    engine = new Engine();
    showStatus(DEMO ? 'Demo način (brez pravega glasu) …' : 'Pripravljam glas …', 2);
  }
  try {
    await engine.ready;
    hideStatus(); renderTech();
    return true;
  } catch (e) {
    showStatus('Glasu ni bilo mogoče naložiti: ' + e.message + '. Preveri internetno povezavo in osveži stran.');
    return false;
  }
}

async function togglePlay() {
  ensureCtx();
  if (state.playing) {
    state.playing = false;
    await ctx.suspend();
    setPlayingUI(false);
    return;
  }
  if (!(await ensureEngine())) return;
  state.playing = true;
  if (state.source && ctx.state === 'suspended') { await ctx.resume(); setPlayingUI(true); return; }
  playSentence(state.sentence);
}

async function jumpToWord(wi) {
  ensureCtx();
  const w = doc.words[wi];
  if (!(await ensureEngine())) return;
  state.playing = true;
  if (ctx.state === 'suspended') await ctx.resume();
  const i = w.sentence.index;
  if (w.pos === 0) { playSentence(i); return; }
  const audio = await getAudio(i);
  playSentence(i, Math.max(0, audio.times[w.pos].start - 0.06));
}

function startReading(text) {
  doc = prepareText(text);
  if (!doc.words.length) return;
  try { localStorage.setItem('bralnik.text', text); } catch (_) {}
  stopSource(); state.playing = false; state.sentence = 0; state.activeWord = -1;
  renderDoc();
  $('viewInput').classList.add('hidden');
  $('viewReader').classList.remove('hidden');
  $('controls').classList.remove('hidden');
  $('btnEdit').classList.remove('hidden');
  setPlayingUI(false);
  window.scrollTo(0, 0);
  ensureCtx();
  ensureEngine(); // začni nalagati takoj
}

function showInput() {
  stopSource(); state.playing = false;
  if (ctx && ctx.state === 'suspended') ctx.resume();
  $('viewReader').classList.add('hidden');
  $('controls').classList.add('hidden');
  $('viewInput').classList.remove('hidden');
  $('btnEdit').classList.add('hidden');
}

function restartIfPlaying() {
  if (state.playing) playSentence(state.sentence);
}

// ---------- Povezave ----------
function bind() {
  const sw = $('swatches');
  COLORS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'swatch'; b.style.background = c; b.dataset.c = c; b.setAttribute('aria-label', 'Barva ' + c);
    b.onclick = () => { S.color = c; applySettings(); };
    sw.appendChild(b);
  });
  $('btnStart').onclick = () => startReading($('inputText').value);
  $('btnSample').onclick = () => { $('inputText').value = SAMPLE; };
  $('btnEdit').onclick = showInput;
  $('btnPlay').onclick = togglePlay;
  $('btnPrev').onclick = () => { ensureCtx(); state.playing = true; playSentence(Math.max(0, state.sentence - 1)); };
  $('btnNext').onclick = () => { ensureCtx(); state.playing = true; playSentence(Math.min(doc.sentences.length - 1, state.sentence + 1)); };
  $('readerText').addEventListener('click', (e) => { const el = e.target.closest('.w'); if (el) jumpToWord(+el.dataset.i); });
  const setSpeed = (v) => { S.speed = Math.round(Math.min(2, Math.max(0.7, v)) * 100) / 100; applySettings(); restartIfPlaying(); };
  $('btnSlower').onclick = () => setSpeed(S.speed - 0.1);
  $('btnFaster').onclick = () => setSpeed(S.speed + 0.1);
  $('setSpeed').onchange = (e) => setSpeed(+e.target.value);
  $('setSpeed').oninput = (e) => { $('outSpeed').textContent = fmt(+e.target.value, 2) + '×'; };
  $('setVoice').onchange = (e) => { S.voice = e.target.value; applySettings(); restartIfPlaying(); };
  $('setSteps').onchange = (e) => { S.steps = +e.target.value; applySettings(); };
  $('setColor').oninput = (e) => { S.color = e.target.value; applySettings(); };
  $('setOpacity').oninput = (e) => { S.opacity = +e.target.value; applySettings(); };
  $('setSentence').onchange = (e) => { S.sentence = e.target.checked; applySettings(); };
  $('setFollow').onchange = (e) => { S.follow = e.target.checked; applySettings(); };
  $('setFont').onchange = (e) => { S.font = e.target.value; applySettings(); };
  $('setSize').oninput = (e) => { S.size = +e.target.value; applySettings(); };
  $('setLine').oninput = (e) => { S.line = +e.target.value; applySettings(); };
  $('setLetter').oninput = (e) => { S.letter = +e.target.value; applySettings(); };
  $('setTheme').onchange = (e) => { S.theme = e.target.value; applySettings(); };
  const openS = (o) => { $('settings').classList.toggle('hidden', !o); $('scrim').classList.toggle('hidden', !o); renderTech(); };
  $('btnSettings').onclick = () => openS(true);
  $('btnCloseSettings').onclick = () => openS(false);
  $('scrim').onclick = () => openS(false);
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || $('viewReader').classList.contains('hidden')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  });
}

bind();
applySettings();
$('btnEdit').classList.add('hidden');
let saved = '';
try { saved = localStorage.getItem('bralnik.text') || ''; } catch (_) {}
$('inputText').value = saved || SAMPLE;
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
requestAnimationFrame(tick);
