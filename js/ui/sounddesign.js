// Sound Design tab: edit synth patches (waves, envelope, filter), sampler settings and the 808 kit.

import { store, commit, uid } from '../state.js';
import { audio, DEFAULT_PATCH, playBuffer } from '../audio.js';
import { renderDrum, DRUM_KINDS, DRUM_PARAMS } from '../drums.js';
import { scaleSteps, degToSemis, mod } from '../theory.js';
import { ui, h, previewMidi, toast } from './common.js';

const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
const WAVE_HELP = {
  sine: 'Sine: pure and round, like a whistle. Great for sub bass.',
  triangle: 'Triangle: soft and flute-like. A sine with a bit of edge.',
  square: 'Square: hollow and buzzy, like old video games.',
  sawtooth: 'Saw: bright and buzzy, the classic synth lead/bass sound.',
  none: 'Off',
};

function waveIcon(type) {
  const pts = {
    sine: Array.from({ length: 41 }, (_, i) => `${i * 1.35},${13 - 10 * Math.sin((i / 40) * Math.PI * 4)}`).join(' '),
    triangle: '0,13 6.75,3 20.25,23 33.75,3 47.25,23 54,13',
    square: '0,3 13.5,3 13.5,23 27,23 27,3 40.5,3 40.5,23 54,23',
    sawtooth: '0,23 27,3 27,23 54,3 54,23',
    none: '0,13 54,13',
  }[type];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 54 26');
  svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="#ffd43b" stroke-width="2" stroke-linejoin="round"/>`;
  return svg;
}

let scopeRaf = null;
let drumRenderTimers = {};

export function renderSoundDesign() {
  const root = document.getElementById('tab-sound');
  const p = store.project;
  if (!p.patches[ui.soundPatchId]) ui.soundPatchId = Object.keys(p.patches)[0];
  const patch = p.patches[ui.soundPatchId];

  const list = h('div', { class: 'sd-list' },
    h('h3', {}, 'Instruments'),
    ...Object.entries(p.patches).map(([id, pt]) => h('div', {
      class: 'patch-item' + (id === ui.soundPatchId ? ' active' : ''),
      onclick: () => { ui.soundPatchId = id; renderSoundDesign(); },
    }, pt.name, h('small', {}, pt.kind === 'sampler' ? 'sample' : 'synth'))),
    h('button', { class: 'btn', onclick: () => newPatch() }, '+ New synth'),
    h('button', { class: 'btn', onclick: () => duplicatePatch() }, 'Duplicate'),
    h('button', { class: 'btn', onclick: () => deletePatch() }, 'Delete'),
  );

  const main = h('div', { class: 'sd-main' });
  main.append(h('div', { class: 'sd-panel' },
    h('div', { class: 'sd-row' },
      h('label', { class: 'knob' }, 'Name', h('input', { type: 'text', value: patch.name, onchange: e => { patch.name = e.target.value; commit('patches'); } })),
      h('p', { class: 'hint', style: { flex: 1 } }, patch.kind === 'sampler'
        ? 'A sampled instrument uses recordings of a real instrument, re-pitched for every note.'
        : 'A synth builds its sound from simple waves. Pick a wave, then shape how loud it is over time (the envelope).'))));

  if (patch.kind === 'synth') main.append(...synthPanels(patch));
  else main.append(samplerPanel(patch));

  main.append(testPanel(), scopePanel(), drumPanel());
  root.replaceChildren(h('div', { class: 'sd' }, list, main));
  drawEnvelope();
  startScope();
}

function knob(label, obj, key, min, max, step, fmt = v => v, onchange, help) {
  const out = h('output', {}, fmt(obj[key]));
  const input = h('input', { type: 'range', min, max, step, value: obj[key] });
  input.addEventListener('input', () => {
    obj[key] = Number(input.value);
    out.textContent = fmt(obj[key]);
    drawEnvelope();
    onchange?.();
  });
  input.addEventListener('change', () => commit('patches'));
  return h('label', { class: 'knob', title: help || '' }, h('span', {}, label, ' ', out), input);
}

const sec = v => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
const pct = v => `${Math.round(v * 100)}%`;
const hz = v => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);

function synthPanels(pt) {
  const pp = pt.patch;
  for (const k of Object.keys(DEFAULT_PATCH)) if (pp[k] === undefined) pp[k] = DEFAULT_PATCH[k];
  const waveRow = (key, withNone) => h('div', { class: 'wave-btns' },
    ...(withNone ? ['none', ...WAVES] : WAVES).map(w => {
      const b = h('button', { class: 'wave-btn' + (pp[key] === w ? ' on' : ''), title: WAVE_HELP[w],
        onclick: () => { pp[key] = w; commit('patches'); renderSoundDesign(); playTest(0); } },
        waveIcon(w), w === 'sawtooth' ? 'saw' : w);
      return b;
    }));
  return [
    h('div', { class: 'sd-panel' },
      h('h3', {}, 'Waves (the raw sound)'),
      h('div', { class: 'sd-row' },
        h('div', {}, h('div', { class: 'hint', style: { marginBottom: '4px' } }, 'Oscillator 1'), waveRow('wave', false)),
        h('div', {}, h('div', { class: 'hint', style: { marginBottom: '4px' } }, 'Oscillator 2 (optional layer)'), waveRow('wave2', true))),
      h('div', { class: 'sd-row', style: { marginTop: '10px' } },
        knob('Osc 2 mix', pp, 'mix2', 0, 1, 0.01, pct, null, 'How loud the second wave is'),
        knob('Detune', pp, 'detune', 0, 50, 1, v => `${v} cents`, null, 'Slightly out-of-tune layers sound wide and thick'),
        knob('Osc 2 octave', pp, 'octave2', -2, 2, 1, v => (v > 0 ? '+' + v : v), null, 'Put the second wave an octave up or down'))),
    h('div', { class: 'sd-panel' },
      h('h3', {}, 'Volume envelope (the life story of one note)'),
      h('canvas', { class: 'envcv', id: 'env-canvas' }),
      h('div', { class: 'sd-row', style: { marginTop: '10px' } },
        knob('Attack', pp, 'attack', 0.001, 2, 0.001, sec, null, 'How long it takes to fade in. Short = punchy, long = swelling pad'),
        knob('Decay', pp, 'decay', 0.005, 3, 0.005, sec, null, 'How fast it drops after the first hit'),
        knob('Sustain', pp, 'sustain', 0, 1, 0.01, pct, null, 'The level it holds while the note is held'),
        knob('Release', pp, 'release', 0.01, 4, 0.01, sec, null, 'How long it rings after you let go'))),
    h('div', { class: 'sd-panel' },
      h('h3', {}, 'Filter & pitch'),
      h('div', { class: 'sd-row' },
        knob('Brightness (cutoff)', pp, 'cutoff', 60, 16000, 1, hz, null, 'Low-pass filter: lower = darker and more muffled'),
        knob('Resonance', pp, 'resonance', 0.1, 20, 0.1, v => v.toFixed(1), null, 'Makes the filter “whistle” at the cutoff'),
        knob('Filter pluck', pp, 'filterEnv', 0, 8000, 10, hz, null, 'Extra brightness at the start of each note that fades away'),
        knob('Pitch drop', pp, 'pitchDrop', 0, 24, 1, v => `${v} st`, null, 'Each note starts higher and falls down (808 “boom”)'),
        knob('Drop time', pp, 'pitchTime', 0.005, 0.5, 0.005, sec),
        knob('Volume', pp, 'volume', 0, 1.2, 0.01, pct))),
  ];
}

function samplerPanel(pt) {
  return h('div', { class: 'sd-panel' },
    h('h3', {}, 'Sampler'),
    h('div', { class: 'sd-row' },
      knob('Attack', pt, 'attack', 0.001, 1, 0.001, sec),
      knob('Release', pt, 'release', 0.02, 3, 0.01, sec),
      knob('Volume', pt, 'volume', 0, 1.5, 0.01, pct)),
    h('p', { class: 'hint' }, `Samples: ${pt.set}. Recorded notes are stretched to fill the gaps between them.`));
}

// Degree keyboard: play the patch in the current key, using numbers of course.
function testPanel() {
  const p = store.project;
  const steps = scaleSteps(p.scale);
  const n = steps.length;
  const pt = p.patches[ui.soundPatchId];
  const baseOct = pt.kind === 'sampler' && pt.set === 'bass' ? 2 : (pt.patch?.pitchDrop ? 2 : 4);
  const keys = h('div', { class: 'test-keys' });
  for (let d = 0; d <= n * 2; d++) {
    const b = h('button', { class: mod(d, n) === 0 ? 'tonic' : '', title: 'Click, or press keys 1–8' }, mod(d, n) + 1);
    let stopFn = null;
    b.addEventListener('pointerdown', () => { stopFn = playTest(d, baseOct, 4); });
    const up = () => { stopFn?.(); stopFn = null; };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    keys.append(b);
  }
  return h('div', { class: 'sd-panel' }, h('h3', {}, 'Try it (hold a key to hear the sustain and release)'), keys);
}

export function playTest(deg, oct = 4, dur = 0.6) {
  const p = store.project;
  const midi = 12 * (oct + 1) + p.root + degToSemis(scaleSteps(p.scale), deg);
  return previewMidi(ui.soundPatchId, midi, dur);
}

function scopePanel() {
  return h('div', { class: 'sd-panel' }, h('h3', {}, 'Oscilloscope (what the wave looks like)'), h('canvas', { class: 'scope', id: 'scope-canvas' }));
}

function drawEnvelope() {
  const cv = document.getElementById('env-canvas');
  const pt = store.project.patches[ui.soundPatchId];
  if (!cv || pt?.kind !== 'synth') return;
  const pp = pt.patch;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, W, H);
  const hold = 0.5;
  const total = pp.attack + pp.decay + hold + pp.release;
  const x = t => 10 + (t / total) * (W - 20);
  const y = v => H - 12 - v * (H - 24);
  g.strokeStyle = '#ffd43b'; g.lineWidth = 2.5; g.beginPath();
  g.moveTo(x(0), y(0));
  g.lineTo(x(pp.attack), y(1));
  g.quadraticCurveTo(x(pp.attack + pp.decay * 0.2), y(pp.sustain), x(pp.attack + pp.decay), y(pp.sustain));
  g.lineTo(x(pp.attack + pp.decay + hold), y(pp.sustain));
  g.quadraticCurveTo(x(pp.attack + pp.decay + hold + pp.release * 0.15), y(0), x(total), y(0));
  g.stroke();
  g.fillStyle = '#9aa1b8'; g.font = '11px system-ui';
  [['A', pp.attack / 2], ['D', pp.attack + pp.decay / 2], ['S', pp.attack + pp.decay + hold / 2], ['R', pp.attack + pp.decay + hold + pp.release / 2]]
    .forEach(([l, t]) => g.fillText(l, x(t) - 3, H - 1));
}

function startScope() {
  cancelAnimationFrame(scopeRaf);
  const cv = document.getElementById('scope-canvas');
  if (!cv || !audio.mixer) return;
  const an = audio.mixer.analyser;
  const data = new Float32Array(an.fftSize);
  const loop = () => {
    if (!cv.isConnected) return;
    scopeRaf = requestAnimationFrame(loop);
    if (!cv.offsetParent) return; // tab hidden
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    an.getFloatTimeDomainData(data);
    // find a rising zero crossing so the wave stands still
    let start = 0;
    for (let i = 1; i < data.length / 2; i++) if (data[i - 1] < 0 && data[i] >= 0) { start = i; break; }
    g.strokeStyle = '#4dabf7'; g.lineWidth = 2; g.beginPath();
    const span = 800;
    for (let i = 0; i < span; i++) {
      const v = data[start + i] || 0;
      const px = (i / span) * W, py = H / 2 - v * H * 0.45;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.stroke();
  };
  loop();
}

// ---------- 808 kit ----------
const DRUM_KNOBS = {
  tune: ['Tune', 20, 2500, 1, hz],
  decay: ['Decay', 0.02, 3, 0.01, sec],
  punch: ['Punch', 1, 8, 0.1, v => v.toFixed(1)],
  click: ['Click', 0, 1, 0.01, pct],
  snappy: ['Snappy', 0, 1.5, 0.01, pct],
  tone: ['Tone', 400, 12000, 10, hz],
};

function drumPanel() {
  const p = store.project;
  const grid = h('div', { class: 'drum-params' });
  for (const { kind, name } of DRUM_KINDS) {
    const params = p.drumParams[kind];
    const knobs = Object.keys(params).map(k => {
      const [label, min, max, step, fmt] = DRUM_KNOBS[k];
      let mn = min, mx = max;
      if (k === 'tune' && kind === 'kick') { mn = 30; mx = 120; }
      return knob(label, params, k, mn, mx, step, fmt, () => rerenderDrum(kind));
    });
    grid.append(h('div', { class: 'drum-param' },
      h('h4', {}, name, h('button', { class: 'btn small', onclick: () => hitDrum(kind) }, '▶')),
      ...knobs));
  }
  return h('div', { class: 'sd-panel' },
    h('h3', {}, '808 drum kit'),
    h('p', { class: 'hint', style: { marginBottom: '10px' } }, 'These drums aren’t recordings. They are built from waves and noise the way the TR-808 machine did it, so you can bend them.'),
    grid,
    h('div', { class: 'type-row' }, h('button', { class: 'btn', onclick: () => {
      p.drumParams = structuredClone(DRUM_PARAMS);
      DRUM_KINDS.forEach(({ kind }) => rerenderDrum(kind));
      commit('patches'); renderSoundDesign();
    } }, 'Reset kit')));
}

function rerenderDrum(kind) {
  clearTimeout(drumRenderTimers[kind]);
  drumRenderTimers[kind] = setTimeout(async () => {
    if (!audio.ctx) return;
    audio.drumBuffers[kind] = await renderDrum(kind, audio.ctx.sampleRate, store.project.drumParams[kind]);
    hitDrum(kind);
  }, 120);
}

function hitDrum(kind) {
  if (!audio.ctx) return;
  const s = audio.mixer.strip('preview');
  s.gain.gain.value = 0.9;
  playBuffer(audio.ctx, s.gain, audio.drumBuffers[kind], audio.ctx.currentTime + 0.005, 0.9);
}

// ---------- Patch management ----------
function newPatch() {
  const id = uid('p');
  store.project.patches[id] = { name: 'New Synth', kind: 'synth', patch: { ...DEFAULT_PATCH } };
  ui.soundPatchId = id;
  commit('patches');
  renderSoundDesign();
}
function duplicatePatch() {
  const src = store.project.patches[ui.soundPatchId];
  const id = uid('p');
  store.project.patches[id] = { ...structuredClone(src), name: src.name + ' copy' };
  ui.soundPatchId = id;
  commit('patches');
  renderSoundDesign();
}
function deletePatch() {
  const p = store.project;
  const id = ui.soundPatchId;
  const users = [...p.tracks.filter(t => t.patch === id).map(t => t.name), ...(p.chords.patch === id ? ['Chords'] : [])];
  if (users.length) { toast(`In use by: ${users.join(', ')}. Pick another instrument there first.`); return; }
  if (Object.keys(p.patches).length <= 1) return;
  if (!confirm(`Delete “${p.patches[id].name}”?`)) return;
  delete p.patches[id];
  ui.soundPatchId = Object.keys(p.patches)[0];
  commit('patches');
  renderSoundDesign();
}

// Re-render the whole kit from the project's parameters (after loading a project).
export async function rebuildDrumKit() {
  if (!audio.ctx) return;
  await Promise.all(DRUM_KINDS.map(async ({ kind }) => {
    audio.drumBuffers[kind] = await renderDrum(kind, audio.ctx.sampleRate, store.project.drumParams[kind]);
  }));
}
