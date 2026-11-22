// Ocena časov posameznih besed znotraj posnetka stavka.
// Supertonic vrne samo dolžino celega stavka, zato:
//   1) poiščemo začetek in konec govora (energija signala),
//   2) čas razdelimo sorazmerno z ocenjeno dolžino besed (zlogi + premori ob ločilih),
//   3) meje premaknemo na bližnje tišine v posnetku (pavze med besedami).

const FRAME = 0.01; // 10 ms

function rmsFrames(wav, sr) {
  const hop = Math.round(sr * FRAME);
  const n = Math.floor(wav.length / hop);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    const o = f * hop;
    for (let i = 0; i < hop; i++) { const v = wav[o + i]; s += v * v; }
    out[f] = Math.sqrt(s / hop);
  }
  return out;
}

// words: [{ weight, pause }] → [{ start, end }] v sekundah
export function estimateWordTimes(wav, sr, words) {
  const rms = rmsFrames(wav, sr);
  const total = wav.length / sr;
  if (!words.length) return [];
  let max = 0;
  for (const v of rms) if (v > max) max = v;
  const thr = Math.max(max * 0.06, 1e-4);

  let first = 0, last = rms.length - 1;
  while (first < rms.length && rms[first] < thr) first++;
  while (last > first && rms[last] < thr) last--;
  const speechStart = first * FRAME;
  const speechEnd = Math.min(total, (last + 1) * FRAME);
  const span = Math.max(0.05, speechEnd - speechStart);

  // Tišine znotraj govora (≥ 70 ms)
  const silences = [];
  let runStart = -1;
  for (let f = first; f <= last; f++) {
    if (rms[f] < thr) { if (runStart < 0) runStart = f; }
    else if (runStart >= 0) {
      if ((f - runStart) * FRAME >= 0.07) silences.push({ s: runStart * FRAME, e: f * FRAME, c: (runStart + f) / 2 * FRAME });
      runStart = -1;
    }
  }

  // Sorazmerna razdelitev
  const wsum = words.reduce((a, w) => a + w.weight + (w.pause || 0), 0) || 1;
  const times = [];
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    const start = speechStart + (acc / wsum) * span;
    acc += words[i].weight;
    const end = speechStart + (acc / wsum) * span;
    acc += words[i].pause || 0;
    times.push({ start, end });
  }

  // Premik mej na bližnje tišine
  const used = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    const boundary = (times[i].end + times[i + 1].start) / 2;
    const nextLen = times[i + 1].end - times[i + 1].start;
    const tol = Math.max(0.12, 0.35 * nextLen);
    let best = -1, bestD = Infinity;
    silences.forEach((sl, k) => {
      if (used.has(k)) return;
      const d = Math.abs(sl.c - boundary);
      if (d < tol && d < bestD && sl.c > times[i].start + 0.04) { best = k; bestD = d; }
    });
    if (best >= 0) {
      used.add(best);
      const sl = silences[best];
      const shift = sl.e - times[i + 1].start;
      times[i].end = sl.s;
      // premaknemo naslednjo besedo, ostale ohranijo relativni položaj
      times[i + 1].start = sl.e;
      if (times[i + 1].end <= times[i + 1].start) times[i + 1].end = times[i + 1].start + Math.max(0.05, nextLen - shift);
    }
  }
  // zagotovimo naraščanje
  for (let i = 1; i < times.length; i++) {
    if (times[i].start < times[i - 1].start + 0.03) times[i].start = times[i - 1].start + 0.03;
    if (times[i].end < times[i].start) times[i].end = times[i].start + 0.05;
  }
  return times;
}
