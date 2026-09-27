// Mix & FX tab: one channel strip per track, the chords and the drum group, plus the shared effect buses.

import { store, commit } from '../state.js';
import { syncMixer } from '../sequencer.js';
import { h } from './common.js';

const FX_HELP = {
  volume: 'How loud this channel is.',
  pan: 'Left–right position in the stereo picture.',
  drive: 'Saturation/distortion. A little adds warmth and grit; a lot sounds crunchy.',
  cutoff: 'Low-pass filter. Turn it down to make the channel darker and push it into the background.',
  reverb: 'How much of this channel goes into the shared reverb (a sense of room/space).',
  delay: 'How much goes into the shared echo, which is synced to the tempo.',
  pump: 'Sidechain-style ducking: the channel dips on every beat and swells back, the classic dance-music “pumping”.',
};

// Cutoff slider uses 0..1 mapped exponentially to 80 Hz .. 20 kHz.
const cutToPos = hz => Math.log(hz / 80) / Math.log(20000 / 80);
const posToCut = x => Math.round(80 * Math.pow(20000 / 80, x));
const pct = v => `${Math.round(v * 100)}%`;
const hz = v => (v >= 19900 ? 'open' : v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${v} Hz`);

function slider(label, help, value, min, max, step, fmt, onInput) {
  const out = h('output', {}, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => { const v = Number(input.value); out.textContent = fmt(v); onInput(v); syncMixer(); });
  input.addEventListener('change', () => commit('fx'));
  return h('label', { class: 'mx-ctl', title: help }, h('span', {}, label, ' ', out), input);
}

function channel(name, color, obj, { volKey = 'volume', pan = true, muteSolo = true } = {}) {
  const fx = obj.fx;
  return h('div', { class: 'mx-strip' },
    h('div', { class: 'mx-name' }, h('span', { class: 'color-dot', style: { background: color } }), h('b', {}, name),
      muteSolo ? h('span', { class: 'mx-ms' },
        h('button', { class: 'btn mute' + (obj.mute ? ' on' : ''), onclick: () => { obj.mute = !obj.mute; commit('mix'); } }, 'M'),
        h('button', { class: 'btn solo' + (obj.solo ? ' on' : ''), onclick: () => { obj.solo = !obj.solo; commit('mix'); } }, 'S')) : null),
    slider('Volume', FX_HELP.volume, obj[volKey], 0, 1.2, 0.01, pct, v => { obj[volKey] = v; }),
    pan ? slider('Pan', FX_HELP.pan, obj.pan, -1, 1, 0.01, v => (Math.abs(v) < 0.02 ? 'center' : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`), v => { obj.pan = v; }) : null,
    slider('Drive', FX_HELP.drive, fx.drive, 0, 1, 0.01, pct, v => { fx.drive = v; }),
    slider('Filter', FX_HELP.cutoff, cutToPos(fx.cutoff), 0, 1, 0.005, x => hz(posToCut(x)), x => { fx.cutoff = posToCut(x); }),
    slider('Reverb', FX_HELP.reverb, fx.reverb, 0, 1, 0.01, pct, v => { fx.reverb = v; }),
    slider('Delay', FX_HELP.delay, fx.delay, 0, 1, 0.01, pct, v => { fx.delay = v; }),
    slider('Pump', FX_HELP.pump, fx.pump, 0, 1, 0.01, pct, v => { fx.pump = v; }));
}

const DELAY_OPTIONS = [[1, '1/16'], [2, '1/8'], [3, 'dotted 1/8'], [4, '1/4'], [6, 'dotted 1/4'], [8, '1/2']];

export function renderMixer() {
  const root = document.getElementById('tab-mix');
  const p = store.project;
  const bus = p.fxBus;
  const strips = h('div', { class: 'mx-strips' },
    ...p.tracks.map(t => channel(t.name, t.color, t)),
    channel('Chords', '#ffd43b', p.chords),
    channel('Drums', '#ff6b6b', p.drums, { pan: false, muteSolo: false }));

  const delaySel = h('select', { onchange: e => { bus.delaySteps = Number(e.target.value); syncMixer(); commit('fx'); } },
    ...DELAY_OPTIONS.map(([v, t]) => h('option', { value: v, selected: bus.delaySteps === v }, t)));
  const buses = h('div', { class: 'mx-strip mx-bus' },
    h('div', { class: 'mx-name' }, h('b', {}, 'Effects & master')),
    slider('Reverb size', 'How long the reverb tail rings out.', bus.reverbSize, 0.3, 6, 0.1, v => `${v.toFixed(1)} s`, v => { bus.reverbSize = v; }),
    h('label', { class: 'mx-ctl', title: 'Echo timing, locked to the tempo. Dotted 1/8 is the classic dance-music echo.' }, h('span', {}, 'Delay time'), delaySel),
    slider('Delay feedback', 'How many times the echo repeats.', bus.delayFeedback, 0, 0.85, 0.01, pct, v => { bus.delayFeedback = v; }),
    slider('Pump release', 'How quickly pumping channels swell back after each beat.', bus.pumpRelease, 0.15, 1, 0.01, v => (v < 0.4 ? 'fast' : v < 0.7 ? 'medium' : 'slow'), v => { bus.pumpRelease = v; }),
    slider('Master', 'Overall output level (a limiter keeps it from clipping).', bus.master, 0, 1.2, 0.01, pct, v => { bus.master = v; }));

  root.replaceChildren(h('div', { class: 'mx' },
    h('p', { class: 'hint mx-intro' }, 'Each channel runs through drive → filter → pump, then gets sent to one shared reverb and one tempo-synced delay. Hover a control to see what it does. Everything here is included in the WAV export.'),
    h('div', { class: 'mx-row' }, strips, buses)));
}
