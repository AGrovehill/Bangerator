// Project model: instruments, patterns, the song arrangement, undo/redo.
// Saving lives in storage.js; this module only tells it when something changed.

import { DEFAULT_PATCH } from './audio.js';
import { DRUM_KINDS, DRUM_PARAMS } from './drums.js';
import { SCALES, scaleSteps, degToSemis, semisToNearestDeg, harmonyScaleId, mod } from './theory.js';
import { saveSampleData, loadSampleData } from './db.js';

export const STEPS_PER_BAR = 16;
export const MAX_BARS = 32;

const synth = (name, over) => ({ name, kind: 'synth', patch: { ...DEFAULT_PATCH, ...over } });

export function builtinPatches() {
  return {
    piano: { name: 'Piano', kind: 'sampler', set: 'piano', attack: 0.003, release: 0.4, volume: 0.9 },
    guitar: { name: 'Acoustic Guitar', kind: 'sampler', set: 'guitar', attack: 0.003, release: 0.3, volume: 0.9 },
    ebass: { name: 'Electric Bass', kind: 'sampler', set: 'bass', attack: 0.003, release: 0.15, volume: 1 },
    sine: synth('Sine Soft', { wave: 'sine', attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.4, cutoff: 12000 }),
    square: synth('Square Lead', { wave: 'square', attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.15, cutoff: 4000, filterEnv: 2000 }),
    saw: synth('Saw Lead', { wave: 'sawtooth', wave2: 'sawtooth', mix2: 0.5, detune: 14, attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2, cutoff: 5000, filterEnv: 3000 }),
    triangle: synth('Triangle Pluck', { wave: 'triangle', attack: 0.002, decay: 0.25, sustain: 0.0, release: 0.2, cutoff: 12000 }),
    sawbass: synth('Saw Bass', { wave: 'sawtooth', wave2: 'square', octave2: -1, mix2: 0.5, detune: 4, attack: 0.003, decay: 0.2, sustain: 0.5, release: 0.08, cutoff: 900, resonance: 4, filterEnv: 1500 }),
    sub808: synth('808 Sub', { wave: 'sine', wave2: 'triangle', mix2: 0.15, detune: 0, attack: 0.002, decay: 1.2, sustain: 0.3, release: 0.3, cutoff: 3000, pitchDrop: 12, pitchTime: 0.06, volume: 0.9 }),
    pad: synth('Warm Pad', { wave: 'sawtooth', wave2: 'triangle', mix2: 0.6, detune: 18, attack: 0.35, decay: 0.8, sustain: 0.7, release: 0.9, cutoff: 1800, resonance: 1, volume: 0.55 }),
    stab: synth('Trance Stab', { wave: 'sawtooth', wave2: 'square', mix2: 0.4, detune: 16, attack: 0.003, decay: 0.22, sustain: 0.35, release: 0.18, cutoff: 3200, resonance: 3, filterEnv: 3500, volume: 0.6 }),
    keys: synth('Soft Keys', { wave: 'triangle', wave2: 'sine', octave2: 1, mix2: 0.35, detune: 3, attack: 0.004, decay: 0.6, sustain: 0.25, release: 0.35, cutoff: 6000, volume: 0.7 }),
  };
}

// Counter + random tail: ids must stay unique across sessions, since projects keep growing over time.
let idCounter = Date.now() % 100000;
export const uid = (p = 'id') => `${p}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const TRACK_COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ffa94d', '#63e6be', '#f783ac'];

// Per-channel effect settings (see the Mix & FX tab).
export const defaultFx = (over = {}) => ({
  drive: 0, cutoff: 20000, hpCut: 10, reso: 0, reverb: 0, delay: 0, pump: 0,
  eqLow: 0, eqMid: 0, eqMidFreq: 1000, eqHigh: 0, comp: 0, ...over,
});

// mode 'scale': notes are { step, len, deg, alt } (scale degrees, follow the key)
// mode 'piano': notes are { step, len, midi } (fixed pitches, like a normal piano roll)
export function newTrack(name, patch, octave, color, notes = [], mode = 'scale') {
  return { id: uid('t'), name, patch, octave, range: 2, volume: 0.8, pan: 0, mute: false, solo: false, color, notes, mode, fx: defaultFx() };
}

function beat(pattern) { // "x...x...x...x..." -> velocities
  return [...pattern].map(c => (c === 'x' ? 1 : c === 'X' ? 2 : 0));
}

// Main riff of "Meet Her at the Love Parade" (Da Hool, 1997), taken from a MIDI transcription.
// Two voices in parallel thirds over a single D chord, in D Mixolydian ♭6 (D E F♯ G A B♭ C).
// Each entry is [step, length, degree]; degree 0 = D4 with the track at octave 4.
const LOVE_PARADE_RIFF = [
  [0, 1, 4], [0, 1, 6], [1, 1, 4], [1, 1, 6], [2, 1, 4], [2, 1, 6], [4, 1, 3], [4, 1, 5], [6, 1, 3], [6, 1, 5],
  [8, 2, 2], [8, 2, 4], [11, 1, 2], [11, 1, 4], [14, 3, 4], [14, 3, 2],
  [18, 1, 2], [18, 1, 4], [19, 1, 2], [19, 1, 4], [20, 1, 5], [20, 1, 3], [22, 1, 3], [22, 1, 5],
  [24, 2, 6], [24, 2, 4], [27, 1, 4], [27, 1, 6], [30, 1, 4], [30, 1, 6],
  [32, 1, 7], [32, 1, 5], [33, 1, 5], [33, 1, 7], [34, 1, 5], [34, 1, 7], [36, 1, 6], [36, 1, 4], [38, 1, 5], [38, 1, 3],
  [40, 2, 4], [40, 2, 2], [43, 1, 4], [43, 1, 2], [46, 3, 4], [46, 3, 2],
  [50, 1, 2], [50, 1, 4], [51, 1, 5], [51, 1, 3], [52, 1, 4], [52, 1, 6], [54, 1, 3], [54, 1, 5],
  [56, 2, 2], [56, 2, 4], [59, 1, 2], [59, 1, 4], [62, 1, 2], [62, 1, 4],
];

// Shared effect buses: one reverb and one tempo-synced delay that every channel can send to.
export const defaultFxBus = () => ({ reverbSize: 2.2, delaySteps: 3, delayFeedback: 0.35, pumpRelease: 0.5, master: 0.8 });

// ---------- Patterns ----------
// A project has instruments (tracks, the chord channel, drum rows) and a list of patterns.
// A pattern holds what gets played: notes per track, chord slots, drum steps per row, plus its own
// length and key. The song places patterns on the playlist.
//
// The OPEN pattern's content also sits where the editors look for it (track.notes, chords.slots,
// drum row steps, project.bars/root/scale/keyChanges), so the editors work on it directly.
// commit() copies it back into project.patterns, and openPattern() swaps another one in.

export const PATTERN_COLORS = ['#ffa94d', '#4dabf7', '#69db7c', '#da77f2', '#ff6b6b', '#ffd43b', '#63e6be', '#f783ac', '#748ffc', '#a9e34b'];

// chordsGuide: the chord lane is shown and used for suggestions, but stays silent (another pattern plays the chords).
export const emptyContent = (bars, root, scale) => ({ bars, root, scale, keyChanges: [], notes: {}, chordSlots: [], slotSteps: 16, chordsGuide: false, drumSteps: {}, auto: [] });

function captureOpen(p) {
  return {
    bars: p.bars, root: p.root, scale: p.scale, keyChanges: p.keyChanges,
    notes: Object.fromEntries(p.tracks.map(t => [t.id, t.notes])),
    chordSlots: p.chords.slots, slotSteps: p.chords.slotSteps, chordsGuide: !!p.chordsGuide,
    drumSteps: Object.fromEntries(p.drums.rows.map(r => [r.id, r.steps])),
    auto: p.patAuto,
  };
}

function applyContent(p, c) {
  p.bars = c.bars; p.root = c.root; p.scale = c.scale; p.keyChanges = c.keyChanges || [];
  for (const t of p.tracks) t.notes = c.notes?.[t.id] || [];
  p.chords.slots = c.chordSlots || [];
  p.chords.slotSteps = c.slotSteps || 16;
  p.chordsGuide = !!c.chordsGuide;
  for (const r of p.drums.rows) r.steps = c.drumSteps?.[r.id] || [];
  p.patAuto = c.auto || [];
}

export const patternById = (p, id) => p.patterns.find(x => x.id === id);
export const openPatternObj = (p = store.project) => patternById(p, p.currentPattern);

export function flushOpen(p = store.project) {
  const pat = openPatternObj(p);
  if (pat) Object.assign(pat, captureOpen(p));
}

function makePattern(p, name, content) {
  const used = new Set(p.patterns.map(x => x.color));
  const color = PATTERN_COLORS.find(c => !used.has(c)) || PATTERN_COLORS[p.patterns.length % PATTERN_COLORS.length];
  return { id: uid('p'), name, color, ...content };
}

function nextPatternName(p) {
  let n = p.patterns.length + 1;
  while (p.patterns.some(x => x.name === `Pattern ${n}`)) n++;
  return `Pattern ${n}`;
}

// Open a pattern in the editors. Not an undo step: every undo snapshot is a complete project anyway.
export function openPattern(id) {
  const p = store.project;
  if (id === p.currentPattern) return;
  const pat = patternById(p, id);
  if (!pat) return;
  flushOpen(p);
  applyContent(p, pat);
  p.currentPattern = id;
  store.lastSnapshot = JSON.stringify(p);
  scheduleSave();
  emit('pattern');
}

function insertAndOpen(p, pat, after) {
  p.patterns.splice(p.patterns.indexOf(after) + 1, 0, pat);
  applyContent(p, pat);
  p.currentPattern = pat.id;
  commit('pattern');
  return pat;
}

export function newPattern() {
  const p = store.project;
  flushOpen(p);
  return insertAndOpen(p, makePattern(p, nextPatternName(p), emptyContent(p.bars, p.root, p.scale)), openPatternObj(p));
}

export function clonePattern(id = store.project.currentPattern) {
  const p = store.project;
  flushOpen(p);
  const src = patternById(p, id);
  if (!src) return null;
  const { id: _, name, color: __, ...content } = structuredClone(src);
  const base = name.replace(/ \d+$/, '');
  let n = 2;
  while (p.patterns.some(x => x.name === `${base} ${n}`)) n++;
  return insertAndOpen(p, makePattern(p, `${base} ${n}`, content), src);
}

export function deletePattern(id) {
  const p = store.project;
  if (p.patterns.length < 2) return false;
  flushOpen(p);
  const i = p.patterns.findIndex(x => x.id === id);
  if (i < 0) return false;
  p.patterns.splice(i, 1);
  p.song.clips = p.song.clips.filter(c => c.pat !== id);
  if (p.currentPattern === id) {
    const next = p.patterns[Math.min(i, p.patterns.length - 1)];
    applyContent(p, next);
    p.currentPattern = next.id;
  }
  commit('pattern');
  return true;
}

// Removing an instrument removes its notes from every pattern.
export function deleteTrack(t) {
  const p = store.project;
  p.tracks.splice(p.tracks.indexOf(t), 1);
  for (const pat of p.patterns) delete pat.notes?.[t.id];
  dropAutomation(p, t.id);
  commit('all');
}

export function deleteDrumRow(r) {
  const p = store.project;
  p.drums.rows.splice(p.drums.rows.indexOf(r), 1);
  for (const pat of p.patterns) delete pat.drumSteps?.[r.id];
  dropAutomation(p, 'row:' + r.id);
  commit('all');
}

// Automation lanes of a channel that no longer exists.
function dropAutomation(p, channel) {
  const keep = l => !l.target.startsWith(channel + '|');
  p.patAuto = p.patAuto.filter(keep);
  for (const pat of p.patterns) pat.auto = (pat.auto || []).filter(keep);
  p.song.auto = p.song.auto.filter(keep);
}

// A project-shaped object for any pattern, for playback and previews. With `key` ({ root, scale })
// the pattern is played in another key: scale tracks keep their degrees, piano tracks transpose.
export function patternView(p, id, key = null) {
  const isOpen = id === p.currentPattern;
  if (isOpen && !key) return p;
  const c = isOpen ? captureOpen(p) : patternById(p, id);
  if (!c) return null;
  const v = contentView(p, c);
  return key && (key.root !== v.root || key.scale !== v.scale) ? transposeView(v, key) : v;
}

// A project-shaped object showing one pattern's stored content.
export function contentView(p, c) {
  return {
    ...p, bars: c.bars, root: c.root, scale: c.scale, keyChanges: c.keyChanges || [],
    tracks: p.tracks.map(t => ({ ...t, notes: c.notes?.[t.id] || [] })),
    chords: { ...p.chords, slots: c.chordSlots || [], slotSteps: c.slotSteps || 16 },
    chordsGuide: !!c.chordsGuide,
    drums: { ...p.drums, rows: p.drums.rows.map(r => ({ ...r, steps: c.drumSteps?.[r.id] || [] })) },
    patAuto: c.auto || [],
  };
}

// Change stored patterns directly (any of them, including the open one): fn(project) edits
// project.patterns[...] and the editors are refreshed from the result. The caller commits.
export function withPatterns(fn, p = store.project) {
  flushOpen(p);
  const r = fn(p);
  applyContent(p, openPatternObj(p));
  return r;
}

// Add an empty pattern without opening it.
export function addPattern(p, name, bars, color) {
  const pat = makePattern(p, name, emptyContent(bars, p.root, p.scale));
  if (color) pat.color = color;
  p.patterns.push(pat);
  return pat;
}

function transposeView(v, key) {
  // Move by the smallest interval (D -> A goes down a 4th, not up a 5th). Roots may leave 0..11 here;
  // a view is only used to compute pitches, which handle that fine.
  const shift = mod(key.root - v.root + 6, 12) - 6;
  const oldSteps = scaleSteps(v.scale), newSteps = scaleSteps(key.scale);
  const later = v.keyChanges.filter(k => k.bar > 0 && k.bar < v.bars).sort((a, b) => a.bar - b.bar);
  const firstEnd = (later[0]?.bar ?? v.bars) * STEPS_PER_BAR;
  const remap = oldSteps.length !== newSteps.length;
  v.tracks = v.tracks.map(t => ({ ...t, notes: t.notes.map(n => {
    if (t.mode === 'piano') return { ...n, midi: n.midi + shift };
    if (!remap || n.step >= firstEnd) return n;
    return { ...n, deg: semisToNearestDeg(newSteps, degToSemis(oldSteps, n.deg) + (n.alt || 0)), alt: 0 };
  }) }));
  const newH = scaleSteps(harmonyScaleId(key.scale)).length;
  if (newH !== scaleSteps(harmonyScaleId(v.scale)).length) {
    const c = v.chords;
    v.chords = { ...c, slots: c.slots.map((s, i) => (s && i * c.slotSteps < firstEnd ? { ...s, deg: mod(s.deg, newH) } : s)) };
  }
  v.keyChanges = later.map(k => ({ ...k, root: k.root + shift }));
  v.root = v.root + shift;
  v.scale = key.scale;
  return v;
}

// ---------- Song (playlist) ----------
// song.lanes: [{ id, name, mute }] (rows of the playlist; any pattern can go on any lane)
// song.clips: [{ id, pat, lane (index), bar, len (bars), key: null | { root, scale } }]
//   A clip longer than its pattern repeats the pattern; a shorter one cuts it off.
// song.loop: null | { start, end } in bars
// song.markers: [{ bar, name }] section labels on the ruler (Intro, Drop...)
// song.auto: automation lanes over the whole song, [{ id, target, points: [{ step, value 0..1 }] }]
// (Patterns have their own lanes in pattern.auto, with steps relative to the pattern; see automation.js.)
export const newLane = i => ({ id: uid('l'), name: `Track ${i + 1}`, mute: false });
export const defaultLanes = () => Array.from({ length: 6 }, (_, i) => newLane(i));
export const newClip = (pat, lane, bar, len, key = null) => ({ id: uid('c'), pat, lane, bar, len, key });

export function songBars(p = store.project) {
  return p.song.clips.reduce((m, c) => Math.max(m, c.bar + c.len), 0);
}

// ---------- Default and blank projects ----------
function drumRows() {
  return DRUM_KINDS.map(({ kind, name }) => ({ id: uid('d'), name, kind, vol: 0.9, pan: 0, pitch: 0, mute: false, solo: false, steps: [], fx: defaultFx() }));
}

function baseProject(name) {
  return {
    version: 2,
    name,
    bpm: 130,
    root: 2, scale: 'major', keyChanges: [], bars: 4, // (open pattern)
    fxBus: defaultFxBus(),
    swing: 0,
    showNoteNames: false,
    patches: builtinPatches(),
    drumParams: structuredClone(DRUM_PARAMS),
    tracks: [],
    chords: {
      patch: 'pad', octave: 3, volume: 0.45, pan: 0, mute: false, solo: false,
      style: 'block', slotSteps: 16, voiceLead: true, slots: [],
      fx: defaultFx({ reverb: 0.35, pump: 0.6 }),
    },
    drums: { volume: 0.9, rows: drumRows(), fx: defaultFx({ reverb: 0.05 }), split: false },
    patAuto: [], // (open pattern)
    chordsGuide: false, // (open pattern)
    guide: null, // genre guide progress: { genre, step, done, roles }
    patterns: [],
    currentPattern: null,
    song: { lanes: defaultLanes(), clips: [], loop: null, auto: [], markers: [] },
  };
}

// The demo: the Love Parade riff as three patterns, arranged into a short song that lifts a tone at the end.
export function defaultProject() {
  const p = baseProject('Meet Her at the Love Parade (riff)');
  const n = (step, len, deg) => ({ step, len, deg, vel: 0.85 });
  const riff = () => LOVE_PARADE_RIFF.map(([s, l, d]) => n(s, l, d));
  // off-beat trance bass on the root, like the original's off-beat bass hits
  const bass = () => { const b = []; for (let s = 2; s < 64; s += 4) b.push(n(s, 2, 0)); return b; };
  const riffTrack = newTrack('Riff', 'stab', 4, TRACK_COLORS[0]);
  riffTrack.fx = defaultFx({ reverb: 0.2, delay: 0.25 });
  const bassTrack = newTrack('Bass', 'sawbass', 2, TRACK_COLORS[1]);
  bassTrack.fx = defaultFx({ pump: 0.3 });
  p.tracks = [riffTrack, bassTrack];
  // drum pattern from the MIDI file's full section
  const beatOf = { kick: 'x...x...x...x...', snare: '....x.......x...', clap: '....X.......X...', chat: 'xx..xx..xx..xx..', ohat: '..x...x...x...x.' };
  const vols = { snare: 0.45, clap: 0.6, chat: 0.4, ohat: 0.45 };
  for (const r of p.drums.rows) if (vols[r.kind]) r.vol = vols[r.kind];
  const content = (notes, chords, kinds) => ({
    ...emptyContent(4, 2, 'mixolydianFlat6'),
    notes,
    chordSlots: chords ? [0, 0, 0, 0].map(deg => ({ deg, type: 'triad' })) : [],
    drumSteps: Object.fromEntries(p.drums.rows.filter(r => kinds.includes(r.kind)).map(r => [r.id, beat(beatOf[r.kind].repeat(4))])),
  });
  const main = makePattern(p, 'Main riff', content({ [riffTrack.id]: riff(), [bassTrack.id]: bass() }, true, Object.keys(beatOf)));
  p.patterns.push(main);
  const groove = makePattern(p, 'Beat + bass', content({ [bassTrack.id]: bass() }, false, ['kick', 'chat', 'ohat']));
  p.patterns.push(groove);
  const brk = makePattern(p, 'Breakdown', content({ [riffTrack.id]: riff() }, true, []));
  p.patterns.push(brk);
  p.song.clips = [
    newClip(groove.id, 0, 0, 8),
    newClip(main.id, 0, 8, 16),
    newClip(brk.id, 0, 24, 8),
    newClip(main.id, 0, 32, 16, { root: 4, scale: 'mixolydianFlat6' }), // up a whole tone for the last drop
  ];
  applyContent(p, main);
  p.currentPattern = main.id;
  return p;
}

export function blankProject(name = 'Untitled') {
  const p = baseProject(name);
  p.bpm = 120;
  p.tracks = [newTrack('Lead', 'saw', 4, TRACK_COLORS[0]), newTrack('Bass', 'sawbass', 2, TRACK_COLORS[1])];
  const pat = makePattern(p, 'Pattern 1', emptyContent(4, 9, 'minor'));
  p.patterns.push(pat);
  applyContent(p, pat);
  p.currentPattern = pat.id;
  return p;
}

// ---------- Store ----------
const listeners = new Set();
// undoStack: earlier project snapshots (oldest first). undoTimes[i]: when the change that left
// undoStack[i] was made. redoStack / redoTimes: the same for undone changes (most recently undone last).
export const store = {
  project: null,
  undoStack: [],
  undoTimes: [],
  redoStack: [],
  redoTimes: [],
  lastSnapshot: null,
};
const MAX_UNDO = 200;

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { listeners.forEach(fn => fn(what)); }

let changeHandler = null;
// storage.js registers here to hear about every saved change.
export function onProjectChanged(fn) { changeHandler = fn; }
function scheduleSave() { changeHandler?.(); }

// Call after every finished edit. `what` hints which views need a redraw.
export function commit(what = 'all') {
  flushOpen(store.project);
  const snap = JSON.stringify(store.project);
  if (snap !== store.lastSnapshot) {
    if (store.lastSnapshot) { store.undoStack.push(store.lastSnapshot); store.undoTimes.push(Date.now()); }
    if (store.undoStack.length > MAX_UNDO) { store.undoStack.shift(); store.undoTimes.shift(); }
    store.redoStack = [];
    store.redoTimes = [];
    store.lastSnapshot = snap;
    scheduleSave();
  }
  emit(what);
}

// Keep a change that shouldn't be an undo step (which guide step you're on, for example).
export function saveQuietly() {
  flushOpen(store.project);
  store.lastSnapshot = JSON.stringify(store.project);
  scheduleSave();
}

// For live changes during a drag: redraw without adding an undo step.
export function touch(what = 'all') { emit(what); }

// Undo / redo `n` steps at once (the history list jumps several steps).
export function undo(n = 1) {
  n = Math.min(n, store.undoStack.length);
  if (n < 1) return;
  for (let i = 0; i < n; i++) {
    store.redoStack.push(store.lastSnapshot);
    store.redoTimes.push(store.undoTimes.pop());
    store.lastSnapshot = store.undoStack.pop();
  }
  store.project = JSON.parse(store.lastSnapshot);
  scheduleSave();
  emit('all');
}
export function redo(n = 1) {
  n = Math.min(n, store.redoStack.length);
  if (n < 1) return;
  for (let i = 0; i < n; i++) {
    store.undoStack.push(store.lastSnapshot);
    store.undoTimes.push(store.redoTimes.pop());
    store.lastSnapshot = store.redoStack.pop();
  }
  store.project = JSON.parse(store.lastSnapshot);
  scheduleSave();
  emit('all');
}

// Load a project (no save is triggered: it came from somewhere already).
export function setProject(p) {
  store.project = migrate(p);
  store.undoStack = [];
  store.undoTimes = [];
  store.redoStack = [];
  store.redoTimes = [];
  store.lastSnapshot = JSON.stringify(store.project);
  emit('all');
}

export function migrate(p) {
  const base = baseProject(p.name || 'Untitled');
  for (const k of ['fxBus', 'swing', 'showNoteNames', 'patches', 'drumParams', 'tracks', 'chords', 'drums', 'keyChanges', 'bars', 'bpm', 'root', 'scale']) {
    if (p[k] === undefined) p[k] = base[k];
  }
  p.fxBus = { ...defaultFxBus(), ...p.fxBus };
  // The old global "keep their pitch" switch became per-track piano-roll mode.
  const fixed = p.noteMode === 'fixed';
  delete p.noteMode;
  for (const t of p.tracks) {
    t.fx = defaultFx(t.fx);
    t.notes ||= [];
    if (!t.mode) {
      t.mode = 'scale';
      if (fixed) {
        t.notes = t.notes.map(n => ({ step: n.step, len: n.len, vel: n.vel,
          midi: 12 * (t.octave + 1) + p.root + degToSemis(scaleSteps(p.scale), n.deg) + (n.alt || 0) }));
        t.mode = 'piano';
      }
    }
  }
  p.chords.fx = defaultFx(p.chords.fx);
  p.chords.slots ||= [];
  p.drums.fx = defaultFx(p.drums.fx);
  p.drums.split ??= false;
  for (const r of p.drums.rows) { r.steps ||= []; r.fx = defaultFx(r.fx); r.pan ??= 0; }
  // kit sounds added in later versions (ride, riser, impact) go after the built-in rows
  for (const { kind, name } of DRUM_KINDS) {
    if (p.drums.rows.some(r => r.kind === kind)) continue;
    const at = p.drums.rows.findIndex(r => r.kind === 'sample');
    p.drums.rows.splice(at < 0 ? p.drums.rows.length : at, 0, { id: uid('d'), name, kind, vol: 0.9, pan: 0, pitch: 0, mute: false, solo: false, steps: [], fx: defaultFx() });
  }
  p.patAuto ||= [];
  // make sure built-in patches exist (older saves)
  const b = builtinPatches();
  for (const k of Object.keys(b)) if (!p.patches[k]) p.patches[k] = b[k];
  for (const k of Object.keys(DRUM_PARAMS)) p.drumParams[k] = { ...DRUM_PARAMS[k], ...(p.drumParams[k] || {}) };

  // Version 1 had a single loop: it becomes pattern 1, placed once in the song.
  if (!Array.isArray(p.patterns) || !p.patterns.length) {
    p.patterns = [];
    const pat = makePattern(p, 'Pattern 1', structuredClone(captureOpen(p)));
    p.patterns.push(pat);
    p.currentPattern = pat.id;
    p.song = { lanes: defaultLanes(), clips: [newClip(pat.id, 0, 0, p.bars)], loop: null };
  }
  p.song ||= { lanes: defaultLanes(), clips: [], loop: null };
  p.song.auto ||= [];
  p.song.markers ||= [];
  p.guide ??= null;
  for (const pat of p.patterns) pat.auto ||= [];
  if (!p.song.lanes?.length) p.song.lanes = defaultLanes();
  p.song.clips = (p.song.clips || []).filter(c => patternById(p, c.pat));
  for (const c of p.song.clips) c.lane = Math.max(0, Math.min(p.song.lanes.length - 1, c.lane | 0));
  if (!patternById(p, p.currentPattern)) p.currentPattern = p.patterns[0].id;
  applyContent(p, openPatternObj(p));
  p.version = 2;
  return p;
}

// ---------- Key sections ----------
// The song can change key/scale at chosen bars. Section 0 is project.root/scale (from bar 1);
// project.keyChanges holds the later ones: [{ bar (0-based), root, scale }], sorted by bar.
export function sections(p = store.project) {
  return [{ bar: 0, root: p.root, scale: p.scale }, ...p.keyChanges.filter(k => k.bar > 0 && k.bar < p.bars)];
}

// Index of the section that is active at `step`.
export function sectionIndexAt(p, step) {
  const secs = sections(p);
  let i = 0;
  for (let k = 1; k < secs.length; k++) if (secs[k].bar * STEPS_PER_BAR <= step) i = k;
  return i;
}

export function keyAt(p, step) { return sections(p)[sectionIndexAt(p, step)]; }

// Step range [start, end) covered by section i.
export function sectionRange(p, i) {
  const secs = sections(p);
  const start = secs[i].bar * STEPS_PER_BAR;
  const end = i + 1 < secs.length ? secs[i + 1].bar * STEPS_PER_BAR : p.bars * STEPS_PER_BAR;
  return [start, end];
}

function sectionObj(p, i) { return i === 0 ? p : sections(p)[i]; }

export function addKeyChange(bar) {
  const p = store.project;
  if (bar <= 0 || bar >= p.bars || p.keyChanges.some(k => k.bar === bar)) return -1;
  const { root, scale } = keyAt(p, bar * STEPS_PER_BAR);
  p.keyChanges.push({ bar, root, scale });
  p.keyChanges.sort((a, b) => a.bar - b.bar);
  commit('all');
  return sections(p).findIndex(s => s.bar === bar);
}

export function removeKeyChange(i) {
  const p = store.project;
  if (i <= 0) return;
  const k = sections(p)[i];
  p.keyChanges = p.keyChanges.filter(x => x !== k);
  commit('all');
}

// Change the key and/or scale of one section.
// Scale-mode tracks store scale degrees, so they follow automatically: same notes, new mood.
// When the new scale has a different number of notes (e.g. 7 -> 5), notes in that section move to the
// nearest pitch and remember the original, so switching back restores the melody.
// Piano-roll tracks store fixed pitches and never move (that's how most DAWs behave).
export function changeKey(newRoot, newScale, i = 0) {
  const p = store.project;
  const sec = sectionObj(p, i);
  const [start, end] = sectionRange(p, i);
  const oldSteps = scaleSteps(sec.scale);
  const newSteps = scaleSteps(newScale);
  if (oldSteps.length !== newSteps.length) {
    for (const t of p.tracks) {
      if (t.mode === 'piano') continue;
      for (const note of t.notes) {
        if (note.step < start || note.step >= end) continue;
        if (note.src && note.src.n === newSteps.length) {
          note.deg = note.src.deg;
          note.alt = note.src.alt;
          delete note.src;
          continue;
        }
        if (!note.src) note.src = { n: oldSteps.length, deg: note.deg, alt: note.alt || 0 };
        const semis = degToSemis(oldSteps, note.deg) + (note.alt || 0);
        note.deg = semisToNearestDeg(newSteps, semis);
        note.alt = 0;
      }
    }
  }
  const oldH = scaleSteps(harmonyScaleId(sec.scale)).length;
  const newH = scaleSteps(harmonyScaleId(newScale)).length;
  if (oldH !== newH) {
    const c = p.chords;
    c.slots.forEach((s, k) => { if (s && k * c.slotSteps >= start && k * c.slotSteps < end) s.deg = mod(s.deg, newH); });
  }
  sec.root = newRoot;
  sec.scale = newScale;
  commit('all');
}

// ---------- Scale mode <-> piano roll mode ----------
export function scaleNoteMidi(p, track, note) {
  const k = keyAt(p, note.step);
  return 12 * (track.octave + 1) + k.root + degToSemis(scaleSteps(k.scale), note.deg) + (note.alt || 0);
}

// Express a MIDI pitch as degree + accidental in the key at `step`.
export function midiToDegree(p, track, midi, step) {
  const k = keyAt(p, step);
  const steps = scaleSteps(k.scale);
  const rel = midi - (12 * (track.octave + 1) + k.root);
  const deg = semisToNearestDeg(steps, rel);
  return { deg, alt: rel - degToSemis(steps, deg) };
}

export function setTrackMode(track, mode) {
  const p = store.project;
  if ((track.mode || 'scale') === mode) return;
  if (mode === 'piano') {
    track.notes = track.notes.map(n => ({ step: n.step, len: n.len, vel: n.vel, midi: scaleNoteMidi(p, track, n) }));
  } else {
    track.notes = track.notes.map(n => ({ step: n.step, len: n.len, vel: n.vel, ...midiToDegree(p, track, n.midi, n.step) }));
  }
  track.mode = mode;
  commit('all');
}

export function inScale(p, midi, step) {
  const k = keyAt(p, step);
  return scaleSteps(k.scale).includes(mod(midi - k.root, 12));
}

export function outOfScaleCount() {
  const p = store.project;
  let n = 0;
  for (const t of p.tracks) for (const note of t.notes) {
    if (note.step >= p.bars * STEPS_PER_BAR) continue;
    if (t.mode === 'piano' ? !inScale(p, note.midi, note.step) : note.alt) n++;
  }
  return n;
}

// Move every out-of-scale note to the nearest scale note (what DAWs call "snap/fold to scale").
export function snapToScale() {
  const p = store.project;
  for (const t of p.tracks) for (const n of t.notes) {
    if (t.mode === 'piano') {
      if (!inScale(p, n.midi, n.step)) n.midi = scaleNoteMidi(p, t, { step: n.step, deg: midiToDegree(p, t, n.midi, n.step).deg });
    } else { n.alt = 0; delete n.src; }
  }
  commit('all');
}

export function setBars(bars) {
  store.project.bars = Math.max(1, Math.min(MAX_BARS, bars));
  commit('all');
}

// Double the loop: everything in it (notes, chords, drums, key changes) is copied after itself.
export function duplicateLoop() {
  const p = store.project;
  const L = p.bars * STEPS_PER_BAR;
  if (p.bars * 2 > MAX_BARS) return false;
  for (const t of p.tracks) {
    const src = t.notes.filter(n => n.step < L);
    t.notes = [...src, ...src.map(n => ({ ...n, step: n.step + L }))];
  }
  const c = p.chords;
  const slotN = Math.ceil(L / c.slotSteps);
  const slots = c.slots.slice(0, slotN);
  while (slots.length < slotN) slots.push(null);
  c.slots = [...slots, ...slots.map(s => (s ? { ...s } : null))];
  for (const r of p.drums.rows) {
    const s = Array.from({ length: L }, (_, i) => r.steps[i] || 0);
    r.steps = [...s, ...s];
  }
  const secs = sections(p);
  p.keyChanges = [...p.keyChanges.filter(k => k.bar < p.bars),
    ...secs.map(k => ({ bar: k.bar + p.bars, root: k.root, scale: k.scale }))];
  // drop the copy of the first section if it doesn't actually change anything
  p.keyChanges = p.keyChanges.filter((k, idx, arr) => {
    const prev = idx === 0 ? { root: p.root, scale: p.scale } : arr[idx - 1];
    return !(k.bar === p.bars && k.root === prev.root && k.scale === prev.scale);
  });
  p.bars *= 2;
  commit('all');
  return true;
}

export function loopSteps() { return store.project.bars * STEPS_PER_BAR; }

export const scaleOf = () => SCALES[store.project.scale];

// ---------- File import/export (.bangerator.json, samples embedded) ----------
export { saveSampleData, loadSampleData };

export function abToB64(ab) {
  const bytes = new Uint8Array(ab);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToAb(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export const sampleIds = p => p.drums.rows.filter(r => r.kind === 'sample' && r.sampleId).map(r => r.sampleId);

export async function exportProjectJSON(project = store.project) {
  if (project === store.project) flushOpen(project);
  const p = structuredClone(project);
  const samples = {};
  for (const id of sampleIds(p)) {
    try {
      const s = await loadSampleData(id);
      if (s) samples[id] = { name: s.name, b64: abToB64(s.data) };
    } catch { /* skip */ }
  }
  p.embeddedSamples = samples;
  return JSON.stringify(p);
}

export async function importProjectJSON(text) {
  const p = JSON.parse(text);
  if (!p || !Array.isArray(p.tracks) || !p.drums) throw new Error('Not a Bangerator project');
  const samples = p.embeddedSamples || {};
  delete p.embeddedSamples;
  for (const [id, s] of Object.entries(samples)) await saveSampleData(id, s.name, b64ToAb(s.b64));
  return p;
}
