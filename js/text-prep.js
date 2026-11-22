// Priprava slovenskega besedila za branje.
// Besedilo razdeli na odstavke → stavke → besede. Vsaka beseda ima
//   - display: kar vidi bralec (izvirnik),
//   - spoken:  kar dobi sintetizator (npr. "107°" → "sto sedem stopinj"),
//   - weight:  ocena dolžine izgovorjave (za časovno označevanje).

// ---------- Števila ----------
const U = ['nič', 'ena', 'dva', 'tri', 'štiri', 'pet', 'šest', 'sedem', 'osem', 'devet'];
const TEEN = ['deset', 'enajst', 'dvanajst', 'trinajst', 'štirinajst', 'petnajst',
  'šestnajst', 'sedemnajst', 'osemnajst', 'devetnajst'];
const TENS = ['', '', 'dvajset', 'trideset', 'štirideset', 'petdeset', 'šestdeset',
  'sedemdeset', 'osemdeset', 'devetdeset'];
const ORD_U = ['', 'prvi', 'drugi', 'tretji', 'četrti', 'peti', 'šesti', 'sedmi', 'osmi', 'deveti'];

function below100(n) {
  if (n < 10) return U[n];
  if (n < 20) return TEEN[n - 10];
  const t = Math.floor(n / 10), u = n % 10;
  return u ? U[u] + 'in' + TENS[t] : TENS[t];
}

function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  let s = '';
  if (h === 1) s = 'sto';
  else if (h === 2) s = 'dvesto';
  else if (h > 2) s = U[h] + 'sto';
  if (r) s += (s ? ' ' : '') + below100(r);
  return s || U[0];
}

// Oblika samostalnika glede na število (ednina, dvojina, množina 3–4, množina 5+).
export function pluralForm(n, forms) {
  const r = n % 100;
  if (r === 1) return forms[0];
  if (r === 2) return forms[1];
  if (r === 3 || r === 4) return forms[2];
  return forms[3];
}

export function numberToWords(n) {
  if (!Number.isFinite(n) || n < 0 || n >= 1e9) return String(n);
  if (n < 1000) return below1000(n);
  const parts = [];
  const mil = Math.floor(n / 1e6);
  const tis = Math.floor((n % 1e6) / 1000);
  const rest = n % 1000;
  if (mil) {
    const w = mil === 1 ? 'milijon' : below1000(mil) + ' ' + pluralForm(mil, ['milijon', 'milijona', 'milijone', 'milijonov']);
    parts.push(w);
  }
  if (tis) parts.push(tis === 1 ? 'tisoč' : below1000(tis) + ' tisoč');
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

export function ordinalToWords(n) {
  if (n <= 0 || n >= 1000) return numberToWords(n);
  if (n < 10) return ORD_U[n];
  if (n < 20) return TEEN[n - 10] + 'i';
  if (n < 100) {
    const t = Math.floor(n / 10), u = n % 10;
    return u ? U[u] + 'in' + TENS[t] + 'i' : TENS[t] + 'i';
  }
  const h = Math.floor(n / 100), r = n % 100;
  if (!r) return (h === 1 ? 'sto' : h === 2 ? 'dvesto' : U[h] + 'sto') + 'ti';
  return below1000(n - r) + ' ' + ordinalToWords(r);
}

// "3,5" → "tri cela pet"
function decimalToWords(str) {
  const [i, d] = str.split(',');
  const dec = d.length <= 2 ? numberToWords(parseInt(d, 10)) : d.split('').map(c => U[+c]).join(' ');
  return numberToWords(parseInt(i, 10)) + ' cela ' + dec;
}

// ---------- Kemijske formule ----------
const ELEMENTS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
  'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu ' +
  'Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm ' +
  'Bk Cf Es Fm Md No Lr').split(' '));

const LETTER = {
  a: 'a', b: 'be', c: 'ce', č: 'če', d: 'de', e: 'e', f: 'ef', g: 'ge', h: 'ha', i: 'i', j: 'je',
  k: 'ka', l: 'el', m: 'em', n: 'en', o: 'o', p: 'pe', q: 'ku', r: 'er', s: 'es', š: 'še', t: 'te',
  u: 'u', v: 've', w: 'dvojni ve', x: 'iks', y: 'ipsilon', z: 'ze', ž: 'že',
};

const SUB = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };

function formulaToWords(core) {
  // naboj iz nadpisanih znakov na koncu (npr. SO₄²⁻, Na⁺) ali "+"/"-" na koncu
  let charge = '';
  let m0 = core.match(/[⁰-⁹¹²³⁺⁻]+$/);
  let body0 = core;
  if (m0) { charge = [...m0[0]].map(c => SUP[c]).join(''); body0 = core.slice(0, -m0[0].length); }
  else if ((m0 = core.match(/^(.*[A-Za-z₀-₉\d])([+−-])$/))) { charge = m0[2] === '+' ? '+' : '-'; body0 = m0[1]; }
  const body = body0.replace(/[₀-₉]/g, c => SUB[c]);
  if (!/^(?:[A-Z][a-z]?\d*)+$/.test(body)) return null;
  const s = body + charge;
  const parts = [...body.matchAll(/([A-Z][a-z]?)(\d*)/g)];
  if (!parts.every(p => ELEMENTS.has(p[1]))) return null;
  const upper = (body.match(/[A-Z]/g) || []).length;
  const hasDigit = /\d/.test(s);
  const hasLower = /[a-z]/.test(body);
  // Formula je, če ima števko/naboj ali (male črke in vsaj 2 elementa). "ALI" ali "CO" ne štejeta.
  if (!(hasDigit || charge || (hasLower && upper >= 2))) return null;
  const out = [];
  for (const [, sym, num] of parts) {
    for (const ch of sym) out.push(LETTER[ch.toLowerCase()]);
    if (num) out.push(numberToWords(parseInt(num, 10)));
  }
  if (charge) {
    const n = charge.slice(0, -1);
    if (n) out.push(numberToWords(parseInt(n, 10)));
    out.push(charge.endsWith('+') ? 'plus' : 'minus');
  }
  return out.join(' ');
}

// ---------- Normalizacija ene besede ----------
const ABBREV = new Set(['npr', 'itd', 'tj', 'oz', 'dr', 'prof', 'št', 'str', 'ipd', 'idr', 'mag', 'gl',
  'pribl', 'ga', 'go', 'gdč', 'mr', 'ing', 'dipl', 'sv', 'jan', 'feb', 'avg', 'sep', 'okt', 'nov', 'dec', 'tel', 'm', 'oz']);
const ABBREV_SPOKEN = { npr: 'na primer', itd: 'in tako dalje', tj: 'to je', oz: 'oziroma', ipd: 'in podobno', idr: 'in drugo', 'št': 'številka', str: 'stran' };

// Vrne izgovorljivo obliko jedra besede (brez ločil spredaj/zadaj).
export function normalizeCore(core, { ordinal = false } = {}) {
  let m;
  // Stopinje: 107°, 25°C, 3,5 °C
  if ((m = core.match(/^(\d+(?:,\d+)?)°([CF])?$/))) {
    const num = m[1].includes(',') ? decimalToWords(m[1]) : numberToWords(parseInt(m[1], 10));
    const unit = m[1].includes(',') ? 'stopinje' : pluralForm(parseInt(m[1], 10), ['stopinja', 'stopinji', 'stopinje', 'stopinj']);
    return num + ' ' + unit + (m[2] === 'C' ? ' Celzija' : m[2] === 'F' ? ' Fahrenheita' : '');
  }
  // Odstotki: 25%, 3,5%
  if ((m = core.match(/^(\d+(?:,\d+)?)%$/))) {
    if (m[1].includes(',')) return decimalToWords(m[1]) + ' odstotka';
    const n = parseInt(m[1], 10);
    return (n === 1 ? 'en' : numberToWords(n)) + ' ' + pluralForm(n, ['odstotek', 'odstotka', 'odstotki', 'odstotkov']);
  }
  // Tisočice s pikami: 1.000.000
  if (/^\d{1,3}(\.\d{3})+$/.test(core)) return numberToWords(parseInt(core.replace(/\./g, ''), 10));
  // Decimalno: 3,5
  if (/^\d+,\d+$/.test(core)) return decimalToWords(core);
  // Številčenje poglavij: 4.3.2
  if (/^\d+(\.\d+)+$/.test(core)) return core.split('.').map(p => numberToWords(parseInt(p, 10))).join(', ');
  // Celo število
  if (/^\d+$/.test(core)) {
    const n = parseInt(core, 10);
    return ordinal ? ordinalToWords(n) : numberToWords(n);
  }
  // Kemijska formula
  const f = formulaToWords(core);
  if (f) return f;
  // Pogoste okrajšave
  const low = core.toLowerCase();
  if (ABBREV_SPOKEN[low]) return ABBREV_SPOKEN[low];
  // Števke sredi besede (npr. "2x") → besede
  if (/\d/.test(core)) return core.replace(/\d+/g, d => ' ' + numberToWords(parseInt(d, 10)) + ' ').replace(/\s+/g, ' ').trim();
  return core;
}

// ---------- Teža izgovorjave (zlogi) ----------
export function syllables(word) {
  const w = word.toLowerCase();
  let n = 0;
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    if ('aeiou'.includes(c)) n++;
    // zlogotvorni r (trg, vrt, prst)
    else if (c === 'r' && !'aeiou'.includes(w[i - 1] || ' ') && !'aeiou'.includes(w[i + 1] || ' ') && /\p{L}/u.test(w[i - 1] || '')) n++;
  }
  return Math.max(1, n);
}

function wordWeight(spoken) {
  const words = spoken.split(/\s+/).filter(Boolean);
  let syl = 0, chars = 0;
  for (const w of words) { syl += syllables(w); chars += w.length; }
  return 0.75 * syl + 0.25 * (chars / 2.5);
}

function pauseWeight(trail) {
  if (/[,)]/.test(trail)) return 0.9;
  if (/[;:–—]/.test(trail)) return 1.2;
  if (/[.!?…]/.test(trail)) return 1.4;
  return 0;
}

function finishSpoken(t) {
  t = t.replace(/\s+,/g, ',').replace(/,+/g, ',').replace(/^,\s*/, '').replace(/\s+/g, ' ').trim();
  // naslov v samih velikih črkah → male črke (da model ne črkuje)
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters.length > 3 && letters === letters.toUpperCase() && t.split(' ').length > 1) t = t.toLowerCase();
  // stavek, ki se konča z vejico, zaključimo s piko
  t = t.replace(/[,;:]$/, '.');
  return t;
}

// ---------- Tokenizacija in stavki ----------
const LEAD_RE = /^[(\[{"'«»„“‘‚]+/;
const TRAIL_RE = /[)\]}"'«»“”’.,;:!?…]+$/;

// Vrne { paragraphs: [{ sentences: [{ words: [...], spokenText }] }], words: [...] }
export function prepareText(text) {
  const allWords = [];
  const paragraphs = [];
  const paraTexts = text.replace(/\r/g, '').split(/\n+/); // vsaka vrstica je svoj odstavek

  for (const pText of paraTexts) {
    if (!pText.trim()) continue;
    const tokens = [...pText.matchAll(/\S+/g)].map(m => m[0]);
    const words = tokens.map(tok => {
      const lead = (tok.match(LEAD_RE) || [''])[0];
      let rest = tok.slice(lead.length);
      let trail = (rest.match(TRAIL_RE) || [''])[0];
      // "4.3.2" ali "107°." – piko obdržimo pri jedru, če je del števila
      let core = rest.slice(0, rest.length - trail.length);
      if (!core) { core = ''; }
      return { display: tok, lead, core, trail };
    });

    // Odločitve: vrstilni števnik in konec stavka
    const sentences = [];
    let cur = [];
    words.forEach((w, i) => {
      const next = words[i + 1];
      const nextStartsLower = next && /^[a-zčšžđć]/.test(next.lead ? next.core : next.core);
      const isNum = /^\d+$/.test(w.core);
      const abbr = ABBREV.has(w.core.toLowerCase());
      // "4. razred" → vrstilni števnik
      const ordinal = isNum && w.trail.startsWith('.') && nextStartsLower;
      let spokenCore = w.core ? normalizeCore(w.core, { ordinal }) : '';
      let trailSpoken = w.trail.replace(/["'«»“”’]/g, '').replace(/[)\]}]/g, ',');
      if (ordinal || (abbr && w.trail.startsWith('.'))) trailSpoken = trailSpoken.replace(/^\./, '');
      const leadSpoken = /[(\[{]/.test(w.lead) && cur.length ? ',' : '';
      // samostojni pomišljaj
      if (!w.core && /^[-–—]+$/.test(w.display)) { spokenCore = ''; trailSpoken = ','; }
      w.spoken = (leadSpoken ? leadSpoken + ' ' : '') + spokenCore + trailSpoken;
      w.weight = spokenCore ? wordWeight(spokenCore) : 0.2;
      w.pause = pauseWeight(trailSpoken);
      cur.push(w);
      const endsSentence = /[.!?…]/.test(w.trail) && !ordinal && !abbr &&
        (!next || !nextStartsLower);
      if (endsSentence || !next) {
        sentences.push(cur);
        cur = [];
      }
    });

    // Predolge stavke razdelimo (model ima omejitev ~300 znakov)
    const finalSentences = [];
    for (const s of sentences) {
      let chunk = [], len = 0;
      s.forEach((w, i) => {
        chunk.push(w); len += w.spoken.length + 1;
        const atComma = /[,;:]$/.test(w.spoken);
        if ((len > 220 && atComma) || len > 280 || i === s.length - 1) {
          finalSentences.push(chunk); chunk = []; len = 0;
        }
      });
    }

    const para = { sentences: [] };
    for (const sw of finalSentences) {
      const sentence = {
        words: sw,
        spokenText: finishSpoken(sw.map(w => w.spoken).join(' ')),
      };
      for (const w of sw) { w.sentence = sentence; w.index = allWords.length; allWords.push(w); }
      para.sentences.push(sentence);
    }
    paragraphs.push(para);
  }
  const sentences = paragraphs.flatMap(p => p.sentences);
  sentences.forEach((s, i) => { s.index = i; });
  return { paragraphs, sentences, words: allWords };
}
