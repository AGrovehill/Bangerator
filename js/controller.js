// MIDI controllers.
//
// Any MIDI keyboard plays the selected channel and records into the open pattern.
// "Scale keys" (on by default): the white keys play scale degrees, C = 1, D = 2 ... B = 7, so every
// white key is in the scale, whatever key the song is in. Black keys are the ♯ of the white key below.
// Channel 10 notes (drum pads on most controllers) hit the matching drum rows.
//
// A Novation Launchkey Mini (MK3 or MK4) also gets its pads, knobs and buttons, through DAW mode:
//   Pads, 4 modes (▲/▼ switches):  STEPS    16 steps of one drum row, lit, with a running light
//                                   DRUMS    one pad per drum row
//                                   CHORDS   the scale's chords (bottom row triads, top row 7ths)
//                                   PATTERNS pick the pattern to edit
//   Knobs 1-8 (selected channel): Filter (DJ: left low-pass, right high-pass), Resonance, Tone (dark/bright),
//     Drive, Punch (compressor), Space (reverb), Echo (delay), Volume.
//     Shift: 1 = Pan, 2 = Synth cutoff, 3 = Synth resonance (the 303 knobs), 7 = Pump, 8 = Master.
//     With Record on while playing, knob moves are recorded as automation.
//   ◀/▶: select channel (tracks, chords, drums). Shift+◀/▶: drum row in STEPS, else previous/next pattern.
//   Shift+▲/▼ in STEPS: page through the pattern's bars.
//   Play: play/stop. Shift+Play: Pattern/Song. Record: arm recording. Shift+Record: scale keys on/off.
// The MK4 Mini's screen shows what the pads and knobs are doing.
//
// Protocol: Novation's Launchkey MK4 Programmer's Reference (DAW mode, colours, screen) and the
// community-documented Launchkey Mini MK3 map (pad notes 96-103 / 112-119, knobs CC 21-28 on ch 16).

import { store, commit, touch, keyAt, midiToDegree, STEPS_PER_BAR, openPattern } from './state.js';
import { PARAMS, staticValue, holdAutomation } from './automation.js';
import { writeAutomation } from './ui/autolane.js';
import { scaleSteps, degToSemis, harmonyScaleId, chordSemis, chordFunction, mod, SCALES, keyName } from './theory.js';
import { audio, playNote, playBuffer, ensureSampleSet, initAudio } from './audio.js';
import { transport, syncMixer, heardPosition, openPatternStep, stepDuration, currentVisualStep } from './sequencer.js';
import { DRUM_KINDS } from './drums.js';
import { ui, toast } from './ui/common.js';

const LS_KEY = 'bangerator.midiController';
const PADS = [96, 97, 98, 99, 100, 101, 102, 103, 112, 113, 114, 115, 116, 117, 118, 119]; // top row, then bottom
const PAD_MODES = ['steps', 'drums', 'chords', 'patterns'];
const MODE_NAMES = { steps: 'Step sequencer', drums: 'Drum pads', chords: 'Chords', patterns: 'Patterns' };
const CC = { play: 115, record: 117, left: 103, right: 102, up: [104, 106], down: [105, 107], shift: [108, 63] };

export const ctl = {
  access: null,
  enabled: false,
  inputs: [],      // names of connected inputs
  lk: null,        // { name, mk4, out } when a Launchkey's DAW port is connected
  rec: false,
  scaleKeys: true,
  padMode: 'steps',
  drumRow: 0,
  bar: 0,          // STEPS page when stopped
  shift: false,
  lastMsg: '',
  onChange: () => {}, // UI hook (status chip, dialog)
  hooks: { togglePlay: () => {}, setMode: () => {} },
};

try { Object.assign(ctl, JSON.parse(localStorage.getItem(LS_KEY)) || {}); } catch { /* defaults */ }
ctl.rec = false;
const remember = () => {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ enabled: ctl.enabled, scaleKeys: ctl.scaleKeys, padMode: ctl.padMode })); } catch { /* private mode */ }
};

// ---------- Connecting ----------
export async function enableMidi() {
  if (!navigator.requestMIDIAccess) throw new Error('This browser has no Web MIDI. Use Chrome or Edge.');
  if (!ctl.access) {
    // SysEx lets us write to the MK4's screen; fall back without it if the user says no.
    try { ctl.access = await navigator.requestMIDIAccess({ sysex: true }); }
    catch { ctl.access = await navigator.requestMIDIAccess({ sysex: false }); }
    ctl.access.addEventListener('statechange', () => setTimeout(rescan, 300));
  }
  ctl.enabled = true;
  remember();
  rescan();
}

export function disableMidi() {
  leaveDawMode();
  for (const i of ctl.access?.inputs.values() || []) i.onmidimessage = null;
  ctl.enabled = false;
  ctl.inputs = [];
  remember();
  ctl.onChange();
}

const isLaunchkey = name => /launchkey/i.test(name);
const isDawPort = name => /daw|midiin2|midiout2/i.test(name);

function rescan() {
  if (!ctl.access || !ctl.enabled) return;
  ctl.inputs = [];
  for (const input of ctl.access.inputs.values()) {
    if (input.state !== 'connected') continue;
    const daw = isLaunchkey(input.name) && isDawPort(input.name);
    input.onmidimessage = e => onMessage(e.data, daw, input.name);
    ctl.inputs.push(input.name);
  }
  const out = [...ctl.access.outputs.values()].find(o => o.state === 'connected' && isLaunchkey(o.name) && isDawPort(o.name));
  if (out && ctl.lk?.out !== out) {
    ctl.lk = { name: out.name.replace(/^MIDIOUT2 \((.*)\)$/, '$1').replace(/\s*DAW( Port| Out)?$/i, ''), mk4: /mk ?4/i.test(out.name), out, leds: new Map() };
    enterDawMode();
  } else if (!out) {
    ctl.lk = null;
  }
  ctl.onChange();
}

const send = bytes => { try { ctl.lk?.out.send(bytes); } catch (e) { console.warn('MIDI send failed', e); } };

function enterDawMode() {
  send([0x9f, 0x0c, 0x7f]);              // DAW mode on
  if (ctl.lk.mk4) {
    send([0xb6, 0x1d, 0x02]);            // pads: DAW layout
    send([0xb6, 0x1e, 0x02]);            // encoders: Plugin (absolute CC 21-28 on ch 16)
  } else {
    send([0xbf, 0x03, 0x02]);            // MK3 pads: Session (DAW) layout
    send([0xbf, 0x09, 0x02]);            // MK3 pots: Device
  }
  ctl.lk.leds.clear();
  setupScreen();
  showMode();
  syncKnobs();
}

function leaveDawMode() {
  if (!ctl.lk) return;
  for (const n of PADS) send([0x90, n, 0]);
  send([0x9f, 0x0c, 0x00]);
}
window.addEventListener('beforeunload', leaveDawMode);

// ---------- MK4 screen ----------
const canScreen = () => ctl.lk?.mk4 && ctl.access?.sysexEnabled;
const ascii = s => [...String(s)].map(c => { const x = c.charCodeAt(0); return x >= 32 && x < 127 ? x : c === '♭' ? 29 : 63; }).slice(0, 24);
const sysex = body => send([0xf0, 0x00, 0x20, 0x29, 0x02, 0x13, ...body, 0xf7]);

function setupScreen() {
  if (!canScreen()) return;
  const names = ['Filter', 'Resonance', 'Tone', 'Drive', 'Punch', 'Space', 'Echo', 'Volume'];
  names.forEach((n, i) => {
    sysex([0x04, 0x15 + i, 0x61]);       // temp display on change: name + text value
    sysex([0x06, 0x15 + i, 0, ...ascii(n)]);
  });
}

function screen(title, text) {
  if (!canScreen()) return;
  sysex([0x04, 0x21, 0x61]);
  sysex([0x06, 0x21, 0, ...ascii(title)]);
  sysex([0x06, 0x21, 1, ...ascii(text)]);
  sysex([0x04, 0x21, 0x7f]);
}

function knobScreen(i, value) {
  if (canScreen()) sysex([0x06, 0x15 + i, 1, ...ascii(value)]);
}

// ---------- Channels (what the keys and knobs control) ----------
function channels() {
  const p = store.project;
  return [...p.tracks.map(t => ({ id: t.id, name: t.name, obj: t, kind: 'track' })),
    { id: 'chords', name: 'Chords', obj: p.chords, kind: 'chords' },
    { id: 'drums', name: 'Drums', obj: p.drums, kind: 'drums' }];
}

export function currentChannel() {
  const list = channels();
  const id = ui.ctlChannel || ui.selectedTrackId;
  return list.find(c => c.id === id) || list[0];
}

function selectChannel(dir) {
  const list = channels();
  const i = list.findIndex(c => c.id === currentChannel().id);
  const c = list[mod(i + dir, list.length)];
  ui.ctlChannel = c.id;
  if (c.kind === 'track') { ui.selectedTrackId = c.id; touch('selection'); }
  toast(`Keys and knobs: ${c.name}`, 1200);
  screen('Channel', c.name);
  syncKnobs();
  ctl.onChange();
}

// ---------- Messages ----------
function onMessage(data, fromDaw, port) {
  const [st, d1 = 0, d2 = 0] = data;
  if (st >= 0xf8) return; // clock etc.
  const type = st & 0xf0, ch = st & 0x0f;
  ctl.lastMsg = `${port}: ${[...data].map(b => b.toString(16).padStart(2, '0')).join(' ')}`;
  ctl.onChange('msg');
  if (fromDaw) return dawMessage(type, ch, d1, d2);
  if (type === 0x90 && d2 > 0) return ch === 9 ? drumNote(d1, d2 / 127) : keyOn(d1, d2 / 127);
  if (type === 0x80 || (type === 0x90 && d2 === 0)) return ch === 9 ? null : keyOff(d1);
  if (type === 0xb0 && d1 >= 21 && d1 <= 28) return knob(d1 - 21, d2);  // custom-mode knobs on the MIDI port
}

function dawMessage(type, ch, d1, d2) {
  if (type === 0x90 || type === 0x80) {
    const pad = PADS.indexOf(d1);
    if (pad >= 0) { if (type === 0x90 && d2 > 0) padDown(pad, d2 / 127); else padUp(pad); }
    return;
  }
  if (type !== 0xb0) return;
  // the device switched its pad mode itself (Shift menu): repaint when it comes back to DAW layout
  if ((ch === 15 && d1 === 0x03) || (ch === 6 && d1 === 0x1d)) { if (d2 === 2) ctl.lk.leds.clear(); return; }
  if (d1 >= 21 && d1 <= 28) return knob(d1 - 21, d2);
  if (CC.shift.includes(d1)) { ctl.shift = d2 > 0; return; }
  if (d2 === 0) return; // buttons act on press
  if (d1 === CC.play) return ctl.shift ? ctl.hooks.setMode(transport.mode === 'song' ? 'pattern' : 'song') : ctl.hooks.togglePlay();
  if (d1 === CC.record) {
    if (ctl.shift) { ctl.scaleKeys = !ctl.scaleKeys; remember(); toast(ctl.scaleKeys ? 'Scale keys: white keys play the scale (C = 1).' : 'Scale keys off: keys play normal notes.'); screen('Scale keys', ctl.scaleKeys ? 'On' : 'Off'); }
    else setRecord(!ctl.rec);
    ctl.onChange();
    return;
  }
  if (d1 === CC.left || d1 === CC.right) {
    const dir = d1 === CC.right ? 1 : -1;
    if (!ctl.shift) return selectChannel(dir);
    if (ctl.padMode === 'steps') return selectDrumRow(dir);
    const p = store.project;
    const i = p.patterns.findIndex(x => x.id === p.currentPattern);
    const next = p.patterns[mod(i + dir, p.patterns.length)];
    openPattern(next.id);
    screen('Pattern', next.name);
    return;
  }
  const up = CC.up.includes(d1), down = CC.down.includes(d1);
  if (!up && !down) return;
  if (ctl.shift && ctl.padMode === 'steps') {
    const bars = store.project.bars;
    ctl.bar = mod(ctl.bar + (up ? -1 : 1), bars);
    screen('Steps', `Bar ${ctl.bar + 1} of ${bars}`);
    return;
  }
  setPadMode(PAD_MODES[mod(PAD_MODES.indexOf(ctl.padMode) + (up ? -1 : 1), PAD_MODES.length)]);
}

export function setPadMode(m) {
  ctl.padMode = m;
  remember();
  showMode();
  syncKnobs();
  ctl.onChange();
}

function showMode() {
  const p = store.project;
  const extra = ctl.padMode === 'steps' ? p.drums.rows[ctl.drumRow]?.name : ctl.padMode === 'patterns' ? p.patterns.find(x => x.id === p.currentPattern)?.name : '';
  screen(MODE_NAMES[ctl.padMode], extra || '');
  if (ctl.lk) toast(`Pads: ${MODE_NAMES[ctl.padMode]}${extra ? ` (${extra})` : ''}`, 1200);
}

function selectDrumRow(dir) {
  const rows = store.project.drums.rows;
  ctl.drumRow = mod(ctl.drumRow + dir, rows.length);
  syncKnobs();
  screen('Steps', rows[ctl.drumRow].name);
  toast(`Step pads: ${rows[ctl.drumRow].name}`, 1000);
}

export function setRecord(on) {
  ctl.rec = on;
  stepCursor = 0;
  toast(on ? (transport.playing ? 'Recording: play along.' : 'Step recording: each note goes on the next 8th. Press Play to record live.') : 'Recording off.');
  screen('Record', on ? 'On' : 'Off');
}

// ---------- Recording position ----------
// Step in the open pattern where a note played now belongs (quantized to 16ths), or -1.
function recordStep() {
  const p = store.project;
  const L = p.bars * STEPS_PER_BAR;
  if (!transport.playing) return stepCursor % L;
  const pos = heardPosition();
  if (pos < 0) return -1;
  if (transport.mode !== 'song') return mod(Math.round(pos), L);
  const base = openPatternStep(Math.floor(pos));
  return base < 0 ? -1 : mod(base + Math.round(pos - Math.floor(pos)), L);
}

let stepCursor = 0;
let warnedSong = false;
const heldKeys = new Map(); // midi -> { stop, note, t0 }

// ---------- Keys ----------
function keyToDegree(midi) {
  const pc = mod(midi, 12);
  const whites = [0, 2, 4, 5, 7, 9, 11];
  let w = whites.indexOf(pc), alt = 0;
  if (w < 0) { w = whites.indexOf(pc - 1); alt = 1; }
  const deg = (Math.floor(midi / 12) - 5) * 7 + w; // C4 = 1
  return { deg, alt };
}

async function keyOn(midi, vel) {
  if (!audio.ctx) await initAudio();
  const p = store.project;
  const c = currentChannel();
  const step = ctl.rec ? recordStep() : -1;
  const kStep = step >= 0 ? step : (transport.playing ? Math.max(0, openPatternStep(currentVisualStep())) : 0);
  const k = keyAt(p, kStep);
  const steps = scaleSteps(k.scale);

  if (c.kind === 'drums') { // white keys from C: one drum row each
    const { deg } = keyToDegree(midi);
    const row = p.drums.rows[mod(deg, Math.max(1, p.drums.rows.length))];
    return row && hitDrum(row, vel);
  }
  if (c.kind === 'chords') {
    const deg = ctl.scaleKeys ? mod(keyToDegree(midi).deg, 7) : mod(midiToDegree(p, { octave: 4 }, midi, kStep).deg, 7);
    const stop = playChord(deg, ui.chordType || 'triad', vel);
    heldKeys.set(midi, { stop });
    if (ctl.rec) recordChord(deg, step);
    return;
  }
  const t = c.obj;
  let note;
  let play;
  if (ctl.scaleKeys) {
    const { deg, alt } = keyToDegree(midi);
    play = 12 * (t.octave + 1) + k.root + degToSemis(steps, deg) + alt;
    note = t.mode === 'piano' ? { midi: play } : { deg, alt };
  } else {
    play = midi;
    note = t.mode === 'piano' ? { midi } : midiToDegree(p, t, midi, kStep);
  }
  const stop = playLive(t.id, t.patch, play, vel);
  const held = { stop, t0: audio.ctx.currentTime };
  heldKeys.set(midi, held);
  if (!ctl.rec) return;
  if (step < 0) {
    if (!warnedSong) { toast('Nothing to record into here: the pattern you are editing is not playing at this point of the song.'); warnedSong = true; }
    return;
  }
  const n = { step, len: 1, vel: Math.round(vel * 100) / 100, ...note };
  if (!n.alt) delete n.alt;
  t.notes.push(n);
  held.note = n;
  held.track = t;
  touch('notes');
}

function keyOff(midi) {
  const h = heldKeys.get(midi);
  if (!h) return;
  heldKeys.delete(midi);
  h.stop?.();
  if (!h.note) return;
  const p = store.project;
  const sd = stepDuration(p.bpm);
  const L = p.bars * STEPS_PER_BAR;
  const len = transport.playing ? Math.max(1, Math.round((audio.ctx.currentTime - h.t0) / sd)) : 2;
  h.note.len = Math.min(len, L - h.note.step);
  if (![...heldKeys.values()].some(x => x.note)) {
    if (!transport.playing) stepCursor += 2;
    commit('notes');
  }
}

function playLive(stripId, patchId, midi, vel) {
  const patch = store.project.patches[patchId];
  if (!patch || !audio.ctx) return null;
  if (patch.kind === 'sampler') ensureSampleSet(patch.set);
  syncMixer();
  return playNote(audio.ctx, audio.mixer.strip(stripId).gain, patch, midi, audio.ctx.currentTime + 0.003, 30, Math.max(0.2, vel));
}

// ---------- Chords ----------
function playChord(deg, type, vel) {
  const p = store.project;
  const c = p.chords;
  const k = keyAt(p, 0);
  const base = 12 * (c.octave + 1) + k.root;
  const stops = chordSemis(scaleSteps(harmonyScaleId(k.scale)), deg, type).map(s => playLive('chords', c.patch, base + s, vel * 0.8));
  return () => stops.forEach(s => s?.());
}

function recordChord(deg, step) {
  if (step < 0) return;
  const c = store.project.chords;
  const slot = Math.floor(step / c.slotSteps);
  c.slots[slot] = { deg, type: ui.chordType || 'triad' };
  if (!transport.playing) stepCursor = (slot + 1) * c.slotSteps;
  commit('chords');
}

// ---------- Drums ----------
function hitDrum(row, vel, record = true) {
  if (!audio.ctx) return;
  const buf = row.kind === 'sample' ? audio.userBuffers[row.sampleId] : audio.drumBuffers[row.kind];
  syncMixer();
  playBuffer(audio.ctx, audio.mixer.rowStrip(row.id).gain, buf, audio.ctx.currentTime + 0.003, vel > 0.85 ? 1 : 0.7, row.pitch);
  flash.set(row.id, performance.now());
  if (!ctl.rec || !record) return;
  const step = recordStep();
  if (step < 0) return;
  row.steps[step] = vel > 0.85 ? 2 : 1;
  if (!transport.playing) stepCursor += 1;
  commit('drums');
}

function drumNote(midi, vel) {
  const rows = store.project.drums.rows;
  const kind = DRUM_KINDS.find(k => k.gm === midi)?.kind;
  const row = rows.find(r => r.kind === kind) || rows[mod(midi - 36, rows.length)];
  if (row) hitDrum(row, vel);
}

// ---------- Pads ----------
const flash = new Map();  // row id -> time of last hit (for lighting drum pads)
const heldPads = new Map();

function padDown(i, vel) {
  const p = store.project;
  if (!audio.ctx) initAudio();
  if (ctl.padMode === 'steps') {
    const row = p.drums.rows[ctl.drumRow];
    if (!row) return;
    const step = stepsBar() * STEPS_PER_BAR + i;
    if (step >= p.bars * STEPS_PER_BAR) return;
    const cur = row.steps[step] || 0;
    row.steps[step] = ctl.shift ? (cur === 2 ? 0 : 2) : (cur ? 0 : 1);
    if (row.steps[step] && !transport.playing) hitDrum(row, row.steps[step] === 2 ? 1 : 0.7, false);
    commit('drums');
  } else if (ctl.padMode === 'drums') {
    const row = p.drums.rows[drumPadRow(i)];
    if (row) { ctl.drumRow = drumPadRow(i); hitDrum(row, vel); }
  } else if (ctl.padMode === 'chords') {
    const deg = i % 8;
    const type = i < 8 ? 'seventh' : 'triad';
    heldPads.set(i, playChord(deg, type, vel));
    if (ctl.rec) recordChord(deg, recordStep());
  } else if (ctl.padMode === 'patterns') {
    const pat = p.patterns[i];
    if (pat) { openPattern(pat.id); screen('Pattern', pat.name); }
  }
}

function padUp(i) {
  heldPads.get(i)?.();
  heldPads.delete(i);
}

const drumPadRow = i => (i >= 8 ? i - 8 : i + 8); // bottom row = first 8 drum rows, like an MPC

function stepsBar() {
  const p = store.project;
  if (transport.playing) {
    const s = openPatternStep(currentVisualStep());
    if (s >= 0) return Math.floor(s / STEPS_PER_BAR);
  }
  return Math.min(ctl.bar, p.bars - 1);
}

// ---------- LEDs ----------
// Novation palette: groups of 4 per hue, first = brightest, +2 = dim. [index, hue in degrees]
const HUES = [[5, 0], [9, 25], [13, 60], [17, 90], [21, 120], [33, 170], [37, 200], [45, 235], [49, 270], [53, 300], [57, 335]];
const WHITE = 3, DIM_WHITE = 1, OFF = 0;

function palette(hex, dim = false) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
  if (!m) return dim ? DIM_WHITE : WHITE;
  const [r, g, b] = m.slice(1).map(x => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.15) return dim ? DIM_WHITE : WHITE; // greys
  const d = max - min;
  const hue = 60 * (max === r ? mod((g - b) / d, 6) : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  let best = HUES[0], bd = Infinity;
  for (const hu of HUES) {
    const dist = Math.min(Math.abs(hu[1] - hue), 360 - Math.abs(hu[1] - hue));
    if (dist < bd) { bd = dist; best = hu; }
  }
  return best[0] + (dim ? 2 : 0);
}

const FN_HEX = { home: '#51cf66', away: '#4dabf7', tension: '#ff922b' };
const DRUM_HEX = { kick: '#ff6b6b', snare: '#ffa94d', clap: '#ffd43b', rim: '#fcc419', chat: '#69db7c', ohat: '#38d9a9',
  ltom: '#4dabf7', mtom: '#748ffc', htom: '#9775fa', cowbell: '#da77f2', cymbal: '#f783ac', shaker: '#63e6be', ride: '#e599f7', riser: '#99e9f2', impact: '#ffc9c9', downer: '#a5d8ff' };

function padColors() {
  const p = store.project;
  const out = new Array(16).fill([OFF, 0]);
  if (ctl.padMode === 'steps') {
    const row = p.drums.rows[ctl.drumRow];
    if (!row) return out;
    const bar = stepsBar();
    const now = transport.playing ? openPatternStep(currentVisualStep()) : -1;
    const col = DRUM_HEX[row.kind] || '#e9ecf5';
    for (let i = 0; i < 16; i++) {
      const s = bar * STEPS_PER_BAR + i;
      if (s >= p.bars * STEPS_PER_BAR) continue;
      const v = row.steps[s] || 0;
      if (s === now) out[i] = [WHITE, 0];
      else if (v) out[i] = [palette(col), v === 2 ? 2 : 0]; // accents pulse
      else out[i] = [i % 4 === 0 ? DIM_WHITE : OFF, 0];
    }
  } else if (ctl.padMode === 'drums') {
    const t = performance.now();
    for (let i = 0; i < 16; i++) {
      const r = p.drums.rows[drumPadRow(i)];
      if (!r) continue;
      const hot = t - (flash.get(r.id) || 0) < 120;
      out[i] = [hot ? WHITE : palette(DRUM_HEX[r.kind] || '#e9ecf5', !(drumPadRow(i) === ctl.drumRow)), 0];
    }
  } else if (ctl.padMode === 'chords') {
    const k = keyAt(p, 0);
    const steps = scaleSteps(harmonyScaleId(k.scale));
    for (let i = 0; i < 16; i++) {
      const deg = i % 8;
      out[i] = [heldPads.has(i) ? WHITE : palette(FN_HEX[chordFunction(deg, steps)], i < 8), 0];
    }
  } else if (ctl.padMode === 'patterns') {
    p.patterns.slice(0, 16).forEach((pat, i) => { out[i] = [palette(pat.color, pat.id !== p.currentPattern), pat.id === p.currentPattern && transport.playing ? 2 : 0]; });
  }
  if (ctl.rec && ctl.padMode !== 'steps') out[15] = [5, 2]; // last pad pulses red while recording
  return out;
}

// Called every animation frame: sends only the LEDs that changed.
export function updateLeds() {
  const lk = ctl.lk;
  if (!lk || !ctl.enabled) return;
  const cols = padColors();
  cols.forEach(([color, behaviour], i) => {
    const key = PADS[i];
    const val = color * 4 + behaviour;
    if (lk.leds.get(key) === val) return;
    lk.leds.set(key, val);
    send([0x90, key, color]);                                  // stationary colour (ch 1)
    if (behaviour === 2) send([0x92, key, color]);             // pulsing (ch 3)
  });
  const btn = (cc, v) => { const k = 'cc' + cc; if (lk.leds.get(k) !== v) { lk.leds.set(k, v); send([0xb0, cc, v]); } };
  btn(CC.play, transport.playing ? 21 : 0);
  btn(CC.record, ctl.rec ? 5 : 0);
}

// ---------- Knobs: performance macros on the selected channel ----------
// Each macro moves one or more mixer settings in a musically useful way. With Record on while playing,
// the moves are recorded as automation (pattern lanes in Pattern mode, song lanes in Song mode).
// Absolute knobs (MK3) pick up: a knob only takes over once it reaches the current value, so nothing jumps.
// The MK4's encoders are sent the current values instead.

const pctOf = x => `${Math.round(x * 100)}%`;
const fxMacro = (name, key) => ({ name, targets: [key], get: c => c.obj.fx[key] ?? 0, set: (c, x) => { c.obj.fx[key] = x; }, fmt: pctOf });
const LP_MIN = 150, HP_MAX = 5000;

const MACROS = [
  { // DJ filter: centre = open, left = low-pass sweeps down, right = high-pass sweeps up
    name: 'Filter', targets: ['cutoff', 'hpCut'],
    get: c => {
      const fx = c.obj.fx;
      if (fx.cutoff < 19900) return 0.5 - 0.5 * Math.log(20000 / fx.cutoff) / Math.log(20000 / LP_MIN);
      if (fx.hpCut > 11) return 0.5 + 0.5 * Math.log(fx.hpCut / 10) / Math.log(HP_MAX / 10);
      return 0.5;
    },
    set: (c, x) => {
      const d = x * 2 - 1, fx = c.obj.fx;
      fx.cutoff = d < -0.04 ? Math.round(20000 * Math.pow(LP_MIN / 20000, -d)) : 20000;
      fx.hpCut = d > 0.04 ? Math.round(10 * Math.pow(HP_MAX / 10, d)) : 10;
    },
    fmt: (x, c) => (c.obj.fx.cutoff < 19900 ? `LP ${PARAMS.cutoff.fmt(c.obj.fx.cutoff)}` : c.obj.fx.hpCut > 11 ? `HP ${PARAMS.hpCut.fmt(c.obj.fx.hpCut)}` : 'Open'),
  },
  fxMacro('Resonance', 'reso'),
  { // tilt EQ: left = darker (more bass, less treble), right = brighter
    name: 'Tone', targets: ['eqLow', 'eqHigh'],
    get: c => Math.max(0, Math.min(1, 0.5 + ((c.obj.fx.eqHigh || 0) - (c.obj.fx.eqLow || 0)) / 32)),
    set: (c, x) => { const t = x * 2 - 1; c.obj.fx.eqLow = Math.round(-t * 80) / 10; c.obj.fx.eqHigh = Math.round(t * 80) / 10; },
    fmt: x => (Math.abs(x - 0.5) < 0.03 ? 'Flat' : x < 0.5 ? `Darker ${Math.round((0.5 - x) * 200)}%` : `Brighter ${Math.round((x - 0.5) * 200)}%`),
  },
  { ...fxMacro('Drive', 'drive'), targets: [] }, // drive isn't automatable (it swaps a curve)
  fxMacro('Punch', 'comp'),
  fxMacro('Space', 'reverb'),
  fxMacro('Echo', 'delay'),
  {
    name: 'Volume', targets: ['volume'],
    get: c => (c.kind === 'row' ? c.obj.vol / 1.5 : c.obj.volume / 1.2),
    set: (c, x) => { if (c.kind === 'row') c.obj.vol = x * 1.5; else c.obj.volume = x * 1.2; },
    fmt: (x, c) => pctOf(c.kind === 'row' ? x * 1.5 : x * 1.2),
  },
];
// The synth's own filter (for acid: ride Cutoff and Resonance). Changes the patch itself.
function synthMacro(name, target, key) {
  const P = PARAMS[target];
  const synth = (c, p) => { const pt = p.patches[c.obj?.patch]; return pt?.kind === 'synth' ? pt.patch : null; };
  return {
    name, targets: [target], needsSynth: synth,
    get: (c, p) => { const s = synth(c, p); return s ? Math.max(0, Math.min(1, P.from(s[key]))) : 0.5; },
    set: (c, x, p) => { const s = synth(c, p); if (s) s[key] = Math.round(P.to(x) * 10) / 10; },
    fmt: x => P.fmt(P.to(x)),
  };
}

const SHIFT_MACROS = {
  0: { name: 'Pan', targets: ['pan'], noDrums: true,
    get: c => ((c.obj.pan || 0) + 1) / 2,
    set: (c, x) => { c.obj.pan = Math.abs(x - 0.5) < 0.02 ? 0 : x * 2 - 1; },
    fmt: x => PARAMS.pan.fmt(x * 2 - 1) },
  1: synthMacro('Synth cutoff', 'synthCutoff', 'cutoff'),
  2: synthMacro('Synth resonance', 'synthReso', 'resonance'),
  6: { ...fxMacro('Pump', 'pump'), targets: [] },
  7: { name: 'Master', targets: ['master'], master: true,
    get: (c, p) => p.fxBus.master / 1.2,
    set: (c, x, p) => { p.fxBus.master = x * 1.2; },
    fmt: x => pctOf(x * 1.2) },
};

// What the knobs act on: the selected channel, or the selected drum sound when drums are split per sound.
function knobChannel() {
  const c = currentChannel();
  const p = store.project;
  if (c.kind === 'drums' && p.drums.split && (ctl.padMode === 'steps' || ctl.padMode === 'drums')) {
    const r = p.drums.rows[ctl.drumRow];
    if (r) return { id: 'row:' + r.id, name: r.name, obj: r, kind: 'row' };
  }
  return c;
}

const macroFor = i => (ctl.shift && SHIFT_MACROS[i]) || MACROS[i];
const pickup = { ch: null, picked: new Map(), last: new Map() };
let knobCommit = null;
let recorded = false;
let pickupHintAt = 0;
const lastWrite = new Map();

// MK4: tell the encoders where things are (they then continue from there). Others: re-arm pickup.
export function syncKnobs() {
  const c = knobChannel();
  pickup.ch = c.id;
  pickup.picked.clear();
  pickup.last.clear();
  if (!ctl.lk?.mk4) return;
  const p = store.project;
  MACROS.forEach((m, i) => {
    send([0xbf, 21 + i, Math.round(Math.max(0, Math.min(1, m.get(c, p))) * 127)]);
    pickup.picked.set(i + 'n', true);
  });
}

function knob(i, v) {
  const p = store.project;
  const c = knobChannel();
  const m = macroFor(i);
  if (m.noDrums && c.kind === 'drums') return;
  if (m.needsSynth && !m.needsSynth(c, p)) { toast(`${c.name} isn’t a synth, so it has no synth filter.`, 1200); return; }
  if (pickup.ch !== c.id) syncKnobs();
  const key = i + (ctl.shift && SHIFT_MACROS[i] ? 's' : 'n');
  const x = v / 127;
  const cur = m.get(c, p);
  if (!pickup.picked.get(key)) {
    const prev = pickup.last.get(key);
    const crossed = prev != null && (prev - cur) * (x - cur) <= 0;
    pickup.last.set(key, x);
    if (Math.abs(x - cur) > 0.04 && !crossed) {
      if (performance.now() - pickupHintAt > 700) {
        pickupHintAt = performance.now();
        const msg = `Turn ${x < cur ? 'right' : 'left'} to pick up ${m.name} (${m.fmt(cur, c, p)})`;
        knobScreen(i, msg);
        toast(`${c.name} · ${msg}`, 900);
      }
      return;
    }
    pickup.picked.set(key, true);
  }
  pickup.last.set(key, x);
  m.set(c, x, p);
  const ch = m.master ? 'master' : c.id;
  for (const k of m.targets) holdAutomation(`${ch}|${k}`, 600); // playback of these lanes steps aside while you turn
  syncMixer();
  if (ctl.rec && transport.playing) recordKnob(m, ch, p);
  const label = m.fmt(x, c, p);
  knobScreen(i, `${m.master ? '' : c.name + ' '}${m.name}: ${label}`);
  if (!ctl.lk?.mk4) toast(`${m.master ? '' : c.name + ' · '}${m.name} ${label}`, 900);
  clearTimeout(knobCommit);
  knobCommit = setTimeout(() => {
    lastWrite.clear();
    commit(recorded ? 'all' : 'fx');
    recorded = false;
  }, 400);
}

// Write the knob's settings into automation lanes at the current position. While a knob keeps moving,
// older points it passes over are replaced (like "latch" automation in a DAW).
function recordKnob(m, ch, p) {
  const pos = heardPosition();
  if (pos < 0 || !m.targets.length) return;
  const song = transport.mode === 'song';
  const step = song ? Math.floor(pos) : mod(Math.floor(pos), p.bars * STEPS_PER_BAR);
  for (const k of m.targets) {
    const target = `${ch}|${k}`;
    const lane = writeAutomation(song ? 'song' : 'pattern', target, step, PARAMS[k].from(staticValue(p, ch, k)));
    const last = lastWrite.get(target);
    if (last != null && step > last) lane.points = lane.points.filter(q => q.step <= last || q.step >= step);
    lastWrite.set(target, step);
  }
  recorded = true;
}

// ---------- Boot ----------
export async function autoConnect() {
  if (ctl.enabled && navigator.requestMIDIAccess) {
    try { await enableMidi(); } catch (e) { console.warn('MIDI not available', e); }
  }
}

export const keyNameOf = () => { const k = keyAt(store.project, 0); return `${keyName(k.root, k.scale)} ${SCALES[k.scale].name}`; };
