// Project model, built-in instruments, undo/redo and saving (localStorage + IndexedDB).

import { DEFAULT_PATCH } from './audio.js';
import { DRUM_KINDS, DRUM_PARAMS } from './drums.js';
import { SCALES, scaleSteps, degToSemis, semisToNearestDeg, harmonyScaleId, mod } from './theory.js';

export const STEPS_PER_BAR = 16;
export const MAX_BARS = 16;

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

let idCounter = Date.now() % 100000;
export const uid = (p = 'id') => `${p}${(idCounter++).toString(36)}`;

export const TRACK_COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ffa94d', '#63e6be', '#f783ac'];

export function newTrack(name, patch, octave, color, notes = []) {
  return { id: uid('t'), name, patch, octave, range: 2, volume: 0.8, pan: 0, mute: false, solo: false, color, notes, collapsed: false };
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

export function defaultProject() {
  const n = (step, len, deg) => ({ step, len, deg, vel: 0.85 });
  const riff = LOVE_PARADE_RIFF.map(([s, l, d]) => n(s, l, d));
  // off-beat trance bass on the root, like the original's off-beat bass hits
  const bass = [];
  for (let s = 2; s < 64; s += 4) bass.push(n(s, 2, 0));
  const rows = DRUM_KINDS.map(({ kind, name }) => ({ id: uid('d'), name, kind, vol: 0.9, pitch: 0, mute: false, solo: false, steps: [] }));
  // drum pattern from the MIDI file's full section
  const pat = {
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    clap: '....X.......X...',
    chat: 'xx..xx..xx..xx..',
    ohat: '..x...x...x...x.',
  };
  for (const r of rows) {
    if (pat[r.kind]) r.steps = beat(pat[r.kind].repeat(4));
    if (r.kind === 'snare') r.vol = 0.45;
    if (r.kind === 'clap') r.vol = 0.6;
    if (r.kind === 'chat') r.vol = 0.4;
    if (r.kind === 'ohat') r.vol = 0.45;
  }
  return {
    version: 1,
    name: 'Meet Her at the Love Parade (riff)',
    bpm: 130,
    root: 2, // D
    scale: 'mixolydianFlat6',
    noteMode: 'degrees', // 'degrees' = notes follow the scale; 'fixed' = notes keep their pitch (DAW style)
    bars: 4,
    swing: 0,
    showNoteNames: false,
    patches: builtinPatches(),
    drumParams: structuredClone(DRUM_PARAMS),
    tracks: [
      newTrack('Riff', 'stab', 4, TRACK_COLORS[0], riff),
      newTrack('Bass', 'sawbass', 2, TRACK_COLORS[1], bass),
    ],
    chords: {
      patch: 'pad', octave: 3, volume: 0.45, pan: 0, mute: false, solo: false,
      style: 'block', slotSteps: 16, voiceLead: true,
      slots: [0, 0, 0, 0].map(deg => ({ deg, type: 'triad' })),
    },
    drums: { volume: 0.9, rows },
  };
}

// ---------- Store ----------
const listeners = new Set();
export const store = {
  project: null,
  undoStack: [],
  redoStack: [],
  lastSnapshot: null,
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { listeners.forEach(fn => fn(what)); }

// Call after every finished edit. `what` hints which views need a redraw.
export function commit(what = 'all') {
  const snap = JSON.stringify(store.project);
  if (snap !== store.lastSnapshot) {
    if (store.lastSnapshot) store.undoStack.push(store.lastSnapshot);
    if (store.undoStack.length > 200) store.undoStack.shift();
    store.redoStack = [];
    store.lastSnapshot = snap;
    scheduleSave();
  }
  emit(what);
}

// For live changes during a drag: redraw without adding an undo step.
export function touch(what = 'all') { emit(what); }

export function undo() {
  if (!store.undoStack.length) return;
  store.redoStack.push(store.lastSnapshot);
  store.lastSnapshot = store.undoStack.pop();
  store.project = JSON.parse(store.lastSnapshot);
  scheduleSave();
  emit('all');
}
export function redo() {
  if (!store.redoStack.length) return;
  store.undoStack.push(store.lastSnapshot);
  store.lastSnapshot = store.redoStack.pop();
  store.project = JSON.parse(store.lastSnapshot);
  scheduleSave();
  emit('all');
}

export function setProject(p, keepHistory = false) {
  store.project = migrate(p);
  if (!keepHistory) { store.undoStack = []; store.redoStack = []; }
  store.lastSnapshot = JSON.stringify(store.project);
  scheduleSave();
  emit('all');
}

function migrate(p) {
  const d = defaultProject();
  for (const k of Object.keys(d)) if (p[k] === undefined) p[k] = d[k];
  // make sure built-in patches exist (older saves)
  const b = builtinPatches();
  for (const k of Object.keys(b)) if (!p.patches[k]) p.patches[k] = b[k];
  for (const k of Object.keys(DRUM_PARAMS)) p.drumParams[k] = { ...DRUM_PARAMS[k], ...(p.drumParams[k] || {}) };
  return p;
}

const LS_KEY = 'bangerator.project.v1';
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store.project)); } catch (e) { console.warn('Autosave failed', e); }
  }, 400);
}
export function loadSaved() {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) return JSON.parse(s);
  } catch { /* storage blocked or corrupt */ }
  return null;
}

// ---------- Key and scale changes ----------
// Two behaviors, picked by project.noteMode:
//  'degrees' (default): notes are scale degrees, so they follow the new key/scale. Same loop, new mood.
//     Scales of a different size move each note to the nearest pitch (and remember the original).
//  'fixed': notes keep their exact pitch, like the piano roll in most DAWs. After a change, notes that
//     aren't in the new scale are stored as accidentals (alt = ±1) and drawn as out-of-scale.
export function changeKey(newRoot, newScale) {
  const p = store.project;
  const oldSteps = scaleSteps(p.scale);
  const newSteps = scaleSteps(newScale);
  if (p.noteMode === 'fixed') {
    // move the root the short way round and compensate with the track octave, so no pitch changes
    const raw = newRoot - p.root;
    const wrapped = mod(raw + 6, 12) - 6;
    const octShift = (raw - wrapped) / 12;
    for (const t of p.tracks) {
      t.octave -= octShift;
      for (const note of t.notes) {
        const rel = degToSemis(oldSteps, note.deg) + (note.alt || 0) - wrapped;
        note.deg = semisToNearestDeg(newSteps, rel);
        note.alt = rel - degToSemis(newSteps, note.deg);
        delete note.src;
      }
    }
  } else if (oldSteps.length !== newSteps.length) {
    for (const t of p.tracks) {
      for (const note of t.notes) {
        // Remember where the note came from, so going 7 -> 5 -> 7 notes gives the original melody back.
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
  const oldH = scaleSteps(harmonyScaleId(p.scale)).length;
  const newH = scaleSteps(harmonyScaleId(newScale)).length;
  if (oldH !== newH) for (const s of p.chords.slots) if (s) s.deg = mod(s.deg, newH);
  p.root = newRoot;
  p.scale = newScale;
  commit('all');
}

export const changeScale = newScale => changeKey(store.project.root, newScale);
export const changeRoot = newRoot => changeKey(newRoot, store.project.scale);

export function outOfScaleCount() {
  return store.project.tracks.reduce((a, t) => a + t.notes.filter(n => n.alt).length, 0);
}

// Snap every out-of-scale note to the nearest scale note (what DAWs call "fold/snap to scale").
export function snapToScale() {
  for (const t of store.project.tracks) for (const n of t.notes) { n.alt = 0; delete n.src; }
  commit('notes');
}

export function setBars(bars) {
  store.project.bars = Math.max(1, Math.min(MAX_BARS, bars));
  commit('all');
}

export function loopSteps() { return store.project.bars * STEPS_PER_BAR; }

export const scaleOf = () => SCALES[store.project.scale];

// ---------- User samples in IndexedDB ----------
const DB_NAME = 'bangerator';
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('samples');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function saveSampleData(id, name, arrayBuffer) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('samples', 'readwrite');
    tx.objectStore('samples').put({ name, data: arrayBuffer }, id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
export async function loadSampleData(id) {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction('samples').objectStore('samples').get(id);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// ---------- File import/export ----------
function abToB64(ab) {
  const bytes = new Uint8Array(ab);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToAb(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export async function exportProjectJSON() {
  const p = structuredClone(store.project);
  const samples = {};
  for (const r of p.drums.rows) {
    if (r.kind === 'sample' && r.sampleId) {
      try {
        const s = await loadSampleData(r.sampleId);
        if (s) samples[r.sampleId] = { name: s.name, b64: abToB64(s.data) };
      } catch { /* skip */ }
    }
  }
  p.embeddedSamples = samples;
  return JSON.stringify(p);
}

export async function importProjectJSON(text) {
  const p = JSON.parse(text);
  const samples = p.embeddedSamples || {};
  delete p.embeddedSamples;
  for (const [id, s] of Object.entries(samples)) await saveSampleData(id, s.name, b64ToAb(s.b64));
  return p;
}
