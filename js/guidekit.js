// Building blocks for genre guides: writing drums, notes and chords into patterns, generators
// (arpeggios, chord stabs, build-ups), arrangement from section plans, automation lanes, shared step text.

import { defaultFx, newClip, uid, STEPS_PER_BAR, songBars, contentView } from './state.js';
import { DEFAULT_PATCH } from './audio.js';
import { chordAt, toTrackNotes } from './advisor.js';

export const synth = (name, over) => ({ name, kind: 'synth', patch: { ...DEFAULT_PATCH, ...over } });

// ---------- Small builders ----------
export const hitsOf = str => [...str.replace(/[\s|]/g, '')].map(c => (c === 'X' ? 2 : c === 'x' ? 1 : 0));
export const fold = semis => { const r = ((semis % 12) + 12) % 12; return r > 7 ? r - 12 : r; };


// Write drum steps: lines = { kick: 'X...X...', ... }; strings repeat to fill the pattern.
export function drums(p, c, role, lines, clear = true) {
  const pat = c.pat(role);
  const L = pat.bars * STEPS_PER_BAR;
  if (clear) pat.drumSteps = {};
  for (const [kind, str] of Object.entries(lines)) {
    const h = hitsOf(str);
    pat.drumSteps[c.row(kind).id] = Array.from({ length: L }, (_, i) => h[i % h.length]);
  }
}

// Write notes given as [step, len, degree, velocity?]
export function notes(c, role, trackRole, list) {
  const pat = c.pat(role);
  const L = pat.bars * STEPS_PER_BAR;
  pat.notes[c.track(trackRole).id] = list.filter(n => n[0] < L).map(([step, len, deg, vel = 0.85]) => ({ step, len: Math.min(len, L - step), deg, vel }));
}

export function abstractNotes(p, c, role, trackRole, abs) {
  c.pat(role).notes[c.track(trackRole).id] = toTrackNotes(c.view(role), c.track(trackRole), abs);
}

// Chords into every pattern: sounding in `playRoles`, as a silent guide everywhere else.
export function setChords(p, c, degs, slotSteps, type, playRoles) {
  const playing = new Set(playRoles.map(r => c.pat(r).id));
  for (const pat of p.patterns) {
    const n = Math.ceil(pat.bars * STEPS_PER_BAR / slotSteps);
    pat.chordSlots = Array.from({ length: n }, (_, i) => ({ deg: degs[i % degs.length], type }));
    pat.slotSteps = slotSteps;
    pat.chordsGuide = !playing.has(pat.id);
  }
}

// Notes that run through the chord tones. shape indexes [root, 3rd, 5th, root+8ve, 3rd+8ve]; it restarts on each chord.
export function arp(view, { rate = 1, shape = [0, 1, 2, 3, 2, 1], len = 1, vels = [0.9, 0.6, 0.7, 0.6], skip = () => false } = {}) {
  const L = view.bars * STEPS_PER_BAR, out = [];
  for (let s = 0; s < L; s += rate) {
    const ch = chordAt(view, s);
    if (!ch || skip(s)) continue;
    const r = fold(ch.semis[0]);
    const t = ch.semis.map(x => r + x - ch.semis[0]);
    const tones = [t[0], t[1], t[2], t[0] + 12, t[1] + 12];
    const i = Math.floor((s - ch.start) / rate);
    out.push({ step: s, len, semis: tones[shape[i % shape.length]], vel: vels[i % vels.length] });
  }
  return out;
}

// Chord hits on a rhythm: hits = [[stepInBar, len, vel?], ...]; tones = which chord notes to play.
export function stabs(view, hits, tones = [0, 1, 2], lift = 0) {
  const L = view.bars * STEPS_PER_BAR, out = [];
  for (let bar = 0; bar < view.bars; bar++) {
    for (const [s, len, vel = 0.8] of hits) {
      const step = bar * STEPS_PER_BAR + s;
      const ch = chordAt(view, step);
      if (!ch || step >= L) continue;
      const r = fold(ch.semis[0]);
      for (const i of tones) {
        if (ch.semis[i] == null) continue;
        out.push({ step, len, semis: r + ch.semis[i] - ch.semis[0] + lift, vel });
      }
    }
  }
  return out;
}

// A snare roll that speeds up over `bars`, with a riser over the last `riserBars` and a gap before the drop.
export function buildUp(p, c, bars, riserBars) {
  const q = Math.max(1, Math.floor(bars / 2)), e = Math.max(1, Math.floor(bars / 4));
  let snare = 'x...x...x...x...'.repeat(q) + 'x.x.x.x.x.x.x.x.'.repeat(bars - q - e) + 'XxxxXxxxXxxxXxxx'.repeat(Math.max(0, e - 1)) + 'XxxxXxxxXxXxX...';
  snare = snare.slice(-bars * 16);
  const riser = '.'.repeat((bars - riserBars) * 16) + 'X' + '.'.repeat(riserBars * 16 - 1);
  const clap = '.'.repeat((bars - 1) * 16) + 'x.x.x.x.x.x.x...';
  drums(p, c, 'build', { snare, riser, clap });
  p.drumParams.riser.length = Math.round(riserBars * 4 * 60 / p.bpm * 100) / 100; // exactly `riserBars` long at this tempo
}

export const fx = (obj, over) => { obj.fx = defaultFx({ ...obj.fx, ...over }); };
export const count = arr => (arr || []).filter(Boolean).length;
export const hasDrums = (c, role, kinds) => kinds.some(k => count(c.pat(role)?.drumSteps[c.row(k).id]) > 0);
export const hasNotes = (c, role, trackRole) => (c.pat(role)?.notes[c.track(trackRole)?.id] || []).length > 0;
export const hasChords = (c, role) => count(c.pat(role)?.chordSlots) > 0;

// ---------- Arrangement ----------
// sections: [{ name, bars, layers: ['kick', 'hats@16', 'bass@0-16', 'lead@-8'], build: bars?, impact: true?, key?: { root, scale } }]
// '@16' = from bar 16 of the section, '@0-16' = bars 0 to 16, '@-8' = the last 8 bars.
export function totalBars(G) { return G.sections.reduce((a, s) => a + s.bars, 0); }

export function sectionStarts(G) {
  const out = {};
  let bar = 0;
  for (const s of G.sections) { out[s.name] = bar; bar += s.bars; }
  out.END = bar;
  return out;
}

export function arrange(p, c, sections = c.G.sections) {
  const G = c.G;
  const laneOf = role => G.lanes.findIndex(l => l.roles.includes(role));
  p.song.lanes = G.lanes.map(l => ({ id: uid('l'), name: l.name, mute: false }));
  const clips = [], markers = [];
  let bar = 0;
  for (const sec of sections) {
    markers.push({ bar, name: sec.name });
    for (const spec of sec.layers) {
      const m = /^(\w+)(?:@(-?\d+)(?:-(\d+))?)?$/.exec(spec);
      const role = m[1];
      let from = 0, to = sec.bars;
      if (m[2] != null) {
        const a = Number(m[2]);
        if (a < 0) from = sec.bars + a; else { from = a; if (m[3] != null) to = Number(m[3]); }
      }
      clips.push(newClip(c.pat(role).id, laneOf(role), bar + from, to - from, sec.key ? { ...sec.key } : null));
    }
    if (sec.build) clips.push(newClip(c.pat('build').id, laneOf('build'), bar + sec.bars - sec.build, sec.build));
    if (sec.impact) clips.push(newClip(c.pat('impact').id, laneOf('impact'), bar, c.pat('impact').bars));
    bar += sec.bars;
  }
  p.song.clips = clips;
  p.song.markers = markers;
  p.song.loop = null;
}

// What you hear while writing: every element stacked as an 8-bar loop, so new parts are heard in context.
// Song-form guides (verse, chorus...) give a short draft of the song instead.
export function jamLoop(p, c) {
  const G = c.G;
  if (G.workSections) { arrange(p, c, G.workSections); return; }
  p.song.lanes = G.lanes.map(l => ({ id: uid('l'), name: l.name, mute: false }));
  p.song.clips = [];
  G.lanes.forEach((l, i) => {
    for (const role of l.roles) if (!['build', 'impact'].includes(role)) p.song.clips.push(newClip(c.pat(role).id, i, 0, 8));
  });
  p.song.markers = [{ bar: 0, name: 'Work loop' }];
  p.song.loop = { start: 0, end: 8 };
}

// Song automation lane from points given in bars: [[bar, value], ...]
export function lane(p, target, pts) {
  p.song.auto = p.song.auto.filter(l => l.target !== target);
  p.song.auto.push({ id: uid('a'), target, points: pts.map(([bar, value]) => ({ step: Math.round(bar * STEPS_PER_BAR), value })).sort((a, b) => a.step - b.step) });
}

// "Filter the drums out": a quick high-pass sweep over the 4 bars before `bar`, released on the downbeat.
export const drumSweep = bar => [[bar - 4, 0], [bar - 0.25, 0.55], [bar, 0]];

// ---------- Shared steps ----------
export const mixText = extra => [
  'Mixing a dance track is mostly about **the low end** and **space**:',
  '• **Sidechain (Pump)**: duck everything that fights the kick, on every beat. The kick stays punchy and the whole track “breathes”.',
  '• **High-pass** everything that isn’t kick or bass (Mix & FX → High-pass, 120–300 Hz). Two things below 100 Hz at once turns to mud.',
  '• **Levels first**: kick loudest, bass just under it, everything else well below. Turn things down, not up.',
  '• **Reverb and delay** on the melodic parts only. Keep kick and bass dry.',
  ...extra,
  'The **Coach** card in the sidebar points out what still clashes.',
];

export const finishStep = {
  id: 'finish', title: 'Listen, polish, export', manual: true,
  where: { tab: 'arrange' },
  text: [
    'Switch to **Song** and play the whole thing from the top. Listen away from the screen if you can.',
    '• Anything that gets boring? Drop an element out for 4–8 bars (shorten or split a clip), or mute a lane for a section.',
    '• Does each drop hit harder than what came before? If not, strip the section before it down further. Contrast is what makes a drop.',
    '• Make it yours: open any pattern and change notes. The Coach, Next note and Bassline cards work on whichever pattern is open.',
    '• Ctrl+S keeps a history point. **File → Export audio** renders the whole song to a .wav.',
    'Then play it to someone. That is the real last step.',
  ],
  check: () => false,
};

export const arrangeText = (G, why) => [
  `Now the song. Dance music is built in **blocks of 8, 16 and 32 bars**, and elements enter and leave at those boundaries, so DJs can mix it and listeners feel the changes coming.`,
  ...why,
  `The plan for this track (${totalBars(G)} bars):`,
  ...G.sections.map(s => `• **${s.name}** (${s.bars} bars): ${s.note}`),
  'In **Arrange**: pick a pattern on the left and click a lane to place it, drag the right edge to make it last, Ctrl+drag to copy. Click the Sections row to label parts.',
];


export const barsToNotes = (bars, vel = 0.8) => bars.flatMap((bar, b) => bar.map(([s, len, d]) => [b * 16 + s, len, d, s === 0 ? vel + 0.08 : vel]));

// chord slots: degs, slot length, optional per-slot types
export function slotsInto(pat, degs, slotSteps, types = null, guide = true) {
  const n = Math.ceil(pat.bars * STEPS_PER_BAR / slotSteps);
  pat.chordSlots = Array.from({ length: n }, (_, i) => ({ deg: degs[i % degs.length], type: types ? types[i % types.length] : 'triad' }));
  pat.slotSteps = slotSteps;
  pat.chordsGuide = guide;
}
