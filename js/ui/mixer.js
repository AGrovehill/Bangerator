// Mix & FX tab: one channel strip per instrument, the chords and the drum group (optionally one strip
// per drum sound), plus the shared effect buses. Every strip: EQ, compressor, drive, filters, pump, sends.
// The small "A" next to a control adds an automation lane for it (Shift+click: in the song).

import { store, commit } from '../state.js';
import { syncMixer } from '../sequencer.js';
import { PARAMS } from '../automation.js';
import { h, toast } from './common.js';
import { addLane } from './autolane.js';

const FX_HELP = {
  volume: 'How loud this channel is.',
  pan: 'Left–right position in the stereo picture.',
  drive: 'Saturation/distortion. A little adds warmth and grit; a lot sounds crunchy.',
  cutoff: 'Low-pass filter: turn it down to make the channel darker and push it into the background.',
  hpCut: 'High-pass filter (low cut): removes rumble and bass, so the channel stops fighting the kick and bass.',
  reso: 'Resonance: a peak at the filter frequency. Sweep a filter with this up for the classic acid / dance sound.',
  eqLow: 'Bass shelf (below ~120 Hz). Turn down on everything that isn’t kick or bass to clean up the mix.',
  eqMid: 'Boost or cut around the Mid frequency. Cutting a little mud (300–500 Hz) often helps.',
  eqMidFreq: 'Where the mid band sits.',
  eqHigh: 'Treble shelf (above ~6 kHz): air and brightness.',
  comp: 'Compressor: evens out loud and quiet parts so the channel sits steadier and sounds punchier. Turns the level back up automatically.',
  reverb: 'How much of this channel goes into the shared reverb (a sense of room/space).',
  delay: 'How much goes into the shared echo, which is synced to the tempo.',
  pump: 'Sidechain-style ducking: the channel dips on every beat and swells back, the classic dance-music “pumping”.',
};

const pct = v => `${Math.round(v * 100)}%`;
const db = v => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;

let automated = new Set();

function slider(label, help, value, min, max, step, fmt, onInput, target) {
  const out = h('output', {}, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => { const v = Number(input.value); out.textContent = fmt(v); onInput(v); syncMixer(); });
  input.addEventListener('change', () => commit('fx'));
  const auto = target ? h('button', { class: 'mx-auto' + (automated.has(target) ? ' on' : ''),
    title: automated.has(target) ? 'Automated. Click to add another lane (Shift+click: in the song).' : 'Automate this: adds a lane under the pattern (Shift+click: in the song)',
    onclick: e => { e.preventDefault(); if (addLane(e.shiftKey ? 'song' : 'pattern', target)) toast(e.shiftKey ? 'Automation lane added in Arrange.' : 'Automation lane added at the bottom of Compose.'); } }, 'A') : null;
  return h('label', { class: 'mx-ctl', title: help }, h('span', {}, h('span', {}, label, auto), out), input);
}

// Exponential slider position <-> Hz
const posMap = (lo, hi) => ({ to: x => Math.round(lo * Math.pow(hi / lo, x)), from: f => Math.log(Math.max(lo, f) / lo) / Math.log(hi / lo) });
const LP = posMap(80, 20000), HP = posMap(10, 8000), MID = posMap(150, 8000);

// ch: mixer channel id (for automation). opts: volKey, pan, muteSolo
function channel(name, color, obj, ch, { volKey = 'volume', volMax = 1.2, pan = true, muteSolo = true, extra = null } = {}) {
  const fx = obj.fx;
  const T = k => `${ch}|${k}`;
  const group = (title, ...ctls) => h('div', { class: 'mx-group' }, h('div', { class: 'mx-gtitle' }, title), ...ctls);
  return h('div', { class: 'mx-strip' },
    h('div', { class: 'mx-name' }, h('span', { class: 'color-dot', style: { background: color } }), h('b', {}, name),
      muteSolo ? h('span', { class: 'mx-ms' },
        h('button', { class: 'btn mute' + (obj.mute ? ' on' : ''), onclick: () => { obj.mute = !obj.mute; commit('mix'); } }, 'M'),
        h('button', { class: 'btn solo' + (obj.solo ? ' on' : ''), onclick: () => { obj.solo = !obj.solo; commit('mix'); } }, 'S')) : null),
    extra,
    slider('Volume', FX_HELP.volume, obj[volKey], 0, volMax, 0.01, pct, v => { obj[volKey] = v; }, T('volume')),
    pan ? slider('Pan', FX_HELP.pan, obj.pan || 0, -1, 1, 0.01, PARAMS.pan.fmt, v => { obj.pan = v; }, T('pan')) : null,
    group('Filter',
      slider('Low-pass', FX_HELP.cutoff, LP.from(fx.cutoff), 0, 1, 0.005, x => PARAMS.cutoff.fmt(LP.to(x)), x => { fx.cutoff = LP.to(x); }, T('cutoff')),
      slider('High-pass', FX_HELP.hpCut, HP.from(fx.hpCut), 0, 1, 0.005, x => PARAMS.hpCut.fmt(HP.to(x)), x => { fx.hpCut = HP.to(x); }, T('hpCut')),
      slider('Resonance', FX_HELP.reso, fx.reso, 0, 1, 0.01, pct, v => { fx.reso = v; }, T('reso')),
      slider('Drive', FX_HELP.drive, fx.drive, 0, 1, 0.01, pct, v => { fx.drive = v; })),
    group('EQ',
      slider('Low', FX_HELP.eqLow, fx.eqLow, -12, 12, 0.5, db, v => { fx.eqLow = v; }, T('eqLow')),
      slider('Mid', FX_HELP.eqMid, fx.eqMid, -12, 12, 0.5, db, v => { fx.eqMid = v; }, T('eqMid')),
      slider('Mid freq', FX_HELP.eqMidFreq, MID.from(fx.eqMidFreq), 0, 1, 0.005, x => PARAMS.cutoff.fmt(MID.to(x)), x => { fx.eqMidFreq = MID.to(x); }),
      slider('High', FX_HELP.eqHigh, fx.eqHigh, -12, 12, 0.5, db, v => { fx.eqHigh = v; }, T('eqHigh'))),
    group('Dynamics',
      slider('Compress', FX_HELP.comp, fx.comp, 0, 1, 0.01, pct, v => { fx.comp = v; }, T('comp')),
      slider('Pump', FX_HELP.pump, fx.pump, 0, 1, 0.01, pct, v => { fx.pump = v; })),
    group('Sends',
      slider('Reverb', FX_HELP.reverb, fx.reverb, 0, 1, 0.01, pct, v => { fx.reverb = v; }, T('reverb')),
      slider('Delay', FX_HELP.delay, fx.delay, 0, 1, 0.01, pct, v => { fx.delay = v; }, T('delay'))));
}

const DELAY_OPTIONS = [[1, '1/16'], [2, '1/8'], [3, 'dotted 1/8'], [4, '1/4'], [6, 'dotted 1/4'], [8, '1/2']];
const DRUM_COLORS = { kick: '#ff6b6b', snare: '#ffa94d', clap: '#ffd43b', rim: '#fcc419', chat: '#69db7c', ohat: '#38d9a9',
  ltom: '#4dabf7', mtom: '#748ffc', htom: '#9775fa', cowbell: '#da77f2', cymbal: '#f783ac', shaker: '#63e6be', ride: '#e599f7', riser: '#99e9f2', impact: '#ffc9c9', downer: '#a5d8ff', sample: '#e9ecf5' };

export function renderMixer() {
  const root = document.getElementById('tab-mix');
  const p = store.project;
  const bus = p.fxBus;
  automated = new Set([...p.patAuto, ...p.song.auto, ...p.patterns.flatMap(x => x.auto || [])].filter(l => l.points.length).map(l => l.target));
  const scroll = root.scrollTop;

  const splitToggle = h('label', { class: 'field check mx-split', title: 'Give every drum sound its own EQ, compressor, filters and sends. They all still go through this Drums strip.' },
    h('input', { type: 'checkbox', checked: p.drums.split, onchange: e => { p.drums.split = e.target.checked; syncMixer(); commit('fx'); renderMixer(); } }),
    'Per-sound strips');
  const strips = h('div', { class: 'mx-strips' },
    ...p.tracks.map(t => channel(t.name, t.color, t, t.id)),
    channel('Chords', '#ffd43b', p.chords, 'chords'),
    channel('Drums', '#ff6b6b', p.drums, 'drums', { pan: false, muteSolo: false, extra: splitToggle }));

  const drumStrips = p.drums.split ? h('div', { class: 'mx-section' },
    h('h3', {}, 'Drum sounds (into the Drums strip)'),
    h('div', { class: 'mx-strips' }, ...p.drums.rows.map(r =>
      channel(r.name, DRUM_COLORS[r.kind] || '#e9ecf5', r, 'row:' + r.id, { volKey: 'vol', volMax: 1.5 })))) : null;

  const delaySel = h('select', { onchange: e => { bus.delaySteps = Number(e.target.value); syncMixer(); commit('fx'); } },
    ...DELAY_OPTIONS.map(([v, t]) => h('option', { value: v, selected: bus.delaySteps === v }, t)));
  const buses = h('div', { class: 'mx-strip mx-bus' },
    h('div', { class: 'mx-name' }, h('b', {}, 'Effects & master')),
    slider('Reverb size', 'How long the reverb tail rings out.', bus.reverbSize, 0.3, 6, 0.1, v => `${v.toFixed(1)} s`, v => { bus.reverbSize = v; }),
    h('label', { class: 'mx-ctl', title: 'Echo timing, locked to the tempo. Dotted 1/8 is the classic dance-music echo.' }, h('span', {}, 'Delay time'), delaySel),
    slider('Delay feedback', 'How many times the echo repeats.', bus.delayFeedback, 0, 0.85, 0.01, pct, v => { bus.delayFeedback = v; }),
    slider('Pump release', 'How quickly pumping channels swell back after each beat.', bus.pumpRelease, 0.15, 1, 0.01, v => (v < 0.4 ? 'fast' : v < 0.7 ? 'medium' : 'slow'), v => { bus.pumpRelease = v; }),
    slider('Master', 'Overall output level (a limiter keeps it from clipping).', bus.master, 0, 1.2, 0.01, pct, v => { bus.master = v; }, 'master|master'));

  root.replaceChildren(h('div', { class: 'mx' },
    h('p', { class: 'hint mx-intro' }, 'Each channel runs through EQ → compressor → drive → filters → pump, then gets sent to one shared reverb and one tempo-synced delay. Hover a control to see what it does; “A” automates it. Everything here is included in the WAV export.'),
    h('div', { class: 'mx-row' }, strips, buses),
    drumStrips));
  root.scrollTop = scroll;
}
