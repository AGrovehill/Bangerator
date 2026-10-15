// Genre guides: a project template plus a step-by-step tutorial for techno, trance, house, drum & bass, psytrance,
// midtempo, hardcore, and a sad instrumental piece in song form.
//
// Every guide works the way these genres are usually built: one pattern per element (kick, hats, bass,
// chords, lead...), layered on the playlist. The tutorial walks through the phases in order. Each step
// explains the genre's common methods, can be done by hand, and has a "Do it for me" that writes a typical
// version, so following the steps end to end always gives a full-length, arranged song.
//
// Pure logic and data: guideui.js draws the panel.

import { blankProject, newTrack, TRACK_COLORS, PATTERN_COLORS, defaultFx, addPattern, withPatterns, contentView, newClip, uid,
  STEPS_PER_BAR, songBars } from './state.js';
import { DEFAULT_PATCH } from './audio.js';
import { chordAt, bassLine, toTrackNotes } from './advisor.js';

const synth = (name, over) => ({ name, kind: 'synth', patch: { ...DEFAULT_PATCH, ...over } });

// ---------- Small builders ----------
const hitsOf = str => [...str.replace(/[\s|]/g, '')].map(c => (c === 'X' ? 2 : c === 'x' ? 1 : 0));
const fold = semis => { const r = ((semis % 12) + 12) % 12; return r > 7 ? r - 12 : r; };

function ctxOf(p) {
  const g = p.guide;
  const G = GENRES[g.genre];
  return {
    G,
    pat: role => p.patterns.find(x => x.id === g.roles.pats[role]),
    track: role => p.tracks.find(t => t.id === g.roles.tracks[role]),
    row: kind => p.drums.rows.find(r => r.kind === kind),
    view: role => contentView(p, p.patterns.find(x => x.id === g.roles.pats[role])),
  };
}

// Write drum steps: lines = { kick: 'X...X...', ... }; strings repeat to fill the pattern.
function drums(p, c, role, lines, clear = true) {
  const pat = c.pat(role);
  const L = pat.bars * STEPS_PER_BAR;
  if (clear) pat.drumSteps = {};
  for (const [kind, str] of Object.entries(lines)) {
    const h = hitsOf(str);
    pat.drumSteps[c.row(kind).id] = Array.from({ length: L }, (_, i) => h[i % h.length]);
  }
}

// Write notes given as [step, len, degree, velocity?]
function notes(c, role, trackRole, list) {
  const pat = c.pat(role);
  const L = pat.bars * STEPS_PER_BAR;
  pat.notes[c.track(trackRole).id] = list.filter(n => n[0] < L).map(([step, len, deg, vel = 0.85]) => ({ step, len: Math.min(len, L - step), deg, vel }));
}

function abstractNotes(p, c, role, trackRole, abs) {
  c.pat(role).notes[c.track(trackRole).id] = toTrackNotes(c.view(role), c.track(trackRole), abs);
}

// Chords into every pattern: sounding in `playRoles`, as a silent guide everywhere else.
function setChords(p, c, degs, slotSteps, type, playRoles) {
  const playing = new Set(playRoles.map(r => c.pat(r).id));
  for (const pat of p.patterns) {
    const n = Math.ceil(pat.bars * STEPS_PER_BAR / slotSteps);
    pat.chordSlots = Array.from({ length: n }, (_, i) => ({ deg: degs[i % degs.length], type }));
    pat.slotSteps = slotSteps;
    pat.chordsGuide = !playing.has(pat.id);
  }
}

// Notes that run through the chord tones. shape indexes [root, 3rd, 5th, root+8ve, 3rd+8ve]; it restarts on each chord.
function arp(view, { rate = 1, shape = [0, 1, 2, 3, 2, 1], len = 1, vels = [0.9, 0.6, 0.7, 0.6], skip = () => false } = {}) {
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
function stabs(view, hits, tones = [0, 1, 2], lift = 0) {
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
function buildUp(p, c, bars, riserBars) {
  const q = Math.max(1, Math.floor(bars / 2)), e = Math.max(1, Math.floor(bars / 4));
  let snare = 'x...x...x...x...'.repeat(q) + 'x.x.x.x.x.x.x.x.'.repeat(bars - q - e) + 'XxxxXxxxXxxxXxxx'.repeat(Math.max(0, e - 1)) + 'XxxxXxxxXxXxX...';
  snare = snare.slice(-bars * 16);
  const riser = '.'.repeat((bars - riserBars) * 16) + 'X' + '.'.repeat(riserBars * 16 - 1);
  const clap = '.'.repeat((bars - 1) * 16) + 'x.x.x.x.x.x.x...';
  drums(p, c, 'build', { snare, riser, clap });
  p.drumParams.riser.length = Math.round(riserBars * 4 * 60 / p.bpm * 100) / 100; // exactly `riserBars` long at this tempo
}

const fx = (obj, over) => { obj.fx = defaultFx({ ...obj.fx, ...over }); };
const count = arr => (arr || []).filter(Boolean).length;
const hasDrums = (c, role, kinds) => kinds.some(k => count(c.pat(role)?.drumSteps[c.row(k).id]) > 0);
const hasNotes = (c, role, trackRole) => (c.pat(role)?.notes[c.track(trackRole)?.id] || []).length > 0;
const hasChords = (c, role) => count(c.pat(role)?.chordSlots) > 0;

// ---------- Arrangement ----------
// sections: [{ name, bars, layers: ['kick', 'hats@16', 'bass@0-16', 'lead@-8'], build: bars?, impact: true?, key?: { root, scale } }]
// '@16' = from bar 16 of the section, '@0-16' = bars 0 to 16, '@-8' = the last 8 bars.
export function totalBars(G) { return G.sections.reduce((a, s) => a + s.bars, 0); }

function sectionStarts(G) {
  const out = {};
  let bar = 0;
  for (const s of G.sections) { out[s.name] = bar; bar += s.bars; }
  out.END = bar;
  return out;
}

function arrange(p, c, sections = c.G.sections) {
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
function jamLoop(p, c) {
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
function lane(p, target, pts) {
  p.song.auto = p.song.auto.filter(l => l.target !== target);
  p.song.auto.push({ id: uid('a'), target, points: pts.map(([bar, value]) => ({ step: Math.round(bar * STEPS_PER_BAR), value })).sort((a, b) => a.step - b.step) });
}

// "Filter the drums out": a quick high-pass sweep over the 4 bars before `bar`, released on the downbeat.
const drumSweep = bar => [[bar - 4, 0], [bar - 0.25, 0.55], [bar, 0]];

// ---------- Shared steps ----------
const mixText = extra => [
  'Mixing a dance track is mostly about **the low end** and **space**:',
  '• **Sidechain (Pump)**: duck everything that fights the kick, on every beat. The kick stays punchy and the whole track “breathes”.',
  '• **High-pass** everything that isn’t kick or bass (Mix & FX → High-pass, 120–300 Hz). Two things below 100 Hz at once turns to mud.',
  '• **Levels first**: kick loudest, bass just under it, everything else well below. Turn things down, not up.',
  '• **Reverb and delay** on the melodic parts only. Keep kick and bass dry.',
  ...extra,
  'The **Coach** card in the sidebar points out what still clashes.',
];

const finishStep = {
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

const arrangeText = (G, why) => [
  `Now the song. Dance music is built in **blocks of 8, 16 and 32 bars**, and elements enter and leave at those boundaries, so DJs can mix it and listeners feel the changes coming.`,
  ...why,
  `The plan for this track (${totalBars(G)} bars):`,
  ...G.sections.map(s => `• **${s.name}** (${s.bars} bars): ${s.note}`),
  'In **Arrange**: pick a pattern on the left and click a lane to place it, drag the right edge to make it last, Ctrl+drag to copy. Click the Sections row to label parts.',
];

// ---------- TECHNO ----------
// The 303 recipe: one saw, mono with slide, a resonant 24 dB filter with a short envelope, accents
// that open the filter, and a fairly long gate. The squelch comes from riding Cutoff and Env mod.
const ACID_PATCH = synth('Acid 303', { wave: 'sawtooth', mono: true, glide: 0.065, attack: 0.002, decay: 0.4, sustain: 0.55, release: 0.05,
  cutoff: 360, resonance: 11, filterSlope: 24, filterEnv: 2600, filterDecay: 0.22, velToFilter: 0.7, volume: 0.4 });

// [step, length, degree, accent]: a length of 2 that overlaps the next note = slide into it.
const ACID_BARS = [
  [[0, 1, 0, 1], [1, 1, 0], [2, 2, 7, 1], [3, 1, 6], [5, 1, 0], [6, 2, 2], [7, 1, 3, 1], [8, 1, 0], [10, 1, 7, 1], [11, 2, 0], [12, 1, -1], [13, 1, 0], [14, 2, 4, 1], [15, 1, 2]],
  [[0, 1, 0, 1], [1, 1, 0], [2, 1, 7], [4, 2, 0], [5, 1, 3, 1], [6, 1, 0], [8, 1, 7, 1], [9, 2, 6], [10, 1, 4], [12, 1, 0, 1], [13, 1, 2], [14, 2, 3], [15, 1, 7, 1]],
  [[0, 1, 0, 1], [1, 1, 0], [2, 2, 7, 1], [3, 1, 6], [5, 1, 0], [6, 2, 2], [7, 1, 3, 1], [8, 1, 0], [10, 1, 7, 1], [11, 2, 0], [12, 1, -1], [13, 1, 0], [14, 2, 4, 1], [15, 1, 2]],
  [[0, 1, 0, 1], [1, 1, 0], [2, 1, 7], [4, 2, 0], [5, 1, 3, 1], [6, 1, 0], [8, 1, 7, 1], [9, 1, 0], [10, 2, 2], [11, 1, 3, 1], [12, 1, 0], [13, 1, 2, 1], [14, 2, 4], [15, 1, 6, 1]],
];
const techno = {
  id: 'techno', name: 'Techno', bpm: 132, root: 7, scale: 'minor', swing: 0,
  blurb: 'Driving and hypnotic. One chord, a rumbling bass, an acid line, and tension built from repetition and filter sweeps.',
  lanes: [
    { name: 'Kick', roles: ['kick'] }, { name: 'Hats & clap', roles: ['hats'] }, { name: 'Percussion', roles: ['perc'] }, { name: 'Ride', roles: ['ride'] },
    { name: 'Bass', roles: ['bass'] }, { name: 'Stab', roles: ['stab'] }, { name: 'Acid', roles: ['acid'] }, { name: 'FX', roles: ['build', 'impact'] },
  ],
  patterns: [['kick', 'Kick', 4], ['hats', 'Hats & clap', 4], ['perc', 'Percussion', 4], ['ride', 'Ride', 4], ['bass', 'Rumble bass', 4],
    ['stab', 'Stab', 4], ['acid', 'Acid line', 4], ['build', 'Build-up', 8], ['impact', 'Impact', 4]],
  tracks: [['bass', 'Bass', 'tk_bass', 1], ['stab', 'Stab', 'tk_stab', 3], ['acid', 'Acid', 'tk_acid', 2]],
  patches: {
    tk_bass: synth('Techno Rumble', { wave: 'sine', wave2: 'sawtooth', mix2: 0.25, attack: 0.003, decay: 0.18, sustain: 0.25, release: 0.06, cutoff: 420, resonance: 2, filterEnv: 500, volume: 0.95 }),
    tk_stab: synth('Dub Stab', { wave: 'sawtooth', wave2: 'square', mix2: 0.4, detune: 14, attack: 0.002, decay: 0.16, sustain: 0.05, release: 0.12, cutoff: 1400, resonance: 4, filterEnv: 2600, volume: 0.6 }),
    tk_acid: ACID_PATCH,
  },
  drumParams: { kick: { tune: 48, decay: 0.42, punch: 4.2, click: 0.6 }, chat: { decay: 0.04, tone: 8500 }, ohat: { decay: 0.22, tone: 8000 }, clap: { decay: 0.28, tone: 1300 } },
  sections: [
    { name: 'Intro', bars: 32, layers: ['kick', 'perc@8', 'hats@16'], note: 'kick alone, percussion after 8 bars, hats after 16. Room for a DJ to mix in.' },
    { name: 'Groove', bars: 32, layers: ['kick', 'hats', 'perc', 'bass'], note: 'the bass arrives. Now it rolls.' },
    { name: 'Main', bars: 32, layers: ['kick', 'hats', 'perc', 'bass', 'stab', 'acid@16'], note: 'stab enters; the acid line creeps in halfway with its filter nearly closed.' },
    { name: 'Break', bars: 16, layers: ['stab', 'acid', 'perc@8'], build: 8, note: 'kick and bass drop out. Tension: filter opens, snare roll and riser.' },
    { name: 'Drop', bars: 48, layers: ['kick', 'hats', 'perc', 'ride', 'bass', 'stab', 'acid'], impact: true, note: 'everything, plus a ride for extra energy. The peak.' },
    { name: 'Outro', bars: 32, layers: ['kick', 'hats@0-16', 'perc', 'bass@0-16'], note: 'strip back down to kick and percussion for the next DJ.' },
  ],
  steps: [
    { id: 'setup', title: 'Tempo, key and the plan', where: { tab: 'compose', role: 'kick' },
      text: [
        '**Techno** runs at **125–140 BPM**; this project is at 132. The key is **G minor**: techno is nearly always minor, and often never leaves its home chord.',
        'There is no verse or chorus. A techno track is **one groove that evolves**: elements enter and leave every 8–16 bars, and filters open and close. Repetition is the point.',
        'The project has one **pattern per element** (see the Pattern menu), which is how these tracks are built. While you work, **Play** loops all of them together as a work loop, so you always hear a new part in context. Mute a lane in Arrange to hear less.',
        'Follow the steps in order. Do each one yourself, or press **Do it for me** and then change what it wrote.',
      ],
      check: () => true },
    { id: 'kick', title: 'The kick', where: { tab: 'compose', role: 'kick', scroll: 'drums' },
      text: [
        'Everything hangs on a **four-on-the-floor** kick: one on every beat (steps 1, 5, 9, 13).',
        '• Put a kick on each beat. Shift+click makes it an accent.',
        '• Techno kicks are short and punchy with a hard click. Shape it in **Sound Design → Drums → Kick**: Tune ~48 Hz, short Decay, high Punch.',
        '• Don’t add extra kicks yet. The space between the kicks is where the bass and hats will go.',
      ],
      do: (p, c) => drums(p, c, 'kick', { kick: 'X...X...X...X...' }),
      check: (p, c) => hasDrums(c, 'kick', ['kick']) },
    { id: 'hats', title: 'Hats and clap', where: { tab: 'compose', role: 'hats', scroll: 'drums' },
      text: [
        'The **off-beat open hat** (step 3 of every beat, exactly between the kicks) is the engine of techno: kick–hat–kick–hat.',
        '• Open hat on every off-beat.',
        '• Closed hats on the 16ths around it. Leave the off-beat step free so the two interlock.',
        '• Clap (or snare) on beats 2 and 4.',
        'Keep hats quiet. They should be felt more than heard.',
      ],
      do: (p, c) => drums(p, c, 'hats', { ohat: '..X...X...X...X.', chat: 'xx.xxx.xxx.xxx.x', clap: '....X.......X...' }),
      check: (p, c) => hasDrums(c, 'hats', ['ohat', 'chat', 'clap']) },
    { id: 'perc', title: 'Percussion and ride', where: { tab: 'compose', role: 'perc', scroll: 'drums' },
      text: [
        'Percussion gives the loop its **character**. The trick is **syncopation**: hits that land between the beats, and patterns that take 2 or 4 bars to repeat so the loop doesn’t feel like 1 bar.',
        '• A rimshot or tom pattern that avoids the beats (try steps 4, 7, 11, 14).',
        '• A soft shaker on 8ths for movement.',
        '• Change something small in bar 4 only: a fill that tells the ear a phrase is ending.',
        'The **Ride** pattern is a separate layer saved for the drop: an 8th-note ride lifts the energy instantly.',
      ],
      do: (p, c) => {
        drums(p, c, 'perc', {
          rim: '...x..x...x..x.. ...x..x...x..x.. ...x..x...x..x.. ...x..x...x.xx.x',
          shaker: 'x.x.x.x.x.x.x.x.',
          ltom: '................ ..........x..x.. ................ ......x...x..x..',
        });
        drums(p, c, 'ride', { ride: 'x.x.x.x.x.x.x.x.' });
      },
      check: (p, c) => hasDrums(c, 'perc', ['rim', 'shaker', 'ltom', 'mtom', 'htom', 'cowbell']) },
    { id: 'bass', title: 'The rumble bass', where: { tab: 'compose', role: 'bass', scroll: 'tracks', track: 'bass' },
      text: [
        'Techno bass is a **rumble**, not a melody: the home note (**1**) on the three 16ths **after** each kick, never on the kick itself. Kick and bass take turns, so both stay clear.',
        '• In the Bass track, put short **1**s on steps 2, 3, 4 of every beat.',
        '• Keep it on one note. One different note at the very end of bar 4 is plenty.',
        '• The sound is a low sine with a little saw: dark, with no top end. Keep the track at **octave 1**.',
        'Bassline ideas → **Off-beat** is the sparser classic alternative.',
      ],
      do: (p, c) => {
        const out = [];
        for (let s = 0; s < 64; s++) if (s % 4) out.push([s, 1, 0, s % 4 === 2 ? 0.9 : 0.7]);
        out.splice(-3, 3, [61, 1, -1, 0.75], [62, 1, -1, 0.9], [63, 1, 2, 0.8]);
        notes(c, 'bass', 'bass', out);
      },
      check: (p, c) => hasNotes(c, 'bass', 'bass') },
    { id: 'chords', title: 'One chord: the stab', where: { tab: 'compose', role: 'stab', scroll: 'chords', track: 'stab' },
      text: [
        'Techno harmony is minimal: usually **one minor chord** for the whole track. What changes is its rhythm and its filter.',
        '• The chord lane holds **i** (the home chord) as a silent guide, so the rolls show you which rows are chord notes (teal, with the root tagged R).',
        '• In the Stab track, play the chord’s three notes (**1, 3, 5**) together as very short hits on off-beat 16ths: try steps 4, 7 and 12 of the bar.',
        '• In bar 4, move the last hit to the chord one step below (**VII**) for a tiny lift before the loop restarts.',
        'This is the **dub techno stab**. Delay and reverb do half the work, and that comes in the mix step.',
      ],
      do: (p, c) => {
        setChords(p, c, [0, 0, 0, 0], 16, 'triad', []);
        const out = [];
        for (let bar = 0; bar < 4; bar++) {
          for (const s of bar === 3 ? [3, 6, 10] : [3, 6, 11]) for (const d of [0, 2, 4]) out.push([bar * 16 + s, 1, d, 0.8]);
        }
        for (const d of [-1, 1, 3]) out.push([62, 1, d, 0.75]);
        notes(c, 'stab', 'stab', out);
      },
      check: (p, c) => hasNotes(c, 'stab', 'stab') },
    { id: 'hook', title: 'The acid line', where: { tab: 'compose', role: 'acid', scroll: 'tracks', track: 'acid' },
      text: [
        'The hook is a **16th-note sequence** in the style of the Roland TB-303. Three things make a line sound like acid, and the notes are the least of them:',
        '• **Slides**: make a note long enough to overlap the next one and the pitch glides into it instead of re-striking. That rubbery bend is the 303. The Acid synth is set to **Mono + slide** (Sound Design).',
        '• **Accents**: louder notes open the filter further and “quack”. Hover a note and Alt+scroll to make it louder. Accent the octave jumps and a few off-beats.',
        '• **Notes**: mostly the home note **1**, jumps up an octave, a **♭3**, **5** or **♭7**, and a few holes. Bar 2 answers bar 1.',
        'Then **ride the filter**. On a Launchkey, Shift + knob 2 is the synth’s Cutoff and Shift + knob 3 its Resonance: record them while the loop plays. Or open Sound Design and move **Brightness**, **Resonance**, **Filter pluck** (Env mod) and **Pluck decay** while it plays.',
      ],
      do: (p, c) => {
        p.patches.tk_acid = structuredClone(ACID_PATCH);
        c.track('acid').patch = 'tk_acid';
        notes(c, 'acid', 'acid', ACID_BARS.flatMap((bar, b) => bar.map(([s, len, d, acc]) => [b * 16 + s, len, d, acc ? 1 : 0.72])));
      },
      check: (p, c) => hasNotes(c, 'acid', 'acid') },
    { id: 'mix', title: 'Mix: space and rumble', where: { tab: 'mix' },
      text: mixText([
        '• Techno specific: lots of **tempo-synced delay** on the stab (dotted 1/8 with high feedback). The acid line wants **Drive** (distortion makes the resonance scream) and some **Compress** to tame the accents.',
        '• Turn on **Per-sound strips** under Drums if you want to treat single drum sounds.',
      ]),
      do: (p, c) => {
        fx(c.track('bass'), { pump: 0.4, eqHigh: -6 });
        Object.assign(c.track('bass'), { volume: 0.85 });
        fx(c.track('stab'), { hpCut: 220, delay: 0.4, reverb: 0.3, pump: 0.3 });
        Object.assign(c.track('stab'), { volume: 0.6 });
        fx(c.track('acid'), { hpCut: 120, cutoff: 20000, reso: 0, delay: 0.22, drive: 0.4, comp: 0.35, reverb: 0.1 });
        Object.assign(c.track('acid'), { volume: 0.55 });
        fx(p.drums, { comp: 0.3, reverb: 0.04 });
        Object.assign(p.fxBus, { delaySteps: 3, delayFeedback: 0.5, reverbSize: 2.8 });
      },
      check: (p, c) => c.track('stab').fx.delay > 0 || c.track('bass').fx.pump > 0 },
    { id: 'build', title: 'Tension: the build-up', where: { tab: 'compose', role: 'build', scroll: 'drums' },
      text: [
        'Before the drop you need **tension**. The standard tools:',
        '• A **snare roll** that doubles in speed: quarter notes, then 8ths, then 16ths.',
        '• A **riser**: noise sweeping upward. The Riser drum sound lasts exactly 4 bars here; place it 4 bars before the end.',
        '• A **gap**: leave the last beat almost empty. Silence right before the drop makes it hit twice as hard.',
        'The **Impact** pattern (a boom and a crash) goes on the first beat of the drop.',
      ],
      do: (p, c) => { buildUp(p, c, 8, 4); drums(p, c, 'impact', { impact: 'X' + '.'.repeat(63), cymbal: 'X' + '.'.repeat(63) }); },
      check: (p, c) => hasDrums(c, 'build', ['snare', 'riser', 'clap']) },
    { id: 'arrange', title: 'Arrange the track', where: { tab: 'arrange' },
      get text() { return arrangeText(techno, ['Techno arrangements **add one thing at a time**. The listener should hardly notice a change, yet a minute later everything is different.']); },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 10 },
    { id: 'automate', title: 'Automation: make it move', where: { tab: 'arrange' },
      text: [
        'A loop that never changes is a loop. **Automation** turns it into a track.',
        '• **Acid filter**: the synth’s own **Cutoff**, nearly closed when the line enters, slowly opening through Main, screaming at the top of the Break. Its **Env mod** grows in the Drop so the accents bite harder.',
        '• **Stab reverb**: more in the Break so it floats, back down for the Drop.',
        '• **Drums high-pass** over the 4 bars before the Break and before the Outro: the bottom falls away, then slams back on the downbeat.',
        'In Arrange, use **+ Automate…** under the lanes: click to add points, Shift+drag to draw. Or turn on Record and twist a Launchkey knob while the song plays.',
      ],
      do: (p, c) => {
        const S = sectionStarts(c.G);
        const acid = c.track('acid').id, stab = c.track('stab').id;
        p.song.auto = p.song.auto.filter(l => l.target !== `${acid}|cutoff`); // older versions swept the mixer low-pass
        lane(p, `${acid}|synthCutoff`, [[S.Main + 16, 0.24], [S.Break, 0.45], [S.Break + 8, 0.4], [S.Drop - 0.25, 0.74], [S.Drop, 0.56], [S.Drop + 24, 0.7], [S.Drop + 40, 0.5], [S.Outro, 0.35]]);
        lane(p, `${acid}|synthEnv`, [[S.Main + 16, 0.25], [S.Drop, 0.32], [S.Drop + 16, 0.45], [S.Outro, 0.3]]);
        lane(p, `${acid}|synthReso`, [[S.Main + 16, 0.5], [S.Break + 8, 0.55], [S.Drop - 0.25, 0.8], [S.Drop, 0.6]]);
        lane(p, `${stab}|reverb`, [[S.Main, 0.3], [S.Break, 0.3], [S.Break + 8, 0.7], [S.Drop, 0.3]]);
        lane(p, 'drums|hpCut', [[0, 0], ...drumSweep(S.Break), ...drumSweep(S.Outro)]);
      },
      check: p => p.song.auto.some(l => l.points.length >= 2) },
    finishStep,
  ],
};

// ---------- TRANCE ----------
const TRANCE_LEAD = [ // [step in bar, len, degree] per bar; 8 bars over i - VI - III - VII (2 bars each)
  [[0, 3, 7], [3, 3, 4], [6, 2, 7], [8, 3, 9], [11, 3, 7], [14, 2, 4]],
  [[0, 3, 7], [3, 3, 4], [6, 2, 7], [8, 3, 9], [11, 3, 11], [14, 2, 9]],
  [[0, 3, 7], [3, 3, 5], [6, 2, 7], [8, 3, 9], [11, 3, 7], [14, 2, 5]],
  [[0, 3, 7], [3, 3, 5], [6, 2, 7], [8, 3, 10], [11, 3, 9], [14, 2, 7]],
  [[0, 3, 9], [3, 3, 6], [6, 2, 9], [8, 3, 11], [11, 3, 9], [14, 2, 6]],
  [[0, 3, 9], [3, 3, 6], [6, 2, 9], [8, 3, 10], [11, 3, 9], [14, 2, 6]],
  [[0, 3, 8], [3, 3, 6], [6, 2, 8], [8, 3, 10], [11, 3, 8], [14, 2, 6]],
  [[0, 3, 8], [3, 3, 6], [6, 2, 8], [8, 4, 10], [12, 4, 11]],
];

const trance = {
  id: 'trance', name: 'Trance', bpm: 138, root: 9, scale: 'minor', swing: 0,
  blurb: 'Uplifting and emotional. A four-chord progression, an off-beat bass, a 16th-note pluck and a big supersaw melody after a long breakdown.',
  lanes: [
    { name: 'Kick', roles: ['kick'] }, { name: 'Hats & clap', roles: ['hats'] }, { name: 'Ride', roles: ['ride'] }, { name: 'Bass', roles: ['bass'] },
    { name: 'Pad', roles: ['pad'] }, { name: 'Pluck', roles: ['pluck'] }, { name: 'Lead', roles: ['lead'] }, { name: 'FX', roles: ['build', 'impact'] },
  ],
  patterns: [['kick', 'Kick', 4], ['hats', 'Hats & clap', 4], ['ride', 'Ride', 4], ['bass', 'Off-beat bass', 8], ['pad', 'Pad chords', 8],
    ['pluck', 'Pluck arp', 8], ['lead', 'Lead melody', 8], ['build', 'Build-up', 8], ['impact', 'Impact', 4]],
  tracks: [['bass', 'Bass', 'tr_bass', 1], ['pluck', 'Pluck', 'tr_pluck', 4], ['lead', 'Lead', 'tr_lead', 4]],
  chordsPatch: ['tr_pad', 3],
  patches: {
    tr_bass: synth('Trance Bass', { wave: 'sawtooth', wave2: 'square', octave2: -1, mix2: 0.4, detune: 6, attack: 0.003, decay: 0.16, sustain: 0.35, release: 0.07, cutoff: 800, resonance: 3, filterEnv: 1400, volume: 0.85 }),
    tr_pluck: synth('Trance Pluck', { wave: 'sawtooth', wave2: 'sawtooth', mix2: 0.5, detune: 14, unison: 3, attack: 0.002, decay: 0.2, sustain: 0, release: 0.18, cutoff: 1100, resonance: 3, filterEnv: 4200, volume: 0.55 }),
    tr_pad: synth('Trance Pad', { wave: 'sawtooth', wave2: 'triangle', mix2: 0.5, detune: 18, unison: 3, attack: 0.45, decay: 1, sustain: 0.75, release: 1.2, cutoff: 1600, resonance: 1, volume: 0.45 }),
    tr_lead: synth('Supersaw Lead', { wave: 'sawtooth', unison: 7, detune: 22, wave2: 'sawtooth', octave2: 1, mix2: 0.25, attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.35, cutoff: 6500, resonance: 1.5, filterEnv: 1500, volume: 0.55 }),
  },
  drumParams: { kick: { tune: 50, decay: 0.38, punch: 4, click: 0.7 }, ohat: { decay: 0.28, tone: 8000 }, snare: { tune: 200, decay: 0.16, snappy: 0.9 } },
  sections: [
    { name: 'Intro', bars: 32, layers: ['kick', 'hats@8', 'bass@16'], note: 'kick, then hats, then the bass. DJ-friendly.' },
    { name: 'Groove', bars: 16, layers: ['kick', 'hats', 'bass', 'pluck'], note: 'the pluck teases the chords with its filter mostly closed.' },
    { name: 'Breakdown', bars: 32, layers: ['pad', 'pluck@0-16', 'lead@16'], build: 8, note: 'drums stop. Pads reveal the chords, then the melody enters quietly. Snare roll and riser at the end.' },
    { name: 'Climax', bars: 32, layers: ['kick', 'hats', 'bass', 'pad', 'pluck', 'lead'], impact: true, note: 'everything at once: the moment the whole track exists for.' },
    { name: 'Break 2', bars: 16, layers: ['pad', 'pluck'], build: 8, note: 'a short breather and a second build.' },
    { name: 'Climax 2', bars: 32, layers: ['kick', 'hats', 'ride', 'bass', 'pad', 'pluck', 'lead'], impact: true, note: 'the same again with a ride on top.' },
    { name: 'Outro', bars: 48, layers: ['kick', 'hats@0-32', 'bass@0-32', 'pluck@0-16'], note: 'take elements away one by one, ending on the kick.' },
  ],
  steps: [
    { id: 'setup', title: 'Tempo, key and the plan', where: { tab: 'compose', role: 'kick' },
      text: [
        '**Trance** sits at **132–140 BPM**; this project is at 138, in **A minor**.',
        'Trance is about **emotion and release**: a long breakdown with no drums where the chords and melody are revealed, a build-up, then a climax where everything plays together. The whole track is designed around that one moment.',
        'The project has one **pattern per element**. While you work, **Play** loops them all together as a work loop so every new part is heard in context.',
        'Follow the steps in order. Do each yourself, or press **Do it for me** and then change what it wrote.',
      ],
      check: () => true },
    { id: 'kick', title: 'The kick', where: { tab: 'compose', role: 'kick', scroll: 'drums' },
      text: [
        '**Four-on-the-floor**: a kick on every beat (steps 1, 5, 9, 13), nothing else.',
        '• Trance kicks are tight and clicky with a short tail, so they leave room for the off-beat bass.',
        '• Shape it in **Sound Design → Drums → Kick**: short Decay, plenty of Click.',
      ],
      do: (p, c) => drums(p, c, 'kick', { kick: 'X...X...X...X...' }),
      check: (p, c) => hasDrums(c, 'kick', ['kick']) },
    { id: 'hats', title: 'Hats and clap', where: { tab: 'compose', role: 'hats', scroll: 'drums' },
      text: [
        '• **Open hat on every off-beat** (step 3 of each beat). With the kick this makes the classic “boots-and-cats”.',
        '• Closed hats on the 16ths around it.',
        '• Clap on beats 2 and 4.',
        'A **Ride** pattern on 8ths is kept back for the final climax.',
      ],
      do: (p, c) => {
        drums(p, c, 'hats', { ohat: '..X...X...X...X.', chat: 'xx.xxx.xxx.xxx.x', clap: '....X.......X...' });
        drums(p, c, 'ride', { ride: 'x.x.x.x.x.x.x.x.' });
      },
      check: (p, c) => hasDrums(c, 'hats', ['ohat', 'chat', 'clap']) },
    { id: 'chords', title: 'The chord progression', where: { tab: 'compose', role: 'pad', scroll: 'chords' },
      text: [
        'Trance lives on a **four-chord minor progression**, each chord held for 2 bars. The classic is **i – VI – III – VII** (in A minor: Am – F – C – G): it starts dark and keeps lifting.',
        '• Open the **Pad chords** pattern, set chord length to **2 bars**, click a slot and pick chords in the sidebar. “Famous progressions → Epic Minor” is this one.',
        '• Other favourites: **i – VII – VI – VII**, or **VI – VII – i – i**.',
        '• Keep **smooth** ticked: the pad then moves between chords with the smallest possible steps.',
        'These chords are copied into every other pattern as a **silent guide**, so the bass, pluck and lead can follow them.',
      ],
      do: (p, c) => setChords(p, c, [0, 5, 2, 6], 32, 'triad', ['pad']),
      check: (p, c) => hasChords(c, 'pad') },
    { id: 'bass', title: 'The off-beat bass', where: { tab: 'compose', role: 'bass', scroll: 'tracks', track: 'bass' },
      text: [
        'The trance bass plays **between the kicks**: the chord’s root on every off-beat 8th. Kick–bass–kick–bass gives the genre its gallop, and the two never overlap.',
        '• In the Bass track put the **root of the current chord** on step 3 of every beat (the teal rows are chord notes; the root is the one tagged **R**).',
        '• It changes note when the chord changes, every 2 bars.',
        '• Variation: a “rolling” bass plays the three 16ths after each kick instead.',
        'Sidebar → **Bassline ideas → Off-beat** writes exactly this from your chords.',
      ],
      do: (p, c) => abstractNotes(p, c, 'bass', 'bass', bassLine(c.view('bass'), 'offbeat')),
      check: (p, c) => hasNotes(c, 'bass', 'bass') },
    { id: 'pluck', title: 'The pluck arpeggio', where: { tab: 'compose', role: 'pluck', scroll: 'tracks', track: 'pluck' },
      text: [
        'A short, bright **pluck playing the chord notes as 16ths** fills the space and carries the harmony when the pad is filtered down.',
        '• Run up and down the chord: root, 3rd, 5th, octave, 5th, 3rd… and restart when the chord changes.',
        '• Only use the teal rows (chord notes) and it cannot sound wrong.',
        '• Delay on a pluck makes one line sound like three.',
      ],
      do: (p, c) => abstractNotes(p, c, 'pluck', 'pluck', arp(c.view('pluck'), { shape: [0, 1, 2, 3, 2, 1, 2, 3], vels: [0.9, 0.6, 0.7, 0.6] })),
      check: (p, c) => hasNotes(c, 'pluck', 'pluck') },
    { id: 'hook', title: 'The lead melody', where: { tab: 'compose', role: 'lead', scroll: 'tracks', track: 'lead' },
      text: [
        'The melody is the heart of a trance track. What works:',
        '• **A short motif, repeated over each chord** and shifted to fit it. Listeners remember rhythm first.',
        '• A **dotted rhythm** (notes 3 steps long: 3 + 3 + 2) pushes against the straight kick.',
        '• **Land on chord notes** (teal rows) on the strong beats; use the notes in between to travel.',
        '• Let the last bar **rise**, so the loop wants to start again.',
        'The sound is a **supersaw**: 7 detuned saws (Sound Design → Unison). The “Next note?” card suggests where to go from any note.',
      ],
      do: (p, c) => notes(c, 'lead', 'lead', TRANCE_LEAD.flatMap((bar, b) => bar.map(([s, len, d]) => [b * 16 + s, len, d, s === 0 || s === 8 ? 0.95 : 0.8]))),
      check: (p, c) => hasNotes(c, 'lead', 'lead') },
    { id: 'mix', title: 'Mix: sidechain everything', where: { tab: 'mix' },
      text: mixText([
        '• Trance specific: the **pump** is part of the sound. Pad and bass duck hard on every kick, which is what makes the track surge.',
        '• Big reverb and delay on the lead and pluck: this genre is meant to sound huge.',
      ]),
      do: (p, c) => {
        fx(c.track('bass'), { pump: 0.7, eqHigh: -4 });
        fx(c.track('pluck'), { hpCut: 250, delay: 0.38, reverb: 0.3, pump: 0.35 });
        Object.assign(c.track('pluck'), { volume: 0.6 });
        fx(c.track('lead'), { hpCut: 250, delay: 0.3, reverb: 0.38, pump: 0.25, comp: 0.3 });
        Object.assign(c.track('lead'), { volume: 0.7 });
        fx(p.chords, { hpCut: 160, reverb: 0.42, pump: 0.65 });
        p.chords.volume = 0.5;
        fx(p.drums, { comp: 0.25, reverb: 0.04 });
        Object.assign(p.fxBus, { delaySteps: 3, delayFeedback: 0.42, reverbSize: 3.4, pumpRelease: 0.55 });
      },
      check: (p, c) => c.track('bass').fx.pump > 0 || p.chords.fx.pump > 0.6 },
    { id: 'build', title: 'The build-up', where: { tab: 'compose', role: 'build', scroll: 'drums' },
      text: [
        'The build-up is 8 bars of rising tension at the end of the breakdown:',
        '• A **snare roll** that doubles in speed: quarters, 8ths, 16ths.',
        '• A **riser** (noise sweeping up) over the last 4 bars.',
        '• A **gap** on the last beat. The silence is what makes the drop land.',
        'The **Impact** pattern (boom and crash) marks the first beat of each climax.',
      ],
      do: (p, c) => { buildUp(p, c, 8, 4); drums(p, c, 'impact', { impact: 'X' + '.'.repeat(63), cymbal: 'X' + '.'.repeat(63) }); },
      check: (p, c) => hasDrums(c, 'build', ['snare', 'riser', 'clap']) },
    { id: 'arrange', title: 'Arrange the track', where: { tab: 'arrange' },
      get text() { return arrangeText(trance, ['Trance has the clearest structure in dance music: **intro – breakdown – build – climax**, usually twice.']); },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 10 },
    { id: 'automate', title: 'Automation: the long sweep', where: { tab: 'arrange' },
      text: [
        'Trance uses long, slow **filter sweeps** to control energy:',
        '• **Pluck filter**: nearly closed in the Groove, closing further into the breakdown, then opening all the way through the build.',
        '• **Lead volume**: sneak the melody in quietly in the breakdown so the climax feels like it arrives.',
        '• **Pad filter**: opens through the breakdown.',
        '• **Drums high-pass** over the 4 bars before each breakdown.',
        'In Arrange use **+ Automate…**, or Record plus a Launchkey knob.',
      ],
      do: (p, c) => {
        const S = sectionStarts(c.G);
        const pluck = c.track('pluck').id, lead = c.track('lead').id;
        lane(p, `${pluck}|cutoff`, [[S.Groove, 0.35], [S.Breakdown, 0.6], [S.Breakdown + 16, 0.3], [S.Climax - 0.25, 0.95], [S.Climax, 0.85], [S['Break 2'], 0.45], [S['Climax 2'] - 0.25, 0.95], [S.Outro, 0.8], [S.Outro + 16, 0.3]]);
        lane(p, `${lead}|volume`, [[S.Breakdown + 16, 0.2], [S.Climax - 1, 0.5], [S.Climax, 0.6]]);
        lane(p, 'chords|cutoff', [[S.Breakdown, 0.45], [S.Climax - 1, 0.9], [S.Climax, 1]]);
        lane(p, 'drums|hpCut', [[0, 0], ...drumSweep(S.Breakdown), ...drumSweep(S['Break 2'])]);
      },
      check: p => p.song.auto.some(l => l.points.length >= 2) },
    finishStep,
  ],
};

// ---------- HOUSE ----------
const HOUSE_HOOK = [
  [[2, 2, 7], [5, 1, 6], [6, 2, 4], [10, 3, 4], [14, 2, 2]],
  [[2, 2, 5], [5, 1, 4], [6, 2, 3], [10, 3, 3], [14, 2, 2]],
  [[2, 2, 6], [5, 1, 5], [6, 2, 3], [10, 3, 3], [14, 2, 1]],
  [[2, 2, 4], [5, 1, 2], [6, 2, 4], [8, 4, 6], [14, 2, 4]],
];

const house = {
  id: 'house', name: 'House', bpm: 124, root: 2, scale: 'minor', swing: 0.1,
  blurb: 'Groovy and warm. Swung drums, a bouncing bassline, jazzy 7th-chord piano stabs and a simple hook.',
  lanes: [
    { name: 'Kick', roles: ['kick'] }, { name: 'Tops', roles: ['hats'] }, { name: 'Percussion', roles: ['perc'] }, { name: 'Bass', roles: ['bass'] },
    { name: 'Piano', roles: ['keys'] }, { name: 'Pad', roles: ['pad'] }, { name: 'Hook', roles: ['hook'] }, { name: 'FX', roles: ['build', 'impact'] },
  ],
  patterns: [['kick', 'Kick', 4], ['hats', 'Tops', 4], ['perc', 'Percussion', 4], ['bass', 'Bassline', 4], ['keys', 'Piano stabs', 4],
    ['pad', 'Pad chords', 4], ['hook', 'Hook', 4], ['build', 'Build-up', 4], ['impact', 'Impact', 4]],
  tracks: [['bass', 'Bass', 'hs_bass', 2], ['keys', 'Piano', 'piano', 3], ['hook', 'Hook', 'hs_lead', 4]],
  chordsPatch: ['hs_pad', 3],
  patches: {
    hs_bass: synth('House Bass', { wave: 'square', wave2: 'sine', octave2: -1, mix2: 0.6, attack: 0.003, decay: 0.22, sustain: 0.3, release: 0.08, cutoff: 650, resonance: 2, filterEnv: 900, volume: 0.9 }),
    hs_pad: synth('House Pad', { wave: 'triangle', wave2: 'sawtooth', mix2: 0.35, detune: 10, attack: 0.25, decay: 0.8, sustain: 0.7, release: 0.8, cutoff: 1400, volume: 0.4 }),
    hs_lead: synth('House Pluck', { wave: 'square', wave2: 'triangle', octave2: 1, mix2: 0.4, detune: 5, attack: 0.004, decay: 0.25, sustain: 0.2, release: 0.2, cutoff: 2600, resonance: 2, filterEnv: 1800, volume: 0.55 }),
  },
  drumParams: { kick: { tune: 52, decay: 0.5, punch: 3, click: 0.45 }, clap: { decay: 0.32, tone: 1150 }, ohat: { decay: 0.3, tone: 7500 }, shaker: { decay: 0.05 } },
  sections: [
    { name: 'Intro', bars: 16, layers: ['kick', 'hats@8'], note: 'kick, then the tops.' },
    { name: 'Groove', bars: 16, layers: ['kick', 'hats', 'perc', 'bass'], note: 'percussion and the bassline: the groove is complete.' },
    { name: 'Verse', bars: 32, layers: ['kick', 'hats', 'perc', 'bass', 'keys'], note: 'the piano brings the chords.' },
    { name: 'Break', bars: 16, layers: ['keys', 'pad'], build: 4, note: 'drums out. Piano and pad, filter opening, short build.' },
    { name: 'Drop', bars: 32, layers: ['kick', 'hats', 'perc', 'bass', 'keys', 'pad', 'hook'], impact: true, note: 'everything, with the hook on top.' },
    { name: 'Break 2', bars: 16, layers: ['pad', 'hook', 'hats@8'], build: 4, note: 'the hook alone over the pad; tops return to lead back in.' },
    { name: 'Drop 2', bars: 32, layers: ['kick', 'hats', 'perc', 'bass', 'keys', 'pad', 'hook'], impact: true, note: 'the full groove again.' },
    { name: 'Outro', bars: 16, layers: ['kick', 'hats', 'perc@0-8', 'bass@0-8'], note: 'down to drums for the mix-out.' },
  ],
  steps: [
    { id: 'setup', title: 'Tempo, key and the plan', where: { tab: 'compose', role: 'kick' },
      text: [
        '**House** runs at **120–128 BPM**; this project is at 124, in **D minor**, with a little **Swing** (top bar) so the 16ths shuffle.',
        'House is about **groove**: a steady kick, and everything else dancing around it. Parts are simple; how they lock together is what counts.',
        'The project has one **pattern per element**. While you work, **Play** loops them all together as a work loop so every new part is heard in context.',
        'Follow the steps in order. Do each yourself, or press **Do it for me** and then change what it wrote.',
      ],
      check: () => true },
    { id: 'kick', title: 'The kick', where: { tab: 'compose', role: 'kick', scroll: 'drums' },
      text: [
        '**Four-on-the-floor**: a kick on every beat. That steady pulse is what “house” means.',
        '• House kicks are rounder and longer than techno kicks: more Decay, less Click (Sound Design → Drums).',
        '• Leave it alone. The interest comes from everything around it.',
      ],
      do: (p, c) => drums(p, c, 'kick', { kick: 'X...X...X...X...' }),
      check: (p, c) => hasDrums(c, 'kick', ['kick']) },
    { id: 'hats', title: 'Tops: clap, hats, shaker', where: { tab: 'compose', role: 'hats', scroll: 'drums' },
      text: [
        '• **Clap on beats 2 and 4**: the backbeat.',
        '• **Open hat on the off-beats**: the “tss” between kicks.',
        '• A **shaker** on 16ths, leaving a gap on the second 16th of each beat. With swing on, this is where the shuffle comes from.',
        'Try the Swing slider between 5 and 20%: straight sounds stiff, too much sounds drunk.',
      ],
      do: (p, c) => drums(p, c, 'hats', { clap: '....X.......X...', ohat: '..x...x...x...x.', shaker: 'x.xxx.xxx.xxx.xx' }),
      check: (p, c) => hasDrums(c, 'hats', ['ohat', 'chat', 'clap', 'shaker']) },
    { id: 'perc', title: 'Percussion', where: { tab: 'compose', role: 'perc', scroll: 'drums' },
      text: [
        'A little **syncopated percussion** makes a house groove feel human:',
        '• A rimshot on off-16ths (try steps 3, 8, 11).',
        '• A tom or two answering at the end of bars 2 and 4.',
        '• Keep it sparse. If you can’t hum the pattern, it is too busy.',
      ],
      do: (p, c) => drums(p, c, 'perc', {
        rim: '..x....x..x..... ..x....x..x..... ..x....x..x..... ..x....x..x..x.x',
        htom: '................ .............x.. ................ ................',
        ltom: '................ ...............x ................ ..........x..x..',
      }),
      check: (p, c) => hasDrums(c, 'perc', ['rim', 'ltom', 'mtom', 'htom', 'cowbell']) },
    { id: 'chords', title: 'Chords: jazzy sevenths', where: { tab: 'compose', role: 'pad', scroll: 'chords' },
      text: [
        'House borrows its harmony from soul, disco and jazz: **7th chords**, one per bar, in a 4-bar loop.',
        '• In the sidebar pick the **7th** chord type, then fill four slots. This project uses **i7 – iv7 – VII7 – III7** (Dm7 – Gm7 – C7 – Fmaj7): each chord falls a 5th to the next, which always sounds smooth.',
        '• “Jazz Turnaround” and “Circle Walk” under Famous progressions are close relatives.',
        'The Pad pattern plays these softly. They are copied to the other patterns as a **silent guide** for the bass, piano and hook.',
      ],
      do: (p, c) => setChords(p, c, [0, 3, 6, 2], 16, 'seventh', ['pad']),
      check: (p, c) => hasChords(c, 'pad') },
    { id: 'bass', title: 'The bassline', where: { tab: 'compose', role: 'bass', scroll: 'tracks', track: 'bass' },
      text: [
        'A house bassline **bounces**: the chord’s root on beat 1, then notes that push ahead of the beat (syncopation), with an octave jump or the 5th for flavour.',
        '• Start each bar with the **root** of that bar’s chord (the teal row tagged **R**).',
        '• Add 3–4 more short notes on off-16ths. Leave gaps: rests are part of the groove.',
        '• One jump up an octave per bar makes it funky.',
        'Sidebar → **Bassline ideas → Syncopated** or **Octave bounce** write house basslines from your chords.',
      ],
      do: (p, c) => abstractNotes(p, c, 'bass', 'bass', bassLine(c.view('bass'), 'syncopated')),
      check: (p, c) => hasNotes(c, 'bass', 'bass') },
    { id: 'keys', title: 'Piano stabs', where: { tab: 'compose', role: 'keys', scroll: 'tracks', track: 'keys' },
      text: [
        'The **house piano**: short chord stabs on a syncopated rhythm. The rhythm matters more than the notes.',
        '• Play 3 notes of the chord together (teal rows). Leaving out the root (the bass has it) and playing **3rd, 5th, 7th** sounds more sophisticated.',
        '• Rhythm to try: steps 1, 4, 7, 11 and 14 of each bar. Hits that fall just before a beat give the push.',
        '• Keep them short (2 steps).',
        'Ctrl+drag selects a bar of stabs; Ctrl+D repeats it, then move the copy to the next chord’s notes.',
      ],
      do: (p, c) => abstractNotes(p, c, 'keys', 'keys', stabs(c.view('keys'), [[0, 2, 0.9], [3, 2, 0.7], [6, 2, 0.8], [10, 2, 0.75], [13, 2, 0.7]], [1, 2, 3])),
      check: (p, c) => hasNotes(c, 'keys', 'keys') },
    { id: 'hook', title: 'The hook', where: { tab: 'compose', role: 'hook', scroll: 'tracks', track: 'hook' },
      text: [
        'A house hook is short, rhythmic and **repeats**: think of a vocal chop or an organ riff, not a long melody.',
        '• Write a 1-bar phrase that starts **off the beat**, then repeat its rhythm in each bar with the notes moved to fit the chord.',
        '• Stay within about 5 notes. Chord notes (teal rows) on the long notes.',
        '• End bar 4 differently so the 4-bar phrase has a shape.',
        'The “Next note?” card suggests where to go from any note.',
      ],
      do: (p, c) => notes(c, 'hook', 'hook', HOUSE_HOOK.flatMap((bar, b) => bar.map(([s, len, d]) => [b * 16 + s, len, d, 0.85]))),
      check: (p, c) => hasNotes(c, 'hook', 'hook') },
    { id: 'mix', title: 'Mix: warm and bouncy', where: { tab: 'mix' },
      text: mixText([
        '• House specific: go easier on the pump than trance; you want bounce, not suction.',
        '• A little **Compress** on the drum group glues the kit together.',
      ]),
      do: (p, c) => {
        fx(c.track('bass'), { pump: 0.5, eqHigh: -3 });
        fx(c.track('keys'), { hpCut: 180, reverb: 0.25, pump: 0.25, eqLow: -4 });
        Object.assign(c.track('keys'), { volume: 0.7 });
        fx(c.track('hook'), { hpCut: 300, delay: 0.3, reverb: 0.2, pump: 0.2 });
        Object.assign(c.track('hook'), { volume: 0.6 });
        fx(p.chords, { hpCut: 150, reverb: 0.35, pump: 0.5 });
        p.chords.volume = 0.4;
        fx(p.drums, { comp: 0.3, reverb: 0.05 });
        Object.assign(p.fxBus, { delaySteps: 3, delayFeedback: 0.35, reverbSize: 2.2 });
      },
      check: (p, c) => c.track('bass').fx.pump > 0 || c.track('keys').fx.hpCut > 11 },
    { id: 'build', title: 'The build-up', where: { tab: 'compose', role: 'build', scroll: 'drums' },
      text: [
        'House builds are short, typically 4 bars:',
        '• A **snare roll** that speeds up: quarters, 8ths, 16ths.',
        '• A **riser** underneath for the whole 4 bars.',
        '• A **gap** on the last beat before the drop.',
        'The **Impact** pattern (boom and crash) marks the first beat of the drop.',
      ],
      do: (p, c) => { buildUp(p, c, 4, 4); drums(p, c, 'impact', { impact: 'X' + '.'.repeat(63), cymbal: 'X' + '.'.repeat(63) }); },
      check: (p, c) => hasDrums(c, 'build', ['snare', 'riser', 'clap']) },
    { id: 'arrange', title: 'Arrange the track', where: { tab: 'arrange' },
      get text() { return arrangeText(house, ['House arrangements are **groove-led**: build the groove up layer by layer, take the drums away for a break, bring it all back with the hook.']); },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 10 },
    { id: 'automate', title: 'Automation: filter house', where: { tab: 'arrange' },
      text: [
        'The **filter sweep** is house music’s signature move:',
        '• **Bass filter** opening through the Groove section: the bassline “emerges”.',
        '• **Piano low-pass** closed at the start of the Break, opening into the Drop.',
        '• **Drums high-pass** over the 4 bars before each break.',
        'In Arrange use **+ Automate…**, or Record plus the Filter knob on a Launchkey.',
      ],
      do: (p, c) => {
        const S = sectionStarts(c.G);
        const bass = c.track('bass').id, keys = c.track('keys').id;
        lane(p, `${bass}|cutoff`, [[S.Groove, 0.3], [S.Verse, 1]]);
        lane(p, `${keys}|cutoff`, [[S.Verse, 0.55], [S.Verse + 16, 1], [S.Break, 0.35], [S.Drop - 0.25, 0.95], [S.Drop, 1]]);
        lane(p, 'drums|hpCut', [[0, 0], ...drumSweep(S.Break), ...drumSweep(S['Break 2'])]);
      },
      check: p => p.song.auto.some(l => l.points.length >= 2) },
    finishStep,
  ],
};

// ---------- DRUM & BASS ----------
const dnb = {
  id: 'dnb', name: 'Drum & Bass', bpm: 174, root: 5, scale: 'minor', swing: 0,
  blurb: 'Fast breakbeats at 174 BPM over half-speed harmony: the two-step drum pattern, a deep sub with a moving reese, pads and keys.',
  lanes: [
    { name: 'Drums', roles: ['drums'] }, { name: 'Hats', roles: ['hats'] }, { name: 'Ghosts', roles: ['ghosts'] }, { name: 'Sub', roles: ['sub'] },
    { name: 'Reese', roles: ['reese'] }, { name: 'Pad', roles: ['pad'] }, { name: 'Keys', roles: ['keys'] }, { name: 'FX', roles: ['build', 'impact'] },
  ],
  patterns: [['drums', 'Two-step', 4], ['hats', 'Hats', 4], ['ghosts', 'Ghost notes', 4], ['sub', 'Sub bass', 8], ['reese', 'Reese', 8],
    ['pad', 'Pad chords', 8], ['keys', 'Keys', 8], ['build', 'Build-up', 8], ['impact', 'Impact', 4]],
  tracks: [['sub', 'Sub', 'dnb_sub', 1], ['reese', 'Reese', 'dnb_reese', 2], ['keys', 'Keys', 'dnb_pluck', 4]],
  chordsPatch: ['dnb_pad', 3],
  patches: {
    dnb_sub: synth('Sub', { wave: 'sine', attack: 0.004, decay: 0.3, sustain: 0.8, release: 0.12, cutoff: 400, volume: 1 }),
    dnb_reese: synth('Reese', { wave: 'sawtooth', wave2: 'sawtooth', mix2: 0.5, detune: 30, unison: 3, attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.15, cutoff: 650, resonance: 5, filterEnv: 300, volume: 0.6 }),
    dnb_pad: synth('Liquid Pad', { wave: 'triangle', wave2: 'sawtooth', mix2: 0.3, detune: 12, unison: 3, attack: 0.5, decay: 1, sustain: 0.8, release: 1.5, cutoff: 1500, volume: 0.42 }),
    dnb_pluck: synth('Liquid Keys', { wave: 'triangle', wave2: 'square', mix2: 0.25, octave2: 1, attack: 0.003, decay: 0.3, sustain: 0.1, release: 0.3, cutoff: 3200, filterEnv: 1500, volume: 0.6 }),
  },
  drumParams: { kick: { tune: 55, decay: 0.3, punch: 3.5, click: 0.6 }, snare: { tune: 200, decay: 0.22, snappy: 1.1 }, chat: { decay: 0.04, tone: 8500 }, ohat: { decay: 0.2, tone: 8000 } },
  sections: [
    { name: 'Intro', bars: 32, layers: ['pad', 'keys@16', 'hats@16'], note: 'pads set the mood, then keys and hats. No drums yet.' },
    { name: 'Build', bars: 16, layers: ['pad', 'keys', 'hats', 'ghosts@8'], build: 8, note: 'percussion creeps in, snare roll and riser.' },
    { name: 'Drop', bars: 64, layers: ['drums', 'hats', 'ghosts', 'sub', 'reese', 'pad@32', 'keys@32'], impact: true, note: 'drums and bass alone for 32 bars, then pad and keys return on top.' },
    { name: 'Breakdown', bars: 32, layers: ['pad', 'keys'], build: 8, note: 'everything stops but the music. A second build.' },
    { name: 'Drop 2', bars: 64, layers: ['drums', 'hats', 'ghosts', 'sub', 'reese', 'pad', 'keys'], impact: true, note: 'the full track.' },
    { name: 'Outro', bars: 48, layers: ['drums@0-32', 'hats', 'pad', 'sub@0-16'], note: 'bass leaves, then the drums, ending on pad and hats.' },
  ],
  steps: [
    { id: 'setup', title: 'Tempo, key and the plan', where: { tab: 'compose', role: 'drums' },
      text: [
        '**Drum & bass** runs at **170–176 BPM**; this project is at 174, in **F minor**.',
        'The secret of DnB: the **drums are fast, the music is slow**. Drums play 174 BPM, but chords, pads and bass move at half speed (87 BPM feel), with one chord every 2 bars. That contrast is the genre.',
        'The project has one **pattern per element**. While you work, **Play** loops them all together as a work loop so every new part is heard in context.',
        'Follow the steps in order. Do each yourself, or press **Do it for me** and then change what it wrote.',
      ],
      check: () => true },
    { id: 'kick', title: 'The two-step', where: { tab: 'compose', role: 'drums', scroll: 'drums' },
      text: [
        'The core DnB beat is the **two-step**, not four-on-the-floor:',
        '• **Kick** on beat 1 (step 1) and on the “and” of beat 3 (step 11).',
        '• **Snare** on beats 2 and 4 (steps 5 and 13), accented. The snare is the loudest thing in DnB.',
        '• In bar 4, add an extra kick or snare near the end as a fill.',
        'Make the snare crack: Sound Design → Drums → Snare, raise Snappy and Tune.',
      ],
      do: (p, c) => drums(p, c, 'drums', {
        kick: 'X.........X..... X.........X..... X.........X..... X.........X..x..',
        snare: '....X.......X... ....X.......X... ....X.......X... ....X.......X..x',
      }),
      check: (p, c) => hasDrums(c, 'drums', ['kick']) && hasDrums(c, 'drums', ['snare']) },
    { id: 'hats', title: 'Hats and shaker', where: { tab: 'compose', role: 'hats', scroll: 'drums' },
      text: [
        'Fast hats supply the **speed** that the sparse kick and snare leave out:',
        '• Closed hats on every 8th.',
        '• A soft shaker on the 16ths in between, so together they run constantly.',
        '• An open hat once every other bar for air.',
      ],
      do: (p, c) => drums(p, c, 'hats', {
        chat: 'x.x.x.x.x.x.x.x.', shaker: '.x.x.x.x.x.x.x.x',
        ohat: '................ ......x......... ................ ......x.......x.',
      }),
      check: (p, c) => hasDrums(c, 'hats', ['chat', 'ohat', 'shaker', 'ride']) },
    { id: 'perc', title: 'Ghost notes', where: { tab: 'compose', role: 'ghosts', scroll: 'drums' },
      text: [
        '**Ghost notes** are quiet hits between the main snares. They turn a stiff two-step into a rolling **breakbeat**.',
        '• Put soft rimshots just before and after the “and” of beat 2 (steps 8 and 10).',
        '• Add one or two more at the end of bar 4.',
        '• They must be quiet: if you notice them as hits, turn the row down.',
      ],
      do: (p, c) => drums(p, c, 'ghosts', {
        rim: '.......x.x...... .......x.x...... .......x.x...... .......x.x...x.x',
        htom: '................ ................ ................ ..............x.',
      }),
      check: (p, c) => hasDrums(c, 'ghosts', ['rim', 'ltom', 'mtom', 'htom', 'snare']) },
    { id: 'chords', title: 'Chords and pad', where: { tab: 'compose', role: 'pad', scroll: 'chords' },
      text: [
        'Liquid DnB harmony is slow and warm: **four minor-key chords, 2 bars each**.',
        '• Set chord length to **2 bars** and fill four slots. This project uses **i – VI – iv – VII** (Fm – D♭ – B♭m – E♭).',
        '• Try the **7th** or **add9** chord type for a jazzier, more “liquid” colour.',
        'The Pad pattern plays them. They are copied to the other patterns as a **silent guide** for the bass and keys.',
      ],
      do: (p, c) => setChords(p, c, [0, 5, 3, 6], 32, 'triad', ['pad']),
      check: (p, c) => hasChords(c, 'pad') },
    { id: 'bass', title: 'The sub', where: { tab: 'compose', role: 'sub', scroll: 'tracks', track: 'sub' },
      text: [
        'DnB bass has two layers. First the **sub**: a pure sine at **octave 1** that you feel more than hear.',
        '• Long notes on the **root of each chord** (the teal row tagged **R**).',
        '• Start a note with each kick: on step 1, and again on step 11.',
        '• Leave a short gap before each new note so it re-triggers cleanly.',
        'Keep the sub simple and exactly on the roots. All the character comes from the next layer.',
      ],
      do: (p, c) => {
        const v = c.view('sub'), out = [];
        for (let bar = 0; bar < v.bars; bar++) {
          const ch = chordAt(v, bar * 16);
          const r = fold(ch.semis[0]);
          out.push({ step: bar * 16, len: 9, semis: r, vel: 0.95 }, { step: bar * 16 + 10, len: bar % 2 ? 3 : 5, semis: r, vel: 0.9 });
          const fifth = r + (ch.semis[2] - ch.semis[0]);
          if (bar % 2) out.push({ step: bar * 16 + 14, len: 2, semis: fifth > 7 ? fifth - 12 : fifth, vel: 0.8 }); // pickup on the 5th, kept in the sub's octave
        }
        abstractNotes(p, c, 'sub', 'sub', out);
      },
      check: (p, c) => hasNotes(c, 'sub', 'sub') },
    { id: 'reese', title: 'The reese', where: { tab: 'compose', role: 'reese', scroll: 'tracks', track: 'reese' },
      text: [
        'The **reese** is the growling mid-bass: detuned saws beating against each other, through a low-pass filter that **moves**.',
        '• Hold the chord’s **root** an octave above the sub, as long notes following the same rhythm.',
        '• The movement is automation: at the bottom of this pattern there is a lane for the reese’s **Low-pass**. Draw a slow wave (Shift+drag) so the growl opens and closes.',
        '• Sound Design: two saws, Detune ~30 cents, a few Unison voices.',
      ],
      do: (p, c) => {
        const v = c.view('reese'), out = [];
        for (let bar = 0; bar < v.bars; bar += 2) {
          const r = fold(chordAt(v, bar * 16).semis[0]);
          out.push({ step: bar * 16, len: 10, semis: r, vel: 0.85 }, { step: bar * 16 + 10, len: 20, semis: r, vel: 0.9 }, { step: bar * 16 + 30, len: 2, semis: r + 12, vel: 0.7 });
        }
        abstractNotes(p, c, 'reese', 'reese', out);
        const pts = [];
        for (let bar = 0; bar <= v.bars; bar++) pts.push({ step: bar * 16, value: bar % 2 ? 0.52 : 0.3 });
        c.pat('reese').auto = [{ id: uid('a'), target: `${c.track('reese').id}|cutoff`, points: pts }];
      },
      check: (p, c) => hasNotes(c, 'reese', 'reese') },
    { id: 'hook', title: 'Keys', where: { tab: 'compose', role: 'keys', scroll: 'tracks', track: 'keys' },
      text: [
        'On top, a simple **keys part** outlines the chords at half speed:',
        '• Play the chord notes one at a time as 8ths: root, 5th, 3rd above, 5th…',
        '• Leave the last couple of 8ths of every second bar empty: the gap lets the drums speak.',
        '• Reverb and delay turn this into a wash behind the drums.',
        'For a lead melody instead, write long notes on chord notes (teal rows): at this tempo, a note per beat already feels busy.',
      ],
      do: (p, c) => abstractNotes(p, c, 'keys', 'keys', arp(c.view('keys'), { rate: 2, len: 2, shape: [0, 2, 4, 2, 3, 2, 4, 2], vels: [0.9, 0.65, 0.8, 0.65], skip: s => s % 32 >= 28 })),
      check: (p, c) => hasNotes(c, 'keys', 'keys') },
    { id: 'mix', title: 'Mix: snare and sub', where: { tab: 'mix' },
      text: mixText([
        '• DnB specific: the **snare and the sub** are the two loudest things. Everything else fits around them.',
        '• **High-pass the reese** around 90 Hz so it never fights the sub, and add a little Drive to it.',
        '• Compress the drum group fairly hard: DnB drums should sound like one instrument.',
      ]),
      do: (p, c) => {
        fx(c.track('sub'), { eqHigh: -8, cutoff: 300 });
        Object.assign(c.track('sub'), { volume: 0.9 });
        fx(c.track('reese'), { hpCut: 90, drive: 0.2, pump: 0.25, reso: 0.2 });
        Object.assign(c.track('reese'), { volume: 0.55 });
        fx(c.track('keys'), { hpCut: 300, delay: 0.3, reverb: 0.32 });
        Object.assign(c.track('keys'), { volume: 0.55 });
        fx(p.chords, { hpCut: 180, reverb: 0.45, pump: 0.35 });
        p.chords.volume = 0.45;
        fx(p.drums, { comp: 0.4, reverb: 0.05 });
        Object.assign(p.fxBus, { delaySteps: 6, delayFeedback: 0.35, reverbSize: 3.2 });
      },
      check: (p, c) => c.track('reese').fx.hpCut > 11 || p.drums.fx.comp > 0 },
    { id: 'build', title: 'The build-up', where: { tab: 'compose', role: 'build', scroll: 'drums' },
      text: [
        'An 8-bar build before each drop:',
        '• A **snare roll** that doubles in speed: quarters, 8ths, 16ths.',
        '• A **riser** over the last 4 bars.',
        '• A **gap** on the last beat: one beat of near silence, then the drop.',
        'The **Impact** pattern (boom and crash) marks the first beat of each drop.',
      ],
      do: (p, c) => { buildUp(p, c, 8, 4); drums(p, c, 'impact', { impact: 'X' + '.'.repeat(63), cymbal: 'X' + '.'.repeat(63) }); },
      check: (p, c) => hasDrums(c, 'build', ['snare', 'riser', 'clap']) },
    { id: 'arrange', title: 'Arrange the track', where: { tab: 'arrange' },
      get text() { return arrangeText(dnb, ['DnB has a **long musical intro with no drums**, then a drop where the beat and bass arrive together. Drops are long (64 bars) and change halfway.']); },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 10 },
    { id: 'automate', title: 'Automation', where: { tab: 'arrange' },
      text: [
        'Song-wide moves on top of the reese’s own filter wave:',
        '• **Pad filter** opening slowly through the intro.',
        '• **Keys volume** fading in.',
        '• **Drums high-pass** over the 4 bars before the breakdown, so the drop’s energy drains away rather than stopping dead.',
        'In Arrange use **+ Automate…**, or Record plus a Launchkey knob.',
      ],
      do: (p, c) => {
        const S = sectionStarts(c.G);
        const keys = c.track('keys').id;
        lane(p, 'chords|cutoff', [[0, 0.4], [S.Build, 0.7], [S.Drop, 1]]);
        lane(p, `${keys}|volume`, [[S.Intro + 16, 0.15], [S.Build, 0.45], [S.Build + 16, 0.46]]);
        lane(p, 'drums|hpCut', [[0, 0], ...drumSweep(S.Breakdown), ...drumSweep(S.Outro + 32)]);
      },
      check: p => p.song.auto.some(l => l.points.length >= 2) },
    finishStep,
  ],
};

// ---------- PSYTRANCE ----------
// The rolling "K-B-B-B" bass: a short bass note on the three 16ths after every kick, in E Phrygian.
// Bar 4 ends on the Phrygian ♭2 (F), the note that gives psy its dark, eastern pull.
const PSY_ACID = [ // [step, length, degree, accent]; a length that overlaps the next note = slide
  [[0, 1, 0, 1], [1, 1, 7], [2, 1, 0], [3, 2, 1, 1], [4, 1, 0], [6, 1, 7, 1], [7, 1, 0], [8, 2, 3], [9, 1, 1], [10, 1, 0, 1], [12, 1, 7], [13, 1, 6], [14, 2, 1, 1], [15, 1, 0]],
  [[0, 1, 0, 1], [1, 1, 0], [2, 2, 7, 1], [3, 1, 8], [4, 1, 7], [6, 1, 0], [7, 1, 1, 1], [8, 1, 0], [10, 1, 3], [11, 2, 4, 1], [12, 1, 5], [13, 1, 4], [14, 1, 1, 1], [15, 1, 0]],
];
const PSY_LEAD = [ // 16ths; null = rest. Two-bar call and answer, then variations climbing higher.
  [7, null, 8, 7, null, 5, 7, null, 8, null, 7, null, 10, 8, 7, 5],
  [7, null, 8, 7, null, 5, 7, null, 8, null, 7, null, 4, 5, 7, 8],
  [7, null, 8, 7, null, 5, 7, null, 8, null, 7, null, 10, 8, 7, 5],
  [7, null, 8, 7, null, 5, 7, null, 8, null, 10, null, 11, 10, 8, 7],
  [10, null, 11, 10, null, 8, 10, null, 11, null, 10, null, 12, 11, 10, 8],
  [10, null, 11, 10, null, 8, 10, null, 11, null, 10, null, 8, 7, 8, 10],
  [12, null, 11, 10, null, 8, 10, null, 11, null, 10, null, 12, 11, 10, 8],
  [7, null, 8, 7, null, 5, 7, null, 8, 10, 11, 12, 14, 12, 11, 8],
];

const psy = {
  id: 'psy', name: 'Psytrance', bpm: 145, root: 4, scale: 'phrygian', swing: 0,
  blurb: 'Hypnotic and relentless. A short kick with a rolling bass in the gaps, squelchy acid, zapping FM leads full of delay, all in a dark Phrygian key.',
  lanes: [
    { name: 'Kick', roles: ['kick'] }, { name: 'Bass', roles: ['bass'] }, { name: 'Hats', roles: ['hats'] }, { name: 'Percussion', roles: ['perc'] },
    { name: 'Acid', roles: ['acid'] }, { name: 'Lead', roles: ['lead'] }, { name: 'Pad', roles: ['pad'] }, { name: 'FX', roles: ['build', 'impact'] },
  ],
  patterns: [['kick', 'Kick', 4], ['bass', 'Rolling bass', 4], ['hats', 'Hats', 4], ['perc', 'Percussion', 4], ['acid', 'Acid line', 4],
    ['lead', 'FM lead', 8], ['pad', 'Atmos pad', 8], ['build', 'Build-up', 8], ['impact', 'Impact', 4]],
  tracks: [['bass', 'Bass', 'psy_bass', 1], ['acid', 'Acid', 'psy_acid', 2], ['lead', 'Lead', 'psy_lead', 4]],
  chordsPatch: ['psy_pad', 3],
  patches: {
    psy_bass: synth('Psy Bass', { wave: 'sawtooth', wave2: 'sine', mix2: 0.5, attack: 0.001, decay: 0.09, sustain: 0, release: 0.03, cutoff: 320, resonance: 3,
      filterEnv: 1100, filterDecay: 0.06, volume: 0.95 }),
    psy_acid: synth('Psy Acid', { wave: 'sawtooth', mono: true, glide: 0.05, attack: 0.002, decay: 0.35, sustain: 0.5, release: 0.04,
      cutoff: 420, resonance: 12, filterSlope: 24, filterEnv: 3000, filterDecay: 0.18, velToFilter: 0.75, volume: 0.4 }),
    psy_lead: synth('FM Zap Lead', { wave: 'sine', fm: 4, fmRatio: 2, fmDecay: 0.12, attack: 0.002, decay: 0.16, sustain: 0.25, release: 0.12,
      cutoff: 7000, resonance: 1.5, filterEnv: 2500, volume: 0.6 }),
    psy_pad: synth('Psy Atmos', { wave: 'sawtooth', wave2: 'triangle', mix2: 0.5, detune: 20, unison: 3, attack: 0.6, decay: 1.2, sustain: 0.75, release: 1.6,
      cutoff: 1800, resonance: 1, volume: 0.4 }),
  },
  drumParams: { kick: { tune: 48, decay: 0.28, punch: 5, click: 0.8 }, chat: { decay: 0.035, tone: 9000 }, ohat: { decay: 0.2, tone: 8500 }, ride: { decay: 0.5, tone: 7000 } },
  sections: [
    { name: 'Intro', bars: 32, layers: ['kick', 'hats@8', 'bass@16', 'perc@24'], note: 'kick, hats, then the rolling bass: a DJ can mix it in.' },
    { name: 'Groove', bars: 32, layers: ['kick', 'bass', 'hats', 'perc', 'acid@16'], note: 'the full groove; the acid creeps in with its filter closed.' },
    { name: 'Main', bars: 32, layers: ['kick', 'bass', 'hats', 'perc', 'acid', 'lead@16'], note: 'the FM lead arrives for the last 16 bars.' },
    { name: 'Breakdown', bars: 32, layers: ['pad', 'lead@16'], impact: true, build: 8, note: 'everything drops away (downlifter). Pad chords, then the lead alone, then the build.' },
    { name: 'Drop', bars: 64, layers: ['kick', 'bass', 'hats', 'perc', 'acid', 'lead', 'pad@32'], impact: true, note: 'the peak: every layer, filters opening, pad on top for the second half.' },
    { name: 'Break 2', bars: 16, layers: ['pad', 'acid@0-8'], build: 8, note: 'a short breath and a second build.' },
    { name: 'Drop 2', bars: 32, layers: ['kick', 'bass', 'hats', 'perc', 'acid', 'lead'], impact: true, note: 'once more, full power.' },
    { name: 'Outro', bars: 16, layers: ['kick', 'bass@0-8', 'hats'], note: 'down to kick and hats for the mix-out.' },
  ],
  steps: [
    { id: 'setup', title: 'Tempo, key and the plan', where: { tab: 'compose', role: 'kick' },
      text: [
        '**Psytrance** runs at **140–148 BPM** (full-on psy around 145; progressive psy slower, 136–140). This project is at 145, in **E Phrygian**.',
        '**Phrygian** is minor with a **♭2**: the note just above home (F over E). That half step is the dark, eastern sound of psy. E and F♯ are the classic keys because their bass notes hit the club’s sweet spot.',
        'Psy is built on one thing: the **kick and the rolling bass**, locked together and never touching. Everything else is ear candy that comes and goes on top of that groove, with lots of delay.',
        'The project has one **pattern per element**. While you work, **Play** loops them all together as a work loop. Follow the steps in order, or press **Do it for me** and then change what it wrote.',
      ],
      check: () => true },
    { id: 'kick', title: 'The kick', where: { tab: 'compose', role: 'kick', scroll: 'drums' },
      text: [
        'A kick on every beat, and it must be **short**: the bass plays in the gaps right after it, so the kick’s tail has to be gone within one 16th.',
        '• Put a kick on steps 1, 5, 9, 13.',
        '• Sound Design → Drums → Kick: **short Decay** (~0.3 s), high **Punch**, plenty of **Click** so it cuts through the bass.',
        '• Tune it to the key if you can: around E (41 Hz) or a 5th above.',
      ],
      do: (p, c) => drums(p, c, 'kick', { kick: 'X...X...X...X...' }),
      check: (p, c) => hasDrums(c, 'kick', ['kick']) },
    { id: 'bass', title: 'The rolling bass', where: { tab: 'compose', role: 'bass', scroll: 'tracks', track: 'bass' },
      text: [
        'The heart of psytrance: **K-B-B-B**. The kick on the beat, then three short bass notes on the next three 16ths, every beat, all track long.',
        '• In the Bass track, put very short **1**s on steps 2, 3, 4 of every beat (never on the beat itself).',
        '• Accent the middle one of each three slightly: it makes the bass “roll”.',
        '• Keep it on the home note. At the end of bar 4, one note up a half step (**♭2**) and back gives a dark twist.',
        '• The sound: a saw with a very fast filter envelope and no sustain, plus a sine for weight. Each note is a tiny “dut”.',
        'Because kick and bass never overlap, psy needs **no sidechain pump**: the space is built into the rhythm.',
      ],
      do: (p, c) => {
        const out = [];
        for (let s = 0; s < 64; s++) if (s % 4) out.push([s, 1, 0, s % 4 === 2 ? 0.95 : 0.78]);
        out.splice(-3, 3, [61, 1, 1, 0.9], [62, 1, 0, 0.95], [63, 1, 1, 0.85]);
        notes(c, 'bass', 'bass', out);
      },
      check: (p, c) => hasNotes(c, 'bass', 'bass') },
    { id: 'hats', title: 'Hats', where: { tab: 'compose', role: 'hats', scroll: 'drums' },
      text: [
        '• **Open hat on every off-beat**, between the kicks.',
        '• **Closed hats** on the 16ths around it, very short and bright.',
        '• A **clap** on beats 2 and 4, kept quiet. Many psy tracks leave it out entirely and let the bass carry the rhythm.',
      ],
      do: (p, c) => drums(p, c, 'hats', { ohat: '..X...X...X...X.', chat: 'xx.xxx.xxx.xxx.x', clap: '....x.......x...' }),
      check: (p, c) => hasDrums(c, 'hats', ['ohat', 'chat', 'clap']) },
    { id: 'perc', title: 'Percussion and ride', where: { tab: 'compose', role: 'perc', scroll: 'drums' },
      text: [
        'Psy percussion is busy but quiet: lots of small sounds that keep the ear moving.',
        '• A **ride** on 8ths for drive.',
        '• **Rimshots** and **toms** on syncopated 16ths, varying over 4 bars.',
        '• A soft **shaker** on 16ths.',
        'Keep it all well below the kick and bass. If you can hear a percussion part clearly on its own, it’s too loud.',
      ],
      do: (p, c) => drums(p, c, 'perc', {
        ride: 'x.x.x.x.x.x.x.x.',
        rim: '...x..x....x..x. ...x..x....x..x. ...x..x....x..x. ...x..x..x.x.xx.',
        htom: '................ ..........x..... ................ ......x.....x...',
        shaker: 'xxxxxxxxxxxxxxxx',
      }),
      check: (p, c) => hasDrums(c, 'perc', ['ride', 'rim', 'htom', 'shaker']) },
    { id: 'acid', title: 'The acid line', where: { tab: 'compose', role: 'acid', scroll: 'tracks', track: 'acid' },
      text: [
        'A 303-style line is a psy staple. Same recipe as acid techno, but in Phrygian, so the **♭2** (one row above **1**) gets used a lot.',
        '• 16th notes, mostly the home note, jumps up an octave, and the ♭2.',
        '• **Slides**: stretch a note so it overlaps the next one and it glides into it.',
        '• **Accents**: louder notes (Alt+scroll on a note) open the filter further.',
        'The squelch comes from riding the synth’s **Cutoff** and **Resonance**: Shift + knobs 2 and 3 on a Launchkey, or automation later.',
      ],
      do: (p, c) => notes(c, 'acid', 'acid', [0, 1, 0, 1].flatMap((v, b) => PSY_ACID[v].map(([s, len, d, acc]) => [b * 16 + s, len, d, acc ? 1 : 0.72]))),
      check: (p, c) => hasNotes(c, 'acid', 'acid') },
    { id: 'chords', title: 'Harmony: drone and a dark turn', where: { tab: 'compose', role: 'pad', scroll: 'chords' },
      text: [
        'Most of a psy track sits on **one chord**: the home minor chord, droned by the bass. The harmony shows up in the **breakdown**, on a pad.',
        '• In the Pad pattern (chord length 2 bars) try **i – II – VI – II**: Em – F – C – F. The move from i up a half step to II is the most Phrygian sound there is.',
        '• Every other pattern gets the home chord as a silent guide, so the rolls show which notes fit.',
        '• For a chopped, rhythmic pad, set the chord style to **Gated 16ths** (and give the pad a fast attack).',
      ],
      do: (p, c) => {
        for (const pat of p.patterns) {
          const isPad = pat.id === c.pat('pad').id;
          const degs = isPad ? [0, 1, 5, 1] : [0];
          const slotSteps = isPad ? 32 : 16;
          const n = Math.ceil(pat.bars * STEPS_PER_BAR / slotSteps);
          pat.chordSlots = Array.from({ length: n }, (_, i) => ({ deg: degs[i % degs.length], type: 'triad' }));
          pat.slotSteps = slotSteps;
          pat.chordsGuide = !isPad;
        }
      },
      check: (p, c) => hasChords(c, 'pad') },
    { id: 'hook', title: 'The FM lead', where: { tab: 'compose', role: 'lead', scroll: 'tracks', track: 'lead' },
      text: [
        'Psy leads are **riffs**, not songs: a short 16th-note phrase that repeats and mutates.',
        '• Write a 1-bar phrase on the upper notes (**1, ♭2, ♭3, 5** above the home note), with gaps.',
        '• Bar 2 **answers** it with a different ending. Then repeat that pair, and move it higher for the second half.',
        '• The sound is **FM**: a sine whose pitch is wobbled by a hidden second wave (Sound Design → FM amount / ratio / decay). A short **FM decay** gives the classic “zap”.',
        '• **Delay** is part of the sound: a dotted-8th echo turns a sparse riff into a rolling cascade.',
      ],
      do: (p, c) => {
        notes(c, 'lead', 'lead', PSY_LEAD.flatMap((bar, b) => bar.flatMap((d, s) => (d == null ? [] : [[b * 16 + s, 1, d, s % 4 === 0 ? 0.95 : 0.75]]))));
        // a filter wave over every 2 bars: the riff breathes
        const pts = [];
        for (let bar = 0; bar <= 8; bar += 1) pts.push({ step: bar * 16, value: bar % 2 ? 0.78 : 0.6 });
        c.pat('lead').auto = [{ id: uid('a'), target: `${c.track('lead').id}|synthCutoff`, points: pts }];
      },
      check: (p, c) => hasNotes(c, 'lead', 'lead') },
    { id: 'mix', title: 'Mix: tight low end, wide top', where: { tab: 'mix' },
      text: mixText([
        '• Psy specific: **no pump on the bass**. Kick and bass already take turns. Instead, high-pass **everything** else hard (200–300 Hz) so the low end is only kick and bass.',
        '• Big **dotted-8th delay** with high feedback on the lead; a little on the acid.',
        '• **Drive** and **Compress** on the acid; a touch of compression on the drum group.',
      ]),
      do: (p, c) => {
        fx(c.track('bass'), { eqLow: 2, eqHigh: -2, pump: 0 });
        Object.assign(c.track('bass'), { volume: 1.1 });
        fx(c.track('acid'), { hpCut: 150, drive: 0.4, comp: 0.35, delay: 0.2, reverb: 0.08 });
        Object.assign(c.track('acid'), { volume: 0.5 });
        fx(c.track('lead'), { hpCut: 300, delay: 0.45, reverb: 0.25, comp: 0.2 });
        Object.assign(c.track('lead'), { volume: 0.36 });
        fx(p.chords, { hpCut: 220, reverb: 0.5, pump: 0.35 });
        p.chords.volume = 0.42;
        fx(p.drums, { comp: 0.3, reverb: 0.03 });
        Object.assign(p.fxBus, { delaySteps: 3, delayFeedback: 0.52, reverbSize: 3 });
      },
      check: (p, c) => c.track('lead').fx.delay > 0 || c.track('acid').fx.hpCut > 11 },
    { id: 'build', title: 'Build-ups, impacts and downlifters', where: { tab: 'compose', role: 'build', scroll: 'drums' },
      text: [
        'Psy transitions are dramatic:',
        '• **Build-up** (8 bars): a snare roll that doubles in speed, with a **riser** over the last 4 bars and a gap before the drop.',
        '• **Impact** on the first beat of a drop: a boom and a crash.',
        '• **Downlifter** at the start of a breakdown: a noise sweep falling away, the sound of the energy draining out. It shares the Impact pattern.',
      ],
      do: (p, c) => {
        buildUp(p, c, 8, 4);
        drums(p, c, 'impact', { impact: 'X' + '.'.repeat(63), cymbal: 'X' + '.'.repeat(63), downer: 'X' + '.'.repeat(63) });
        p.drumParams.downer.length = Math.round(4 * 4 * 60 / p.bpm * 100) / 100;
      },
      check: (p, c) => hasDrums(c, 'build', ['snare', 'riser', 'clap']) },
    { id: 'arrange', title: 'Arrange the track', where: { tab: 'arrange' },
      get text() { return arrangeText(psy, ['Psy tracks are long (7–9 minutes) and **DJ-friendly**: long intros and outros with just kick, bass and hats, elements entering every 8–16 bars, and one big breakdown.']); },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 10 },
    { id: 'automate', title: 'Automation: constant motion', where: { tab: 'arrange' },
      text: [
        'In psy, something should always be moving:',
        '• **Bass filter**: closed when the bass enters, opening over the intro.',
        '• **Acid**: the synth’s **Cutoff** and **Resonance** rising through each section and peaking before the drops.',
        '• **Lead delay** up in the breakdown so the riff smears into a cloud.',
        '• **Drums high-pass** over the 4 bars before each breakdown.',
        'In Arrange use **+ Automate…**, or Record plus a Launchkey knob.',
      ],
      do: (p, c) => {
        const S = sectionStarts(c.G);
        const bass = c.track('bass').id, acid = c.track('acid').id, lead = c.track('lead').id;
        lane(p, `${bass}|synthCutoff`, [[S.Intro + 16, 0.28], [S.Groove, 0.42], [S.Drop, 0.46]]);
        lane(p, `${acid}|synthCutoff`, [[S.Groove + 16, 0.25], [S.Main, 0.4], [S.Breakdown, 0.5], [S.Drop, 0.42], [S.Drop + 32, 0.7], [S['Break 2'], 0.4], [S['Drop 2'] - 0.25, 0.75], [S['Drop 2'], 0.55]]);
        lane(p, `${acid}|synthReso`, [[S.Groove + 16, 0.5], [S.Drop + 32, 0.75], [S['Break 2'], 0.55]]);
        lane(p, `${lead}|delay`, [[S.Main, 0.45], [S.Breakdown + 16, 0.7], [S.Drop, 0.45]]);
        lane(p, 'drums|hpCut', [[0, 0], ...drumSweep(S.Breakdown), ...drumSweep(S['Break 2'])]);
      },
      check: p => p.song.auto.some(l => l.points.length >= 2) },
    finishStep,
  ],
};

// ---------- SAD INSTRUMENTAL (song form, acoustic instruments) ----------
// A piano-led piece in D major that leans on its minor chords: verse vi–IV–I–V, chorus IV–V–iii–vi,
// a bridge that borrows chords from D minor, and a last chorus lifted a whole tone.
const BALLAD_VERSE = [
  [[0, 6, 5], [6, 2, 4], [8, 8, 2]], [[0, 4, 3], [4, 4, 4], [8, 8, 5]], [[0, 6, 4], [6, 2, 2], [8, 8, 0]], [[0, 8, 1], [8, 8, -1]],
  [[0, 6, 5], [6, 2, 4], [8, 8, 2]], [[0, 4, 3], [4, 4, 4], [8, 4, 5], [12, 4, 7]], [[0, 8, 4], [8, 8, 2]], [[0, 12, 1], [12, 4, -1]],
];
const BALLAD_CHORUS = [
  [[0, 8, 7], [8, 4, 5], [12, 4, 4]], [[0, 8, 8], [8, 8, 6]], [[0, 8, 9], [8, 4, 8], [12, 4, 6]], [[0, 12, 7], [12, 4, 5]],
  [[0, 6, 5], [6, 2, 6], [8, 8, 7]], [[0, 8, 8], [8, 8, 6]], [[0, 8, 6], [8, 8, 4]], [[0, 16, 5]],
];
const BALLAD_BRIDGE = [ // in D minor
  [[0, 8, 5], [8, 8, 3]], [[0, 8, 7], [8, 8, 5]], [[0, 8, 6], [8, 8, 3]], [[0, 8, 4], [8, 8, 1]],
  [[0, 8, 7], [8, 8, 5]], [[0, 8, 9], [8, 8, 7]], [[0, 8, 8], [8, 8, 6]], [[0, 16, 4]],
];
const barsToNotes = (bars, vel = 0.8) => bars.flatMap((bar, b) => bar.map(([s, len, d]) => [b * 16 + s, len, d, s === 0 ? vel + 0.08 : vel]));

// chord slots: degs, slot length, optional per-slot types
function slotsInto(pat, degs, slotSteps, types = null, guide = true) {
  const n = Math.ceil(pat.bars * STEPS_PER_BAR / slotSteps);
  pat.chordSlots = Array.from({ length: n }, (_, i) => ({ deg: degs[i % degs.length], type: types ? types[i % types.length] : 'triad' }));
  pat.slotSteps = slotSteps;
  pat.chordsGuide = guide;
}

const BALLAD_ARP = { rate: 2, len: 2, shape: [0, 1, 2, 3, 4, 3, 2, 1], vels: [0.72, 0.5, 0.56, 0.5] };

const ballad = {
  id: 'ballad', name: 'Sad instrumental', bpm: 72, root: 2, scale: 'major', swing: 0, lowNotes: 60,
  blurb: 'Bittersweet and slow. Piano, strings, cello and a singing lead: a major key that keeps falling onto its minor chords, a bridge that borrows from minor, and a final lift.',
  lanes: [
    { name: 'Piano, bass & melody', roles: ['intro', 'verse', 'chorus', 'bridge', 'outro'] },
    { name: 'Strings', roles: ['stringsV', 'stringsC', 'stringsB'] }, { name: 'Cello', roles: ['counter'] }, { name: 'Drums', roles: ['drums'] },
  ],
  patterns: [['intro', 'Intro', 8], ['verse', 'Verse', 8], ['chorus', 'Chorus', 8], ['bridge', 'Bridge', 8], ['outro', 'Outro', 8],
    ['stringsV', 'Strings: verse', 8], ['stringsC', 'Strings: chorus', 8], ['stringsB', 'Strings: bridge', 8], ['counter', 'Cello line', 8], ['drums', 'Soft drums', 4]],
  patternKeys: { bridge: { scale: 'minor' }, stringsB: { scale: 'minor' } },
  tracks: [['piano', 'Piano', 'piano', 3], ['melody', 'Melody', 'sad_lead', 4], ['bass', 'Bass', 'ebass', 2], ['cello', 'Cello', 'sad_cello', 3]],
  chordsPatch: ['sad_strings', 3],
  drumsVolume: 0.5,
  patches: {
    sad_strings: synth('Strings', { wave: 'sawtooth', wave2: 'sawtooth', mix2: 0.5, detune: 14, unison: 3, attack: 0.6, decay: 1, sustain: 0.85, release: 1.4,
      cutoff: 2400, resonance: 0.7, vibrato: 8, vibratoRate: 5, vibratoDelay: 0.4, volume: 0.36 }),
    sad_lead: synth('Violin-ish Lead', { wave: 'sawtooth', wave2: 'triangle', mix2: 0.3, detune: 4, attack: 0.12, decay: 0.4, sustain: 0.85, release: 0.5,
      cutoff: 3200, resonance: 1, filterEnv: 600, vibrato: 18, vibratoRate: 5.5, vibratoDelay: 0.25, volume: 0.42 }),
    sad_cello: synth('Cello-ish', { wave: 'sawtooth', wave2: 'triangle', mix2: 0.4, detune: 3, attack: 0.2, decay: 0.5, sustain: 0.9, release: 0.6,
      cutoff: 1600, resonance: 0.8, vibrato: 14, vibratoRate: 4.8, vibratoDelay: 0.35, volume: 0.5 }),
  },
  drumParams: { kick: { tune: 55, decay: 0.45, punch: 2, click: 0.15 } },
  workSections: [
    { name: 'Intro', bars: 8, layers: ['intro'] }, { name: 'Verse', bars: 8, layers: ['verse', 'stringsV'] },
    { name: 'Chorus', bars: 8, layers: ['chorus', 'stringsC', 'counter', 'drums'] }, { name: 'Bridge', bars: 8, layers: ['bridge', 'stringsB'] },
    { name: 'Outro', bars: 8, layers: ['outro'] },
  ],
  sections: [
    { name: 'Intro', bars: 8, layers: ['intro'], note: 'piano alone sets the mood.' },
    { name: 'Verse', bars: 16, layers: ['verse'], note: 'the melody enters, low and quiet. Piano, bass and melody only.' },
    { name: 'Chorus', bars: 16, layers: ['chorus', 'stringsC@8'], note: 'the melody climbs; strings swell in halfway.' },
    { name: 'Verse 2', bars: 16, layers: ['verse', 'stringsV', 'drums@8'], note: 'same tune, more around it: strings, then soft drums.' },
    { name: 'Chorus 2', bars: 16, layers: ['chorus', 'stringsC', 'counter', 'drums'], note: 'everything, with the cello answering the melody.' },
    { name: 'Bridge', bars: 8, layers: ['bridge', 'stringsB'], note: 'the floor drops: chords borrowed from D minor. Drums out.' },
    { name: 'Final chorus', bars: 16, layers: ['chorus', 'stringsC', 'counter', 'drums'], key: { root: 4, scale: 'major' }, note: 'the same chorus a whole tone higher (E major): the classic lift.' },
    { name: 'Outro', bars: 8, layers: ['outro'], key: { root: 4, scale: 'major' }, note: 'piano alone again, ending on the home chord.' },
  ],
  steps: [
    { id: 'setup', title: 'Tempo, key and the idea', where: { tab: 'arrange' },
      text: [
        'This guide makes a **slow, bittersweet instrumental**: piano, strings, a cello and a singing lead line. No drops, just a song.',
        '**72 BPM**, in **D major**. Why major for a sad piece? Pure minor sounds tragic; **bittersweet** comes from a major key that keeps landing on its **minor chords** (vi, iii). Hope and sadness at the same time.',
        'Unlike the dance guides, this one is built in **song form**: Intro, Verse, Chorus, Bridge, Outro, one pattern each (piano, bass and melody together), plus layers for strings, cello and drums.',
        'While you work, **Play** plays a short draft of the song in that order. Follow the steps, or press **Do it for me** and then change what it wrote.',
      ],
      check: () => true },
    { id: 'chords', title: 'The chords', where: { tab: 'compose', role: 'verse', scroll: 'chords' },
      text: [
        'Write the harmony first; everything else grows out of it. One chord per bar.',
        '• **Verse: vi – IV – I – V** (Bm – G – D – A). Starting on the minor vi chord makes the verse sound wistful; it only reaches home (I) in bar 3.',
        '• **Chorus: IV – V – iii – vi** (G – A – F♯m – Bm). It rises (IV, V) as if heading home, then **avoids** it and sinks to two minor chords. That denied resolution is the bittersweet feeling.',
        '• The Intro uses the verse chords; the Outro slows them down and finally **does** land on I.',
        'Click chord slots in the Verse and Chorus patterns and pick chords in the sidebar. They are silent guides there; the strings will play them later.',
      ],
      do: (p, c) => {
        for (const r of ['intro', 'verse', 'stringsV', 'drums']) slotsInto(c.pat(r), [5, 3, 0, 4], 16);
        for (const r of ['chorus', 'stringsC', 'counter']) slotsInto(c.pat(r), [3, 4, 2, 5], 16);
        slotsInto(c.pat('outro'), [5, 3, 0, 0], 32);
      },
      check: (p, c) => hasChords(c, 'verse') && hasChords(c, 'chorus') },
    { id: 'piano', title: 'Piano: broken chords', where: { tab: 'compose', role: 'verse', scroll: 'tracks', track: 'piano' },
      text: [
        'The piano carries the piece. Instead of block chords, play them **broken**: one note at a time, in 8ths, rising and falling.',
        '• For each bar: root, 3rd, 5th, the root an octave up, the 3rd above that, then back down. Only use the teal rows (chord notes).',
        '• Play it quietly and evenly. The left hand (low root) can be a little louder than the rest.',
        '• Write it in Intro, Verse, Chorus and Outro. In the Outro, let the last chord ring as one long chord.',
        'Ctrl+drag selects a bar; Ctrl+C and Ctrl+V copy it into the next bar, then drag the notes onto the new chord’s rows.',
      ],
      do: (p, c) => {
        for (const r of ['intro', 'verse', 'chorus']) abstractNotes(p, c, r, 'piano', arp(c.view(r), { ...BALLAD_ARP, vels: r === 'intro' ? [0.6, 0.42, 0.48, 0.42] : BALLAD_ARP.vels }));
        const v = c.view('outro');
        const out = arp(v, { ...BALLAD_ARP, skip: s => s >= 96 });
        const ch = chordAt(v, 96);
        const r0 = fold(ch.semis[0]);
        for (const t of [...ch.semis, ch.semis[0] + 12]) out.push({ step: 96, len: 32, semis: r0 + t - ch.semis[0], vel: 0.6 });
        abstractNotes(p, c, 'outro', 'piano', out);
      },
      check: (p, c) => hasNotes(c, 'verse', 'piano') },
    { id: 'bass', title: 'Bass', where: { tab: 'compose', role: 'verse', scroll: 'tracks', track: 'bass' },
      text: [
        'A gentle bass makes the piano sound bigger and the chords clearer.',
        '• **Verse**: one long note per bar on the chord’s **root** (the teal row tagged **R**).',
        '• **Chorus**: root on beat 1, the chord’s **5th** on beat 3. A little more motion for the bigger section.',
        '• **Intro**: nothing. Let the piano be alone first.',
        'Sidebar → Bassline ideas → **Long roots** and **Root and fifth** write exactly these.',
      ],
      do: (p, c) => {
        abstractNotes(p, c, 'verse', 'bass', bassLine(c.view('verse'), 'roots'));
        abstractNotes(p, c, 'chorus', 'bass', bassLine(c.view('chorus'), 'rootfifth'));
        abstractNotes(p, c, 'outro', 'bass', bassLine(c.view('outro'), 'roots'));
      },
      check: (p, c) => hasNotes(c, 'verse', 'bass') },
    { id: 'melody', title: 'The melody', where: { tab: 'compose', role: 'verse', scroll: 'tracks', track: 'melody' },
      text: [
        'A slow melody should feel **sung**: long notes, few of them, mostly moving by step.',
        '• **Verse**: stay low (around **3–5**). Short phrases of 2 bars, each ending on a long note. Long notes on chord tones (teal rows).',
        '• **Chorus**: **higher** (around **1 an octave up**). The contrast in register is what makes a chorus feel bigger, more than volume.',
        '• End the verse on **5** over the V chord (unresolved: it wants to go on), and the chorus on **6** over vi (sad, but complete).',
        '• Leave space between phrases. Silence is part of a sad melody.',
        'The Melody synth has **vibrato** that fades in on long notes, like a violin. Swap it for Piano or Acoustic Guitar in the track header for a different colour.',
      ],
      do: (p, c) => {
        notes(c, 'verse', 'melody', barsToNotes(BALLAD_VERSE, 0.72));
        notes(c, 'chorus', 'melody', barsToNotes(BALLAD_CHORUS, 0.8));
      },
      check: (p, c) => hasNotes(c, 'verse', 'melody') && hasNotes(c, 'chorus', 'melody') },
    { id: 'strings', title: 'Strings', where: { tab: 'compose', role: 'stringsC', scroll: 'chords' },
      text: [
        'Sustained **strings** under the piano turn a sketch into something cinematic.',
        '• The three Strings patterns already hold the right chords. Untick **guide only** in each so they play.',
        '• Keep **smooth** on: each chord then moves to the next with the smallest possible steps, the way a string section would play it.',
        '• Strings enter **gradually** in the song (halfway through the first chorus), and get louder through automation later.',
      ],
      do: (p, c) => {
        for (const r of ['stringsV', 'stringsC', 'stringsB']) c.pat(r).chordsGuide = false;
        Object.assign(p.chords, { style: 'block', octave: 3, voiceLead: true, volume: 0.4 });
      },
      check: (p, c) => hasChords(c, 'stringsC') && !c.pat('stringsC').chordsGuide },
    { id: 'counter', title: 'The cello line', where: { tab: 'compose', role: 'counter', scroll: 'tracks', track: 'cello' },
      text: [
        'A **countermelody** answers the main tune, in a lower register. The easiest beautiful one is a **guide-tone line**:',
        '• Play each chord’s **3rd**, then its **5th**, as two half-notes per bar. 3rds are what make a chord sound happy or sad, so this line traces the emotion.',
        '• Keep it in the cello’s range (octave 3), under the melody.',
        '• It comes in only in the second and final choruses, so the piece keeps growing.',
      ],
      do: (p, c) => {
        const v = c.view('counter'), out = [];
        for (let bar = 0; bar < v.bars; bar++) {
          const ch = chordAt(v, bar * 16);
          const r = fold(ch.semis[0]);
          out.push({ step: bar * 16, len: 8, semis: r + ch.semis[1] - ch.semis[0], vel: 0.75 }, { step: bar * 16 + 8, len: 8, semis: r + ch.semis[2] - ch.semis[0], vel: 0.7 });
        }
        abstractNotes(p, c, 'counter', 'cello', out);
      },
      check: (p, c) => hasNotes(c, 'counter', 'cello') },
    { id: 'bridge', title: 'The bridge: borrowing from minor', where: { tab: 'compose', role: 'bridge', scroll: 'chords' },
      text: [
        'The bridge is where the floor drops away. The trick: **borrow chords from D minor** while staying on D.',
        '• The Bridge pattern is set to **D minor** (see the Key and Scale in the top bar). Its chords: **iv – VI – VII – V(sus4)** (Gm – B♭ – C – Asus4).',
        '• **Gm** in place of G is the famous “minor iv”: the single most bittersweet chord in pop and film music.',
        '• **Asus4** at the end hangs in the air and leads back into the chorus.',
        '• Piano, bass and a slow melody (two notes per bar) as before.',
      ],
      do: (p, c) => {
        for (const r of ['bridge', 'stringsB']) slotsInto(c.pat(r), [3, 5, 6, 4], 16, ['triad', 'triad', 'triad', 'sus4'], r === 'bridge');
        abstractNotes(p, c, 'bridge', 'piano', arp(c.view('bridge'), BALLAD_ARP));
        abstractNotes(p, c, 'bridge', 'bass', bassLine(c.view('bridge'), 'roots'));
        notes(c, 'bridge', 'melody', barsToNotes(BALLAD_BRIDGE, 0.74));
      },
      check: (p, c) => hasNotes(c, 'bridge', 'melody') },
    { id: 'drums', title: 'Soft drums (optional)', where: { tab: 'compose', role: 'drums', scroll: 'drums' },
      text: [
        'Drums are optional here. If you use them, keep them **soft and sparse**, entering late:',
        '• A soft kick on beat 1 and just before beat 3.',
        '• A rimshot (instead of a snare) on beats 2 and 4.',
        '• A quiet shaker on 8ths.',
        'They come in halfway through the second verse and leave for the bridge. Turn the Drums channel down in Mix & FX if they feel too present.',
      ],
      do: (p, c) => drums(p, c, 'drums', { kick: 'x.........x.....', rim: '....x.......x...', shaker: 'x.x.x.x.x.x.x.x.' }),
      check: (p, c) => hasDrums(c, 'drums', ['kick', 'rim', 'shaker']) },
    { id: 'mix', title: 'Mix: space and warmth', where: { tab: 'mix' },
      text: [
        'A quiet piece is mixed for **space** and **warmth**, not punch:',
        '• Plenty of **reverb** on everything except the bass: it puts the instruments in a room together.',
        '• **High-pass** the strings and the melody (150–200 Hz) so the piano’s low notes and the bass stay clear.',
        '• **No pump** (sidechain); nothing here should breathe on the beat.',
        '• The **melody** sits on top: a little louder than you think, everything else tucked under.',
      ],
      do: (p, c) => {
        fx(c.track('piano'), { reverb: 0.35, comp: 0.15 });
        fx(c.track('melody'), { reverb: 0.42, delay: 0.12, hpCut: 200, comp: 0.2 });
        Object.assign(c.track('melody'), { volume: 0.75 });
        fx(c.track('cello'), { reverb: 0.35, hpCut: 60 });
        Object.assign(c.track('cello'), { volume: 0.6 });
        fx(c.track('bass'), { eqHigh: -3 });
        Object.assign(c.track('bass'), { volume: 0.7 });
        fx(p.chords, { reverb: 0.5, hpCut: 150, pump: 0 });
        fx(p.drums, { reverb: 0.25, comp: 0.15 });
        Object.assign(p.fxBus, { reverbSize: 3.6, delaySteps: 6, delayFeedback: 0.3 });
      },
      check: (p, c) => c.track('piano').fx.reverb > 0 },
    { id: 'arrange', title: 'Arrange the song', where: { tab: 'arrange' },
      get text() {
        return arrangeText(ballad, [
          'A song gets its shape from **adding things each time a section comes back**, then taking almost everything away near the end.',
          'The last chorus is the same pattern played a **whole tone higher**: select a clip and change its Key, and every melody follows because notes are stored as scale degrees.',
        ]);
      },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 10 },
    { id: 'automate', title: 'Automation: swells and a fade', where: { tab: 'arrange' },
      text: [
        'In slow music, **dynamics** are the drama:',
        '• **Strings volume** swelling in over the first chorus, and growing through the song.',
        '• More **reverb on the melody** in the bridge, so it sounds further away.',
        '• A **fade-out** of the master over the last bars.',
        'In Arrange use **+ Automate…**. Shift+drag draws a curve freehand.',
      ],
      do: (p, c) => {
        const S = sectionStarts(c.G);
        const mel = c.track('melody').id;
        lane(p, 'chords|volume', [[S.Chorus + 8, 0.05], [S.Chorus + 16, 0.3], [S['Verse 2'] + 8, 0.33], [S['Chorus 2'], 0.38], [S.Bridge, 0.42], [S['Final chorus'], 0.45], [S.Outro, 0.32]]);
        lane(p, `${mel}|reverb`, [[S.Bridge - 1, 0.42], [S.Bridge, 0.62], [S['Final chorus'], 0.42]]);
        lane(p, 'master|master', [[S.END - 4, 0.667], [S.END, 0]]);
      },
      check: p => p.song.auto.some(l => l.points.length >= 2) },
    finishStep,
  ],
};

// ---------- MIDTEMPO ----------
const midtempo = {
  id: 'midtempo', name: 'Midtempo', bpm: 105, root: 5, scale: 'minor', swing: 0,
  blurb: 'Dark, heavy and slow-burning. 105 BPM, a pounding kick and snare, a growling FM bass pumped by the kick, a sub underneath and a dark arpeggio.',
  lanes: [
    { name: 'Drums', roles: ['drums'] }, { name: 'Hats', roles: ['hats'] }, { name: 'Bass', roles: ['bass'] }, { name: 'Sub', roles: ['sub'] },
    { name: 'Arp', roles: ['arp'] }, { name: 'Pad', roles: ['pad'] }, { name: 'FX', roles: ['build', 'impact'] },
  ],
  patterns: [['drums', 'Kick & snare', 4], ['hats', 'Hats', 4], ['bass', 'Growl bass', 8], ['sub', 'Sub', 8], ['arp', 'Dark arp', 8],
    ['pad', 'Pad chords', 8], ['build', 'Build-up', 8], ['impact', 'Impact', 4]],
  tracks: [['bass', 'Bass', 'mt_bass', 2], ['sub', 'Sub', 'mt_sub', 1], ['arp', 'Arp', 'mt_arp', 4]],
  chordsPatch: ['mt_pad', 3],
  patches: {
    mt_bass: synth('Midtempo Growl', { wave: 'sawtooth', wave2: 'square', mix2: 0.45, detune: 12, fm: 1.6, fmRatio: 1, attack: 0.004, decay: 0.35, sustain: 0.75, release: 0.08,
      cutoff: 1100, resonance: 5, filterEnv: 900, filterDecay: 0.15, volume: 0.45 }),
    mt_sub: synth('Sub', { wave: 'sine', attack: 0.004, decay: 0.3, sustain: 0.9, release: 0.1, cutoff: 400, volume: 0.9 }),
    mt_arp: synth('Dark Arp', { wave: 'square', wave2: 'sawtooth', mix2: 0.3, detune: 8, attack: 0.002, decay: 0.22, sustain: 0.1, release: 0.2, cutoff: 2200, resonance: 3, filterEnv: 2000, volume: 0.5 }),
    mt_pad: synth('Dark Pad', { wave: 'sawtooth', wave2: 'triangle', mix2: 0.5, detune: 16, unison: 3, attack: 0.5, decay: 1, sustain: 0.75, release: 1.4, cutoff: 1300, volume: 0.4 }),
  },
  drumParams: { kick: { tune: 46, decay: 0.55, punch: 4, click: 0.5 }, snare: { tune: 180, decay: 0.25, snappy: 1 }, clap: { decay: 0.35, tone: 1000 } },
  sections: [
    { name: 'Intro', bars: 24, layers: ['pad', 'arp@8', 'hats@16'], build: 8, note: 'dark pad, then the arp, then hats and a build.' },
    { name: 'Drop', bars: 32, layers: ['drums', 'hats', 'bass', 'sub', 'arp@16'], impact: true, note: 'kick, snare and the growl bass hit at once; the arp returns halfway.' },
    { name: 'Break', bars: 24, layers: ['pad', 'arp', 'sub@0-8'], build: 8, note: 'the weight falls away, the arp carries on; build again.' },
    { name: 'Drop 2', bars: 32, layers: ['drums', 'hats', 'bass', 'sub', 'arp', 'pad@16'], impact: true, note: 'everything, with the pad on top for the second half.' },
    { name: 'Outro', bars: 24, layers: ['drums@0-16', 'hats', 'pad', 'bass@0-8', 'sub@0-8'], note: 'the bass leaves, then the drums; the pad fades out the track.' },
  ],
  steps: [
    { id: 'setup', title: 'Tempo, key and the plan', where: { tab: 'compose', role: 'drums' },
      text: [
        '**Midtempo** (midtempo bass, dark electro) runs at **95–110 BPM**. This project is at 105 in **F minor**.',
        'It is slow for dance music, so everything is **heavy**: a big kick and snare, a distorted, growling bass that pumps with the kick, and dark, cinematic synths. Think of it as halfway between techno’s darkness and dubstep’s weight.',
        'The project has one **pattern per element**. While you work, **Play** loops them all together as a work loop. Follow the steps, or press **Do it for me** and then change what it wrote.',
      ],
      check: () => true },
    { id: 'kick', title: 'Kick and snare', where: { tab: 'compose', role: 'drums', scroll: 'drums' },
      text: [
        'At 105 BPM the beat is a slow, pounding **kick on 1 and 3, snare on 2 and 4**.',
        '• Kick on steps 1 and 9, with a small extra kick near the end of the bar (step 15) for bounce.',
        '• Snare **and** clap layered together on steps 5 and 13: big and wide.',
        '• In bar 4, add one more kick for a fill.',
        'Sound Design → Drums: a long kick (more Decay) and a fat snare (lower Tune, more Snappy).',
      ],
      do: (p, c) => drums(p, c, 'drums', {
        kick: 'X.......X.....x. X.......X.....x. X.......X.....x. X.......X..x..x.',
        snare: '....X.......X...', clap: '....X.......X...',
      }),
      check: (p, c) => hasDrums(c, 'drums', ['kick']) && hasDrums(c, 'drums', ['snare', 'clap']) },
    { id: 'hats', title: 'Hats', where: { tab: 'compose', role: 'hats', scroll: 'drums' },
      text: [
        '• Closed hats on 16ths, quiet, leaving out the second 16th of each beat.',
        '• One **open hat** on the last off-beat of the bar to lead back to beat 1.',
        'At this tempo the hats are what keep it moving; keep them crisp and low in level.',
      ],
      do: (p, c) => drums(p, c, 'hats', { chat: 'x.xxx.xxx.xxx.xx', ohat: '..............x.' }),
      check: (p, c) => hasDrums(c, 'hats', ['chat', 'ohat']) },
    { id: 'chords', title: 'Dark chords', where: { tab: 'compose', role: 'pad', scroll: 'chords' },
      text: [
        'Four minor-key chords, **2 bars each**: **i – VI – iv – v** (Fm – D♭ – B♭m – Cm).',
        '• Using the **minor v** (Cm) instead of a major V keeps it dark: nothing ever resolves brightly.',
        '• The Pad pattern plays them; every other pattern gets them as a silent guide.',
      ],
      do: (p, c) => setChords(p, c, [0, 5, 3, 4], 32, 'triad', ['pad']),
      check: (p, c) => hasChords(c, 'pad') },
    { id: 'bass', title: 'The growl bass', where: { tab: 'compose', role: 'bass', scroll: 'tracks', track: 'bass' },
      text: [
        'The midtempo bass is the lead instrument: a **rhythmic, distorted growl** on the chord roots.',
        '• Play the chord’s **root** in a choppy 16th rhythm: long on the beats, short pickups between.',
        '• Jump to the **octave** and the chord’s **5th** now and then.',
        '• The sound: saw and square with a little **FM** (Sound Design → FM amount) for grit, then **Drive** in the mixer.',
        'It pumps hard with the kick (mix step), which is half of the groove.',
      ],
      do: (p, c) => {
        const v = c.view('bass'), out = [];
        const hits = [[0, 3, 'r'], [3, 1, 'r'], [4, 2, 'o'], [6, 2, 'r'], [8, 3, 'r'], [11, 1, 'r'], [12, 2, 'f'], [14, 2, 'r']];
        for (let bar = 0; bar < v.bars; bar++) {
          const ch = chordAt(v, bar * 16);
          const r = fold(ch.semis[0]);
          for (const [s, len, t] of hits) out.push({ step: bar * 16 + s, len, semis: t === 'o' ? r + 12 : t === 'f' ? r + ch.semis[2] - ch.semis[0] : r, vel: s % 4 === 0 ? 0.95 : 0.75 });
        }
        abstractNotes(p, c, 'bass', 'bass', out);
      },
      check: (p, c) => hasNotes(c, 'bass', 'bass') },
    { id: 'sub', title: 'The sub', where: { tab: 'compose', role: 'sub', scroll: 'tracks', track: 'sub' },
      text: [
        'Distortion eats low end, so a heavy bass gets a separate, clean **sub**: a sine wave holding each chord’s root, an octave below.',
        '• One long note per chord.',
        '• Keep the sub clean: no drive, no reverb. The growl provides the character, the sub the weight.',
      ],
      do: (p, c) => abstractNotes(p, c, 'sub', 'sub', bassLine(c.view('sub'), 'roots')),
      check: (p, c) => hasNotes(c, 'sub', 'sub') },
    { id: 'hook', title: 'The dark arp', where: { tab: 'compose', role: 'arp', scroll: 'tracks', track: 'arp' },
      text: [
        'A fast **arpeggio** of the chords on top gives the tension and the “cinematic” feel (think of 80s thriller soundtracks).',
        '• 16ths through the chord notes: root, 3rd, 5th, octave and back, restarting on each chord.',
        '• Plenty of delay; it sits behind the bass, not in front.',
      ],
      do: (p, c) => abstractNotes(p, c, 'arp', 'arp', arp(c.view('arp'), { rate: 1, shape: [0, 1, 2, 3, 2, 1, 2, 4], vels: [0.9, 0.55, 0.7, 0.55] })),
      check: (p, c) => hasNotes(c, 'arp', 'arp') },
    { id: 'mix', title: 'Mix: weight and pump', where: { tab: 'mix' },
      text: mixText([
        '• Midtempo specific: heavy **Drive** and **Compress** on the growl bass, with a high-pass around 90 Hz so the sub owns the low end.',
        '• **Pump** the bass, sub and pad hard: the bass ducking under every kick is the groove.',
      ]),
      do: (p, c) => {
        fx(c.track('bass'), { drive: 0.55, comp: 0.4, pump: 0.55, hpCut: 90, eqLow: -4 });
        Object.assign(c.track('bass'), { volume: 0.6 });
        fx(c.track('sub'), { pump: 0.6, eqHigh: -10 });
        Object.assign(c.track('sub'), { volume: 0.32 }); // a held sine is pure energy: it needs far less level than it seems
        fx(c.track('arp'), { delay: 0.35, reverb: 0.25, hpCut: 300, pump: 0.3 });
        Object.assign(c.track('arp'), { volume: 0.45 });
        fx(p.chords, { hpCut: 200, reverb: 0.45, pump: 0.6 });
        fx(p.drums, { comp: 0.35, reverb: 0.06 });
        Object.assign(p.fxBus, { delaySteps: 3, delayFeedback: 0.4, reverbSize: 2.6, pumpRelease: 0.6 });
      },
      check: (p, c) => c.track('bass').fx.pump > 0 || c.track('bass').fx.drive > 0 },
    { id: 'build', title: 'Build-ups and impacts', where: { tab: 'compose', role: 'build', scroll: 'drums' },
      text: [
        'Midtempo drops hit hardest after a moment of tension and a moment of silence:',
        '• **Build-up** (8 bars): a snare roll that speeds up (quarters, 8ths, 16ths) with a **riser** over the last 4 bars.',
        '• A **gap** on the last beat: let the pad and arp ring out alone for a split second.',
        '• **Impact** (boom and crash) on the first beat of each drop, landing together with the first growl note.',
      ],
      do: (p, c) => { buildUp(p, c, 8, 4); drums(p, c, 'impact', { impact: 'X' + '.'.repeat(63), cymbal: 'X' + '.'.repeat(63) }); },
      check: (p, c) => hasDrums(c, 'build', ['snare', 'riser', 'clap']) },
    { id: 'arrange', title: 'Arrange the track', where: { tab: 'arrange' },
      get text() { return arrangeText(midtempo, ['Midtempo tracks are shorter and punchier than techno or trance: a moody intro, a heavy drop, a break, a second drop.']); },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 10 },
    { id: 'automate', title: 'Automation', where: { tab: 'arrange' },
      text: [
        '• **Arp low-pass** opening through the intro, so the track brightens into the drop.',
        '• The growl’s **Synth cutoff** opening during each drop: the bass gets nastier as the drop goes on.',
        '• **Drums high-pass** over the 4 bars before the break.',
      ],
      do: (p, c) => {
        const S = sectionStarts(c.G);
        const arpId = c.track('arp').id, bass = c.track('bass').id;
        lane(p, `${arpId}|cutoff`, [[S.Intro + 8, 0.35], [S.Drop - 0.25, 1]]);
        lane(p, `${bass}|synthCutoff`, [[S.Drop, 0.48], [S.Drop + 28, 0.62], [S['Drop 2'], 0.5], [S['Drop 2'] + 28, 0.68]]);
        lane(p, 'drums|hpCut', [[0, 0], ...drumSweep(S.Break)]);
      },
      check: p => p.song.auto.some(l => l.points.length >= 2) },
    finishStep,
  ],
};

// ---------- HARDCORE ----------
const HC_LEAD = [ // A harmonic minor, over Am – F – Dm – E (2 bars each)
  [[0, 4, 7], [4, 4, 9], [8, 4, 11], [12, 4, 9]], [[0, 6, 7], [6, 2, 6], [8, 8, 4]],
  [[0, 4, 7], [4, 4, 9], [8, 4, 10], [12, 4, 9]], [[0, 8, 5], [8, 8, 7]],
  [[0, 4, 10], [4, 4, 12], [8, 4, 10], [12, 4, 9]], [[0, 8, 7], [8, 8, 5]],
  [[0, 4, 8], [4, 4, 11], [8, 4, 13], [12, 4, 11]], [[0, 8, 11], [8, 4, 8], [12, 4, 6]],
];

const hardcore = {
  id: 'hardcore', name: 'Hardcore', bpm: 180, root: 9, scale: 'harmonicMinor', swing: 0, lowNotes: 0,
  blurb: 'Fast, loud and euphoric. 180 BPM, a distorted kick that doubles as the bass, a hoover screech, anthem supersaw melodies and kick-roll build-ups.',
  lanes: [
    { name: 'Kick', roles: ['kick'] }, { name: 'Hats & clap', roles: ['hats'] }, { name: 'Lead', roles: ['lead'] }, { name: 'Screech', roles: ['screech'] },
    { name: 'Pad', roles: ['pad'] }, { name: 'FX', roles: ['build', 'impact'] },
  ],
  patterns: [['kick', 'Distorted kick', 4], ['hats', 'Hats & clap', 4], ['lead', 'Anthem lead', 8], ['screech', 'Hoover screech', 8],
    ['pad', 'Pad chords', 8], ['build', 'Kick roll build', 8], ['impact', 'Impact', 4]],
  tracks: [['lead', 'Lead', 'hc_lead', 4], ['screech', 'Screech', 'hc_hoover', 3]],
  chordsPatch: ['hc_pad', 3],
  patches: {
    hc_lead: synth('Hardcore Supersaw', { wave: 'sawtooth', unison: 7, detune: 26, wave2: 'square', octave2: 1, mix2: 0.2, attack: 0.005, decay: 0.3, sustain: 0.75, release: 0.25,
      cutoff: 7000, resonance: 1.5, filterEnv: 1200, volume: 0.45 }),
    hc_hoover: synth('Hoover', { wave: 'sawtooth', wave2: 'sawtooth', octave2: -1, mix2: 0.6, detune: 32, unison: 3, pitchDrop: -7, pitchTime: 0.09,
      attack: 0.004, decay: 0.4, sustain: 0.8, release: 0.15, cutoff: 3200, resonance: 2, volume: 0.4 }),
    hc_pad: synth('Hardcore Pad', { wave: 'sawtooth', wave2: 'sawtooth', mix2: 0.5, detune: 20, unison: 5, attack: 0.3, decay: 1, sustain: 0.8, release: 1, cutoff: 2600, volume: 0.36 }),
  },
  drumParams: { kick: { tune: 55, decay: 0.5, punch: 6, click: 1, drive: 0.85 }, ohat: { decay: 0.15, tone: 8500 }, clap: { decay: 0.25, tone: 1300 } },
  sections: [
    { name: 'Intro', bars: 32, layers: ['kick', 'hats@16'], note: 'the kick alone, then hats: for the DJ, and to show off the kick.' },
    { name: 'Break', bars: 32, layers: ['pad', 'lead@16'], build: 8, note: 'no kick. Pads, then the anthem melody, then a kick-roll build.' },
    { name: 'Drop', bars: 32, layers: ['kick', 'hats', 'lead', 'pad', 'screech@16'], impact: true, note: 'the melody over the kick: the euphoric moment. The screech joins halfway.' },
    { name: 'Hard section', bars: 32, layers: ['kick', 'hats', 'screech'], note: 'just kick and screech: raw energy before the second break.' },
    { name: 'Break 2', bars: 32, layers: ['pad', 'lead'], build: 8, note: 'the melody again, unaccompanied, and another build.' },
    { name: 'Drop 2', bars: 48, layers: ['kick', 'hats', 'lead', 'pad', 'screech'], impact: true, note: 'everything at once, to the end.' },
    { name: 'Outro', bars: 32, layers: ['kick', 'hats@0-16', 'screech@0-8'], note: 'back to the kick for the mix-out.' },
  ],
  steps: [
    { id: 'setup', title: 'Tempo, key and the plan', where: { tab: 'compose', role: 'kick' },
      text: [
        '**Hardcore** (gabber, Dutch and UK hardcore) runs at **160–200 BPM**. This project is at 180, in **A harmonic minor**.',
        '**Harmonic minor** is minor with a raised 7th (G♯ in A minor). It gives a **major V chord** (E), the dramatic, almost classical pull you hear in hardcore anthems.',
        'The **kick is the bass**: so distorted that its long tail is a pitched, buzzing note. There is no separate bassline. On top: hoover screeches and huge supersaw melodies in the breaks.',
        'The project has one **pattern per element**. While you work, **Play** loops them all together. Follow the steps, or press **Do it for me** and then change what it wrote.',
      ],
      check: () => true },
    { id: 'kick', title: 'The distorted kick', where: { tab: 'sound' },
      text: [
        'Everything starts with the kick. Design it before writing anything.',
        '• Sound Design → Drums → Kick: **Distortion** high (80–90%), long **Decay** (~0.5 s) so the distorted tail rings, lots of **Punch** and **Click**.',
        '• **Tune** it to the key: 55 Hz is A, the home note, so the kick’s buzz is in tune with everything.',
        '• Pattern: four on the floor, nothing more.',
      ],
      do: (p, c) => drums(p, c, 'kick', { kick: 'X...X...X...X...' }),
      check: (p, c) => hasDrums(c, 'kick', ['kick']) },
    { id: 'hats', title: 'Hats and clap', where: { tab: 'compose', role: 'hats', scroll: 'drums' },
      text: [
        'With a kick this big, the top end just has to mark time and add sparkle:',
        '• **Open hat on the off-beats**, short and bright: kick, hat, kick, hat.',
        '• **Clap** on 2 and 4.',
        '• Closed hats on 8ths, quiet. At 180 BPM, 16th hats turn into a blur and fight the kick’s distortion.',
      ],
      do: (p, c) => drums(p, c, 'hats', { ohat: '..x...x...x...x.', clap: '....x.......x...', chat: 'x.x.x.x.x.x.x.x.' }),
      check: (p, c) => hasDrums(c, 'hats', ['ohat', 'clap', 'chat']) },
    { id: 'chords', title: 'Anthem chords', where: { tab: 'compose', role: 'pad', scroll: 'chords' },
      text: [
        'Hardcore breakdowns are **emotional**: four chords, 2 bars each.',
        '• **i – VI – iv – V** (Am – F – Dm – E). The last chord, **E major**, exists only because of harmonic minor. Its G♯ pulls hard back to A.',
        '• The Pad pattern plays them; the other patterns get them as a guide.',
      ],
      do: (p, c) => setChords(p, c, [0, 5, 3, 4], 32, 'triad', ['pad']),
      check: (p, c) => hasChords(c, 'pad') },
    { id: 'hook', title: 'The anthem melody', where: { tab: 'compose', role: 'lead', scroll: 'tracks', track: 'lead' },
      text: [
        'The melody is meant to be **shouted along** with by a crowd:',
        '• Mostly **quarter notes**, climbing up the chord: root, 3rd, 5th.',
        '• Each 2-bar phrase ends on a long note.',
        '• Over the E chord, use its **G♯** (the raised 7th) for that dramatic pull home.',
        '• The sound: a **supersaw** (7 detuned saws). Same idea as trance, but harder and brighter.',
      ],
      do: (p, c) => notes(c, 'lead', 'lead', HC_LEAD.flatMap((bar, b) => bar.map(([s, len, d]) => [b * 16 + s, len, d, s === 0 ? 0.95 : 0.82]))),
      check: (p, c) => hasNotes(c, 'lead', 'lead') },
    { id: 'screech', title: 'The hoover screech', where: { tab: 'compose', role: 'screech', scroll: 'tracks', track: 'screech' },
      text: [
        'The **hoover** is the classic rave sound: thick detuned saws that **scoop up into each note** from below.',
        '• A rhythmic riff on the chord **roots**, jumping to the octave and the 5th.',
        '• The scoop is **Pitch drop** set below zero in Sound Design (here −7: each note starts a 5th low and bends up).',
        '• It pumps with the kick so it stays out of the kick’s way.',
      ],
      do: (p, c) => {
        const v = c.view('screech'), out = [];
        const hits = [[0, 3, 0], [3, 3, 0], [6, 2, 'o'], [8, 3, 0], [11, 3, 'f'], [14, 2, 'o']];
        for (let bar = 0; bar < v.bars; bar++) {
          const ch = chordAt(v, bar * 16);
          const r = fold(ch.semis[0]);
          for (const [s, len, t] of hits) out.push({ step: bar * 16 + s, len, semis: t === 'o' ? r + 12 : t === 'f' ? r + ch.semis[2] - ch.semis[0] : r, vel: s % 8 === 0 ? 0.95 : 0.8 });
        }
        abstractNotes(p, c, 'screech', 'screech', out);
      },
      check: (p, c) => hasNotes(c, 'screech', 'screech') },
    { id: 'mix', title: 'Mix: everything around the kick', where: { tab: 'mix' },
      text: mixText([
        '• Hardcore specific: the kick takes the whole low end. **High-pass everything else** at 200 Hz or more, and **pump** everything hard so the kick punches through.',
        '• Turn on **Per-sound strips** under Drums if you want to add even more Drive to the kick alone.',
      ]),
      do: (p, c) => {
        fx(c.track('lead'), { pump: 0.6, hpCut: 250, reverb: 0.3, delay: 0.2, comp: 0.3 });
        Object.assign(c.track('lead'), { volume: 0.95 });
        fx(c.track('screech'), { pump: 0.55, hpCut: 180, drive: 0.3 });
        Object.assign(c.track('screech'), { volume: 0.75 });
        p.drums.rows.find(r => r.kind === 'kick').vol = 0.8;
        fx(p.chords, { pump: 0.7, hpCut: 250, reverb: 0.45 });
        fx(p.drums, { comp: 0.2 });
        Object.assign(p.fxBus, { pumpRelease: 0.4, delaySteps: 3, delayFeedback: 0.35, reverbSize: 2.4 });
      },
      check: (p, c) => c.track('lead').fx.pump > 0 || c.track('lead').fx.hpCut > 11 },
    { id: 'build', title: 'The kick roll', where: { tab: 'compose', role: 'build', scroll: 'drums' },
      text: [
        'Hardcore builds with the **kick itself**: a kick roll that doubles in speed.',
        '• Quarter notes for 4 bars, 8ths for 2, 16ths for 1, then a last bar of 16ths ending in a gap.',
        '• A **riser** over the last 4 bars on top.',
        '• **Impact** on the first beat of the drop.',
      ],
      do: (p, c) => {
        drums(p, c, 'build', {
          kick: 'X...X...X...X...'.repeat(4) + 'X.X.X.X.X.X.X.X.'.repeat(2) + 'XXXXXXXXXXXXXXXX' + 'XXXXXXXXXXXX....',
          riser: '.'.repeat(64) + 'X' + '.'.repeat(63),
        });
        p.drumParams.riser.length = Math.round(4 * 4 * 60 / p.bpm * 100) / 100;
        drums(p, c, 'impact', { impact: 'X' + '.'.repeat(63), cymbal: 'X' + '.'.repeat(63) });
      },
      check: (p, c) => hasDrums(c, 'build', ['kick', 'riser']) },
    { id: 'arrange', title: 'Arrange the track', where: { tab: 'arrange' },
      get text() { return arrangeText(hardcore, ['Hardcore alternates **kick sections** (raw energy) and **breaks** (emotion), with the melody finally landing over the kick in the drops.']); },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 10 },
    { id: 'automate', title: 'Automation', where: { tab: 'arrange' },
      text: [
        '• **Pad low-pass** opening through each break.',
        '• **Screech synth cutoff** opening through the hard section.',
        '• **Drums high-pass** before each break, so the kick drains away instead of stopping.',
      ],
      do: (p, c) => {
        const S = sectionStarts(c.G);
        const scr = c.track('screech').id;
        lane(p, 'chords|cutoff', [[S.Break, 0.5], [S.Drop - 1, 1], [S['Break 2'], 0.5], [S['Drop 2'] - 1, 1]]);
        lane(p, `${scr}|synthCutoff`, [[S['Hard section'], 0.6], [S['Hard section'] + 30, 0.85], [S['Break 2'], 0.65]]);
        lane(p, 'drums|hpCut', [[0, 0], ...drumSweep(S.Break), ...drumSweep(S['Break 2'])]);
      },
      check: p => p.song.auto.some(l => l.points.length >= 2) },
    finishStep,
  ],
};

export const GENRES = { techno, trance, house, dnb, psy, midtempo, hardcore, ballad };

// ---------- Template ----------
export function createGuideProject(genreId) {
  const G = GENRES[genreId];
  const p = blankProject(`My ${G.name} track`);
  p.bpm = G.bpm;
  p.swing = G.swing;
  Object.assign(p.patches, structuredClone(G.patches));
  for (const [kind, params] of Object.entries(G.drumParams)) Object.assign(p.drumParams[kind], params);
  const VOL = { kick: 0.95, snare: genreId === 'dnb' ? 0.9 : 0.6, clap: 0.55, rim: 0.35, chat: 0.32, ohat: 0.38, ltom: 0.5, mtom: 0.5, htom: 0.45,
    cowbell: 0.4, cymbal: 0.35, shaker: 0.28, ride: 0.28, riser: 0.5, impact: 0.8 };
  for (const r of p.drums.rows) r.vol = VOL[r.kind] ?? r.vol;

  p.tracks = G.tracks.map(([, name, patch, octave], i) => newTrack(name, patch, octave, TRACK_COLORS[i % TRACK_COLORS.length]));
  if (G.chordsPatch) { p.chords.patch = G.chordsPatch[0]; p.chords.octave = G.chordsPatch[1]; }
  p.chords.style = 'block';
  p.chords.slots = [];

  p.root = G.root; p.scale = G.scale; p.keyChanges = []; p.bars = 4;
  p.patterns = [];
  const pats = {};
  G.patterns.forEach(([role, name, bars], i) => { pats[role] = addPattern(p, name, bars, PATTERN_COLORS[i % PATTERN_COLORS.length]).id; });
  for (const [role, key] of Object.entries(G.patternKeys || {})) Object.assign(p.patterns.find(x => x.id === pats[role]), key);
  if (G.drumsVolume) p.drums.volume = G.drumsVolume;
  p.currentPattern = p.patterns[0].id;
  // the editors show the first pattern: take its length and key, so opening it doesn't overwrite them
  Object.assign(p, { bars: p.patterns[0].bars, root: p.patterns[0].root, scale: p.patterns[0].scale });
  const tracks = {};
  G.tracks.forEach(([role], i) => { tracks[role] = p.tracks[i].id; });
  p.guide = { genre: genreId, step: 0, done: {}, roles: { pats, tracks } };
  withPatterns(q => jamLoop(q, ctxOf(q)), p);
  return p;
}

// ---------- Steps ----------
export function guideOf(p) {
  if (!p.guide || !GENRES[p.guide.genre]) return null;
  const G = GENRES[p.guide.genre];
  const c = ctxOf(p);
  const steps = G.steps.map(s => {
    let done = false;
    try { done = s.manual ? !!p.guide.done[s.id] : !!s.check(p, c); } catch { /* roles were deleted */ }
    return { ...s, text: s.text, done, canDo: !!s.do };
  });
  return { G, steps, total: totalBars(G), index: Math.max(0, Math.min(steps.length - 1, p.guide.step || 0)) };
}

// "Do it for me" for one step. Changes the project; the caller commits.
export function runStep(p, stepId) {
  const G = GENRES[p.guide.genre];
  const step = G.steps.find(s => s.id === stepId);
  if (!step?.do) return false;
  withPatterns(q => step.do(q, ctxOf(q)), p);
  return true;
}

// Where a step happens: { tab, patternId?, trackId?, scroll? }
export function stepPlace(p, step) {
  const w = step.where || {};
  return { tab: w.tab, patternId: w.role ? p.guide.roles.pats[w.role] : null, trackId: w.track ? p.guide.roles.tracks[w.track] : null, scroll: w.scroll };
}
