// Transport + scheduler. Uses the classic "look-ahead" pattern: a timer wakes up often
// and schedules any steps that fall in the next ~120 ms on the audio clock.
// The same event builder is used for live playback, WAV rendering and MIDI export.

import { audio, playNote, playBuffer, Mixer, ensureSampleSet, loadSampleSet } from './audio.js';
import { store, loopSteps, STEPS_PER_BAR } from './state.js';
import { scaleSteps, degToSemis, harmonyScaleId, chordSemis, voiceLead, mod } from './theory.js';
import { renderDrumKit, DRUM_KINDS } from './drums.js';
import { midiOut } from './midi.js';

export const stepDuration = bpm => 60 / bpm / 4; // 16th notes

export function noteMidi(p, track, note) {
  return 12 * (track.octave + 1) + p.root + degToSemis(scaleSteps(p.scale), note.deg) + (note.alt || 0);
}

// Pitches for each chord slot, voice-led across the loop. Returns array of { midis, deg, type } | null
export function chordVoicings(p) {
  const steps = scaleSteps(harmonyScaleId(p.scale));
  const c = p.chords;
  const base = 12 * (c.octave + 1) + p.root;
  const slotCount = Math.ceil(loopSteps() / c.slotSteps);
  const out = [];
  let prevCenter = null;
  for (let i = 0; i < slotCount; i++) {
    const s = c.slots[i];
    if (!s) { out.push(null); continue; }
    let midis = chordSemis(steps, s.deg, s.type).map(x => base + x);
    if (c.voiceLead) {
      const lo = base - 7, hi = base + 21;
      midis = voiceLead(midis, prevCenter ?? midis.reduce((a, b) => a + b, 0) / midis.length, lo, hi);
    }
    prevCenter = midis.reduce((a, b) => a + b, 0) / midis.length;
    out.push({ midis, deg: s.deg, type: s.type });
  }
  return out;
}

function audibleSet(items) {
  const anySolo = items.some(x => x.solo);
  return x => !x.mute && (!anySolo || x.solo);
}

// Build every event in one loop pass: [{ step, offset (in steps), dur (in steps), kind, ... }]
export function buildEvents(p) {
  const L = loopSteps();
  const events = [];
  const melodic = [...p.tracks, p.chords];
  const audible = audibleSet(melodic);

  p.tracks.forEach((t, ti) => {
    for (const n of t.notes) {
      if (n.step >= L) continue;
      events.push({ step: n.step, dur: Math.min(n.len, L - n.step), kind: 'note', trackId: t.id, patch: t.patch,
        midi: noteMidi(p, t, n), vel: n.vel ?? 0.85, channel: ti % 9, audible: audible(t) });
    }
  });

  const c = p.chords;
  const voicings = chordVoicings(p);
  const chAud = audible(c);
  voicings.forEach((v, i) => {
    if (!v) return;
    const start = i * c.slotSteps;
    if (start >= L) return;
    const len = Math.min(c.slotSteps, L - start);
    const push = (step, dur, midi, vel = 0.7) => events.push({ step, dur, kind: 'note', trackId: 'chords', patch: c.patch, midi, vel, channel: 10, audible: chAud });
    if (c.style === 'block') {
      v.midis.forEach(m => push(start, len, m));
    } else if (c.style === 'strum') {
      v.midis.forEach((m, k) => push(start + k * 0.25, len - k * 0.25, m));
    } else if (c.style === 'stabs') {
      for (let s = 0; s < len; s += 4) v.midis.forEach(m => push(start + s + 2, 1, m, 0.75)); // off-beat stabs
    } else {
      // arpeggios, one note per 16th ("arp-up", "arp-down", "arp-updown")
      let seq = [...v.midis, v.midis[0] + 12];
      if (c.style === 'arp-down') seq = seq.reverse();
      if (c.style === 'arp-updown') seq = [...seq, ...seq.slice(1, -1).reverse()];
      for (let s = 0; s < len; s++) push(start + s, 1, seq[s % seq.length], s % 4 === 0 ? 0.8 : 0.6);
    }
  });

  const dAud = audibleSet(p.drums.rows);
  for (const r of p.drums.rows) {
    const gm = DRUM_KINDS.find(k => k.kind === r.kind)?.gm ?? 60;
    for (let s = 0; s < L; s++) {
      const v = r.steps[s];
      if (!v) continue;
      events.push({ step: s, dur: 1, kind: 'drum', rowId: r.id, row: r, vel: v === 2 ? 1 : 0.7, gm, audible: dAud(r) });
    }
  }
  events.sort((a, b) => a.step - b.step);
  return events;
}

// Swing delays every second 16th note.
export function swingOffset(p, step) {
  return (Math.floor(step) % 2 === 1 ? p.swing * 0.5 : 0);
}

// ---------- Live transport ----------
export const transport = {
  playing: false,
  step: 0,          // next step to schedule (loop-relative)
  nextTime: 0,      // audio time of that step
  startTime: 0,
  timer: null,
  events: null,     // cached events, rebuilt when the project changes
  visualQueue: [],  // { step, time } for the playhead
  onStep: null,
  liveStops: [],
};

export function invalidateEvents() { transport.events = null; }

function eventsFor(step) {
  if (!transport.events) {
    const all = buildEvents(store.project);
    const map = new Map();
    for (const e of all) {
      const k = Math.floor(e.step);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    transport.events = map;
  }
  return transport.events.get(step) || [];
}

// Apply volume/pan/mute to the live mixer strips.
export function syncMixer(mixer = audio.mixer, p = store.project) {
  if (!mixer) return;
  const melodic = [...p.tracks, p.chords];
  const aud = audibleSet(melodic);
  p.tracks.forEach(t => mixer.setStrip(t.id, t.volume, t.pan, aud(t)));
  mixer.setStrip('chords', p.chords.volume, p.chords.pan, aud(p.chords));
  const dAud = audibleSet(p.drums.rows);
  p.drums.rows.forEach(r => mixer.setStrip(r.id, r.vol * p.drums.volume, 0, dAud(r)));
}

function drumBuffer(row) {
  return row.kind === 'sample' ? audio.userBuffers[row.sampleId] : audio.drumBuffers[row.kind];
}

// Open hats get cut off by closed hats, like on the real machine.
let openHat = null;

function scheduleStep(step, time) {
  const p = store.project;
  const sd = stepDuration(p.bpm);
  const ctx = audio.ctx;
  for (const e of eventsFor(step)) {
    const t = time + (e.step - step + swingOffset(p, e.step)) * sd;
    if (e.kind === 'note') {
      const patch = p.patches[e.patch];
      if (!patch) continue;
      if (e.audible && !midiOut.localMute) playNote(ctx, audio.mixer.strip(e.trackId).gain, patch, e.midi, t, e.dur * sd * 0.98, e.vel);
      if (e.audible) midiOut.note(e.channel, e.midi, e.vel, t, e.dur * sd * 0.98);
    } else {
      if (!e.audible) continue;
      if (!midiOut.localMute) {
        if (e.row.kind === 'chat' && openHat) { openHat.g.gain.setTargetAtTime(0, t, 0.01); openHat = null; }
        const v = playBuffer(ctx, audio.mixer.strip(e.rowId).gain, drumBuffer(e.row), t, e.vel, e.row.pitch);
        if (e.row.kind === 'ohat') openHat = v;
      }
      midiOut.note(9, e.gm, e.vel, t, sd);
    }
  }
}

function tick() {
  const ctx = audio.ctx;
  const p = store.project;
  const ahead = 0.12;
  while (transport.nextTime < ctx.currentTime + ahead) {
    const L = loopSteps();
    if (transport.step >= L) transport.step = 0;
    scheduleStep(transport.step, transport.nextTime);
    transport.visualQueue.push({ step: transport.step, time: transport.nextTime });
    transport.nextTime += stepDuration(p.bpm);
    transport.step++;
  }
}

export function play(fromStep = 0) {
  if (transport.playing) return;
  // warm up any sampled instruments
  for (const t of [...store.project.tracks, store.project.chords]) {
    const patch = store.project.patches[t.patch];
    if (patch?.kind === 'sampler') ensureSampleSet(patch.set);
  }
  syncMixer();
  transport.playing = true;
  transport.step = fromStep;
  transport.nextTime = audio.ctx.currentTime + 0.06;
  transport.visualQueue = [];
  invalidateEvents();
  tick();
  transport.timer = setInterval(tick, 25);
}

export function stop() {
  transport.playing = false;
  clearInterval(transport.timer);
  transport.timer = null;
  transport.visualQueue = [];
  midiOut.allOff();
  // quickly fade the master so ringing notes stop cleanly
  const m = audio.mixer?.master;
  if (m) {
    const t = audio.ctx.currentTime;
    m.gain.cancelScheduledValues(t);
    m.gain.setTargetAtTime(0, t, 0.02);
    m.gain.setTargetAtTime(0.8, t + 0.15, 0.01);
  }
}

// Current playhead step for drawing (reads the queue against the audio clock).
export function currentVisualStep() {
  if (!transport.playing) return -1;
  const now = audio.ctx.currentTime;
  const q = transport.visualQueue;
  let cur = -1;
  while (q.length && q[0].time <= now) cur = q.shift().step;
  if (cur >= 0) transport.lastVisual = cur;
  return transport.lastVisual ?? -1;
}

// ---------- Offline render to WAV ----------
export async function renderWav(loops = 2) {
  const p = store.project;
  const sd = stepDuration(p.bpm);
  const L = loopSteps();
  const tail = 2;
  const sr = 44100;
  const total = L * sd * loops + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const mixer = new Mixer(ctx);
  mixer.immediate = true;
  syncMixer(mixer, p);
  const kit = await renderDrumKit(sr, p.drumParams);
  const events = buildEvents(p);
  // make sure sampled instruments are loaded before rendering
  const sets = new Set(events.map(e => p.patches[e.patch]).filter(x => x?.kind === 'sampler').map(x => x.set));
  await Promise.all([...sets].map(loadSampleSet));

  for (let loop = 0; loop < loops; loop++) {
    let open = null;
    for (const e of events) {
      if (!e.audible) continue;
      const t = 0.05 + (loop * L + e.step + swingOffset(p, e.step)) * sd;
      if (e.kind === 'note') {
        const patch = p.patches[e.patch];
        if (patch) playNote(ctx, mixer.strip(e.trackId).gain, patch, e.midi, t, e.dur * sd * 0.98, e.vel);
      } else {
        const buf = e.row.kind === 'sample' ? audio.userBuffers[e.row.sampleId] : kit[e.row.kind];
        if (e.row.kind === 'chat' && open) { open.g.gain.setTargetAtTime(0, t, 0.01); open = null; }
        const v = playBuffer(ctx, mixer.strip(e.rowId).gain, buf, t, e.vel, e.row.pitch);
        if (e.row.kind === 'ohat') open = v;
      }
    }
  }
  const buf = await ctx.startRendering();
  return encodeWav(buf);
}

function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  w(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i]));
    data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return new Blob([data], { type: 'audio/wav' });
}

export { STEPS_PER_BAR, mod };
