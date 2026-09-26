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

export function defaultProject() {
  const n = (step, len, deg) => ({ step, len, deg, vel: 0.85 });
  // A little demo: minor loop i–VI–III–VII with a melody that uses degree numbers.
  const lead = [
    n(0, 2, 4), n(2, 2, 7), n(4, 4, 6), n(8, 2, 4), n(10, 2, 2), n(12, 4, 4),
    n(16, 2, 5), n(18, 2, 7), n(20, 4, 9), n(24, 4, 7), n(28, 4, 5),
    n(32, 2, 4), n(34, 2, 7), n(36, 4, 6), n(40, 2, 4), n(42, 2, 2), n(44, 4, 4),
    n(48, 4, 6), n(52, 4, 8), n(56, 8, 7),
  ];
  const bassDegs = [0, 5, 2, 6];
  const bass = [];
  bassDegs.forEach((d, bar) => {
    bass.push(n(bar * 16, 3, d), n(bar * 16 + 6, 2, d), n(bar * 16 + 10, 3, d), n(bar * 16 + 14, 2, d + 7));
  });
  const rows = DRUM_KINDS.map(({ kind, name }) => ({ id: uid('d'), name, kind, vol: 0.9, pitch: 0, mute: false, solo: false, steps: [] }));
  const pat = {
    kick: 'x.........x.....x.........x...x.',
    snare: '....x.......x.......x.......x...',
    chat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.xxx.x.',
    ohat: '..............x...............x.',
    clap: '....x.......x.......x.......x...',
  };
  for (const r of rows) {
    if (pat[r.kind]) r.steps = beat(pat[r.kind].repeat(2));
    if (r.kind === 'clap') r.vol = 0.5;
    if (r.kind === 'chat') r.vol = 0.55;
  }
  return {
    version: 1,
    name: 'My first banger',
    bpm: 100,
    root: 9, // A
    scale: 'minor',
    bars: 4,
    swing: 0,
    showNoteNames: false,
    patches: builtinPatches(),
    drumParams: structuredClone(DRUM_PARAMS),
    tracks: [
      newTrack('Lead', 'keys', 4, TRACK_COLORS[0], lead),
      newTrack('Bass', 'sub808', 2, TRACK_COLORS[1], bass),
    ],
    chords: {
      patch: 'pad', octave: 4, volume: 0.6, pan: 0, mute: false, solo: false,
      style: 'block', slotSteps: 16, voiceLead: true,
      slots: [{ deg: 0, type: 'triad' }, { deg: 5, type: 'triad' }, { deg: 2, type: 'triad' }, { deg: 6, type: 'triad' }],
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

// ---------- Scale swapping ----------
// Same-size scales keep degree numbers untouched (that's the point: same loop, new flavor).
// Different sizes: move each note to the nearest pitch in the new scale.
export function changeScale(newScale) {
  const p = store.project;
  const oldSteps = scaleSteps(p.scale);
  const newSteps = scaleSteps(newScale);
  if (oldSteps.length !== newSteps.length) {
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
  p.scale = newScale;
  commit('all');
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
