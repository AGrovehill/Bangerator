// Automation: lanes of points that move a mixer parameter (or a synth's own filter) over time.
//   lane: { id, target: '<channel>|<param>', points: [{ step, value }] }   (value 0..1 along the param's range)
//   channel = a mixer strip id: a track id, 'chords', 'drums', 'row:<drum row id>', or 'master'.
// Pattern lanes live in pattern.auto (steps from the pattern start, looping with it).
// Song lanes live in song.auto (steps from the song start) and win over pattern lanes for the same target.

const pct = x => `${Math.round(x * 100)}%`;
const hz = x => (x >= 19900 ? 'open' : x >= 1000 ? `${(x / 1000).toFixed(1)} kHz` : `${Math.round(x)} Hz`);
const db = x => `${x > 0 ? '+' : ''}${x.toFixed(1)} dB`;
const logMap = (lo, hi) => ({ to: v => lo * Math.pow(hi / lo, v), from: x => Math.log(Math.max(lo, x) / lo) / Math.log(hi / lo) });
const lin = (lo, hi) => ({ to: v => lo + (hi - lo) * v, from: x => (x - lo) / (hi - lo) });

// to(): 0..1 -> real value; from(): real -> 0..1
export const PARAMS = {
  volume: { label: 'Volume', ...lin(0, 1.2), fmt: pct },
  pan: { label: 'Pan', ...lin(-1, 1), fmt: x => (Math.abs(x) < 0.03 ? 'center' : x < 0 ? `L ${Math.round(-x * 100)}` : `R ${Math.round(x * 100)}`) },
  cutoff: { label: 'Low-pass', ...logMap(80, 20000), fmt: hz },
  hpCut: { label: 'High-pass', ...logMap(10, 8000), fmt: x => (x <= 11 ? 'off' : hz(x)) },
  reso: { label: 'Resonance', ...lin(0, 1), fmt: pct },
  eqLow: { label: 'EQ low', ...lin(-12, 12), fmt: db },
  eqMid: { label: 'EQ mid', ...lin(-12, 12), fmt: db },
  eqHigh: { label: 'EQ high', ...lin(-12, 12), fmt: db },
  comp: { label: 'Compress', ...lin(0, 1), fmt: pct },
  reverb: { label: 'Reverb', ...lin(0, 1), fmt: pct },
  delay: { label: 'Delay', ...lin(0, 1), fmt: pct },
  master: { label: 'Master volume', ...lin(0, 1.2), fmt: pct },
  // The synth's own sound (only for channels playing a synth patch). These apply to notes as they start:
  // a 303's Cutoff / Resonance / Env mod / Decay knobs.
  synthCutoff: { label: 'Synth cutoff', ...logMap(60, 16000), fmt: hz, synth: 'cutoff' },
  synthReso: { label: 'Synth resonance', ...lin(0.1, 20), fmt: x => x.toFixed(1), synth: 'resonance' },
  synthEnv: { label: 'Synth env mod', ...lin(0, 8000), fmt: x => `${Math.round(x)} Hz`, synth: 'filterEnv' },
  synthDecay: { label: 'Synth decay', ...logMap(0.02, 2), fmt: x => `${Math.round(x * 1000)} ms`, synth: 'filterDecay' },
};
const STRIP_PARAMS = ['volume', 'pan', 'cutoff', 'hpCut', 'reso', 'eqLow', 'eqMid', 'eqHigh', 'comp', 'reverb', 'delay'];
const SYNTH_PARAMS = ['synthCutoff', 'synthReso', 'synthEnv', 'synthDecay'];

// The synth patch a channel plays, if it is a synth.
export function synthOf(p, ch) {
  const pt = p.patches[channelObj(p, ch)?.patch];
  return pt?.kind === 'synth' ? pt.patch : null;
}

export function channelObj(p, ch) {
  if (ch === 'chords') return p.chords;
  if (ch === 'drums') return p.drums;
  if (ch === 'master') return p.fxBus;
  if (ch.startsWith('row:')) return p.drums.rows.find(r => r.id === ch.slice(4));
  return p.tracks.find(t => t.id === ch);
}

export function channelName(p, ch) {
  if (ch === 'chords') return 'Chords';
  if (ch === 'drums') return 'Drums';
  if (ch === 'master') return 'Master';
  return channelObj(p, ch)?.name || '?';
}

// The mixer's own (not automated) value, in real units.
export function staticValue(p, ch, key) {
  const o = channelObj(p, ch);
  if (!o) return 0;
  if (key === 'master') return p.fxBus.master;
  if (key === 'volume') return o.volume ?? o.vol ?? 1;
  if (key === 'pan') return o.pan || 0;
  if (PARAMS[key]?.synth) {
    const s = synthOf(p, ch);
    const k = PARAMS[key].synth;
    return s ? (k === 'filterDecay' ? s.filterDecay || s.decay : s[k]) : 0;
  }
  if (ch.startsWith('row:') && !p.drums.split) return defaultsFor(key);
  return o.fx?.[key] ?? defaultsFor(key);
}
const defaultsFor = key => ({ cutoff: 20000, hpCut: 10 }[key] ?? 0);

export const staticNorm = (p, target) => {
  const [ch, key] = target.split('|');
  return PARAMS[key].from(staticValue(p, ch, key));
};

export function targetLabel(p, target) {
  const [ch, key] = target.split('|');
  return `${channelName(p, ch)} · ${PARAMS[key]?.label || key}`;
}

// Everything that can be automated, grouped by channel: [{ channel, name, targets: [{ id, label }] }]
export function targetGroups(p) {
  const strip = (channel, name, keys = STRIP_PARAMS) => ({ channel, name, targets: keys.map(k => ({ id: `${channel}|${k}`, label: PARAMS[k].label })) });
  return [
    ...p.tracks.map(t => strip(t.id, t.name, synthOf(p, t.id) ? [...STRIP_PARAMS, ...SYNTH_PARAMS] : STRIP_PARAMS)),
    strip('chords', 'Chords', synthOf(p, 'chords') ? [...STRIP_PARAMS, ...SYNTH_PARAMS] : STRIP_PARAMS),
    strip('drums', 'Drums (group)'),
    ...p.drums.rows.map(r => strip('row:' + r.id, `Drum: ${r.name}`, p.drums.split ? STRIP_PARAMS : ['volume', 'pan'])),
    { channel: 'master', name: 'Master', targets: [{ id: 'master|master', label: 'Master volume' }] },
  ];
}

// Value of a lane at `step` (linear between points; flat before the first and after the last).
export function valueAt(points, step) {
  if (!points.length) return null;
  if (step <= points[0].step) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (step <= b.step) {
      const a = points[i - 1];
      return b.step === a.step ? b.value : a.value + (b.value - a.value) * (step - a.step) / (b.step - a.step);
    }
  }
  return points[points.length - 1].value;
}

// One event per step (so the mixer gets corrected right away if something resets it).
// prio orders events within a step: releases first, then pattern lanes, then song lanes.
export function autoEvents(lanes, length, prio = 1, skip = null) {
  const out = [];
  for (const l of lanes || []) {
    if (!l.points?.length || skip?.has(l.target)) continue;
    for (let s = 0; s < length; s++) out.push({ step: s, kind: 'auto', target: l.target, value: valueAt(l.points, s), prio });
  }
  return out;
}

// While a controller knob is turning a setting, its automation steps aside (like "touch" mode in a DAW).
const heldUntil = new Map();
export function holdAutomation(target, ms = 500) { heldUntil.set(target, performance.now() + ms); }

// Apply an automation event to a mixer at `time`. value null = back to the mixer's own value.
export function applyAuto(mixer, p, e, time) {
  if (!mixer.immediate && (heldUntil.get(e.target) || 0) > performance.now()) return;
  const [ch, key] = e.target.split('|');
  const P = PARAMS[key];
  if (!P || !channelObj(p, ch)) return;
  if (P.synth) { // remembered on the mixer; notes pick it up as they start (see patchFor)
    mixer.synthOverride ||= new Map();
    const o = { ...(mixer.synthOverride.get(ch) || {}) };
    if (e.value == null) delete o[P.synth]; else o[P.synth] = P.to(e.value);
    mixer.synthOverride.set(ch, o);
    return;
  }
  mixer.param(ch, key, e.value == null ? staticValue(p, ch, key) : P.to(e.value), time);
}

// The patch a note on `stripId` should play with, including automated synth settings.
export function patchFor(mixer, stripId, patch) {
  const o = mixer.synthOverride?.get(stripId);
  if (!o || patch?.kind !== 'synth' || !Object.keys(o).length) return patch;
  return { ...patch, patch: { ...patch.patch, ...o } };
}
