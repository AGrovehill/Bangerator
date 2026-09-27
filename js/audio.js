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
// Every channel (a track, the chords, the drum group) gets a strip:
//   input gain -> drive -> low-pass filter -> pump (sidechain-style ducking) -> pan -> master
//                                                                    \-> reverb send, delay send
// Drum rows get a small row strip (gain + pan) that feeds the "drums" channel strip.
// The reverb and delay are shared buses, so every send goes into the same room / echo.
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
    this.rows = new Map();

    // reverb bus
    this.reverb = ctx.createConvolver();
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(this.reverb);
    this.reverb.connect(this.master);
    this.reverbSize = 0;
    this.setReverbSize(2.2);

    // delay bus: delay -> (darkening filter) -> feedback -> delay; output to master
    this.delayIn = ctx.createGain();
    this.delay = ctx.createDelay(4);
    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = 'lowpass';
    this.delayFilter.frequency.value = 5000;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.35;
    this.delayIn.connect(this.delay);
    this.delay.connect(this.delayFilter);
    this.delayFilter.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delayFilter.connect(this.master);
  }

  // Synthetic reverb: a burst of stereo noise that fades out over `seconds`.
  setReverbSize(seconds) {
    if (Math.abs(seconds - this.reverbSize) < 0.01) return;
    this.reverbSize = seconds;
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * seconds));
    const buf = this.ctx.createBuffer(2, len, sr);
    let seed = 99991;
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        d[i] = ((seed / 0x3fffffff) - 1) * Math.pow(1 - i / len, 3);
      }
    }
    this.reverb.buffer = buf;
  }

  strip(id) {
    let s = this.strips.get(id);
    if (!s) {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      const drive = ctx.createWaveShaper();
      drive.oversample = '2x';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      filter.Q.value = 0.7;
      const pump = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const rev = ctx.createGain(); rev.gain.value = 0;
      const dly = ctx.createGain(); dly.gain.value = 0;
      gain.connect(drive).connect(filter).connect(pump).connect(pan).connect(this.master);
      pan.connect(rev).connect(this.reverbIn);
      pan.connect(dly).connect(this.delayIn);
      s = { gain, drive, filter, pump, pan, rev, dly, driveAmt: -1, pumpAmt: 0 };
      this.strips.set(id, s);
    }
    return s;
  }

  // A drum row: its own volume/pan, then into the drum group's channel strip.
  rowStrip(id) {
    let r = this.rows.get(id);
    if (!r) {
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      gain.connect(pan).connect(this.strip('drums').gain);
      r = { gain, pan };
      this.rows.set(id, r);
    }
    return r;
  }

  set(param, v) {
    if (this.immediate) param.value = v;
    else param.setTargetAtTime(v, this.ctx.currentTime, 0.015);
  }

  setRow(id, volume, audible) { this.set(this.rowStrip(id).gain.gain, audible ? volume : 0); }

  // fx: { drive 0..1, cutoff Hz, reverb 0..1, delay 0..1, pump 0..1 }
  setStrip(id, volume, panValue, audible, fx) {
    const s = this.strip(id);
    this.set(s.gain.gain, audible ? volume : 0);
    this.set(s.pan.pan, panValue || 0);
    if (!fx) return;
    if (fx.drive !== s.driveAmt) {
      s.driveAmt = fx.drive;
      s.drive.curve = fx.drive > 0 ? driveCurve(fx.drive) : null;
    }
    this.set(s.filter.frequency, Math.min(fx.cutoff, this.ctx.sampleRate / 2 - 100));
    this.set(s.rev.gain, fx.reverb);
    this.set(s.dly.gain, fx.delay);
    if (s.pumpAmt && !fx.pump) { s.pump.gain.cancelScheduledValues(0); s.pump.gain.value = 1; }
    s.pumpAmt = fx.pump;
  }

  setBus(bus, stepSeconds) {
    this.setReverbSize(bus.reverbSize);
    this.set(this.delay.delayTime, Math.min(4, bus.delaySteps * stepSeconds));
    this.set(this.feedback.gain, bus.delayFeedback);
    this.set(this.master.gain, bus.master);
  }

  // Sidechain-style "pump": duck each pumping channel on the beat, then let it swell back.
  pumpAt(time, beatSeconds, release) {
    for (const s of this.strips.values()) {
      if (!s.pumpAmt) continue;
      const g = s.pump.gain;
      g.setTargetAtTime(1 - 0.9 * s.pumpAmt, time, 0.005);
      g.setTargetAtTime(1, time + 0.03, beatSeconds * 0.35 * release);
    }
  }

  resetPump() {
    for (const s of this.strips.values()) { s.pump.gain.cancelScheduledValues(0); s.pump.gain.value = 1; }
  }
}

// Soft-clipping curve; more drive = more saturation, output level kept roughly constant.
function driveCurve(amount) {
  const k = 1 + amount * 30;
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
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
