// Audio engine: the AudioContext, mixer strips, the sampler, and synth voices.
// All sound is generated in the visitor's browser with the Web Audio API.

import { renderDrumKit } from './drums.js';

export const audio = {
  ctx: null,
  mixer: null,
  drumBuffers: {},   // kind -> AudioBuffer (synthesized 808 kit)
  userBuffers: {},   // sampleId -> AudioBuffer (user-dropped samples)
};

const SAMPLE_BASE = 'samples/';

// Sampled instruments: note name -> file. Loaded lazily the first time they are used.
export const SAMPLE_SETS = {
  piano: { name: 'Piano', dir: 'piano', notes: [
    'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4',
    'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8', 'C1', 'Ds1', 'Fs1'] },
  guitar: { name: 'Acoustic Guitar', dir: 'guitar', notes: [
    'E2', 'G2', 'As2', 'Cs3', 'E3', 'G3', 'As3', 'Cs4', 'E4', 'G4', 'As4', 'D5'] },
  bass: { name: 'Electric Bass', dir: 'bass', notes: [
    'E1', 'G1', 'As1', 'Cs2', 'E2', 'G2', 'As2', 'Cs3', 'E3', 'G3', 'As3', 'Cs4', 'E4', 'G4', 'As4', 'Cs5'] },
};

const NOTE_PC = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };
function noteFileToMidi(n) {
  const m = n.match(/^([A-G]s?)(\d)$/);
  return NOTE_PC[m[1]] + 12 * (Number(m[2]) + 1);
}

const sampleCache = {}; // setId -> Promise<[{midi, buffer}]>
const loadedSets = {};  // setId -> [{midi, buffer}] once decoded

export function loadSampleSet(setId) {
  if (sampleCache[setId]) return sampleCache[setId];
  const set = SAMPLE_SETS[setId];
  const ctx = audio.ctx;
  sampleCache[setId] = Promise.all(set.notes.map(async n => {
    const res = await fetch(`${SAMPLE_BASE}${set.dir}/${n}.mp3`);
    if (!res.ok) throw new Error(`Missing sample ${set.dir}/${n}`);
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    return { midi: noteFileToMidi(n), buffer: buf };
  })).then(list => {
    list.sort((a, b) => a.midi - b.midi);
    loadedSets[setId] = list;
    return list;
  }).catch(err => {
    delete sampleCache[setId];
    throw err;
  });
  return sampleCache[setId];
}

// Synchronous lookup; returns null until the set has loaded.
export function ensureSampleSet(setId) {
  if (loadedSets[setId]) return true;
  loadSampleSet(setId).catch(e => console.warn(e));
  return false;
}
export function isSampleSetLoaded(setId) { return !!loadedSets[setId]; }

function nearestSample(setId, midi) {
  const list = loadedSets[setId];
  if (!list) return null;
  let best = list[0];
  for (const s of list) if (Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s;
  return best;
}

// ---------- Mixer ----------
// One strip (gain + pan) per track id, all into a master bus with a gentle limiter.
export class Mixer {
  constructor(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.strips = new Map();
  }
  strip(id) {
    let s = this.strips.get(id);
    if (!s) {
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      gain.connect(pan);
      pan.connect(this.master);
      s = { gain, pan };
      this.strips.set(id, s);
    }
    return s;
  }
  setStrip(id, volume, panValue, audible) {
    const s = this.strip(id);
    const g = audible ? volume : 0;
    if (this.immediate) { s.gain.gain.value = g; s.pan.pan.value = panValue || 0; return; }
    const t = this.ctx.currentTime;
    s.gain.gain.setTargetAtTime(g, t, 0.01);
    s.pan.pan.setTargetAtTime(panValue || 0, t, 0.01);
  }
}

export async function initAudio() {
  if (audio.ctx) {
    if (audio.ctx.state === 'suspended') await audio.ctx.resume();
    return audio;
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  audio.ctx = ctx;
  audio.mixer = new Mixer(ctx);
  audio.drumBuffers = await renderDrumKit(ctx.sampleRate);
  if (ctx.state === 'suspended') await ctx.resume();
  return audio;
}

function holdAt(param, t) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else { const v = param.value; param.cancelScheduledValues(t); param.setValueAtTime(v, t); }
}

const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

// ---------- Default synth patch ----------
export const DEFAULT_PATCH = {
  wave: 'sawtooth',     // sine | square | sawtooth | triangle
  wave2: 'none',        // optional second oscillator
  mix2: 0.5,
  detune: 8,            // cents between oscillators (and unison spread)
  octave2: 0,           // octave offset of osc 2
  attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.25,
  cutoff: 8000, resonance: 1, filterEnv: 0, // filterEnv: extra Hz added at attack peak
  pitchDrop: 0, pitchTime: 0.05,            // semitones the note falls from at start (808 style)
  glide: 0,
  volume: 0.7,
};

// ---------- Playing notes ----------
// inst: { kind: 'synth', patch } or { kind: 'sampler', set, attack, release, volume }
// Schedules a note on `ctx` into `dest`. Returns a function that stops it early (for previews).
export function playNote(ctx, dest, inst, midi, time, dur, vel = 0.8) {
  if (inst.kind === 'sampler') return playSampled(ctx, dest, inst, midi, time, dur, vel);
  return playSynth(ctx, dest, inst.patch || DEFAULT_PATCH, midi, time, dur, vel);
}

function playSampled(ctx, dest, inst, midi, time, dur, vel) {
  const s = nearestSample(inst.set, midi);
  if (!s) { ensureSampleSet(inst.set); return () => {}; }
  const src = ctx.createBufferSource();
  src.buffer = s.buffer;
  src.playbackRate.value = Math.pow(2, (midi - s.midi) / 12);
  const g = ctx.createGain();
  const peak = vel * (inst.volume ?? 0.9);
  const a = Math.max(0.002, inst.attack ?? 0.003);
  const r = Math.max(0.02, inst.release ?? 0.3);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + a);
  const end = time + Math.max(dur, a);
  g.gain.setValueAtTime(peak, end);
  g.gain.setTargetAtTime(0, end, r / 4);
  src.connect(g);
  g.connect(dest);
  src.start(time);
  src.stop(end + r + 0.1);
  // early stop (e.g. a held preview key is released): run the normal release from here
  return (at = ctx.currentTime) => {
    holdAt(g.gain, at);
    g.gain.setTargetAtTime(0, at, r / 4);
    try { src.stop(at + r + 0.1); } catch { /* already stopped */ }
  };
}

function playSynth(ctx, dest, p, midi, time, dur, vel) {
  const freq = midiToFreq(midi);
  const out = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = p.resonance;
  const nyq = ctx.sampleRate / 2 - 100;
  const cut = Math.min(p.cutoff, nyq);
  filter.frequency.setValueAtTime(Math.min(cut + p.filterEnv, nyq), time);
  if (p.filterEnv) filter.frequency.setTargetAtTime(cut, time + p.attack, Math.max(0.01, p.decay / 3));
  filter.connect(out);
  out.connect(dest);

  const oscs = [];
  const addOsc = (type, level, detuneCents, octave) => {
    if (type === 'none' || level <= 0) return;
    const o = ctx.createOscillator();
    o.type = type;
    const f = freq * Math.pow(2, octave);
    if (p.pitchDrop) {
      o.frequency.setValueAtTime(f * Math.pow(2, p.pitchDrop / 12), time);
      o.frequency.exponentialRampToValueAtTime(f, time + Math.max(0.005, p.pitchTime));
    } else {
      o.frequency.setValueAtTime(f, time);
    }
    o.detune.value = detuneCents;
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g);
    g.connect(filter);
    oscs.push(o);
  };
  const mix2 = p.wave2 === 'none' ? 0 : p.mix2;
  addOsc(p.wave, 1 - mix2 * 0.5, -p.detune / 2, 0);
  addOsc(p.wave2, mix2, p.detune / 2, p.octave2 || 0);

  // ADSR on the output gain. Square and saw waves are loud, so tame them a little.
  const loud = { sine: 1, triangle: 0.9, square: 0.45, sawtooth: 0.5 }[p.wave] ?? 0.6;
  const peak = vel * p.volume * loud;
  const a = Math.max(0.002, p.attack), d = Math.max(0.005, p.decay), r = Math.max(0.01, p.release);
  const sus = peak * p.sustain;
  const g = out.gain;
  g.setValueAtTime(0, time);
  g.linearRampToValueAtTime(peak, time + a);
  g.setTargetAtTime(sus, time + a, d / 3);
  // Release starts at note end (never before the attack has finished).
  const end = Math.max(time + Math.max(dur, 0.01), time + a + 0.001);
  g.setTargetAtTime(0, end, r / 4);
  const stopAt = end + r + 0.1;
  oscs.forEach(o => { o.start(time); o.stop(stopAt); });
  oscs[0]?.addEventListener('ended', () => { try { out.disconnect(); } catch { /* ignore */ } });
  return (at = ctx.currentTime) => {
    holdAt(g, at);
    g.setTargetAtTime(0, at, r / 4);
    oscs.forEach(o => { try { o.stop(at + r + 0.1); } catch { /* ignore */ } });
  };
}

// ---------- Drums / one-shot samples ----------
export function playBuffer(ctx, dest, buffer, time, vel = 1, semitones = 0) {
  if (!buffer) return null;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = Math.pow(2, semitones / 12);
  const g = ctx.createGain();
  g.gain.value = vel;
  src.connect(g);
  g.connect(dest);
  src.start(time);
  return { src, g };
}

// Decode a user-dropped audio file into a buffer.
export async function decodeUserSample(arrayBuffer) {
  await initAudio();
  return audio.ctx.decodeAudioData(arrayBuffer.slice(0));
}
