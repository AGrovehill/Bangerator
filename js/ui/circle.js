// Circle of fifths: majors on the outside, relative minors in the middle, diminished inside.
// The chords of the current scale light up in their "home / away / tension" colors.

import { FIFTHS, FIFTHS_MAJOR_NAMES, FIFTHS_MINOR_NAMES, FIFTHS_DIM_NAMES, scaleSteps, harmonyScaleId,
  chordSemis, chordQuality, romanNumeral, chordFunction, keySignature, keyName, SCALES, mod } from '../theory.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

function arcPath(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
}

const FN_COLOR = { home: '#51cf66', away: '#4dabf7', tension: '#ff922b' };

export function renderCircle(container, project, { onPickRoot, onAudition }) {
  const S = 320, C = S / 2;
  const R = [158, 118, 84, 58];
  const svg = el('svg', { viewBox: `0 0 ${S} ${S}` });
  const root = project.root;
  const hid = harmonyScaleId(project.scale);
  const steps = scaleSteps(hid);
  const scalePcs = scaleSteps(project.scale).map(s => mod(root + s, 12));

  // Which ring segments are chords of this scale: key = `${ring}:${index}`
  const marks = new Map();
  steps.forEach((_, d) => {
    const semis = chordSemis(steps, d, 'triad');
    const r = mod(root + semis[0], 12);
    const q = chordQuality(semis).quality;
    let ring, idx;
    if (q === 'major') { ring = 0; idx = FIFTHS.indexOf(r); }
    else if (q === 'minor') { ring = 1; idx = FIFTHS.indexOf(mod(r - 9, 12)); }
    else if (q === 'dim') { ring = 2; idx = FIFTHS.indexOf(mod(r - 11, 12)); }
    else return;
    marks.set(`${ring}:${idx}`, { deg: d, roman: romanNumeral(steps, d), fn: chordFunction(d, steps) });
  });

  const names = [FIFTHS_MAJOR_NAMES, FIFTHS_MINOR_NAMES, FIFTHS_DIM_NAMES];
  for (let ring = 0; ring < 3; ring++) {
    for (let i = 0; i < 12; i++) {
      const a0 = ((i * 30 - 15 - 90) * Math.PI) / 180 + 0.012;
      const a1 = ((i * 30 + 15 - 90) * Math.PI) / 180 - 0.012;
      const mark = marks.get(`${ring}:${i}`);
      const isTonic = mark && mark.deg === 0;
      const base = ['#2a2e3c', '#232633', '#1d2029'][ring];
      const fill = mark ? FN_COLOR[mark.fn] : base;
      const path = el('path', {
        d: arcPath(C, C, R[ring + 1] + 1, R[ring] - 1, a0, a1),
        fill, 'fill-opacity': mark ? (isTonic ? 0.95 : 0.55) : 1,
        stroke: isTonic ? '#fff' : 'none', 'stroke-width': isTonic ? 2.5 : 0,
        class: 'seg',
      }, svg);
      const title = el('title', {}, path);
      title.textContent = mark
        ? `${names[ring][i]}: the ${mark.roman} chord in this key (${mark.fn})`
        : `${names[ring][i]}: not in this scale`;
      path.addEventListener('click', () => {
        if (ring === 0) onPickRoot(FIFTHS[i], 'major');
        else if (ring === 1) onPickRoot(mod(FIFTHS[i] + 9, 12), 'minor');
        if (mark) onAudition(mark.deg);
      });
      const am = (i * 30 - 90) * Math.PI / 180;
      const rm = (R[ring] + R[ring + 1]) / 2;
      const x = C + rm * Math.cos(am), y = C + rm * Math.sin(am);
      const label = names[ring][i];
      const t = el('text', {
        x, y: mark ? y - 2 : y + 4, 'text-anchor': 'middle',
        'font-size': ring === 0 ? (label.length > 3 ? 10 : 14) : ring === 1 ? 11 : 9,
        'font-weight': mark ? 700 : 400,
        fill: mark ? '#111' : '#8b91a8',
      }, svg);
      t.textContent = label;
      if (mark) {
        const rt = el('text', { x, y: y + (ring === 2 ? 8 : 11), 'text-anchor': 'middle', 'font-size': ring === 2 ? 8 : 10, 'font-weight': 800, fill: '#111' }, svg);
        rt.textContent = mark.roman;
      }
    }
  }
  // scale notes as dots on the rim: the "shape" of the scale
  for (let i = 0; i < 12; i++) {
    if (!scalePcs.includes(FIFTHS[i])) continue;
    const a = (i * 30 - 90) * Math.PI / 180;
    el('circle', { cx: C + (R[0] - 5) * Math.cos(a) + 0, cy: C + (R[0] - 5) * Math.sin(a), r: FIFTHS[i] === root ? 4 : 2.6, fill: FIFTHS[i] === root ? '#fff' : '#ffd43b' }, svg);
  }
  // center: key name + signature
  const sig = keySignature(root, project.scale);
  el('circle', { cx: C, cy: C, r: R[3] - 2, fill: '#15161c' }, svg);
  const k = el('text', { x: C, y: C - 2, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 800, fill: '#ffd43b' }, svg);
  k.textContent = keyName(root, project.scale);
  const s2 = el('text', { x: C, y: C + 14, 'text-anchor': 'middle', 'font-size': 9, fill: '#9aa1b8' }, svg);
  s2.textContent = SCALES[project.scale].name.split(' (')[0];
  const s3 = el('text', { x: C, y: C + 26, 'text-anchor': 'middle', 'font-size': 9, fill: '#9aa1b8' }, svg);
  s3.textContent = sig === 0 ? 'no ♯ or ♭' : sig > 0 ? `${sig} sharp${sig > 1 ? 's' : ''}` : `${-sig} flat${sig < -1 ? 's' : ''}`;
  if (hid !== project.scale) s3.textContent += ' (parent)';

  container.replaceChildren(svg);
}
