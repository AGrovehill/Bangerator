// Transport + scheduler. Uses the classic "look-ahead" pattern: a timer wakes up often
// and schedules any steps that fall in the next ~120 ms on the audio clock.
// Two modes, like FL Studio: loop the open pattern, or play the song (the playlist).
// The same timeline builder is used for live playback, WAV rendering and MIDI export.

import { audio, playNote, playBuffer, Mixer, ensureSampleSet, loadSampleSet } from './audio.js';
import { store, STEPS_PER_BAR, keyAt, scaleNoteMidi, patternView, songBars, defaultFx } from './state.js';
import { autoEvents, applyAuto, patchFor } from './automation.js';
import { scaleSteps, harmonyScaleId, chordSemis, voiceLead, mod } from './theory.js';
import { renderDrumKit, DRUM_KINDS } from './drums.js';
import { midiOut } from './midi.js';

export const stepDuration = bpm => 60 / bpm / 4; // 16th notes

// Scale-mode notes are degrees in the key at their position; piano-roll notes are fixed MIDI pitches.
export function noteMidi(p, track, note) {
  return track.mode === 'piano' ? note.midi : scaleNoteMidi(p, track, note);
}

// Pitches for each chord slot, voice-led across the loop. Each slot uses the key at its position.
// Returns array of { midis, deg, type } | null
export function chordVoicings(p) {
  const c = p.chords;
  const slotCount = Math.ceil(p.bars * STEPS_PER_BAR / c.slotSteps);
  const out = [];
  let prevCenter = null;
  for (let i = 0; i < slotCount; i++) {
    const s = c.slots[i];
    if (!s) { out.push(null); continue; }
    const k = keyAt(p, i * c.slotSteps);
    const steps = scaleSteps(harmonyScaleId(k.scale));
    const base = 12 * (c.octave + 1) + k.root;
    let midis = chordSemis(steps, s.deg, s.type).map(x => base + x);
    if (c.voiceLead) {
      const center = 12 * (c.octave + 1) + 7; // keep chords around the same register in every key
      midis = voiceLead(midis, prevCenter ?? center, center - 12, center + 16);
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

// Build every event of one pattern pass: [{ step, dur (in steps), kind, ... }]
// `p` is the project (= its open pattern) or a patternView().
export function buildEvents(p) {
  const L = p.bars * STEPS_PER_BAR;
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
  const chAud = audible(c) && !p.chordsGuide; // guide-only chords stay silent
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
    } else if (c.style === 'gate') {
      // the chord chopped into 16ths by a rhythmic gate (trance / psy pads)
      for (let s = 0; s < len; s++) {
        const g = GATE[(start + s) % 16];
        if (g) v.midis.forEach(m => push(start + s, 0.55, m, g === 2 ? 0.75 : 0.55));
      }
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

// Within a step: automation first (releases, pattern lanes, song lanes), then notes, so notes hear it.
const byStep = (a, b) => a.step - b.step || (a.prio ?? 3) - (b.prio ?? 3);

export function patternTimeline(p) {
  const length = p.bars * STEPS_PER_BAR;
  return { events: [...buildEvents(p), ...autoEvents(p.patAuto, length)].sort(byStep), length };
}

// Every clip in the playlist, laid out on one timeline (steps from the song start).
export function songTimeline(p) {
  const events = [];
  const built = new Map(); // one event list per pattern + key combination
  const songTargets = new Set(p.song.auto.filter(l => l.points.length).map(l => l.target)); // song lanes win
  for (const c of p.song.clips) {
    if (p.song.lanes[c.lane]?.mute) continue;
    const k = c.pat + '|' + (c.key ? `${c.key.root}${c.key.scale}` : '');
    if (!built.has(k)) {
      const v = patternView(p, c.pat, c.key);
      built.set(k, v ? { evs: [...buildEvents(v), ...autoEvents(v.patAuto, v.bars * STEPS_PER_BAR, 1, songTargets)], len: v.bars * STEPS_PER_BAR,
        autoTargets: [...new Set(v.patAuto.filter(l => l.points.length && !songTargets.has(l.target)).map(l => l.target))] } : null);
    }
    const src = built.get(k);
    if (!src) continue;
    const clipLen = c.len * STEPS_PER_BAR, base = c.bar * STEPS_PER_BAR;
    for (let off = 0; off < clipLen; off += src.len) {
      for (const e of src.evs) {
        const s = off + e.step;
        if (s >= clipLen) continue;
        events.push({ ...e, step: base + s, dur: Math.min(e.dur, clipLen - s), clipId: c.id });
      }
    }
    // when the clip ends, its pattern's automation hands back to the mixer
    for (const target of src.autoTargets) events.push({ step: base + clipLen, kind: 'auto', target, value: null, prio: 0 });
  }
  const length = songBars(p) * STEPS_PER_BAR;
  events.push(...autoEvents(p.song.auto, length, 2));
  events.sort(byStep);
  return { events, length };
}

const GATE = [2, 0, 1, 1, 0, 1, 1, 0, 2, 0, 1, 1, 0, 1, 1, 1]; // 2 = accented 16th, 1 = soft, 0 = silent

// Swing delays every second 16th note.
// swingGrid 16: every second 16th is late (house, hip hop). swingGrid 8: the second 8th of every beat is
// late, the blues / jazz shuffle; at Swing 33% it lands exactly on the last triplet of the beat.
export function swingOffset(p, step) {
  const s = Math.floor(step);
  if (p.swingGrid === 8) return s % 4 === 2 ? p.swing * 2 : 0;
  return s % 2 === 1 ? p.swing * 0.5 : 0;
}

// ---------- Live transport ----------
export const transport = {
  mode: 'pattern',  // 'pattern' loops the open pattern, 'song' plays the playlist
  playing: false,
  step: 0,          // next step to schedule (pattern step, or song step)
  nextTime: 0,      // audio time of that step
  timer: null,
  events: null,     // cached events, rebuilt when the project changes
  visualQueue: [],  // { step, time } for the playhead
};

export function invalidateEvents() { transport.events = null; }

function timeline() {
  const p = store.project;
  return transport.mode === 'song' ? songTimeline(p) : patternTimeline(p);
}

// Where playback wraps: the pattern, or the song's loop region (whole song when none is set).
export function loopRange() {
  const p = store.project;
  if (transport.mode !== 'song') return { start: 0, end: p.bars * STEPS_PER_BAR };
  const end = Math.max(1, songBars(p)) * STEPS_PER_BAR;
  const l = p.song.loop;
  if (l && l.end > l.start) return { start: l.start * STEPS_PER_BAR, end: l.end * STEPS_PER_BAR };
  return { start: 0, end };
}

function eventsFor(step) {
  if (!transport.events) {
    const all = timeline().events;
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

// Apply volume/pan/mute/effects to the mixer (live, or the offline one used for WAV export).
export function syncMixer(mixer = audio.mixer, p = store.project) {
  if (!mixer) return;
  const melodic = [...p.tracks, p.chords];
  const aud = audibleSet(melodic);
  p.tracks.forEach(t => mixer.setStrip(t.id, t.volume, t.pan, aud(t), t.fx));
  mixer.setStrip('chords', p.chords.volume, p.chords.pan, aud(p.chords), p.chords.fx);
  mixer.setStrip('drums', p.drums.volume, 0, true, p.drums.fx);
  const dAud = audibleSet(p.drums.rows);
  // drum sounds have their own strips; their effects only count when the drums are split per sound
  p.drums.rows.forEach(r => mixer.setStrip('row:' + r.id, r.vol, r.pan || 0, dAud(r), p.drums.split ? r.fx : FLAT_FX));
  mixer.setBus(p.fxBus, stepDuration(p.bpm));
}

const FLAT_FX = defaultFx();

function drumBuffer(row) {
  return row.kind === 'sample' ? audio.userBuffers[row.sampleId] : audio.drumBuffers[row.kind];
}

// Open hats get cut off by closed hats, like on the real machine.
let openHat = null;

function scheduleStep(step, time) {
  const p = store.project;
  const sd = stepDuration(p.bpm);
  const ctx = audio.ctx;
  if (step % 4 === 0) audio.mixer.pumpAt(time, sd * 4, p.fxBus.pumpRelease);
  for (const e of eventsFor(step)) {
    const t = time + (e.step - step + swingOffset(p, e.step)) * sd;
    if (e.kind === 'auto') {
      applyAuto(audio.mixer, p, e, Math.max(t, ctx.currentTime));
    } else if (e.kind === 'note') {
      const patch = patchFor(audio.mixer, e.trackId, p.patches[e.patch]);
      if (!patch) continue;
      if (e.audible && !midiOut.localMute) playNote(ctx, audio.mixer.strip(e.trackId).gain, patch, e.midi, t, e.dur * sd * 0.98, e.vel);
      if (e.audible) midiOut.note(e.channel, e.midi, e.vel, t, e.dur * sd * 0.98);
    } else {
      if (!e.audible) continue;
      if (!midiOut.localMute) {
        if (e.row.kind === 'chat' && openHat) { openHat.g.gain.setTargetAtTime(0, t, 0.01); openHat = null; }
        const v = playBuffer(ctx, audio.mixer.rowStrip(e.rowId).gain, drumBuffer(e.row), t, e.vel, e.row.pitch);
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
    const { start, end } = loopRange();
    if (transport.step >= end) transport.step = start;
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
  transport.lastVisual = -1;
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
  const mx = audio.mixer;
  if (mx) {
    mx.cancelScheduled();
    mx.synthOverride?.clear();
    syncMixer(); // automation hands back to the mixer
    mx.resetPump();
    // quickly fade the master so ringing notes and echoes stop cleanly
    const t = audio.ctx.currentTime;
    const m = mx.master.gain;
    m.cancelScheduledValues(t);
    m.setTargetAtTime(0, t, 0.02);
    m.setTargetAtTime(store.project.fxBus.master, t + 0.15, 0.01);
  }
}

// Exact position (fractional step) of what you are hearing right now, accounting for output latency.
// Used to place notes recorded from a MIDI keyboard.
export function heardPosition() {
  if (!transport.playing) return -1;
  const ctx = audio.ctx;
  const sd = stepDuration(store.project.bpm);
  const heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  let pos = transport.step - (transport.nextTime - heard) / sd;
  const { start, end } = loopRange();
  // just wrapped around: what you hear is still the end of the loop
  if (pos < start && transport.step >= start && transport.step - start < 16) pos += end - start;
  return pos;
}

// Where the open pattern is being played right now (for the editor's playhead), or -1.
export function openPatternStep(step) {
  if (step < 0) return -1;
  const p = store.project;
  if (transport.mode !== 'song') return step;
  const len = p.bars * STEPS_PER_BAR;
  for (const c of p.song.clips) {
    if (c.pat !== p.currentPattern || p.song.lanes[c.lane]?.mute) continue;
    const rel = step - c.bar * STEPS_PER_BAR;
    if (rel >= 0 && rel < c.len * STEPS_PER_BAR) return rel % len;
  }
  return -1;
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
// song: render the whole playlist once; otherwise the open pattern `loops` times.
// onProgress(fraction 0..1, phase text) is called along the way; cancel.cancelled = true stops it.
// Phases: loading sounds, rendering (the offline renderer pauses every couple of seconds of audio to report
// progress and place the next notes), encoding.
export async function renderWav({ song = false, loops = 2, onProgress = () => {}, cancel = {} } = {}) {
  const p = store.project;
  const sd = stepDuration(p.bpm);
  const tl = song ? songTimeline(p) : patternTimeline(p);
  if (song) loops = 1;
  const L = tl.length;
  const tail = Math.max(2, p.fxBus.reverbSize + 1);
  const sr = 44100;
  const total = L * sd * loops + tail;
  const stopped = () => { if (cancel.cancelled) throw Object.assign(new Error('Cancelled'), { cancelled: true }); };
  const yieldUI = () => new Promise(r => setTimeout(r, 0));

  onProgress(0, 'Loading sounds…');
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const mixer = new Mixer(ctx);
  mixer.immediate = true;
  syncMixer(mixer, p);
  const kit = await renderDrumKit(sr, p.drumParams);
  const events = tl.events;
  // make sure sampled instruments are loaded before rendering
  const sets = new Set(events.map(e => p.patches[e.patch]).filter(x => x?.kind === 'sampler').map(x => x.set));
  await Promise.all([...sets].map(loadSampleSet));
  stopped();

  // Notes are created just ahead of the renderer, a window at a time: the renderer pauses at each window's start,
  // the next window's notes are placed, and it carries on. Creating every note up front makes the browser process
  // thousands of waiting nodes on every audio block, which gets slower and slower as songs get longer.
  const start = 0.05;
  const jobs = [];
  for (let loop = 0; loop < loops; loop++) {
    for (const e of events) {
      if (!e.audible && e.kind !== 'auto') continue;
      jobs.push({ t: start + (loop * L + e.step + swingOffset(p, e.step)) * sd, e });
    }
  }
  jobs.sort((x, y) => x.t - y.t);
  const pumps = [];
  for (let s = 0; s < L * loops; s += 4) pumps.push(start + s * sd);
  let ji = 0, pi = 0, open = null;
  const place = until => {
    while (pi < pumps.length && pumps[pi] < until) mixer.pumpAt(pumps[pi++], sd * 4, p.fxBus.pumpRelease);
    while (ji < jobs.length && jobs[ji].t < until) {
      const { t, e } = jobs[ji++];
      if (e.kind === 'auto') {
        applyAuto(mixer, p, e, t);
      } else if (e.kind === 'note') {
        const patch = patchFor(mixer, e.trackId, p.patches[e.patch]);
        if (patch) playNote(ctx, mixer.strip(e.trackId).gain, patch, e.midi, t, e.dur * sd * 0.98, e.vel);
      } else {
        const buf = e.row.kind === 'sample' ? audio.userBuffers[e.row.sampleId] : kit[e.row.kind];
        if (e.row.kind === 'chat' && open) { open.g.gain.setTargetAtTime(0, t, 0.01); open = null; }
        const v = playBuffer(ctx, mixer.rowStrip(e.rowId).gain, buf, t, e.vel, e.row.pitch);
        if (e.row.kind === 'ohat') open = v;
      }
    }
  };

  // rendering: 2..97%
  const WINDOW = 2; // seconds
  const block = t => Math.floor(t * sr / 128) * 128 / sr; // pauses sit on render-block boundaries
  const bounds = [];
  for (let t = WINDOW; t < total; t += WINDOW) bounds.push(block(t));
  let cancelRender;
  const cancelled = new Promise((_, reject) => { cancelRender = reject; });
  // Cancel answers at once; the renderer itself stops at its next pause, where it is no longer resumed.
  cancel.onCancel = () => cancelRender(Object.assign(new Error('Cancelled'), { cancelled: true }));
  bounds.forEach((t, i) => {
    ctx.suspend(t).then(() => {
      onProgress(0.02 + 0.95 * t / total, 'Rendering…');
      if (cancel.cancelled) { cancel.onCancel(); return; }
      place(bounds[i + 1] ?? Infinity);
      ctx.resume();
    });
  });
  place(bounds[0] ?? Infinity);
  stopped();
  onProgress(0.02, 'Rendering…');
  const buf = await Promise.race([ctx.startRendering(), cancelled]);
  onProgress(0.98, 'Encoding the WAV…');
  await yieldUI();
  const wav = encodeWav(buf);
  onProgress(1, 'Done');
  return wav;
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
