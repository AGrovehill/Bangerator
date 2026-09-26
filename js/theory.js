// Music theory core: scales, degrees, chords, progressions and suggestions.
// Everything here is pure data and math, with no audio or DOM code.

export const PC_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const PC_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
// Default display name for each key root (the most common spelling).
export const ROOT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// Interval names relative to a major scale; used as the small hint next to degree numbers.
export const INTERVAL_NAMES = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'];
export const MAJOR = [0, 2, 4, 5, 7, 9, 11];

// parent: 7-note scale used for chords when the scale itself has fewer notes.
// family: whether the scale sounds 'major' (bright) or 'minor' (dark) when sitting on 1.
export const SCALES = {
  major:       { name: 'Major (Ionian)',      steps: [0, 2, 4, 5, 7, 9, 11], family: 'major', mood: 'Bright and happy. The most common scale in pop.' },
  minor:       { name: 'Natural Minor (Aeolian)', steps: [0, 2, 3, 5, 7, 8, 10], family: 'minor', mood: 'Sad, serious, epic. The go-to for dark pop, trap and film.' },
  dorian:      { name: 'Dorian',              steps: [0, 2, 3, 5, 7, 9, 10], family: 'minor', mood: 'Minor but cool and hopeful. Funk, house, jazz, lo-fi.' },
  phrygian:    { name: 'Phrygian',            steps: [0, 1, 3, 5, 7, 8, 10], family: 'minor', mood: 'Dark and tense, the ♭2 feels threatening. Metal, drill, techno.' },
  lydian:      { name: 'Lydian',              steps: [0, 2, 4, 6, 7, 9, 11], family: 'major', mood: 'Dreamy and floating, like flying. Film music and space-y stuff.' },
  mixolydian:  { name: 'Mixolydian',          steps: [0, 2, 4, 5, 7, 9, 10], family: 'major', mood: 'Happy but relaxed and bluesy. Rock, funk, classic house.' },
  locrian:     { name: 'Locrian',             steps: [0, 1, 3, 5, 6, 8, 10], family: 'minor', mood: 'Unstable and weird. It never feels at home. Rare, but spooky.' },
  harmonicMinor: { name: 'Harmonic Minor',    steps: [0, 2, 3, 5, 7, 8, 11], family: 'minor', mood: 'Dramatic and a bit exotic. Classical, metal, dark trap.' },
  melodicMinor:  { name: 'Melodic Minor',     steps: [0, 2, 3, 5, 7, 9, 11], family: 'minor', mood: 'Smooth and jazzy, minor with a bright top.' },
  mixolydianFlat6: { name: 'Mixolydian ♭6',   steps: [0, 2, 4, 5, 7, 8, 10], family: 'major', mood: 'Major at the bottom, minor at the top. Bittersweet and a bit melancholic.' },
  phrygianDominant: { name: 'Phrygian Dominant', steps: [0, 1, 4, 5, 7, 8, 10], family: 'major', mood: 'Middle-eastern and flamenco flavors. Very dramatic.' },
  hungarianMinor: { name: 'Hungarian Minor',  steps: [0, 2, 3, 6, 7, 8, 11], family: 'minor', mood: 'Gothic and mysterious, with two spicy gaps.' },
  doubleHarmonic: { name: 'Double Harmonic',  steps: [0, 1, 4, 5, 7, 8, 11], family: 'major', mood: 'Strongly Middle Eastern. Very distinctive.' },
  majorPent:   { name: 'Major Pentatonic',    steps: [0, 2, 4, 7, 9], parent: 'major', family: 'major', mood: 'Five safe notes, super happy. Hard to hit a wrong note.' },
  minorPent:   { name: 'Minor Pentatonic',    steps: [0, 3, 5, 7, 10], parent: 'minor', family: 'minor', mood: 'Five safe notes, cool and bluesy. The rock/hip-hop solo scale.' },
  blues:       { name: 'Blues',               steps: [0, 3, 5, 6, 7, 10], parent: 'minor', family: 'minor', mood: 'Minor pentatonic plus one “blue note” for grit.' },
  wholeTone:   { name: 'Whole Tone',          steps: [0, 2, 4, 6, 8, 10], family: 'major', mood: 'Every step the same size, so it sounds like a dream or a flashback.' },
};

// Handy order for the scale picker and the "next scale" button.
export const SCALE_ORDER = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian',
  'harmonicMinor', 'melodicMinor', 'mixolydianFlat6', 'phrygianDominant', 'hungarianMinor', 'doubleHarmonic',
  'majorPent', 'minorPent', 'blues', 'wholeTone'];

// Semitone offset of each 7-note mode from its parent major scale (for key signatures).
const MODE_OFFSET = { major: 0, dorian: 2, phrygian: 4, lydian: 5, mixolydian: 7, minor: 9, locrian: 11 };

export const mod = (n, m) => ((n % m) + m) % m;

export function scaleSteps(scaleId) { return SCALES[scaleId].steps; }

// The 7-note scale chords are built from (the scale itself, or its parent for pentatonics).
export function harmonyScaleId(scaleId) { return SCALES[scaleId].parent || scaleId; }

// Degree index (0-based, can go past one octave or below 0) -> semitones above root.
export function degToSemis(steps, deg) {
  const n = steps.length;
  const oct = Math.floor(deg / n);
  return steps[mod(deg, n)] + 12 * oct;
}

// Semitones above root -> nearest degree index in a scale (for scale swapping).
export function semisToNearestDeg(steps, semis) {
  const n = steps.length;
  let best = 0, bestDist = Infinity;
  const oct = Math.floor(semis / 12);
  for (let o = oct - 1; o <= oct + 1; o++) {
    for (let i = 0; i < n; i++) {
      const s = steps[i] + 12 * o;
      const d = Math.abs(s - semis);
      // prefer the lower note on a tie so melodies don't creep upward
      if (d < bestDist || (d === bestDist && s < semis)) { bestDist = d; best = i + n * o; }
    }
  }
  return best;
}

export function midiName(midi, flats = false) {
  const names = flats ? PC_FLAT : PC_SHARP;
  return names[mod(midi, 12)] + (Math.floor(midi / 12) - 1);
}

export function degreeLabel(deg, n) { return String(mod(deg, n) + 1); }
export function degreeOctave(deg, n) { return Math.floor(deg / n); }

// Interval hint (like ♭3) for a degree in a scale.
export function intervalLabel(steps, deg) { return INTERVAL_NAMES[mod(steps[mod(deg, steps.length)], 12)]; }

// Correct letter spelling for 7-note scales (every letter used once). Falls back to sharps/flats.
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const ACC = { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };

function spellWithRootLetter(root, steps, letterIdx) {
  const out = [];
  let accCount = 0;
  for (let i = 0; i < 7; i++) {
    const L = (letterIdx + i) % 7;
    const pc = mod(root + steps[i], 12);
    let acc = mod(pc - LETTER_PC[L] + 6, 12) - 6;
    if (Math.abs(acc) > 2) return null;
    accCount += Math.abs(acc) * (Math.abs(acc) === 2 ? 3 : 1);
    out.push(LETTERS[L] + ACC[acc]);
  }
  return { names: out, cost: accCount };
}

export function spellScale(root, scaleId) {
  const steps = scaleSteps(scaleId);
  if (steps.length === 7) {
    let best = null;
    for (let L = 0; L < 7; L++) {
      const rootAcc = mod(root - LETTER_PC[L] + 6, 12) - 6;
      if (Math.abs(rootAcc) > 1) continue;
      const s = spellWithRootLetter(root, steps, L);
      // on a tie, prefer the flat spelling (E♭ minor rather than D♯ minor)
      if (s && (!best || s.cost < best.cost || (s.cost === best.cost && rootAcc < 0))) best = s;
    }
    if (best) return best.names;
  }
  const flats = prefersFlats(root, scaleId);
  return steps.map(s => (flats ? PC_FLAT : PC_SHARP)[mod(root + s, 12)]);
}

// Name of the key's root note as spelled in the scale.
export function keyName(root, scaleId) { return spellScale(root, scaleId)[0]; }

// Key signature: positive = sharps, negative = flats, using the parent major key.
export function keySignature(root, scaleId) {
  const hid = harmonyScaleId(scaleId);
  let majorRoot;
  if (hid in MODE_OFFSET) majorRoot = mod(root - MODE_OFFSET[hid], 12);
  else majorRoot = SCALES[hid].family === 'minor' ? mod(root + 3, 12) : root;
  // position on circle of fifths: C=0, G=1 ... F=-1
  const pos = mod(majorRoot * 7, 12); // how many fifths up from C
  return pos > 6 ? pos - 12 : (pos === 6 ? 6 : pos); // F♯ = 6 sharps
}

export function prefersFlats(root, scaleId) { return keySignature(root, scaleId) < 0; }

// ---------- Chords ----------

export const CHORD_TYPES = {
  triad: { name: 'Triad', idx: [0, 2, 4], help: 'Three notes: 1-3-5 of the chord. The basic chord.' },
  seventh: { name: '7th', idx: [0, 2, 4, 6], help: 'Adds the 7th, so it sounds richer and jazzier.' },
  sus2: { name: 'sus2', idx: [0, 1, 4], help: 'Swaps the 3rd for the 2nd. Open and floaty, neither happy nor sad.' },
  sus4: { name: 'sus4', idx: [0, 3, 4], help: 'Swaps the 3rd for the 4th. Hangs in the air, wants to resolve.' },
  add9: { name: 'add9', idx: [0, 2, 4, 8], help: 'Triad plus the 9th (2nd an octave up). Sparkly pop sound.' },
  power: { name: 'Power (5)', idx: [0, 4, 7], help: 'Just root and 5th (+octave). Neither happy nor sad. Rock and EDM.' },
};

// Semitone intervals of a chord built on degree `deg` of a 7-note scale (relative to the key root).
export function chordSemis(steps, deg, type = 'triad') {
  return CHORD_TYPES[type].idx.map(i => degToSemis(steps, deg + i));
}

const TRIAD_Q = { '4,7': '', '3,7': 'm', '3,6': '°', '4,8': '+', '2,7': 'sus2', '5,7': 'sus4', '4,6': '(♭5)', '2,6': 'sus2(♭5)', '5,6': 'sus4(♭5)', '2,8': 'sus2(♯5)', '5,8': 'sus4(♯5)', '3,8': 'm(♯5)' };
const SEVENTH_Q = { '4,7,11': 'maj7', '4,7,10': '7', '3,7,10': 'm7', '3,6,10': 'ø7', '3,6,9': '°7', '3,7,11': 'm(maj7)', '4,8,11': '+maj7', '4,8,10': '+7', '4,6,10': '7♭5', '4,6,11': 'maj7♭5' };

// Returns { quality: 'major'|'minor'|'dim'|'aug'|'sus'|'other', suffix }
export function chordQuality(semis, type = 'triad') {
  const root = semis[0];
  const rel = semis.map(s => s - root);
  if (type === 'power') return { quality: 'power', suffix: '5' };
  if (type === 'seventh') {
    const key = rel.slice(1, 4).map(x => mod(x, 12)).join(',');
    const suf = SEVENTH_Q[key];
    const tri = TRIAD_Q[rel.slice(1, 3).join(',')];
    return { quality: triadQuality(tri), suffix: suf ?? (tri ?? '?') + '7' };
  }
  const tri = TRIAD_Q[rel.slice(1, 3).map(x => mod(x, 12)).join(',')] ?? (type === 'sus2' || type === 'sus4' ? type : '?');
  const q = triadQuality(tri);
  if (type === 'add9') return { quality: q, suffix: (tri === 'm' ? 'm' : tri) + 'add9' };
  return { quality: q, suffix: tri };
}

function triadQuality(suffix) {
  if (suffix === '') return 'major';
  if (suffix === 'm') return 'minor';
  if (suffix === '°') return 'dim';
  if (suffix === '+') return 'aug';
  if (suffix && suffix.startsWith('sus')) return 'sus';
  return 'other';
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

// Roman numeral like "♭VII" or "ii°" for a chord on `deg` in scale `steps`.
export function romanNumeral(steps, deg, type = 'triad') {
  const semis = chordSemis(steps, deg, type);
  const { quality, suffix } = chordQuality(semis, type);
  const n = steps.length;
  const d = mod(deg, n);
  let base = ROMAN[d] || String(d + 1);
  let prefix = '';
  if (n === 7) {
    const diff = mod(steps[d] - MAJOR[d] + 6, 12) - 6;
    prefix = diff < 0 ? '♭'.repeat(-diff) : '♯'.repeat(diff);
  }
  const lower = quality === 'minor' || quality === 'dim';
  if (lower) base = base.toLowerCase();
  let suf = suffix;
  if (quality === 'minor') suf = suffix.replace(/^m(?!aj)/, ''); // lowercase already says minor
  if (quality === 'dim' && type !== 'seventh') suf = '°';
  return prefix + base + suf;
}

// Chord name like "Am7" or "F♯°".
export function chordName(root, scaleId, deg, type = 'triad') {
  const hid = harmonyScaleId(scaleId);
  const steps = scaleSteps(hid);
  const names = spellScale(root, hid);
  const semis = chordSemis(steps, deg, type);
  const { suffix } = chordQuality(semis, type);
  return names[mod(deg, steps.length)] + suffix;
}

// Function in the key: the "home / away / tension" story (from major-key theory).
export const FUNCTION_INFO = {
  home: { label: 'Home', color: 'var(--fn-home)', help: 'Stable and resolved. The music could stop here.' },
  away: { label: 'Away', color: 'var(--fn-away)', help: 'Moves away from home and creates motion.' },
  tension: { label: 'Tension', color: 'var(--fn-tension)', help: 'Unstable. Strongly suggests that Home comes next.' },
};
// Pass `steps` (the harmony scale) so diminished chords always count as tension.
export function chordFunction(deg, steps) {
  if (steps && chordQuality(chordSemis(steps, deg)).quality === 'dim') return 'tension';
  const d = mod(deg, 7);
  if (d === 0 || d === 2 || d === 5) return 'home';
  if (d === 1 || d === 3) return 'away';
  return 'tension';
}

// Where chords like to go next (the classic "chord map"), by degree index.
const NEXT = { 0: [3, 4, 5, 1], 1: [4, 6, 3], 2: [5, 3], 3: [4, 0, 1], 4: [0, 5], 5: [1, 3, 4], 6: [0, 2] };
const NEXT_WHY = {
  '0>3': 'Home to Away, the most common first move.',
  '0>4': 'Home to Tension. Creates a strong pull back home.',
  '0>5': 'Home to vi, its minor relative (they share two notes).',
  '0>1': 'Home to a soft Away chord.',
  '1>4': 'The famous ii → V, a jazz favorite. Sets up home perfectly.',
  '1>6': 'Away to a tense diminished chord.',
  '1>3': 'Sideways to the other Away chord.',
  '2>5': 'Down a 5th to vi, a smooth move.',
  '2>3': 'Leads into Away.',
  '3>4': 'Away → Tension, the classic build-up before landing.',
  '3>0': 'Away → Home, the “Amen” ending (plagal cadence).',
  '3>1': 'Stays in Away territory, gentle.',
  '4>0': 'Tension → Home, the strongest resolution (perfect cadence).',
  '4>5': 'Expected to go home, goes to vi instead (deceptive cadence).',
  '5>1': 'vi → ii, down a 5th, very smooth.',
  '5>3': 'vi → IV, very common in pop.',
  '5>4': 'vi → V, builds tension.',
  '6>0': 'vii° → Home, a strong pull.',
  '6>2': 'Slides to the iii chord.',
};

export function suggestNext(deg) {
  if (deg == null) return [0, 3, 4, 5].map(d => ({ deg: d, why: d === 0 ? 'Start at home, always safe.' : 'A fine place to start.' }));
  const d = mod(deg, 7);
  return NEXT[d].map(nd => ({ deg: nd, why: NEXT_WHY[`${d}>${nd}`] || 'Common move.' }));
}

// ---------- Progressions library (degrees are 0-based on the 7-note harmony scale) ----------
export const PROGRESSIONS = [
  { name: 'Pop Anthem', degs: [0, 4, 5, 3], family: 'major', help: 'I–V–vi–IV. Thousands of hits use it. Hopeful and singable.' },
  { name: 'Sad Pop / Emo', degs: [5, 3, 0, 4], family: 'major', help: 'vi–IV–I–V. The Pop Anthem chords, starting on the minor one.' },
  { name: '50s Doo-wop', degs: [0, 5, 3, 4], family: 'major', help: 'I–vi–IV–V. Old-school, sweet and nostalgic.' },
  { name: 'Three-Chord Rock', degs: [0, 3, 4, 3], family: 'major', help: 'I–IV–V–IV. The three most important chords.' },
  { name: 'Jazz Turnaround', degs: [1, 4, 0, 0], family: 'major', help: 'ii–V–I. Use 7th chords for instant jazz.' },
  { name: 'Circle Walk', degs: [5, 1, 4, 0], family: 'major', help: 'vi–ii–V–I. Each chord falls a 5th: pure gravity.' },
  { name: 'Royal Road', degs: [3, 4, 2, 5], family: 'major', help: 'IV–V–iii–vi. Emotional J-pop/anime staple.' },
  { name: 'Canon', degs: [0, 4, 5, 2, 3, 0, 3, 4], family: 'major', help: 'I–V–vi–iii–IV–I–IV–V. Pachelbel’s famous loop (8 slots).' },
  { name: 'Mixolydian Rock', degs: [0, 6, 3, 0], family: 'major', help: 'I–♭VII–IV–I. Best in Mixolydian. Stadium rock.' },
  { name: 'Lydian Float', degs: [0, 1, 0, 1], family: 'major', help: 'I–II. Best in Lydian. Dreamy film-score magic.' },
  { name: 'Epic Minor', degs: [0, 5, 2, 6], family: 'minor', help: 'i–VI–III–VII. Epic, cinematic, EDM drops.' },
  { name: 'Minor Loop', degs: [0, 5, 6, 0], family: 'minor', help: 'i–VI–VII–i. Rising hope, then back to the dark.' },
  { name: 'Andalusian Cadence', degs: [0, 6, 5, 4], family: 'minor', help: 'i–VII–VI–V. Walking down the stairs. Try Harmonic Minor.' },
  { name: 'Minor Cadence', degs: [0, 3, 4, 0], family: 'minor', help: 'i–iv–v–i. Use Harmonic Minor for a strong V.' },
  { name: 'Minor Circle', degs: [0, 3, 6, 2], family: 'minor', help: 'i–iv–VII–III. Moody and smooth. Lo-fi and trap.' },
  { name: 'Dorian Groove', degs: [0, 3, 0, 3], family: 'minor', help: 'i–IV. Best in Dorian. Funky minor vamp.' },
  { name: 'Phrygian Menace', degs: [0, 1, 0, 1], family: 'minor', help: 'i–♭II. Best in Phrygian. Dark, heavy, cinematic.' },
  { name: '12-Bar Blues', degs: [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4], family: 'major', help: 'The blues form. Needs 12 slots. Try Mixolydian and 7th chords.' },
];

// ---------- Harmonize: pick chords that fit a melody ----------
// notesBySlot: array of arrays of { pc (0-11 abs), weight }
// Returns for each slot a ranked list of { deg, score }.
export function harmonize(root, scaleId, notesBySlot) {
  const hid = harmonyScaleId(scaleId);
  const steps = scaleSteps(hid);
  const n = steps.length;
  const chordPcs = [];
  for (let d = 0; d < n; d++) chordPcs.push(chordSemis(steps, d, 'triad').map(s => mod(root + s, 12)));
  const out = [];
  let prev = null;
  notesBySlot.forEach((notes, i) => {
    const scores = [];
    for (let d = 0; d < n; d++) {
      let s = 0;
      for (const { pc, weight } of notes) s += chordPcs[d].includes(pc) ? weight : -0.6 * weight;
      if (chordPcs[d].length && notes.length) {
        // bonus when the lowest-weighted-heavy note is the chord root
        const rootHit = notes.filter(x => x.pc === chordPcs[d][0]).reduce((a, x) => a + x.weight, 0);
        s += rootHit * 0.3;
      }
      if (i === 0 && d === 0) s += 0.5;       // start at home
      if (d === 6 && n === 7) s -= 0.4;        // the dim chord rarely fits naturally
      if (prev != null && prev === d) s -= 0.3; // prefer movement
      if (prev != null && NEXT[mod(prev, 7)]?.includes(d)) s += 0.25;
      scores.push({ deg: d, score: s });
    }
    scores.sort((a, b) => b.score - a.score);
    out.push(scores);
    prev = notes.length ? scores[0].deg : prev;
  });
  return out;
}

// Choose an inversion / octave for chord pitches that stays close to the previous voicing.
export function voiceLead(midis, prevCenter, lo = 48, hi = 76) {
  if (prevCenter == null) return midis;
  let best = midis, bestD = Infinity;
  const n = midis.length;
  // try all inversions shifted by octaves
  for (let inv = 0; inv < n; inv++) {
    const v = midis.map((m, i) => (i < inv ? m + 12 : m)).sort((a, b) => a - b);
    for (let o = -2; o <= 2; o++) {
      const w = v.map(m => m + 12 * o);
      if (w[0] < lo || w[w.length - 1] > hi) continue;
      const c = w.reduce((a, b) => a + b, 0) / w.length;
      const d = Math.abs(c - prevCenter);
      if (d < bestD) { bestD = d; best = w; }
    }
  }
  return best;
}

// Which degrees of the *melody* scale belong to a chord (for highlighting rows).
export function chordPitchClasses(root, scaleId, deg, type = 'triad') {
  const steps = scaleSteps(harmonyScaleId(scaleId));
  return chordSemis(steps, deg, type).map(s => mod(root + s, 12));
}

// Step pattern text like "W W H W W W H".
export function stepPattern(steps) {
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const next = i + 1 < steps.length ? steps[i + 1] : 12;
    const d = next - steps[i];
    out.push(d === 1 ? 'H' : d === 2 ? 'W' : d === 3 ? 'W+H' : String(d));
  }
  return out;
}

// Circle of fifths order of pitch classes: C G D A E B F♯ D♭ A♭ E♭ B♭ F
export const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
export const FIFTHS_MAJOR_NAMES = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯/G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F'];
export const FIFTHS_MINOR_NAMES = ['Am', 'Em', 'Bm', 'F♯m', 'C♯m', 'G♯m', 'E♭m', 'B♭m', 'Fm', 'Cm', 'Gm', 'Dm'];
export const FIFTHS_DIM_NAMES = ['B°', 'F♯°', 'C♯°', 'G♯°', 'D♯°', 'A♯°', 'F°', 'C°', 'G°', 'D°', 'A°', 'E°'];
