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
// Every channel (a track, the chords, the drum group, each drum sound) gets a strip:
//   input -> EQ (low shelf, mid peak, high shelf) -> compressor -> drive -> low-pass -> high-pass
//     -> pump (sidechain-style ducking) -> fader (volume, mute) -> pan -> out   (+ reverb and delay sends after pan)
// The fader comes after the effects, like on a real desk, so turning a driven channel down really makes it quieter.
// Channels go out to the master; drum sounds ("row:<id>") go out into the "drums" group strip.
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
      const eqLow = ctx.createBiquadFilter();
      eqLow.type = 'lowshelf'; eqLow.frequency.value = 120;
      const eqMid = ctx.createBiquadFilter();
      eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 0.9;
      const eqHigh = ctx.createBiquadFilter();
      eqHigh.type = 'highshelf'; eqHigh.frequency.value = 6000;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = 0; comp.ratio.value = 1; comp.knee.value = 8;
      comp.attack.value = 0.01; comp.release.value = 0.15;
      const makeup = ctx.createGain();
      const drive = ctx.createWaveShaper();
      drive.oversample = '2x';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      filter.Q.value = 0.7;
      const fader = ctx.createGain();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 10;
      hp.Q.value = 0.7;
      const pump = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const rev = ctx.createGain(); rev.gain.value = 0;
      const dly = ctx.createGain(); dly.gain.value = 0;
      const out = id.startsWith('row:') ? this.strip('drums').gain : this.master;
      gain.connect(eqLow).connect(eqMid).connect(eqHigh).connect(comp).connect(makeup)
        .connect(drive).connect(filter).connect(hp).connect(pump).connect(fader).connect(pan).connect(out);
      pan.connect(rev).connect(this.reverbIn);
      pan.connect(dly).connect(this.delayIn);
      s = { gain, eqLow, eqMid, eqHigh, comp, makeup, drive, filter, hp, pump, fader, pan, rev, dly, driveAmt: -1, pumpAmt: 0, audible: true };
      this.strips.set(id, s);
    }
    return s;
  }

  // A drum sound's strip (feeds the drum group strip).
  rowStrip(id) { return this.strip('row:' + id); }

  // Glide a parameter to `v`, starting now or at `time` (automation is scheduled ahead).
  set(param, v, time) {
    if (this.immediate && time == null) param.value = v;
    else param.setTargetAtTime(v, time ?? this.ctx.currentTime, 0.015);
  }

  // fx: { drive 0..1, cutoff Hz (low-pass), hpCut Hz (high-pass), reso 0..1, reverb 0..1, delay 0..1, pump 0..1,
  //       eqLow/eqMid/eqHigh dB, eqMidFreq Hz, comp 0..1 }
  setStrip(id, volume, panValue, audible, fx) {
    const s = this.strip(id);
    s.audible = audible;
    s.volume = volume;
    this.set(s.fader.gain, audible ? volume : 0);
    this.set(s.pan.pan, panValue || 0);
    if (!fx) return;
    if (fx.drive !== s.driveAmt) {
      s.driveAmt = fx.drive;
      s.drive.curve = fx.drive > 0 ? driveCurve(fx.drive) : null;
    }
    for (const k of ['cutoff', 'hpCut', 'reso', 'reverb', 'delay', 'pump', 'eqLow', 'eqMid', 'eqHigh', 'eqMidFreq', 'comp']) this.param(id, k, fx[k] ?? 0);
  }

  // Drop automation that was scheduled ahead (on stop), so the mixer's own values can take over.
  cancelScheduled() {
    const now = this.ctx.currentTime;
    for (const s of this.strips.values()) {
      for (const prm of [s.fader.gain, s.eqLow.gain, s.eqMid.gain, s.eqMid.frequency, s.eqHigh.gain, s.comp.threshold, s.comp.ratio,
        s.makeup.gain, s.filter.frequency, s.filter.Q, s.hp.frequency, s.hp.Q, s.pan.pan, s.rev.gain, s.dly.gain]) prm.cancelScheduledValues(now);
    }
  }

  // Set one strip parameter (also used by automation, with a time). Values are in real units.
  param(id, key, v, time) {
    const s = id === 'master' ? null : this.strip(id);
    switch (key) {
      case 'master': return this.set(this.master.gain, v, time);
      case 'volume': s.volume = v; return this.set(s.fader.gain, s.audible ? v : 0, time);
      case 'pan': return this.set(s.pan.pan, v, time);
      case 'cutoff': return this.set(s.filter.frequency, Math.min(v || 20000, this.ctx.sampleRate / 2 - 100), time);
      case 'hpCut': return this.set(s.hp.frequency, Math.max(10, v || 10), time);
      case 'reso': { // resonance on both filters
        const q = 0.7 + 14 * v * v;
        this.set(s.filter.Q, q, time);
        return this.set(s.hp.Q, q, time);
      }
      case 'reverb': return this.set(s.rev.gain, v, time);
      case 'delay': return this.set(s.dly.gain, v, time);
      case 'eqLow': return this.set(s.eqLow.gain, v, time);
      case 'eqMid': return this.set(s.eqMid.gain, v, time);
      case 'eqHigh': return this.set(s.eqHigh.gain, v, time);
      case 'eqMidFreq': return this.set(s.eqMid.frequency, v || 1000, time);
      case 'comp': {
        // one knob: lower threshold + higher ratio, with automatic makeup gain
        this.set(s.comp.threshold, -36 * v, time);
        this.set(s.comp.ratio, 1 + 7 * v, time);
        return this.set(s.makeup.gain, Math.pow(10, (12 * v * v + 6 * v) / 20 * 0.6), time);
      }
      case 'pump':
        if (s.pumpAmt && !v) { s.pump.gain.cancelScheduledValues(0); s.pump.gain.value = 1; }
        s.pumpAmt = v;
        return undefined;
      default: return undefined;
    }
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

// Soft-clipping curve: more drive = more saturation (harmonics, grit), at about the same loudness.
// The curve is matched at a typical level (0.3): quieter parts get a little louder, peaks get squashed,
// instead of everything being pushed to full scale.
function driveCurve(amount) {
  const k = 1 + amount * 30;
  const ref = 0.3;
  const g = ref / Math.tanh(k * ref);
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) * g;
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
  unison: 1,            // copies of osc 1 spread across the detune amount (7 saws = the trance "supersaw")
  octave2: 0,           // octave offset of osc 2
  attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.25,
  cutoff: 8000, resonance: 1, filterEnv: 0, // filterEnv: extra Hz added at attack peak
  filterSlope: 12,      // 12 or 24 dB/octave
  filterDecay: 0,       // how fast the filter envelope falls (0 = same as Decay)
  velToFilter: 0,       // 0..1: how much harder notes open the filter (accent)
  mono: false,          // one note at a time; overlapping notes slide (glide) instead of retriggering
  fm: 0,                // FM: a hidden sine wobbles the pitch of wave 1 this much (0 = off). Metallic, glassy, "zappy"
  fmRatio: 2,           // the modulator's pitch, relative to the note (whole numbers sound tuned, others clangy)
  fmDecay: 0,           // how fast the FM amount falls after the attack (0 = it stays). Short = a "zap"
  vibrato: 0,           // pitch wobble depth in cents (0 = off): strings, voices, flutes
  vibratoRate: 5,       // wobbles per second
  vibratoDelay: 0.3,    // seconds before the vibrato fades in, like a player who starts a note straight
  pitchDrop: 0, pitchTime: 0.05,            // semitones the note falls from at start (808 style)
  glide: 0.06,          // slide time for mono patches
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

// Mono synths remember their sounding voice per output, so a note that starts while the previous one
// is still held slides into it instead of starting over (the TB-303 "slide").
const monoVoices = new WeakMap();

function playSynth(ctx, dest, p, midi, time, dur, vel) {
  const freq = midiToFreq(midi);
  const a = Math.max(0.002, p.attack), d = Math.max(0.005, p.decay), r = Math.max(0.01, p.release);
  const end = Math.max(time + Math.max(dur, 0.01), time + a + 0.001); // release starts here

  if (p.mono) {
    const last = monoVoices.get(dest);
    if (last && last.ctx === ctx && time >= last.start && time < last.end - 0.002) {
      const glide = Math.max(0.005, p.glide || 0.06);
      for (const { o, mult } of last.oscs) if (mult != null) o.frequency.setTargetAtTime(freq * mult, time, glide / 3);
      // keep the gate open until the new note ends (the old release is cancelled)
      last.gain.cancelScheduledValues(time);
      last.gain.setTargetAtTime(0, end, r / 4);
      for (const { o } of last.oscs) { try { o.stop(end + r + 0.1); } catch { /* already stopped */ } }
      last.end = end;
      const g = last.gain;
      return (at = ctx.currentTime) => { holdAt(g, at); g.setTargetAtTime(0, at, r / 4); };
    }
  }

  const out = ctx.createGain();
  // Filter: 12 dB (one resonant low-pass) or 24 dB (a clean low-pass into a resonant one: squelchier, more 303)
  const nyq = ctx.sampleRate / 2 - 100;
  const cut = Math.min(p.cutoff, nyq);
  // Velocity can push the filter envelope (accents open the filter further, like a 303's accent)
  const envAmt = Math.max(0, p.filterEnv * (1 + (p.velToFilter || 0) * (vel - 0.75) * 2.5));
  const fDecay = Math.max(0.01, p.filterDecay || p.decay);
  const filters = [];
  const mkFilter = q => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.min(cut + envAmt, nyq), time);
    if (envAmt) f.frequency.setTargetAtTime(cut, time + a, fDecay / 3);
    filters.push(f);
    return f;
  };
  if (p.filterSlope === 24) mkFilter(0.707).connect(mkFilter(p.resonance));
  else mkFilter(p.resonance);
  const filterIn = filters[0];
  filters[filters.length - 1].connect(out);
  out.connect(dest);

  const oscs = [];
  const addOsc = (type, level, detuneCents, octave) => {
    if (type === 'none' || level <= 0) return;
    const o = ctx.createOscillator();
    o.type = type;
    const mult = Math.pow(2, octave);
    const f = freq * mult;
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
    g.connect(filterIn);
    oscs.push({ o, mult });
  };
  const mix2 = p.wave2 === 'none' ? 0 : p.mix2;
  const voices = Math.max(1, Math.min(7, Math.round(p.unison || 1)));
  if (voices === 1) addOsc(p.wave, 1 - mix2 * 0.5, -p.detune / 2, 0);
  else {
    // spread the copies evenly from -detune to +detune cents; keep the overall level about the same
    for (let v = 0; v < voices; v++) addOsc(p.wave, (1 - mix2 * 0.5) * 1.25 / Math.sqrt(voices), (v / (voices - 1) * 2 - 1) * p.detune, 0);
  }
  addOsc(p.wave2, mix2, p.detune / 2, p.octave2 || 0);

  // FM: a sine modulator bends the frequency of wave 1's oscillators. Its depth follows its own envelope.
  if (p.fm > 0) {
    const ratio = p.fmRatio || 1;
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(freq * ratio, time);
    const depth = ctx.createGain();
    const dev = p.fm * freq * ratio; // frequency deviation in Hz (index x modulator frequency)
    depth.gain.setValueAtTime(dev, time);
    if (p.fmDecay) depth.gain.setTargetAtTime(dev * 0.12, time + 0.002, p.fmDecay / 3);
    mod.connect(depth);
    const carriers = oscs.slice(0, voices);
    for (const { o } of carriers) depth.connect(o.frequency);
    oscs.push({ o: mod, mult: ratio });
  }

  // Vibrato: a slow sine bends every oscillator's pitch (in cents), fading in after vibratoDelay.
  const extras = [];
  if (p.vibrato > 0) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = p.vibratoRate || 5;
    const depth = ctx.createGain();
    const at = time + Math.max(0, p.vibratoDelay ?? 0.3);
    depth.gain.setValueAtTime(0, time);
    depth.gain.setValueAtTime(0, at);
    depth.gain.linearRampToValueAtTime(p.vibrato, at + 0.4);
    lfo.connect(depth);
    for (const { o } of oscs) depth.connect(o.detune);
    extras.push(lfo);
  }

  // ADSR on the output gain. Square and saw waves are loud, so tame them a little.
  const loud = { sine: 1, triangle: 0.9, square: 0.45, sawtooth: 0.5 }[p.wave] ?? 0.6;
  const peak = vel * p.volume * loud;
  const sus = peak * p.sustain;
  const g = out.gain;
  g.setValueAtTime(0, time);
  g.linearRampToValueAtTime(peak, time + a);
  g.setTargetAtTime(sus, time + a, d / 3);
  g.setTargetAtTime(0, end, r / 4);
  const stopAt = end + r + 0.1;
  oscs.forEach(({ o }) => { o.start(time); o.stop(stopAt); });
  extras.forEach(o => { o.start(time); o.stop(stopAt); });
  oscs[0]?.o.addEventListener('ended', () => { try { out.disconnect(); } catch { /* ignore */ } });
  if (p.mono) monoVoices.set(dest, { ctx, start: time, end, oscs: [...oscs, ...extras.map(o => ({ o, mult: null }))], gain: g });
  return (at = ctx.currentTime) => {
    holdAt(g, at);
    g.setTargetAtTime(0, at, r / 4);
    [...oscs.map(x => x.o), ...extras].forEach(o => { try { o.stop(at + r + 0.1); } catch { /* ignore */ } });
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
