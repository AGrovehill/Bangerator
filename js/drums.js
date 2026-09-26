// 808-style drum kit, synthesized the way the analog Roland TR-808 made its sounds.
// Each voice is rendered once into an AudioBuffer with an OfflineAudioContext,
// so playback during the song is just cheap buffer playback.

export const DRUM_KINDS = [
  { kind: 'kick', name: 'Kick', gm: 36 },
  { kind: 'snare', name: 'Snare', gm: 38 },
  { kind: 'clap', name: 'Clap', gm: 39 },
  { kind: 'rim', name: 'Rimshot', gm: 37 },
  { kind: 'chat', name: 'Closed Hat', gm: 42 },
  { kind: 'ohat', name: 'Open Hat', gm: 46 },
  { kind: 'ltom', name: 'Low Tom', gm: 45 },
  { kind: 'mtom', name: 'Mid Tom', gm: 47 },
  { kind: 'htom', name: 'High Tom', gm: 50 },
  { kind: 'cowbell', name: 'Cowbell', gm: 56 },
  { kind: 'cymbal', name: 'Cymbal', gm: 49 },
  { kind: 'shaker', name: 'Maracas', gm: 70 },
];

// Tweakable parameters (edited in the Sound Design tab).
export const DRUM_PARAMS = {
  kick: { tune: 50, decay: 0.9, punch: 3, click: 0.4 },
  snare: { tune: 185, decay: 0.2, snappy: 0.7 },
  clap: { decay: 0.35, tone: 1100 },
  rim: { tune: 1700 },
  chat: { decay: 0.06, tone: 8000 },
  ohat: { decay: 0.45, tone: 8000 },
  ltom: { tune: 95, decay: 0.45 },
  mtom: { tune: 140, decay: 0.38 },
  htom: { tune: 200, decay: 0.32 },
  cowbell: { decay: 0.35 },
  cymbal: { decay: 1.4, tone: 7000 },
  shaker: { decay: 0.06 },
};

// The six "metallic" square-wave frequencies used by the 808 hats and cymbal.
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

function noiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff; // deterministic noise
    d[i] = (seed / 0x3fffffff) - 1;
  }
  return b;
}

function env(param, t, peak, decay, attack = 0.001) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

const VOICES = {
  kick(ctx, p) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    o.frequency.setValueAtTime(p.tune * p.punch, 0);
    o.frequency.exponentialRampToValueAtTime(p.tune * 1.3, 0.03);
    o.frequency.exponentialRampToValueAtTime(p.tune, 0.12);
    env(g.gain, 0, 1, p.decay, 0.002);
    o.connect(g).connect(ctx.destination);
    o.start(0); o.stop(p.decay + 0.1);
    // beater click
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx, 0.02);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
    const ng = ctx.createGain(); env(ng.gain, 0, p.click, 0.01);
    n.connect(hp).connect(ng).connect(ctx.destination);
    n.start(0);
    return p.decay + 0.15;
  },
  snare(ctx, p) {
    [1, 1.62].forEach((m, i) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(p.tune * m * 1.2, 0);
      o.frequency.exponentialRampToValueAtTime(p.tune * m, 0.02);
      const g = ctx.createGain(); env(g.gain, 0, i ? 0.35 : 0.6, 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(0); o.stop(0.3);
    });
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.5);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const g = ctx.createGain(); env(g.gain, 0, p.snappy, p.decay);
    n.connect(hp).connect(g).connect(ctx.destination);
    n.start(0);
    return p.decay + 0.1;
  },
  clap(ctx, p) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 1);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = p.tone; bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    // three quick "hands" then the room tail
    [0, 0.011, 0.022].forEach(t => {
      g.gain.setValueAtTime(1, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.009);
    });
    g.gain.setValueAtTime(0.8, 0.031);
    g.gain.exponentialRampToValueAtTime(0.0001, 0.031 + p.decay);
    n.connect(bp).connect(g).connect(ctx.destination);
    n.start(0);
    return p.decay + 0.1;
  },
  rim(ctx, p) {
    [p.tune, p.tune * 0.3].forEach(f => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); env(g.gain, 0, 0.6, 0.03);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
      o.connect(hp).connect(g).connect(ctx.destination);
      o.start(0); o.stop(0.1);
    });
    return 0.12;
  },
  chat: (ctx, p) => metal(ctx, p.decay, p.tone, 0.7),
  ohat: (ctx, p) => metal(ctx, p.decay, p.tone, 0.6),
  cymbal: (ctx, p) => metal(ctx, p.decay, p.tone, 0.5),
  ltom: (ctx, p) => tom(ctx, p),
  mtom: (ctx, p) => tom(ctx, p),
  htom: (ctx, p) => tom(ctx, p),
  cowbell(ctx, p) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2640; bp.Q.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.7, 0.002);
    g.gain.exponentialRampToValueAtTime(0.25, 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, 0.03 + p.decay);
    [540, 800].forEach(f => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      o.connect(bp);
      o.start(0); o.stop(p.decay + 0.1);
    });
    bp.connect(g).connect(ctx.destination);
    return p.decay + 0.1;
  },
  shaker(ctx, p) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.3);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = ctx.createGain(); env(g.gain, 0, 0.5, p.decay, 0.005);
    n.connect(hp).connect(g).connect(ctx.destination);
    n.start(0);
    return p.decay + 0.05;
  },
};

function metal(ctx, decay, tone, level) {
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.8;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = tone;
  const g = ctx.createGain(); env(g.gain, 0, level, decay);
  METAL.forEach(f => {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * 1.7;
    const og = ctx.createGain(); og.gain.value = 0.3;
    o.connect(og).connect(bp);
    o.start(0); o.stop(decay + 0.1);
  });
  bp.connect(hp).connect(g).connect(ctx.destination);
  return decay + 0.05;
}

function tom(ctx, p) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(p.tune * 1.4, 0);
  o.frequency.exponentialRampToValueAtTime(p.tune, 0.05);
  const g = ctx.createGain(); env(g.gain, 0, 0.9, p.decay, 0.002);
  o.connect(g).connect(ctx.destination);
  o.start(0); o.stop(p.decay + 0.1);
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.1);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.tune * 8;
  const ng = ctx.createGain(); env(ng.gain, 0, 0.15, 0.05);
  n.connect(lp).connect(ng).connect(ctx.destination);
  n.start(0);
  return p.decay + 0.15;
}

export async function renderDrum(kind, sampleRate, params = DRUM_PARAMS[kind]) {
  const maxLen = 3;
  const ctx = new OfflineAudioContext(1, Math.floor(sampleRate * maxLen), sampleRate);
  const len = Math.min(maxLen, VOICES[kind](ctx, params));
  const full = await ctx.startRendering();
  // trim to the useful length
  const frames = Math.floor(len * sampleRate);
  const out = new AudioBuffer({ length: frames, numberOfChannels: 1, sampleRate });
  out.copyToChannel(full.getChannelData(0).subarray(0, frames), 0);
  return out;
}

export async function renderDrumKit(sampleRate, paramsByKind = DRUM_PARAMS) {
  const out = {};
  await Promise.all(DRUM_KINDS.map(async ({ kind }) => {
    out[kind] = await renderDrum(kind, sampleRate, paramsByKind[kind] || DRUM_PARAMS[kind]);
  }));
  return out;
}
