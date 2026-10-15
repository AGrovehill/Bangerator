// More guides, for learning to write music beyond electronic dance tracks: a plain sad song in minor, a 12-bar
// blues, a basic rock song, a pop song, lo-fi hip hop, funk and ambient. Same shape as guides.js (a template
// plus steps that each explain a method and can write a typical version), built from guidekit.js.

import { STEPS_PER_BAR, songBars } from './state.js';
import { chordAt, bassLine } from './advisor.js';
import { abstractNotes, arp, arrange, barsToNotes, drums, fold, fx, hasChords, hasDrums, hasNotes, lane, notes, sectionStarts,
  setChords, slotsInto, stabs, synth, totalBars } from './guidekit.js';

// ---------- Shared helpers ----------
// Fixed-pitch notes for piano-mode tracks: [step, length, midi, velocity?]
function midis(c, role, trackRole, list) {
  const pat = c.pat(role);
  const L = pat.bars * STEPS_PER_BAR;
  pat.notes[c.track(trackRole).id] = list.filter(n => n[0] < L).map(([step, len, midi, vel = 0.85]) => ({ step, len: Math.min(len, L - step), midi, vel }));
}
const barsToMidis = bars => bars.flatMap((bar, b) => bar.map(([s, len, m, vel]) => [b * 16 + s, len, m, vel ?? (s === 0 ? 0.88 : 0.8)]));

// The chord's root an octave below the chords, once per bar: a pianist's left hand.
function leftHand(view, { vel = 0.6, len = 16, drop = 12 } = {}) {
  const out = [];
  for (let s = 0; s < view.bars * STEPS_PER_BAR; s += 16) {
    const ch = chordAt(view, s);
    if (ch) out.push({ step: s, len, semis: fold(ch.semis[0]) - drop, vel });
  }
  return out;
}

// Power chords: root, 5th and octave, on a rhythm of [stepInBar, length, velocity?] hits.
function power(view, hits, skip = () => false) {
  const out = [];
  for (let bar = 0; bar < view.bars; bar++) {
    for (const [s, len, vel = 0.85] of hits) {
      const step = bar * 16 + s;
      const ch = chordAt(view, step);
      if (!ch || skip(step)) continue;
      const r = fold(ch.semis[0]);
      for (const t of [0, 7, 12]) out.push({ step, len, semis: r + t, vel });
    }
  }
  return out;
}

const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const mod7 = x => ((x % 7) + 7) % 7;

// An improvised-sounding line: `pool` is the scale it moves in (degrees, low to high). On the beat it lands on a
// chord tone of the chord playing; between beats it steps up or down. `cells` are the rhythms, one per bar in turn.
function soloLine(view, { seed, pool, cells, start = Math.floor(pool.length / 2), vel = 0.8 }) {
  const rnd = rng(seed), out = [];
  let i = start, dir = 1;
  for (let bar = 0; bar < view.bars; bar++) {
    const cell = cells[bar % cells.length];
    for (const [s, len] of cell) {
      const step = bar * 16 + s;
      const ch = chordAt(view, step);
      if (!ch) continue;
      const tones = [0, 2, 4].map(k => mod7(ch.deg + k));
      if (s % 4 === 0) {
        for (const off of [0, dir, -dir, 2 * dir, -2 * dir, 3 * dir, -3 * dir]) {
          const j = i + off;
          if (j >= 0 && j < pool.length && tones.includes(mod7(pool[j]))) { i = j; break; }
        }
      } else {
        if (rnd() < 0.25) dir = -dir;
        i += dir;
        if (i <= 0 || i >= pool.length - 1) { dir = -dir; i = Math.max(0, Math.min(pool.length - 1, i)); }
      }
      out.push([step, len, pool[i], s % 4 === 0 ? vel + 0.08 : vel - 0.06]);
    }
  }
  return out;
}

// Song-form text and last step (no drops here, just sections that come back).
const songArrangeText = (G, why) => [
  'Now the whole song. Songs are made of **sections that come back**: you hear a verse, a chorus, then the verse again but with a bit more, and so on. Repetition makes it familiar; small changes keep it alive.',
  ...why,
  `The plan (${totalBars(G)} bars):`,
  ...G.sections.map(s => `• **${s.name}** (${s.bars} bars): ${s.note}`),
  'In **Arrange**: pick a pattern on the left and click a lane to place it, drag the right edge to make it last, Ctrl+drag to copy. Click the Sections row to label parts.',
];

const songFinish = {
  id: 'finish', title: 'Listen, change, export', manual: true,
  where: { tab: 'arrange' },
  text: [
    'Switch to **Song** and play it from the top, ideally without looking at the screen.',
    '• Is there a moment where you lose interest? Take something out there, or add one new thing.',
    '• Does every section feel different from the one before? If two sound the same, change the drums, the register of the melody or which instruments play.',
    '• Make it yours: change notes in the melody first. A melody you wrote yourself over these chords is the most valuable thing you can take away.',
    '• Ctrl+S keeps a history point. **File → Export audio** renders the song to a .wav.',
    'Then play it to someone, and start another guide with what you learned.',
  ],
  check: () => false,
};

// ---------- SAD SONG (MINOR) ----------
const SAD_VERSE = [
  [[0, 6, 4], [6, 2, 3], [8, 8, 2]], [[0, 12, 3], [12, 4, 2]], [[0, 4, 0], [4, 4, 2], [8, 8, 4]], [[0, 16, 1]],
  [[0, 6, 4], [6, 2, 5], [8, 8, 4]], [[0, 8, 5], [8, 4, 3], [12, 4, 2]], [[0, 8, 2], [8, 8, 0]], [[0, 16, -1]],
];
const SAD_CHORUS = [
  [[0, 8, 7], [8, 4, 9], [12, 4, 7]], [[0, 12, 10], [12, 4, 9]], [[0, 8, 7], [8, 4, 6], [12, 4, 4]], [[0, 16, 6]],
  [[0, 8, 9], [8, 8, 7]], [[0, 8, 5], [8, 8, 3]], [[0, 8, 4], [8, 4, 2], [12, 4, 0]], [[0, 16, 1]],
];
const SAD_OUTRO = [[[0, 16, 4]], [[0, 16, 2]], [[0, 16, 5]], [[0, 16, 3]], [[0, 16, -1]], [[0, 16, 1]], [[0, 32, 0]], []];
const SAD_ARP = { rate: 2, len: 3, shape: [0, 2, 3, 4, 3, 2, 3, 2], vels: [0.62, 0.44, 0.5, 0.44] };

const sadminor = {
  id: 'sadminor', name: 'Sad song (minor)', category: 'mood', bpm: 66, root: 9, scale: 'minor', swing: 0,
  test: { lowNotes: 100, minDrums: 0, minSecs: 240 },
  blurb: 'Plainly sad, no hope in it. A minor key, chords that never lift to major, a slow piano, low strings and a cello that sighs downward.',
  lanes: [{ name: 'Piano, cello & low strings', roles: ['intro', 'verse', 'chorus', 'outro'] }, { name: 'Strings', roles: ['stringsV', 'stringsC'] }],
  patterns: [['intro', 'Intro', 8], ['verse', 'Verse', 8], ['chorus', 'Chorus', 8], ['outro', 'Outro', 8], ['stringsV', 'Strings: verse', 4], ['stringsC', 'Strings: chorus', 4]],
  tracks: [['piano', 'Piano', 'piano', 3], ['cello', 'Cello', 'sm_cello', 3], ['bass', 'Low strings', 'sm_bass', 1]],
  chordsPatch: ['sm_strings', 3],
  patches: {
    sm_strings: synth('Dark Strings', { wave: 'sawtooth', wave2: 'sawtooth', mix2: 0.5, detune: 12, unison: 3, attack: 0.9, decay: 1, sustain: 0.85, release: 1.6,
      cutoff: 1700, resonance: 0.6, vibrato: 7, vibratoRate: 4.6, vibratoDelay: 0.5, volume: 0.36 }),
    sm_cello: synth('Cello-ish', { wave: 'sawtooth', wave2: 'triangle', mix2: 0.45, detune: 3, attack: 0.25, decay: 0.5, sustain: 0.9, release: 0.7,
      cutoff: 1900, resonance: 0.8, vibrato: 16, vibratoRate: 4.8, vibratoDelay: 0.35, volume: 0.48 }),
    sm_bass: synth('Contrabass', { wave: 'sawtooth', wave2: 'triangle', mix2: 0.6, detune: 2, attack: 0.18, decay: 0.6, sustain: 0.85, release: 0.6,
      cutoff: 650, resonance: 0.7, volume: 0.55 }),
  },
  drumParams: {},
  workSections: [
    { name: 'Intro', bars: 8, layers: ['intro'] }, { name: 'Verse', bars: 8, layers: ['verse', 'stringsV'] },
    { name: 'Chorus', bars: 8, layers: ['chorus', 'stringsC'] }, { name: 'Outro', bars: 8, layers: ['outro'] },
  ],
  sections: [
    { name: 'Intro', bars: 8, layers: ['intro'], note: 'piano alone, low and slow.' },
    { name: 'Verse', bars: 16, layers: ['verse'], note: 'the cello enters with the low strings under it.' },
    { name: 'Chorus', bars: 16, layers: ['chorus', 'stringsC@8'], note: 'the cello climbs high; strings creep in halfway.' },
    { name: 'Verse 2', bars: 16, layers: ['verse', 'stringsV'], note: 'the same verse, now with strings all through.' },
    { name: 'Chorus 2', bars: 16, layers: ['chorus', 'stringsC'], note: 'everything at once, the emotional peak.' },
    { name: 'Outro', bars: 8, layers: ['outro'], note: 'piano and the last cello phrase, slowing onto the home chord.' },
  ],
  steps: [
    { id: 'setup', title: 'Tempo, key and the mood', where: { tab: 'arrange' },
      text: [
        'This guide makes a **plainly sad** piece: no silver lining, no bittersweet major chords pulling the other way. Piano, a cello and strings.',
        '**66 BPM** in **A minor**. Slow tempos sound heavy because each note has time to hang. The minor scale (A B C D E F G) gives the dark colour.',
        'The difference from the *Sad instrumental* guide: that one stays in a major key and leans on its minor chords (bittersweet). This one lives in minor and **never resolves to anything bright**.',
        'It is built in song form: Intro, Verse, Chorus, Outro patterns (piano, cello and low strings together) and two Strings layers. **Play** runs a short draft in that order.',
      ],
      check: () => true },
    { id: 'chords', title: 'Chords that never lift', where: { tab: 'compose', role: 'verse', scroll: 'chords' },
      text: [
        'One chord per bar. In a minor key the main chords are **i** (Am), **iv** (Dm) and **v** (Em), all three minor. Keep it that way.',
        '• **Verse: i – iv – i – v** (Am – Dm – Am – Em). Three minor chords: dark, still, no way out.',
        '• **Chorus: VI – iv – i – v** (F – Dm – Am – Em). The F is major, but it falls straight back into minor chords, so it sounds like a sigh, not hope.',
        '• **Outro**: i – iv – v – i, two bars each, finally ending on Am.',
        'A theory note: many songs swap the minor **v** for a major **V** (E major) to make a strong pull home. That pull feels like drama and relief. Leaving the v minor keeps it **resigned** instead.',
      ],
      do: (p, c) => {
        for (const r of ['intro', 'verse', 'stringsV']) slotsInto(c.pat(r), [0, 3, 0, 4], 16);
        for (const r of ['chorus', 'stringsC']) slotsInto(c.pat(r), [5, 3, 0, 4], 16);
        slotsInto(c.pat('outro'), [0, 3, 4, 0], 32);
      },
      check: (p, c) => hasChords(c, 'verse') && hasChords(c, 'chorus') && hasChords(c, 'outro') },
    { id: 'piano', title: 'Piano: low broken chords', where: { tab: 'compose', role: 'verse', scroll: 'tracks', track: 'piano' },
      text: [
        'The piano is the floor everything stands on. Two hands:',
        '• **Left hand**: the chord’s root, low, one long note per bar.',
        '• **Right hand**: the chord broken into slow 8th notes: root, 5th, octave, 3rd above it, back down. Only the teal rows.',
        '• **Chorus**: block chords on beats 1 and 3 instead. Changing the piano’s pattern is the cheapest way to make a chorus feel different.',
        '• Keep it soft. Sad music is rarely loud; velocity around 50–60% (Alt+wheel on a note changes it).',
      ],
      do: (p, c) => {
        for (const r of ['intro', 'verse']) {
          const v = c.view(r);
          abstractNotes(p, c, r, 'piano', [...arp(v, { ...SAD_ARP, vels: r === 'intro' ? [0.55, 0.38, 0.44, 0.38] : SAD_ARP.vels }), ...leftHand(v)]);
        }
        const ch = c.view('chorus');
        abstractNotes(p, c, 'chorus', 'piano', [...stabs(ch, [[0, 8, 0.62], [8, 8, 0.54]]), ...leftHand(ch, { vel: 0.66 })]);
        const o = c.view('outro');
        const last = chordAt(o, 96);
        const r0 = fold(last.semis[0]);
        abstractNotes(p, c, 'outro', 'piano', [...arp(o, { ...SAD_ARP, skip: s => s >= 96 }), ...leftHand(o, { vel: 0.55 }).filter(n => n.step < 96),
          ...last.semis.map(t => ({ step: 96, len: 32, semis: r0 + t - last.semis[0], vel: 0.5 })), { step: 96, len: 32, semis: r0 - 12, vel: 0.55 }]);
      },
      check: (p, c) => hasNotes(c, 'verse', 'piano') && hasNotes(c, 'chorus', 'piano') },
    { id: 'bass', title: 'Low strings', where: { tab: 'compose', role: 'verse', scroll: 'tracks', track: 'bass' },
      text: [
        'A **contrabass** under the piano: one long root note per chord, very low.',
        '• It doubles the piano’s left hand an octave lower. Doubling the root low is what makes an orchestra sound deep.',
        '• Leave it out of the Intro, so the verse arrives with weight.',
        'Sidebar → Bassline ideas → **Long roots** writes exactly this for the open pattern.',
      ],
      do: (p, c) => { for (const r of ['verse', 'chorus', 'outro']) abstractNotes(p, c, r, 'bass', bassLine(c.view(r), 'roots')); },
      check: (p, c) => hasNotes(c, 'verse', 'bass') },
    { id: 'melody', title: 'The cello: falling lines', where: { tab: 'compose', role: 'verse', scroll: 'tracks', track: 'cello' },
      text: [
        'Sadness in melody comes from a few simple habits:',
        '• **Falling** lines. Phrases that start high and step down sound like sighing or giving up. Rising ones sound hopeful.',
        '• **The sigh**: a long note followed by the note just below it (E → D, F → E). Classical composers used it for weeping for 400 years.',
        '• **Long notes and space.** Few notes, each one held. End phrases on long notes and leave a breath before the next.',
        '• **Verse low** (around the A below middle C), **chorus high**: a cello reaching up into its top register sounds strained, almost crying. That register change is the chorus.',
        'Land on teal rows (chord notes) when a chord changes. In between, step through the scale.',
      ],
      do: (p, c) => {
        notes(c, 'verse', 'cello', barsToNotes(SAD_VERSE, 0.7));
        notes(c, 'chorus', 'cello', barsToNotes(SAD_CHORUS, 0.8));
        notes(c, 'outro', 'cello', barsToNotes(SAD_OUTRO, 0.62));
      },
      check: (p, c) => hasNotes(c, 'verse', 'cello') && hasNotes(c, 'chorus', 'cello') },
    { id: 'strings', title: 'Strings', where: { tab: 'compose', role: 'stringsC', scroll: 'chords' },
      text: [
        'Sustained strings fill the space between piano and cello. The two Strings patterns already hold the verse and chorus chords.',
        '• Untick **guide only** in each so they play. Keep **smooth** on: each chord moves to the next by the smallest steps.',
        '• The strings have a slow attack, so each chord swells in rather than starting with a hit. That swell is a lot of the emotion.',
        '• They are only 4 bars long: the chords repeat every 4 bars, so a longer pattern would just be a copy. The song loops them.',
      ],
      do: (p, c) => {
        for (const r of ['stringsV', 'stringsC']) c.pat(r).chordsGuide = false;
        Object.assign(p.chords, { style: 'block', octave: 3, voiceLead: true, volume: 0.42 });
      },
      check: (p, c) => hasChords(c, 'stringsC') && !c.pat('stringsC').chordsGuide && !c.pat('stringsV').chordsGuide },
    { id: 'mix', title: 'Mix: a dark room', where: { tab: 'mix' },
      text: [
        'For a sad piece, mix for **darkness and distance**:',
        '• **Low-pass** the strings and piano a little (Mix & FX → Low-pass ~5 kHz). Less top end sounds muffled and heavy, like hearing it through a wall.',
        '• A long **reverb** on everything except the low strings: the instruments sound alone in a big empty space.',
        '• The **cello** sits on top, a touch louder. Everything else supports it.',
        '• High-pass the strings (~150 Hz) so they don’t muddy the bass.',
      ],
      do: (p, c) => {
        fx(c.track('piano'), { reverb: 0.42, cutoff: 6000, comp: 0.15 });
        fx(c.track('cello'), { reverb: 0.45, delay: 0.08, hpCut: 70 });
        Object.assign(c.track('cello'), { volume: 0.8 });
        fx(c.track('bass'), { reverb: 0.12, eqHigh: -4 });
        Object.assign(c.track('bass'), { volume: 0.7 });
        fx(p.chords, { reverb: 0.55, hpCut: 150, cutoff: 5000, pump: 0 });
        Object.assign(p.fxBus, { reverbSize: 4.2, delaySteps: 6, delayFeedback: 0.28 });
      },
      check: (p, c) => c.track('piano').fx.reverb > 0 },
    { id: 'arrange', title: 'Arrange the song', where: { tab: 'arrange' },
      get text() {
        return songArrangeText(sadminor, ['A slow sad piece grows by **adding layers**, not by getting faster: strings creep in, then stay, and at the end almost everything leaves again.']);
      },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 7 },
    { id: 'automate', title: 'Automation: swells and a fade', where: { tab: 'arrange' },
      text: [
        'Dynamics carry slow music. Three lanes:',
        '• **Strings volume** rising through the first chorus and peaking in the second.',
        '• **Cello reverb** opening up in the outro, so the last phrase drifts away.',
        '• A **fade-out** on the master over the last bars.',
        'In Arrange use **+ Automate…**. Shift+drag draws a curve freehand.',
      ],
      do: (p, c) => {
        const S = sectionStarts(c.G);
        lane(p, 'chords|volume', [[S.Chorus + 8, 0.08], [S.Chorus + 16, 0.3], [S['Verse 2'], 0.26], [S['Chorus 2'], 0.34], [S['Chorus 2'] + 12, 0.42], [S.Outro, 0.3]]);
        lane(p, `${c.track('cello').id}|reverb`, [[S.Outro, 0.45], [S.END, 0.75]]);
        lane(p, 'master|master', [[S.END - 4, 0.667], [S.END, 0]]);
      },
      check: p => p.song.auto.some(l => l.points.length >= 2) },
    songFinish,
  ],
};

// ---------- 12-BAR BLUES ----------
// Each bar of the form is the home chord of its own mixolydian scale (three dominant 7ths): the pattern changes key with the chord.
const BLUES_KEYS = [[4, 0], [6, 7], [8, 2], [9, 0], [10, 7], [11, 2]].map(([bar, root]) => ({ bar, root, scale: 'mixolydian' }));
const BLUES_ROOTS = [7, 7, 7, 7, 0, 0, 7, 7, 2, 0, 7, 2]; // G G G G C C G G D C G D
const BOOGIE = [0, 4, 7, 9, 10, 9, 7, 4];
const BLUES_HEAD = [
  [[2, 2, 70], [4, 2, 71], [6, 4, 74], [10, 2, 77], [12, 4, 74]], [[0, 2, 74], [2, 2, 72], [4, 10, 67]], [], [],
  [[2, 2, 70], [4, 2, 72], [6, 4, 74], [10, 2, 77], [12, 4, 74]], [[0, 2, 74], [2, 2, 72], [4, 10, 67]], [], [],
  [[0, 6, 78], [6, 2, 77], [8, 4, 74], [12, 4, 72]], [[0, 4, 70], [4, 4, 72], [8, 8, 67]],
  [[0, 4, 71], [4, 4, 67], [8, 4, 74], [12, 4, 71]], [[4, 2, 69], [6, 2, 72], [8, 8, 74]],
];
// G blues scale (G B♭ C D♭ D F) over two octaves
const BLUES_SCALE = [62, 65, 67, 70, 72, 73, 74, 77, 79, 82, 84, 86];

function bluesSolo(seed, busy) {
  const rnd = rng(seed), out = [];
  const cells = busy ? [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]], [[0, 6], [6, 2], [8, 2], [10, 6]]]
    : [[[2, 2], [4, 2], [6, 6], [12, 4]], [[0, 8], [8, 8]]];
  let i = 6, dir = 1;
  for (let bar = 0; bar < 12; bar++) {
    if (!busy && bar % 4 === 3) continue; // a breath at the end of each line
    const root = BLUES_ROOTS[bar];
    const tones = [0, 4, 7, 10].map(x => (root + x) % 12);
    const cell = bar === 11 ? [[0, 4], [4, 12]] : cells[bar % 2];
    for (const [s, len] of cell) {
      if (s % 4 === 0) {
        for (const off of [0, dir, -dir, 2 * dir, -2 * dir, 3 * dir, -3 * dir]) {
          const j = i + off;
          if (j >= 0 && j < BLUES_SCALE.length && tones.includes(BLUES_SCALE[j] % 12)) { i = j; break; }
        }
      } else {
        if (rnd() < 0.3) dir = -dir;
        i = Math.max(0, Math.min(BLUES_SCALE.length - 1, i + dir));
        if (i === 0 || i === BLUES_SCALE.length - 1) dir = -dir;
      }
      out.push([bar * 16 + s, len, BLUES_SCALE[i], s % 4 === 0 ? 0.88 : 0.74]);
    }
  }
  return out;
}

const blues = {
  id: 'blues', name: '12-bar blues', category: 'band', bpm: 92, root: 7, scale: 'mixolydian', swing: 0.33, swingGrid: 8, chordsStyle: 'stabs',
  test: { lowNotes: 300, minDrums: 800, minSecs: 180 },
  blurb: 'The form under most of rock and roll. A shuffle groove, a boogie bass, piano comping, three dominant 7th chords, and a guitar that calls, answers and solos with blue notes.',
  lanes: [{ name: 'Band', roles: ['rhythm', 'ending'] }, { name: 'Lead guitar', roles: ['head', 'solo', 'solo2'] }],
  patterns: [['rhythm', 'Band (12 bars)', 12], ['head', 'Head melody', 12], ['solo', 'Solo 1', 12], ['solo2', 'Solo 2', 12], ['ending', 'Ending', 4]],
  patternKeys: {
    rhythm: { keyChanges: BLUES_KEYS }, head: { keyChanges: BLUES_KEYS }, solo: { keyChanges: BLUES_KEYS }, solo2: { keyChanges: BLUES_KEYS },
    ending: { root: 2, keyChanges: [{ bar: 1, root: 0, scale: 'mixolydian' }, { bar: 2, root: 7, scale: 'mixolydian' }] },
  },
  tracks: [['bass', 'Bass', 'ebass', 2, 'piano'], ['lead', 'Lead guitar', 'bl_lead', 4, 'piano']],
  chordsPatch: ['piano', 3],
  drumsVolume: 0.75,
  patches: {
    bl_lead: synth('Blues Guitar', { wave: 'sawtooth', wave2: 'square', mix2: 0.3, detune: 5, attack: 0.004, decay: 0.5, sustain: 0.55, release: 0.25,
      cutoff: 2600, resonance: 2, filterEnv: 1800, filterDecay: 0.3, vibrato: 22, vibratoRate: 5.5, vibratoDelay: 0.2, volume: 0.4 }),
  },
  drumParams: { kick: { tune: 55, decay: 0.4, punch: 2, click: 0.2 }, snare: { tune: 200, decay: 0.18, snappy: 0.5 }, ride: { decay: 0.8, tone: 6000 } },
  workSections: [
    { name: 'Intro', bars: 12, layers: ['rhythm'] }, { name: 'Head', bars: 12, layers: ['rhythm', 'head'] },
    { name: 'Solo', bars: 12, layers: ['rhythm', 'solo'] }, { name: 'Ending', bars: 4, layers: ['ending'] },
  ],
  sections: [
    { name: 'Intro', bars: 12, layers: ['rhythm'], note: 'the band plays the form once on its own.' },
    { name: 'Head', bars: 12, layers: ['rhythm', 'head'], note: 'the melody: a riff, the same riff over the IV chord, then the answer.' },
    { name: 'Head 2', bars: 12, layers: ['rhythm', 'head'], note: 'the melody again, so it sticks.' },
    { name: 'Solo', bars: 12, layers: ['rhythm', 'solo'], note: 'first solo chorus: short phrases with space.' },
    { name: 'Solo 2', bars: 12, layers: ['rhythm', 'solo2'], note: 'second chorus: busier and higher, building.' },
    { name: 'Head 3', bars: 12, layers: ['rhythm', 'head'], note: 'back to the melody, the way jazz and blues tunes end.' },
    { name: 'Ending', bars: 4, layers: ['ending'], note: 'the last line of the form with a final hit.' },
  ],
  steps: [
    { id: 'setup', title: 'The 12-bar form', where: { tab: 'arrange' },
      text: [
        'The **12-bar blues** is the most influential pattern in popular music: blues, early rock and roll, a lot of jazz, punk and funk come out of it.',
        'It is **12 bars** using only three chords, **I, IV and V** (here G, C and D):',
        '• | G | G | G | G | C | C | G | G | D | C | G | D |',
        'Three lines of four bars. Line 1 states, line 2 repeats over a new chord, line 3 resolves: **call, call, answer**. The last bar (D) is the **turnaround** that throws you back to the top.',
        '**92 BPM** with a **shuffle** (Swing on 8ths): every off-beat 8th comes late, making a long-short “da-dum, da-dum” feel. The top bar shows Swing 33% on an 8th grid.',
      ],
      check: () => true },
    { id: 'chords', title: 'Three dominant 7ths', where: { tab: 'compose', role: 'rhythm', scroll: 'chords' },
      text: [
        'Blues breaks a rule of classical harmony: **every chord is a dominant 7th** (G7, C7, D7). Each one has a flat 7th, which normally means “tension, resolve me”. In blues nothing resolves; it just grooves.',
        'Because of that, each chord is the home chord of its **own** mixolydian scale (a major scale with a flat 7th). So this pattern **changes key with the chord**: G in bars 1–4, C in 5–6, and so on (see the Key row). Each chord is a **I7** of its own key.',
        '• Put a **7th** chord on degree 1 in every bar. The chord lane plays the piano part: offbeat stabs (“comping”), which the swing turns into a shuffle.',
        '• Untick **guide only** in the Band pattern so the piano plays.',
      ],
      do: (p, c) => {
        for (const r of ['rhythm', 'head', 'solo', 'solo2']) slotsInto(c.pat(r), [0], 16, ['seventh'], r !== 'rhythm');
        const end = c.pat('ending');
        end.chordSlots = [{ deg: 0, type: 'seventh' }, { deg: 0, type: 'seventh' }, { deg: 0, type: 'seventh' }, null];
        end.slotSteps = 16; end.chordsGuide = false;
        Object.assign(p.chords, { style: 'stabs', octave: 3, voiceLead: true, volume: 0.5 });
      },
      check: (p, c) => hasChords(c, 'rhythm') && !c.pat('rhythm').chordsGuide },
    { id: 'drums', title: 'The shuffle beat', where: { tab: 'compose', role: 'rhythm', scroll: 'drums' },
      text: [
        'A blues shuffle on drums:',
        '• **Ride** cymbal: “ding, ding-a, ding, ding-a”: beats 1 and 3, and beats 2 and 4 with the swung 8th after them.',
        '• **Snare** on 2 and 4 (the backbeat), **kick** on 1 and 3, softly.',
        '• **Hi-hat pedal** (closed hat) on 2 and 4 with the snare.',
        '• A small **fill** in the last bar (the turnaround) and a **crash** at the top of each 12.',
        'Write one bar, then ⋯ → Repeat on each row. Swing is applied while playing; write the notes straight.',
      ],
      do: (p, c) => drums(p, c, 'rhythm', {
        kick: 'x.......x.......', chat: '....x.......x...', ride: 'x...x.x.x...x.x.',
        snare: '....x.......x...'.repeat(11) + '....x.....x.xXxX', cymbal: 'X' + '.'.repeat(191),
      }),
      check: (p, c) => hasDrums(c, 'rhythm', ['ride', 'snare']) },
    { id: 'bass', title: 'Boogie bass', where: { tab: 'compose', role: 'rhythm', scroll: 'tracks', track: 'bass' },
      text: [
        'The **boogie-woogie** bass line, in swung 8ths, on every chord: **1 – 3 – 5 – 6 – ♭7 – 6 – 5 – 3**.',
        '• On G: G B D E F E D B. On C and D the same shape starts from their root. Because the pattern changes key with the chord, you can copy one bar and only move it to the new root.',
        '• This one riff is the left hand of boogie-woogie piano, Chuck Berry’s guitar and countless rock songs.',
        'The bass is a **piano-mode** track (fixed pitches): blues uses notes outside the scale, so the roll shows all 12.',
      ],
      do: (p, c) => {
        const out = [];
        for (let bar = 0; bar < 12; bar++) BOOGIE.forEach((s, i) => out.push({ step: bar * 16 + i * 2, len: 2, semis: s, vel: i % 2 ? 0.72 : 0.9 }));
        abstractNotes(p, c, 'rhythm', 'bass', out);
      },
      check: (p, c) => hasNotes(c, 'rhythm', 'bass') },
    { id: 'head', title: 'The head: call and response', where: { tab: 'compose', role: 'head', scroll: 'tracks', track: 'lead' },
      text: [
        'The melody (“head”) follows the form’s **AAB** shape, like a blues lyric: a line, the same line again, then an answer.',
        '• Bars 1–2: a short **riff**. Bars 3–4: silence, the band answers.',
        '• Bars 5–6: the **same riff** over C, with one note changed to fit (B → C). Bars 7–8: silence.',
        '• Bars 9–12: the **answer**, a longer phrase that comes home to G, and a turnaround lick over D.',
        'The riff mixes **B♭ and B**: the minor 3rd against the major chord is the **blue note**. Singers and guitarists bend between the two. That clash IS the blues.',
        'The top bar will say some notes are **outside the scale**. In blues that is the point, so leave them (don’t press Snap to scale).',
      ],
      do: (p, c) => midis(c, 'head', 'lead', barsToMidis(BLUES_HEAD)),
      check: (p, c) => hasNotes(c, 'head', 'lead') },
    { id: 'solo', title: 'Soloing with the blues scale', where: { tab: 'compose', role: 'solo', scroll: 'tracks', track: 'lead' },
      text: [
        'The **blues scale** in G: **G B♭ C D♭ D F**. It is the minor pentatonic plus one extra “blue” note (D♭, the ♭5). Almost any note of it sounds right over all three chords.',
        '• **Land on chord notes on the beat** (teal rows are the chord): G, B, D, F over G7; C, E, G, B♭ over C7; D, F♯, A, C over D7.',
        '• **Leave space.** The first solo chorus plays short phrases with rests; the second gets busier and higher. That growth is the solo’s story.',
        '• Repeat a lick and vary its ending. Blues soloing is conversation, not scales.',
        'Do it for me writes two solo choruses. Rewrite parts of them; it is the best way to learn the scale.',
      ],
      do: (p, c) => { midis(c, 'solo', 'lead', bluesSolo(7, false)); midis(c, 'solo2', 'lead', bluesSolo(21, true)); },
      check: (p, c) => hasNotes(c, 'solo', 'lead') && hasNotes(c, 'solo2', 'lead') },
    { id: 'ending', title: 'The ending', where: { tab: 'compose', role: 'ending', scroll: 'tracks', track: 'lead' },
      text: [
        'Blues tunes end on the **last line** of the form (D – C – G) and a final hit:',
        '• The band plays bars 9–11, then **stops together** on beat 1 of the last bar.',
        '• The guitar plays a descending blues-scale run into the last G and holds it.',
        '• The drums finish with a crash on the final hit. Stopping together is what makes it sound like an ending and not a fade.',
      ],
      do: (p, c) => {
        drums(p, c, 'ending', {
          kick: 'x.......x.......x.......x.......x.......x.......X...............',
          snare: '....x.......x.......x.......x.......x.....x.xXxX................',
          ride: 'x...x.x.x...x.x.x...x.x.x...x.x.x...x.x.x...x.x.................', cymbal: '.'.repeat(48) + 'X...............',
        });
        const out = [];
        for (let bar = 0; bar < 3; bar++) BOOGIE.forEach((s, i) => out.push({ step: bar * 16 + i * 2, len: 2, semis: s, vel: i % 2 ? 0.72 : 0.9 }));
        out.push({ step: 48, len: 16, semis: 0, vel: 0.95 });
        abstractNotes(p, c, 'ending', 'bass', out);
        midis(c, 'ending', 'lead', barsToMidis([[[0, 6, 78], [6, 2, 77], [8, 8, 74]], [[0, 4, 70], [4, 4, 72], [8, 8, 67]],
          [[0, 2, 79], [2, 2, 77], [4, 2, 74], [6, 2, 73], [8, 1, 72], [10, 2, 70], [12, 4, 67]], [[0, 16, 67, 0.9]]]));
      },
      check: (p, c) => hasNotes(c, 'ending', 'lead') && hasDrums(c, 'ending', ['kick']) },
    { id: 'mix', title: 'Mix: a band in a room', where: { tab: 'mix' },
      text: [
        'Mix it like a small band playing together:',
        '• **Drive** on the lead guitar (amp distortion), and a short **delay** for a slapback echo.',
        '• **Pan** the piano a little left and the guitar a little right, so they don’t sit on top of each other. Bass and drums stay in the middle.',
        '• A shared, medium **reverb**: one room for everybody.',
        '• Drums under the band: the ride and snare should feel like texture, not the lead.',
      ],
      do: (p, c) => {
        fx(c.track('lead'), { drive: 0.35, delay: 0.16, reverb: 0.25, hpCut: 150 });
        Object.assign(c.track('lead'), { pan: 0.25, volume: 0.75 });
        fx(p.chords, { reverb: 0.22, hpCut: 140 });
        Object.assign(p.chords, { pan: -0.3 });
        fx(c.track('bass'), { comp: 0.3 });
        fx(p.drums, { reverb: 0.18, comp: 0.2 });
        Object.assign(p.fxBus, { reverbSize: 1.8, delaySteps: 2, delayFeedback: 0.15 });
      },
      check: (p, c) => c.track('lead').fx.drive > 0 },
    { id: 'arrange', title: 'Arrange: choruses of the form', where: { tab: 'arrange' },
      get text() {
        return songArrangeText(blues, ['In blues and jazz each trip through the 12 bars is called a **chorus**. A tune is just several choruses: the head, solos, the head again, and an ending.']);
      },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 10 },
    songFinish,
  ],
};

// ---------- BASIC ROCK ----------
const ROCK_VERSE = [
  [[0, 2, 4], [2, 2, 4], [4, 4, 4], [8, 2, 2], [10, 2, 4], [12, 4, 2]], [[0, 2, 3], [2, 2, 3], [4, 4, 5], [8, 8, 3]],
  [[0, 2, 2], [2, 2, 2], [4, 4, 4], [8, 2, 2], [10, 2, 1], [12, 4, 0]], [[0, 12, 1], [12, 4, -1]],
  [[0, 2, 4], [2, 2, 4], [4, 4, 7], [8, 4, 4], [12, 4, 2]], [[0, 4, 5], [4, 4, 3], [8, 8, 5]],
  [[0, 2, 4], [2, 2, 2], [4, 4, 0], [8, 8, 2]], [[0, 16, 1]],
];
const ROCK_CHORUS = [
  [[0, 8, 7], [8, 4, 8], [12, 4, 7]], [[0, 8, 8], [8, 8, 6]], [[0, 4, 9], [4, 4, 8], [8, 8, 7]], [[0, 12, 5], [12, 4, 4]],
  [[0, 8, 7], [8, 4, 8], [12, 4, 10]], [[0, 8, 8], [8, 8, 11]], [[0, 4, 9], [4, 4, 8], [8, 8, 7]], [[0, 16, 9]],
];
const MAJOR_PENT = [-3, -2, 0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14]; // E F♯ A B C♯ E F♯ A B C♯ E F♯ A (in A major degrees)
const RK = { // one drum bar per string
  verse: { kick: 'x.......x.x.....', snare: '....x.......x...', chat: 'x.x.x.x.x.x.x.x.' },
  fill: { kick: 'x.......x.......', snare: '....x.......xxxx', htom: '........xx......', ltom: '..........xx....' },
};

const rock = {
  id: 'rock', name: 'Basic rock', category: 'band', bpm: 120, root: 9, scale: 'major', swing: 0,
  test: { lowNotes: 500, minDrums: 1200, minSecs: 180 },
  blurb: 'Guitars, bass and drums. Power chords in 8ths, a backbeat, a verse that holds back and a chorus that opens up, an organ, and a guitar solo.',
  lanes: [{ name: 'Band', roles: ['intro', 'verse', 'chorus', 'solo', 'outro'] }],
  patterns: [['intro', 'Intro', 4], ['verse', 'Verse', 8], ['chorus', 'Chorus', 8], ['solo', 'Guitar solo', 16], ['outro', 'Outro', 4]],
  tracks: [['guitar', 'Rhythm guitar', 'rk_gtr', 2], ['bass', 'Bass', 'ebass', 1], ['lead', 'Lead guitar', 'rk_lead', 3]],
  chordsPatch: ['rk_organ', 3],
  patches: {
    rk_gtr: synth('Rhythm Guitar', { wave: 'sawtooth', wave2: 'square', mix2: 0.4, detune: 8, attack: 0.002, decay: 0.3, sustain: 0.7, release: 0.08,
      cutoff: 2400, resonance: 1.5, filterEnv: 1500, filterDecay: 0.15, volume: 0.32 }),
    rk_lead: synth('Lead Guitar', { wave: 'sawtooth', wave2: 'square', mix2: 0.35, detune: 6, attack: 0.004, decay: 0.4, sustain: 0.75, release: 0.2,
      cutoff: 3200, resonance: 2, filterEnv: 1200, vibrato: 20, vibratoRate: 5.8, vibratoDelay: 0.22, volume: 0.34 }),
    rk_organ: synth('Organ', { wave: 'sine', wave2: 'square', octave2: 1, mix2: 0.25, detune: 4, attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.12,
      cutoff: 4200, vibrato: 6, vibratoRate: 6.5, vibratoDelay: 0, volume: 0.3 }),
  },
  drumParams: { kick: { tune: 58, decay: 0.45, punch: 3, click: 0.5 }, snare: { tune: 190, decay: 0.24, snappy: 0.8 } },
  workSections: [
    { name: 'Intro', bars: 4, layers: ['intro'] }, { name: 'Verse', bars: 8, layers: ['verse'] }, { name: 'Chorus', bars: 8, layers: ['chorus'] },
    { name: 'Solo', bars: 16, layers: ['solo'] }, { name: 'Outro', bars: 4, layers: ['outro'] },
  ],
  sections: [
    { name: 'Intro', bars: 4, layers: ['intro'], note: 'ringing guitar chords, then a drum fill kicks the band in.' },
    { name: 'Verse', bars: 16, layers: ['verse'], note: 'palm-muted guitar, steady beat, the melody low.' },
    { name: 'Chorus', bars: 16, layers: ['chorus'], note: 'open chords, crashes, organ, the melody up high.' },
    { name: 'Verse 2', bars: 16, layers: ['verse'], note: 'back down, so the next chorus can hit again.' },
    { name: 'Chorus 2', bars: 16, layers: ['chorus'], note: 'the chorus again.' },
    { name: 'Solo', bars: 16, layers: ['solo'], note: 'a guitar solo over new chords.' },
    { name: 'Chorus 3', bars: 16, layers: ['chorus'], note: 'the last chorus, everything in.' },
    { name: 'Outro', bars: 4, layers: ['outro'], note: 'two more bars of chords and one big final chord ringing out.' },
  ],
  steps: [
    { id: 'setup', title: 'A rock band in 4 parts', where: { tab: 'arrange' },
      text: [
        'This guide writes a **basic rock song**: rhythm guitar, bass, drums, a lead guitar for the melody (where a singer would be) and an organ in the chorus.',
        '**120 BPM**, in **A major**. Rock guitar loves A and E: they are the guitar’s open strings.',
        'Song form, one pattern per section: Intro, Verse, Chorus, Guitar solo, Outro. Each holds the whole band for that part. **Play** runs a short draft.',
        'The main idea of the whole guide: **contrast**. The verse holds back so the chorus can explode.',
      ],
      check: () => true },
    { id: 'chords', title: 'Three-chord rock', where: { tab: 'compose', role: 'verse', scroll: 'chords' },
      text: [
        'Most rock songs use the **I, IV and V** chords (here A, D, E), with **vi** (F♯m) for a darker moment.',
        '• **Verse: I – IV – I – V** (A – D – A – E). Stable, home-y, waiting.',
        '• **Chorus: IV – V – I – vi** (D – E – A – F♯m). Starting away from home and climbing (IV, V) makes the chorus feel like a lift-off.',
        '• **Solo: vi – IV – I – V** (F♯m – D – A – E). New chords for the solo keep the middle of the song fresh.',
        '• Intro uses the verse chords; the Outro plays IV – V, then I for two bars.',
        'They are silent guides for the guitar; only the chorus organ plays them.',
      ],
      do: (p, c) => {
        for (const r of ['intro', 'verse']) slotsInto(c.pat(r), [0, 3, 0, 4], 16);
        slotsInto(c.pat('chorus'), [3, 4, 0, 5], 16);
        slotsInto(c.pat('solo'), [5, 3, 0, 4], 16);
        slotsInto(c.pat('outro'), [3, 4, 0, 0], 16);
      },
      check: (p, c) => hasChords(c, 'verse') && hasChords(c, 'chorus') && hasChords(c, 'solo') },
    { id: 'drums', title: 'The rock beat', where: { tab: 'compose', role: 'verse', scroll: 'drums' },
      text: [
        'The basic rock beat, one bar: **kick** on 1 and 3 (with an extra kick on the “and” of 3), **snare** on 2 and 4, **hi-hat** on every 8th.',
        '• The snare on 2 and 4 is the **backbeat**: it is what makes people nod their heads.',
        '• **Chorus**: the same beat but on the **open hat** (washier, louder) with a **crash** on bar 1 and bar 5.',
        '• The last bar of each section gets a **fill**: snare 16ths and a tom run into the next section. Fills tell the listener “something new is coming”.',
        'Write one bar, then ⋯ → Repeat; put the fill in the last bar by hand.',
      ],
      do: (p, c) => {
        const B = (n, bar, last) => Object.fromEntries(['kick', 'snare', 'chat', 'ohat', 'htom', 'ltom', 'cymbal'].map(k => [k, Array.from({ length: n }, (_, i) =>
          i === n - 1 ? (last[k] || '................') : (bar[k] || '................')).join('')]));
        drums(p, c, 'verse', B(8, RK.verse, RK.fill));
        const ch = { kick: 'x.......x.x.....', snare: '....x.......x...', ohat: 'x.x.x.x.x.x.x.x.' };
        const chorus = B(8, ch, RK.fill);
        chorus.cymbal = 'X...............' + '.'.repeat(48) + 'X...............' + '.'.repeat(48);
        drums(p, c, 'chorus', chorus);
        const solo = B(16, { kick: 'x.......x.x.....', snare: '....x.......x...', ride: 'x.x.x.x.x.x.x.x.' }, RK.fill);
        solo.ride = 'x.x.x.x.x.x.x.x.'.repeat(15) + '................';
        solo.cymbal = 'X' + '.'.repeat(255);
        drums(p, c, 'solo', solo);
        drums(p, c, 'intro', { snare: '.'.repeat(48) + '....x...xxxxxxxx', htom: '.'.repeat(48) + '..xx............', cymbal: 'X' + '.'.repeat(63) });
        drums(p, c, 'outro', {
          kick: 'x.......x.x.....x.......x.x.....X...............................', snare: '....x.......x.......x.....xxxxxx' + '.'.repeat(32),
          ohat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.....' + '.'.repeat(32), cymbal: 'X'.padEnd(32, '.') + 'X'.padEnd(32, '.'),
        });
      },
      check: (p, c) => hasDrums(c, 'verse', ['snare']) && hasDrums(c, 'chorus', ['snare']) },
    { id: 'guitar', title: 'Power chords', where: { tab: 'compose', role: 'verse', scroll: 'tracks', track: 'guitar' },
      text: [
        'Rock rhythm guitar plays **power chords**: just the root, the 5th and the octave, no 3rd. With distortion, full chords turn to mush; power chords stay huge and clear. They are neither major nor minor.',
        '• **Verse**: 8th notes, short and tight (**palm-muted**): notes 1 step long. Holding back.',
        '• **Chorus**: 8th notes that ring into each other (2 steps long, louder). Same notes, completely different energy.',
        '• **Intro**: one big chord per bar, left to ring.',
        '• **Solo**: driving 8ths under the lead. **Outro**: 8ths, then one final chord held for two bars.',
        'Each power chord is three notes: the R row, the 5 row and R an octave up.',
      ],
      do: (p, c) => {
        const e8 = (len, v1, v2) => Array.from({ length: 8 }, (_, i) => [i * 2, len, i % 2 ? v2 : v1]);
        abstractNotes(p, c, 'intro', 'guitar', power(c.view('intro'), [[0, 16, 0.9]]));
        abstractNotes(p, c, 'verse', 'guitar', power(c.view('verse'), e8(1, 0.82, 0.66)));
        abstractNotes(p, c, 'chorus', 'guitar', power(c.view('chorus'), e8(2, 0.95, 0.82)));
        abstractNotes(p, c, 'solo', 'guitar', power(c.view('solo'), e8(1.5, 0.85, 0.7)));
        abstractNotes(p, c, 'outro', 'guitar', [...power(c.view('outro'), e8(2, 0.95, 0.82), s => s >= 32), ...power(c.view('outro'), [[0, 32, 1]], s => s !== 32)]);
      },
      check: (p, c) => hasNotes(c, 'verse', 'guitar') && hasNotes(c, 'chorus', 'guitar') },
    { id: 'bass', title: 'Bass: root 8ths', where: { tab: 'compose', role: 'verse', scroll: 'tracks', track: 'bass' },
      text: [
        'Rock bass usually **locks with the kick and the guitar**: the chord’s root on every 8th note.',
        '• It sounds simple, and it is: that is the point. The bass and the guitar together make the wall of sound; the bass adds the weight.',
        '• In the **Intro**, one long root per bar, ringing with the guitar.',
        '• Variation for later: play the root an octave up on the off-beats (Sidebar → Bassline ideas → **Octave bounce**).',
      ],
      do: (p, c) => {
        abstractNotes(p, c, 'intro', 'bass', bassLine(c.view('intro'), 'roots'));
        for (const r of ['verse', 'chorus', 'solo']) abstractNotes(p, c, r, 'bass', bassLine(c.view(r), 'eighths'));
        const o = c.view('outro');
        abstractNotes(p, c, 'outro', 'bass', [...bassLine(o, 'eighths').filter(n => n.step < 32), { step: 32, len: 32, semis: 0, vel: 0.95 }]);
      },
      check: (p, c) => hasNotes(c, 'verse', 'bass') },
    { id: 'melody', title: 'The melody: verse low, chorus high', where: { tab: 'compose', role: 'verse', scroll: 'tracks', track: 'lead' },
      text: [
        'The lead guitar plays what a singer would sing.',
        '• **Verse**: low, **rhythmic**, lots of repeated notes, like talking. Short phrases that end on chord notes.',
        '• **Chorus**: **higher and longer notes**, like shouting along. The highest note of the song belongs in the chorus.',
        '• Both repeat their first 4 bars with a different ending: repetition is how a melody becomes catchy.',
        'Teal rows are the chord’s notes. Rock melodies sit on them on the strong beats.',
      ],
      do: (p, c) => {
        notes(c, 'verse', 'lead', barsToNotes(ROCK_VERSE, 0.74));
        notes(c, 'chorus', 'lead', barsToNotes(ROCK_CHORUS, 0.84));
      },
      check: (p, c) => hasNotes(c, 'verse', 'lead') && hasNotes(c, 'chorus', 'lead') },
    { id: 'solo', title: 'The guitar solo', where: { tab: 'compose', role: 'solo', scroll: 'tracks', track: 'lead' },
      text: [
        'A first guitar solo uses the **major pentatonic** scale: 5 notes (A B C♯ E F♯) out of the 7. No note in it clashes with any chord of the song, so it is very forgiving.',
        '• Hit **chord notes on the beat**, move through the scale between beats.',
        '• Tell a story: start with a few long notes, then faster runs, and save the highest notes for the last 4 bars.',
        '• For a grittier, bluesier sound, try the **minor pentatonic** (A C D E G) over these major chords. The C against the C♯ in the chord is the rock “blue note”.',
      ],
      do: (p, c) => notes(c, 'solo', 'lead', soloLine(c.view('solo'), { seed: 5, pool: MAJOR_PENT, start: 4,
        cells: [[[0, 8], [8, 4], [12, 4]], [[0, 4], [4, 2], [6, 2], [8, 8]], [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4]], [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]]] })),
      check: (p, c) => hasNotes(c, 'solo', 'lead') },
    { id: 'organ', title: 'Organ in the chorus', where: { tab: 'compose', role: 'chorus', scroll: 'chords' },
      text: [
        'Adding **one new instrument in the chorus** is a classic way to make it bigger. An organ holding the chords fills the space between guitar and melody.',
        '• In the Chorus pattern, untick **guide only**: the organ plays the chord lane (block chords, one per bar).',
        '• Keep it quiet. You should miss it when it’s gone more than notice it when it’s there.',
        '• The organ plays full chords (with the 3rd), which the power chords leave out: together they sound complete.',
      ],
      do: (p, c) => { c.pat('chorus').chordsGuide = false; Object.assign(p.chords, { style: 'block', octave: 3, voiceLead: true, volume: 0.42 }); },
      check: (p, c) => hasChords(c, 'chorus') && !c.pat('chorus').chordsGuide },
    { id: 'mix', title: 'Mix: loud guitars, clear vocal', where: { tab: 'mix' },
      text: [
        'Rock mixing in four moves:',
        '• **Drive** on both guitars: that is the amp distortion. More on the rhythm guitar than you’d think.',
        '• **High-pass** the guitars (~120 Hz) so the bass owns the low end, and compress the bass so it stays even.',
        '• The **lead** (the “vocal”) on top: a little louder, with a short delay.',
        '• **Compress** the drums for punch; a little room reverb on the snare side.',
      ],
      do: (p, c) => {
        fx(c.track('guitar'), { drive: 0.6, hpCut: 120, eqMid: -2, comp: 0.25 });
        fx(c.track('lead'), { drive: 0.45, delay: 0.18, reverb: 0.22, hpCut: 180 });
        Object.assign(c.track('lead'), { volume: 0.8 });
        fx(c.track('bass'), { comp: 0.4, drive: 0.15 });
        fx(p.chords, { reverb: 0.2, hpCut: 200 });
        fx(p.drums, { comp: 0.4, reverb: 0.15 });
        Object.assign(p.fxBus, { reverbSize: 1.6, delaySteps: 3, delayFeedback: 0.25 });
      },
      check: (p, c) => c.track('guitar').fx.drive > 0 },
    { id: 'arrange', title: 'Arrange the song', where: { tab: 'arrange' },
      get text() {
        return songArrangeText(rock, ['Verse–chorus form: **V C V C solo C**. Each section is 16 bars (the 8-bar pattern twice). The solo replaces what would be a bridge.']);
      },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 8 },
    songFinish,
  ],
};

// ---------- POP SONG ----------
const POP_VERSE = [
  [[0, 2, 2], [2, 2, 2], [4, 2, 2], [6, 2, 1], [8, 4, 0], [12, 4, 2]], [[0, 4, 0], [4, 4, -2], [8, 8, 0]],
  [[0, 2, 3], [2, 2, 3], [4, 4, 5], [8, 8, 0]], [[0, 8, 1], [8, 8, -1]],
  [[0, 2, 2], [2, 2, 2], [4, 2, 4], [6, 2, 2], [8, 4, 4], [12, 4, 2]], [[0, 4, 2], [4, 4, 0], [8, 8, -2]],
  [[0, 2, 3], [2, 2, 2], [4, 4, 0], [8, 8, -2]], [[0, 16, 1]],
];
const POP_PRE = [[[0, 4, 3], [4, 4, 4], [8, 8, 5]], [[0, 4, 4], [4, 4, 5], [8, 8, 6]], [[0, 6, 5], [6, 2, 6], [8, 8, 7]], [[0, 8, 8], [8, 8, 6]]];
const POP_CHORUS = [
  [[0, 6, 7], [6, 2, 8], [8, 4, 7], [12, 4, 4]], [[0, 8, 6], [8, 4, 4], [12, 4, 6]], [[0, 6, 7], [6, 2, 7], [8, 4, 9], [12, 4, 7]], [[0, 16, 5]],
  [[0, 6, 7], [6, 2, 8], [8, 4, 7], [12, 4, 4]], [[0, 8, 8], [8, 8, 6]], [[0, 4, 7], [4, 4, 5], [8, 8, 2]], [[0, 16, 3]],
];
const POP_BRIDGE = [
  [[0, 12, 2], [12, 4, 0]], [[0, 12, 3], [12, 4, 5]], [[0, 8, 4], [8, 8, 2]], [[0, 16, 1]],
  [[0, 8, 4], [8, 8, 5]], [[0, 8, 7], [8, 8, 5]], [[0, 8, 4], [8, 8, 7]], [[0, 16, 8]],
];

const pop = {
  id: 'pop', name: 'Pop song', category: 'band', bpm: 108, root: 0, scale: 'major', swing: 0,
  test: { lowNotes: 250, minDrums: 800, minSecs: 200 },
  blurb: 'Verse, pre-chorus, chorus, bridge and a key change. The four-chord progression, a hook you can sing, and how a pop song builds energy section by section.',
  lanes: [{ name: 'Song', roles: ['intro', 'verse', 'pre', 'chorus', 'bridge', 'outro'] }, { name: 'Synth hook', roles: ['synth'] }],
  patterns: [['intro', 'Intro', 4], ['verse', 'Verse', 8], ['pre', 'Pre-chorus', 4], ['chorus', 'Chorus', 8], ['bridge', 'Bridge', 8], ['outro', 'Outro', 4], ['synth', 'Synth hook', 4]],
  tracks: [['piano', 'Piano', 'piano', 3], ['bass', 'Bass', 'pp_bass', 2], ['lead', 'Vocal line', 'pp_lead', 4], ['pluck', 'Synth pluck', 'pp_pluck', 4]],
  chordsPatch: ['pp_pad', 3],
  patches: {
    pp_lead: synth('Vocal Lead', { wave: 'square', wave2: 'sawtooth', mix2: 0.3, detune: 5, attack: 0.03, decay: 0.3, sustain: 0.8, release: 0.3,
      cutoff: 2800, resonance: 1, filterEnv: 900, vibrato: 14, vibratoRate: 5.5, vibratoDelay: 0.3, volume: 0.32 }),
    pp_pluck: synth('Pop Pluck', { wave: 'sawtooth', wave2: 'square', mix2: 0.3, detune: 10, unison: 3, attack: 0.002, decay: 0.22, sustain: 0, release: 0.2,
      cutoff: 1800, resonance: 3, filterEnv: 4000, filterDecay: 0.16, volume: 0.36 }),
    pp_pad: synth('Soft Pad', { wave: 'sawtooth', wave2: 'triangle', mix2: 0.6, detune: 16, unison: 3, attack: 0.3, decay: 0.8, sustain: 0.75, release: 0.8,
      cutoff: 2000, volume: 0.36 }),
    pp_bass: synth('Pop Bass', { wave: 'sawtooth', wave2: 'sine', octave2: -1, mix2: 0.5, detune: 3, attack: 0.004, decay: 0.3, sustain: 0.6, release: 0.1,
      cutoff: 700, resonance: 2, filterEnv: 900, volume: 0.6 }),
  },
  drumParams: { kick: { tune: 52, decay: 0.55, punch: 3, click: 0.35 }, clap: { decay: 0.3, tone: 1200 } },
  workSections: [
    { name: 'Intro', bars: 4, layers: ['intro'] }, { name: 'Verse', bars: 8, layers: ['verse'] }, { name: 'Pre-chorus', bars: 4, layers: ['pre'] },
    { name: 'Chorus', bars: 8, layers: ['chorus', 'synth'] }, { name: 'Bridge', bars: 8, layers: ['bridge'] }, { name: 'Outro', bars: 4, layers: ['outro'] },
  ],
  sections: [
    { name: 'Intro', bars: 4, layers: ['intro'], note: 'piano and the synth hook: a taste of the chorus.' },
    { name: 'Verse', bars: 16, layers: ['verse'], note: 'sparse: piano, bass, light drums, the melody low and wordy.' },
    { name: 'Pre-chorus', bars: 4, layers: ['pre'], note: 'rising melody and a snare build: the ramp.' },
    { name: 'Chorus', bars: 16, layers: ['chorus'], note: 'full beat, pad, the hook up high.' },
    { name: 'Verse 2', bars: 16, layers: ['verse', 'synth@8'], note: 'the verse again, with the synth hook sneaking in.' },
    { name: 'Pre-chorus 2', bars: 4, layers: ['pre'], note: 'the ramp again.' },
    { name: 'Chorus 2', bars: 16, layers: ['chorus', 'synth'], note: 'the chorus with the synth hook on top.' },
    { name: 'Bridge', bars: 8, layers: ['bridge'], note: 'new chords, half-time drums, a breather.' },
    { name: 'Final chorus', bars: 16, layers: ['chorus', 'synth'], key: { root: 2, scale: 'major' }, note: 'the chorus a whole tone higher (D major): the key change.' },
    { name: 'Outro', bars: 4, layers: ['outro'], key: { root: 2, scale: 'major' }, note: 'the hook one more time and a last chord.' },
  ],
  steps: [
    { id: 'setup', title: 'How a pop song is built', where: { tab: 'arrange' },
      text: [
        'A pop song is a machine for making the **chorus** feel great. Everything else (verse, pre-chorus, bridge) exists to set it up.',
        '**108 BPM** in **C major**: the easiest key, all white keys.',
        'Sections: **Verse** (tells, low energy), **Pre-chorus** (a short ramp up), **Chorus** (the hook, highest energy), **Bridge** (something different near the end), then a **final chorus** in a higher key.',
        'One pattern per section with piano, bass, drums and the vocal line (played by a synth), plus a synth hook layer. **Play** runs a short draft.',
      ],
      check: () => true },
    { id: 'chords', title: 'The four chords', where: { tab: 'compose', role: 'chorus', scroll: 'chords' },
      text: [
        'Pop runs on a handful of 4-chord loops built from **I, V, vi and IV** (C, G, Am, F):',
        '• **Verse: I – vi – IV – V** (C – Am – F – G). The “50s progression”: gentle and familiar.',
        '• **Pre-chorus: IV – V – vi – V** (F – G – Am – G). It avoids C (home), which builds the need to arrive.',
        '• **Chorus: I – V – vi – IV** (C – G – Am – F). The most-used progression in modern pop. Starting on I makes the chorus feel like arriving.',
        '• **Bridge: vi – IV – I – V** (Am – F – C – G). Same chords, starting on the minor one: suddenly more serious.',
        'The chord lane plays them on a **pad** in the chorus and bridge; elsewhere they are silent guides.',
      ],
      do: (p, c) => {
        for (const r of ['verse']) slotsInto(c.pat(r), [0, 5, 3, 4], 16);
        slotsInto(c.pat('pre'), [3, 4, 5, 4], 16);
        for (const r of ['intro', 'chorus', 'synth']) slotsInto(c.pat(r), [0, 4, 5, 3], 16, null, r !== 'chorus');
        slotsInto(c.pat('bridge'), [5, 3, 0, 4], 16, null, false);
        slotsInto(c.pat('outro'), [5, 3, 4, 0], 16);
      },
      check: (p, c) => hasChords(c, 'verse') && hasChords(c, 'chorus') && hasChords(c, 'bridge') },
    { id: 'drums', title: 'Drums that build', where: { tab: 'compose', role: 'verse', scroll: 'drums' },
      text: [
        'Pop drums change **per section** to steer the energy:',
        '• **Verse**: light. Kick on 1 and the “and” of 3, a **rimshot** on 2 and 4, a shaker on 8ths.',
        '• **Pre-chorus**: kick on every beat, and a **snare roll** that speeds up into the chorus, ending with a short gap of silence.',
        '• **Chorus**: four-on-the-floor kick, **clap + snare** on 2 and 4, off-beat hats, a crash on bar 1.',
        '• **Bridge**: **half-time**: snare only on beat 3. Everything feels slower without changing tempo.',
      ],
      do: (p, c) => {
        drums(p, c, 'verse', { kick: 'x.......x.x.....', rim: '....x.......x...', shaker: 'x.x.x.x.x.x.x.x.' });
        drums(p, c, 'pre', { kick: 'x...x...x...x...'.repeat(3) + 'x...x...x.......', snare: '....x.......x...'.repeat(2) + 'x.x.x.x.x.x.x.x.' + 'xxxxxxxxxxxx....', shaker: 'x.x.x.x.x.x.x.x.' });
        drums(p, c, 'chorus', { kick: 'x...x...x...x...', clap: '....x.......x...', snare: '....x.......x...', chat: '..x...x...x...x.', cymbal: 'X' + '.'.repeat(127) });
        drums(p, c, 'bridge', { kick: 'x.........x.....', snare: '........x.......', shaker: 'x.x.x.x.x.x.x.x.' });
        drums(p, c, 'outro', { kick: 'x...x...x...x...'.repeat(2) + 'X'.padEnd(32, '.'), clap: '....x.......x...'.repeat(2) + '.'.repeat(32), cymbal: '.'.repeat(32) + 'X'.padEnd(32, '.') });
      },
      check: (p, c) => hasDrums(c, 'verse', ['kick']) && hasDrums(c, 'chorus', ['clap']) },
    { id: 'piano', title: 'Piano and bass', where: { tab: 'compose', role: 'verse', scroll: 'tracks', track: 'piano' },
      text: [
        'The piano and bass carry the chords:',
        '• **Verse**: piano chords on every beat, soft, with the left hand on the root. Bass: root and 5th.',
        '• **Pre-chorus**: piano in half notes, bass in 8ths (pushing forward).',
        '• **Chorus**: piano in a syncopated pop rhythm (on 1, the “and” of 1, and 2, and the “and” of 3), bass in driving 8ths.',
        '• **Bridge**: broken chords (arpeggio) and long bass roots. **Intro**: piano only, with the synth.',
        'Teal rows are the chord tones. Sidebar → Bassline ideas writes any of these bass styles.',
      ],
      do: (p, c) => {
        const piano = (r, hits) => { const v = c.view(r); abstractNotes(p, c, r, 'piano', [...stabs(v, hits), ...leftHand(v, { len: 8 }), ...leftHand(v, { len: 8 }).map(n => ({ ...n, step: n.step + 8 }))]); };
        piano('verse', [[0, 4, 0.58], [4, 4, 0.5], [8, 4, 0.55], [12, 4, 0.5]]);
        piano('pre', [[0, 8, 0.62], [8, 8, 0.6]]);
        piano('chorus', [[0, 3, 0.7], [3, 3, 0.6], [6, 4, 0.64], [10, 3, 0.6], [13, 3, 0.58]]);
        piano('intro', [[0, 3, 0.62], [3, 3, 0.55], [6, 4, 0.58], [10, 6, 0.55]]);
        abstractNotes(p, c, 'bridge', 'piano', arp(c.view('bridge'), { rate: 2, len: 2, shape: [0, 1, 2, 3, 4, 3, 2, 1], vels: [0.6, 0.45, 0.5, 0.45] }));
        piano('outro', [[0, 16, 0.6]]);
        abstractNotes(p, c, 'verse', 'bass', bassLine(c.view('verse'), 'rootfifth'));
        for (const r of ['pre', 'chorus', 'outro']) abstractNotes(p, c, r, 'bass', bassLine(c.view(r), 'eighths'));
        abstractNotes(p, c, 'bridge', 'bass', bassLine(c.view('bridge'), 'roots'));
      },
      check: (p, c) => hasNotes(c, 'verse', 'piano') && hasNotes(c, 'chorus', 'bass') },
    { id: 'melody', title: 'Verse and pre-chorus melody', where: { tab: 'compose', role: 'verse', scroll: 'tracks', track: 'lead' },
      text: [
        'A pop vocal melody works on **register**: each section sits a little higher than the one before.',
        '• **Verse**: low and wordy, many short notes on one or two pitches, like speaking. Phrases of 2 bars.',
        '• **Pre-chorus**: each bar starts a step higher than the last (F, G, A, then D). The melody literally climbs toward the chorus.',
        '• Leave the very highest notes for the chorus.',
        'Write it, then hum along. If you can’t sing it, simplify it.',
      ],
      do: (p, c) => { notes(c, 'verse', 'lead', barsToNotes(POP_VERSE, 0.72)); notes(c, 'pre', 'lead', barsToNotes(POP_PRE, 0.78)); },
      check: (p, c) => hasNotes(c, 'verse', 'lead') && hasNotes(c, 'pre', 'lead') },
    { id: 'hook', title: 'The chorus hook', where: { tab: 'compose', role: 'chorus', scroll: 'tracks', track: 'lead' },
      text: [
        'The **hook** is the part people remember. What makes one:',
        '• **High**: the chorus melody starts on high C, the top of the song so far.',
        '• **Repeated**: bars 1–2 and 5–6 are the same; only the endings change. Repetition makes it singable on the second listen.',
        '• **Simple rhythm**: a long note, a quick pickup, then held notes. Long notes on the chord’s top notes.',
        '• **The answer**: bar 4 lands on a long note (the chord’s 3rd, A), bar 8 on F: the end of the loop, not the end of the song.',
      ],
      do: (p, c) => notes(c, 'chorus', 'lead', barsToNotes(POP_CHORUS, 0.84)),
      check: (p, c) => hasNotes(c, 'chorus', 'lead') },
    { id: 'synth', title: 'Synth hook and bridge', where: { tab: 'compose', role: 'synth', scroll: 'tracks', track: 'pluck' },
      text: [
        'Modern pop layers an **instrumental hook** on top: a plucky synth riff that plays the chords as a pattern.',
        '• The **Synth hook** pattern: the chorus chords arpeggiated in 8ths, rising and falling. It also plays in the Intro to tease the chorus.',
        '• It is a separate layer, so the arrangement can add it to the second chorus but not the first: each chorus a bit bigger.',
        '• **Bridge melody**: long notes that start low and climb back up to D, leading into the final chorus.',
      ],
      do: (p, c) => {
        const hook = { rate: 2, len: 2, shape: [0, 1, 2, 3, 2, 1, 2, 4], vels: [0.8, 0.6, 0.7, 0.6] };
        abstractNotes(p, c, 'synth', 'pluck', arp(c.view('synth'), hook));
        abstractNotes(p, c, 'intro', 'pluck', arp(c.view('intro'), { ...hook, vels: [0.66, 0.5, 0.56, 0.5] }));
        notes(c, 'bridge', 'lead', barsToNotes(POP_BRIDGE, 0.74));
        notes(c, 'outro', 'lead', barsToNotes([[[0, 6, 7], [6, 2, 7], [8, 4, 5], [12, 4, 4]], [[0, 16, 5]], [[0, 8, 6], [8, 8, 4]], [[0, 16, 7]]], 0.8));
      },
      check: (p, c) => hasNotes(c, 'synth', 'pluck') && hasNotes(c, 'bridge', 'lead') },
    { id: 'mix', title: 'Mix: vocal on top', where: { tab: 'mix' },
      text: [
        'Pop mixing has one rule above all: **the vocal is king**. Here the vocal line is the lead synth.',
        '• Lead louder than everything, compressed so every note is equally clear, with reverb and a little delay.',
        '• **Pump** (sidechain) on the pad and pluck, gently: the chorus breathes with the kick.',
        '• High-pass the piano, pad and pluck so the bass and kick stay clean.',
        '• Compress the drums; a bright, short reverb on the clap.',
      ],
      do: (p, c) => {
        fx(c.track('lead'), { comp: 0.45, reverb: 0.28, delay: 0.14, hpCut: 200 });
        Object.assign(c.track('lead'), { volume: 0.85 });
        fx(c.track('piano'), { hpCut: 110, reverb: 0.22, comp: 0.2 });
        fx(c.track('pluck'), { hpCut: 250, delay: 0.22, reverb: 0.2, pump: 0.35 });
        Object.assign(c.track('pluck'), { volume: 0.6 });
        fx(c.track('bass'), { comp: 0.35 });
        fx(p.chords, { hpCut: 200, reverb: 0.35, pump: 0.4 });
        fx(p.drums, { comp: 0.35, reverb: 0.12 });
        Object.assign(p.fxBus, { reverbSize: 2.2, delaySteps: 3, delayFeedback: 0.3 });
      },
      check: (p, c) => c.track('lead').fx.comp > 0 },
    { id: 'arrange', title: 'Arrange: verse, pre, chorus, bridge, key change', where: { tab: 'arrange' },
      get text() {
        return songArrangeText(pop, ['Each time a section comes back it gets **a little bigger** (the synth hook joins), the bridge gives a rest, and the **key change** lifts the final chorus: select those clips and set their Key a whole tone up.']);
      },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 12 },
    songFinish,
  ],
};

// ---------- LO-FI HIP HOP ----------
const LOFI_MELODY = [
  [[2, 2, 5], [4, 4, 4], [8, 6, 1]], [[0, 8, 1], [10, 2, 2], [12, 4, 4]], [[0, 12, 2], [12, 4, 0]], [],
  [[2, 2, 7], [4, 2, 5], [6, 2, 4], [8, 8, 5]], [[0, 4, 4], [4, 4, 3], [8, 8, 1]], [[0, 6, 2], [6, 2, 1], [8, 8, 0]], [[4, 4, -2], [8, 8, 0]],
];

const lofi = {
  id: 'lofi', name: 'Lo-fi hip hop', category: 'mood', bpm: 80, root: 5, scale: 'major', swing: 0.24, swingGrid: 8, chordsStyle: 'strum',
  test: { lowNotes: 80, minDrums: 400, minSecs: 180 },
  blurb: 'Dusty, lazy and warm. Jazz 7th chords on an electric piano, a boom-bap beat that drags behind the grid, a round bass and a muted, wandering melody.',
  lanes: [{ name: 'Drums', roles: ['drums'] }, { name: 'Keys', roles: ['keys'] }, { name: 'Bass', roles: ['bass'] }, { name: 'Melody', roles: ['melody'] }],
  patterns: [['drums', 'Boom-bap', 2], ['keys', 'Rhodes chords', 4], ['bass', 'Bass', 4], ['melody', 'Melody', 8]],
  tracks: [['bass', 'Bass', 'lf_bass', 2], ['melody', 'Melody', 'lf_lead', 4]],
  chordsPatch: ['lf_rhodes', 3],
  drumsVolume: 0.8,
  patches: {
    lf_rhodes: synth('Electric Piano', { wave: 'sine', wave2: 'triangle', mix2: 0.25, fm: 1.4, fmRatio: 1, fmDecay: 0.5, attack: 0.004, decay: 1.4, sustain: 0.3, release: 0.5,
      cutoff: 3200, vibrato: 4, vibratoRate: 4.5, vibratoDelay: 0, volume: 0.5 }),
    lf_bass: synth('Round Bass', { wave: 'sine', wave2: 'triangle', mix2: 0.35, attack: 0.008, decay: 0.5, sustain: 0.6, release: 0.15, cutoff: 900, volume: 0.75 }),
    lf_lead: synth('Muted Lead', { wave: 'triangle', wave2: 'square', mix2: 0.15, detune: 6, attack: 0.04, decay: 0.3, sustain: 0.7, release: 0.35,
      cutoff: 1800, resonance: 1, vibrato: 12, vibratoRate: 4.2, vibratoDelay: 0.25, volume: 0.42 }),
  },
  drumParams: { kick: { tune: 50, decay: 0.5, punch: 1.5, click: 0.1 }, snare: { tune: 170, decay: 0.22, snappy: 0.45 }, chat: { decay: 0.05, tone: 6000 } },
  sections: [
    { name: 'Intro', bars: 8, layers: ['keys'], note: 'the keys alone, muffled as if from another room.' },
    { name: 'Beat', bars: 16, layers: ['drums', 'keys', 'bass'], note: 'the beat and bass drop in.' },
    { name: 'Melody', bars: 16, layers: ['drums', 'keys', 'bass', 'melody'], note: 'the melody wanders over the top.' },
    { name: 'Break', bars: 8, layers: ['keys', 'melody'], note: 'drums and bass out: a moment of air.' },
    { name: 'Melody 2', bars: 16, layers: ['drums', 'keys', 'bass', 'melody'], note: 'everything back.' },
    { name: 'Outro', bars: 8, layers: ['keys', 'drums@0-4'], note: 'the beat drops out, the keys fade.' },
  ],
  steps: [
    { id: 'setup', title: 'Lo-fi: lazy on purpose', where: { tab: 'arrange' },
      text: [
        '**Lo-fi hip hop** is study music: a slow boom-bap beat, jazzy chords, warm and slightly broken sound. It is a great genre to learn **7th chords** and **swing** with.',
        '**80 BPM** in **F major**, with **swing** on 8ths (24%): every off-beat 8th comes late, so the beat sounds lazy and human. That late feel is the genre (look up J Dilla).',
        'One pattern per element, like the electronic guides: drums, keys, bass, melody. **Play** loops them stacked while you work.',
        'The sound is **lo-fi** on purpose: dull highs, soft drums, everything a little muffled.',
      ],
      check: () => true },
    { id: 'chords', title: 'Jazz chords: ii – V – I – vi', where: { tab: 'compose', role: 'keys', scroll: 'chords' },
      text: [
        'Lo-fi borrows jazz harmony: every chord is a **7th chord** (four notes: root, 3rd, 5th, 7th). The 7th makes chords soft and unresolved.',
        '• **ii7 – V7 – Imaj7 – vi7** (Gm7 – C7 – Fmaj7 – Dm7), one bar each. The **ii – V – I** is the most important progression in jazz: ii prepares, V pulls, I arrives.',
        '• vi7 at the end leads smoothly back to ii7, so the loop never really stops.',
        '• Set each slot’s type to **7th** in the sidebar.',
        'The Keys pattern plays them on an electric piano, **strummed** (the notes roll in one after another, like a player’s fingers).',
      ],
      do: (p, c) => { setChords(p, c, [1, 4, 0, 5], 16, 'seventh', ['keys']); Object.assign(p.chords, { style: 'strum', octave: 3, voiceLead: true, volume: 0.55 }); },
      check: (p, c) => hasChords(c, 'keys') && !c.pat('keys').chordsGuide && c.pat('keys').chordSlots.every(s => s?.type === 'seventh') },
    { id: 'drums', title: 'Boom-bap drums', where: { tab: 'compose', role: 'drums', scroll: 'drums' },
      text: [
        'The **boom-bap** beat: “boom” (kick), “bap” (snare). Two bars:',
        '• **Kick** on 1 and just before 3 (the “and” of 2 in bar 1, a little later in bar 2): a lazy, off-balance groove.',
        '• **Snare** on 2 and 4, with a soft **rimshot** ghost note in bar 2.',
        '• **Hats** on 8ths, accented on the beat. Swing pushes every second one late.',
        'Keep it quiet and soft. In lo-fi, the beat sits **under** the music.',
      ],
      do: (p, c) => drums(p, c, 'drums', {
        kick: 'x.........x.....x.....x...x.....', snare: '....X.......X.......X.......X...',
        rim: '..............................x.', chat: 'X.x.X.x.X.x.X.x.X.x.X.x.X.x.X.xx',
      }),
      check: (p, c) => hasDrums(c, 'drums', ['kick', 'snare']) },
    { id: 'bass', title: 'A round bass', where: { tab: 'compose', role: 'bass', scroll: 'tracks', track: 'bass' },
      text: [
        'A soft, round bass, close to a sine wave (like an upright bass or a muted electric):',
        '• The **root** on beat 1, held for most of a beat and a half.',
        '• Again on the “and” of 3, then the chord’s **5th**: a little bounce that follows the kick.',
        '• Low and quiet. It should be felt more than heard.',
      ],
      do: (p, c) => {
        const v = c.view('bass'), out = [];
        for (let bar = 0; bar < v.bars; bar++) {
          const ch = chordAt(v, bar * 16);
          const r = fold(ch.semis[0]), f = r + ch.semis[2] - ch.semis[0];
          out.push({ step: bar * 16, len: 6, semis: r, vel: 0.9 }, { step: bar * 16 + 10, len: 2, semis: r, vel: 0.72 }, { step: bar * 16 + 12, len: 4, semis: f > 7 ? f - 12 : f, vel: 0.78 });
        }
        abstractNotes(p, c, 'bass', 'bass', out);
      },
      check: (p, c) => hasNotes(c, 'bass', 'bass') },
    { id: 'melody', title: 'A wandering melody', where: { tab: 'compose', role: 'melody', scroll: 'tracks', track: 'melody' },
      text: [
        'The lo-fi melody is relaxed, like someone humming:',
        '• Mostly the **pentatonic** notes of F major (F G A C D): no note can sound wrong.',
        '• **Start phrases off the beat** (on the “and”): it sounds casual, not stiff.',
        '• Leave a bar of **silence** after the first phrase. Rests are what make it feel unhurried.',
        '• Two phrases of 4 bars: the second answers the first and comes home to F.',
        'A muted, soft synth with vibrato: think of a muted trumpet or a flute heard through a wall.',
      ],
      do: (p, c) => notes(c, 'melody', 'melody', barsToNotes(LOFI_MELODY, 0.68)),
      check: (p, c) => hasNotes(c, 'melody', 'melody') },
    { id: 'mix', title: 'Mix: make it lo-fi', where: { tab: 'mix' },
      text: [
        'The lo-fi sound is mostly **taking things away**:',
        '• **Low-pass** everything: drums around 4 kHz, keys around 3 kHz. No crisp highs anywhere.',
        '• A little **drive** on the keys and drums, like an old tape or a sampler.',
        '• **Pump** (sidechain) on the keys from the kick: they breathe with the beat.',
        '• A soft room reverb, and some delay on the melody.',
      ],
      do: (p, c) => {
        fx(p.drums, { cutoff: 4200, drive: 0.15, comp: 0.3, eqLow: 2 });
        fx(p.chords, { cutoff: 3000, drive: 0.12, reverb: 0.3, pump: 0.3 });
        fx(c.track('melody'), { cutoff: 3500, reverb: 0.35, delay: 0.22, hpCut: 200 });
        fx(c.track('bass'), { cutoff: 1200 });
        Object.assign(p.fxBus, { reverbSize: 2.4, delaySteps: 3, delayFeedback: 0.32 });
      },
      check: p => p.drums.fx.cutoff < 20000 },
    { id: 'arrange', title: 'Arrange: a loop that breathes', where: { tab: 'arrange' },
      text: [
        'Lo-fi tracks are **loops** that change by adding and removing layers, every 8 or 16 bars. No big drops; small changes keep it alive while staying in the background.',
        'The plan (72 bars):',
        '• **Intro** (8): keys alone. • **Beat** (16): drums and bass drop in. • **Melody** (16): the melody joins.',
        '• **Break** (8): drums and bass out. • **Melody 2** (16): everything. • **Outro** (8): the beat stops halfway, the keys fade.',
        'In **Arrange**: pick a pattern on the left and click a lane to place it, drag the right edge to make it last.',
      ],
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 10 },
    { id: 'automate', title: 'Automation: the muffled intro', where: { tab: 'arrange' },
      text: [
        'A lo-fi signature: the intro sounds like it is playing **in the next room**, then the filter opens when the beat drops.',
        '• **Keys Low-pass**: almost closed in the intro, opening right at the beat.',
        '• The same in reverse in the outro, plus a **fade** on the master.',
        'In Arrange use **+ Automate…**, pick Chords → Low-pass. Shift+drag draws a curve.',
      ],
      do: (p, c) => {
        const S = sectionStarts(c.G);
        lane(p, 'chords|cutoff', [[0, 0.32], [S.Beat - 0.5, 0.45], [S.Beat, 0.78], [S.Outro, 0.78], [S.END, 0.35]]);
        lane(p, 'master|master', [[S.END - 4, 0.667], [S.END, 0]]);
      },
      check: p => p.song.auto.some(l => l.points.length >= 2) },
    songFinish,
  ],
};

// ---------- FUNK ----------
const FUNK_BASS = {
  em: [[0, 3, 0, 1], [3, 1, 0, 0.6], [6, 1, 7, 0.85], [8, 2, 0, 0.9], [10, 1, 6, 0.7], [11, 1, 7, 0.8], [13, 1, 4, 0.7], [14, 2, 2, 0.8]],
  a: [[0, 3, 3, 1], [3, 1, 3, 0.6], [6, 1, 10, 0.85], [8, 2, 3, 0.9], [10, 1, 7, 0.7], [11, 1, 9, 0.8], [13, 1, 5, 0.7], [14, 2, 4, 0.8]],
  bm: [[0, 3, 4, 1], [3, 1, 4, 0.6], [6, 1, 11, 0.85], [8, 2, 4, 0.9], [10, 1, 8, 0.7], [11, 1, 10, 0.8], [13, 1, 6, 0.7], [14, 2, 2, 0.8]],
};
const funkBar = (cells, bar) => cells.map(([s, len, d, vel]) => [bar * 16 + s, len, d, vel]);
const FUNK_HORNS = [
  [[0, 2, 6], [3, 1, 6], [6, 2, 4], [10, 1, 6], [12, 4, 7]], [[2, 1, 5], [4, 2, 7], [8, 1, 5], [10, 2, 3]],
  [], [[8, 1, 5], [10, 1, 7], [12, 4, 9]],
];
const SCRATCH = [[2, 1, 0.8], [3, 1, 0.45], [6, 1, 0.75], [7, 1, 0.85], [10, 1, 0.8], [11, 1, 0.45], [14, 1, 0.75], [15, 1, 0.55]];

const funk = {
  id: 'funk', name: 'Funk', category: 'band', bpm: 100, root: 4, scale: 'dorian', swing: 0.2,
  test: { lowNotes: 250, minDrums: 1500, minSecs: 180 },
  blurb: 'Everything is rhythm. A two-chord vamp, ghost notes on the snare, a syncopated bass, chicken-scratch guitar and horn stabs that all lock together on "the one".',
  lanes: [
    { name: 'Drums', roles: ['drums'] }, { name: 'Bass', roles: ['bass', 'bridge'] }, { name: 'Guitar', roles: ['guitar'] },
    { name: 'Horns', roles: ['horns'] }, { name: 'Organ', roles: ['organ'] },
  ],
  patterns: [['drums', 'Drums', 2], ['bass', 'Bass', 2], ['guitar', 'Scratch guitar', 2], ['horns', 'Horn stabs', 4], ['organ', 'Organ', 2], ['bridge', 'Bridge (band)', 4]],
  tracks: [['bass', 'Bass', 'fk_bass', 2], ['guitar', 'Guitar', 'fk_gtr', 3], ['horns', 'Horns', 'fk_brass', 4]],
  chordsPatch: ['fk_organ', 3],
  patches: {
    fk_bass: synth('Funk Bass', { wave: 'sawtooth', wave2: 'square', octave2: -1, mix2: 0.4, detune: 3, attack: 0.002, decay: 0.22, sustain: 0.45, release: 0.06,
      cutoff: 650, resonance: 4, filterEnv: 2200, filterDecay: 0.12, velToFilter: 0.5, volume: 0.6 }),
    fk_gtr: synth('Scratch Guitar', { wave: 'square', wave2: 'sawtooth', mix2: 0.4, detune: 6, attack: 0.001, decay: 0.09, sustain: 0, release: 0.05,
      cutoff: 2600, resonance: 3, filterEnv: 2500, filterDecay: 0.06, volume: 0.42 }),
    fk_brass: synth('Horn Section', { wave: 'sawtooth', wave2: 'sawtooth', mix2: 0.5, detune: 12, unison: 3, attack: 0.025, decay: 0.25, sustain: 0.7, release: 0.12,
      cutoff: 1400, resonance: 1.5, filterEnv: 2600, filterDecay: 0.18, vibrato: 8, vibratoRate: 5.5, vibratoDelay: 0.2, volume: 0.3 }),
    fk_organ: synth('Funk Organ', { wave: 'square', wave2: 'sine', octave2: 1, mix2: 0.4, detune: 5, attack: 0.008, decay: 0.2, sustain: 0.8, release: 0.1,
      cutoff: 3000, vibrato: 8, vibratoRate: 6.8, vibratoDelay: 0, volume: 0.28 }),
  },
  drumParams: { kick: { tune: 55, decay: 0.38, punch: 3, click: 0.45 }, snare: { tune: 210, decay: 0.16, snappy: 0.75 }, chat: { decay: 0.04, tone: 9000 } },
  workSections: [
    { name: 'Groove', bars: 8, layers: ['drums', 'bass', 'guitar', 'horns', 'organ'] }, { name: 'Bridge', bars: 4, layers: ['drums', 'bridge'] },
  ],
  sections: [
    { name: 'Intro', bars: 8, layers: ['guitar', 'drums@4'], note: 'the guitar alone, then the drums.' },
    { name: 'Groove', bars: 16, layers: ['drums', 'bass', 'guitar'], note: 'the rhythm section locks in.' },
    { name: 'Horns', bars: 16, layers: ['drums', 'bass', 'guitar', 'horns'], note: 'horn stabs on top.' },
    { name: 'Bridge', bars: 8, layers: ['drums', 'bridge'], note: 'new chords and the organ, to break the vamp.' },
    { name: 'Breakdown', bars: 8, layers: ['drums', 'bass'], note: 'just drums and bass: the groove laid bare.' },
    { name: 'Groove 2', bars: 16, layers: ['drums', 'bass', 'guitar', 'horns', 'organ'], note: 'everything, organ included.' },
    { name: 'Outro', bars: 8, layers: ['drums', 'bass', 'guitar', 'horns@-4'], note: 'the vamp with one last horn line.' },
  ],
  steps: [
    { id: 'setup', title: 'Funk: everything is drums', where: { tab: 'arrange' },
      text: [
        'In **funk**, every instrument plays like a drum. Melody and harmony matter less than how the parts **interlock**: each fills the gaps the others leave.',
        '**100 BPM** in **E dorian** (a minor scale with a bright 6th, C♯): the classic funk scale, dark but not sad.',
        'The whole song is a **vamp**: two chords over and over. The interest comes from rhythm, layers coming and going, and a bridge.',
        'A little **16th swing** (20%) loosens the groove. One pattern per instrument; **Play** loops them stacked.',
      ],
      check: () => true },
    { id: 'chords', title: 'The vamp: Em7 – A7', where: { tab: 'compose', role: 'organ', scroll: 'chords' },
      text: [
        'Two chords, one bar each: **Em7 – A7** (i7 – IV7 in E dorian).',
        '• The **A7** has a C♯: that is the dorian note. In plain E minor it would be Am (C natural), much sadder. This one swap is the sound of a thousand funk records.',
        '• Both are 7th chords: four notes, more color than triads.',
        '• The **Organ** pattern plays them as held chords; everywhere else they are guides.',
        '• The **Bridge** uses **A7 – A7 – Bm7 – Bm7**: two new bars on IV and v so the vamp has somewhere to go.',
      ],
      do: (p, c) => {
        setChords(p, c, [0, 3], 16, 'seventh', ['organ']);
        slotsInto(c.pat('bridge'), [3, 3, 4, 4], 16, ['seventh'], false);
        Object.assign(p.chords, { style: 'block', octave: 3, voiceLead: true, volume: 0.42 });
      },
      check: (p, c) => hasChords(c, 'organ') && hasChords(c, 'bridge') },
    { id: 'drums', title: 'Drums: ghost notes and the one', where: { tab: 'compose', role: 'drums', scroll: 'drums' },
      text: [
        'A funk beat over two bars:',
        '• **Kick**: on **the one** (beat 1, the most important moment in funk) and on syncopated 16ths around it.',
        '• **Snare**: loud backbeats on 2 and 4 (accented, X) plus quiet **ghost notes** (x) on 16ths in between. Ghost notes are felt more than heard; they make the groove roll.',
        '• **Hi-hat** on every 16th, accents on the 8ths, and an **open hat** before the bar line.',
        'Alt+click a hit to toggle its accent. The ⋯ menu on a row has 16ths and repeat.',
      ],
      do: (p, c) => drums(p, c, 'drums', {
        kick: 'X.........x..x..X.x.......x.....', snare: '....X..x.x..X..x.x..X..x.x..X.x.',
        chat: 'XxXxXxXxXxXxXxXxXxXxXxXxXxXxXx..', ohat: '..............................x.',
      }),
      check: (p, c) => hasDrums(c, 'drums', ['snare', 'chat']) },
    { id: 'bass', title: 'Syncopated bass', where: { tab: 'compose', role: 'bass', scroll: 'tracks', track: 'bass' },
      text: [
        'The funk bass is half drum, half melody:',
        '• **The root on the one**, hard and long. Then short notes on the 16ths in between, many of them **off the beat**.',
        '• **Octave jumps** (E, then high E): the slap-bass trick.',
        '• **Gaps**: the notes the bass doesn’t play are as important as those it does. Leave room for the kick and the guitar.',
        '• Over A7 the same shape moves to A, using its C♯ and G. The Bridge pattern carries the same riff over A7 and Bm7.',
      ],
      do: (p, c) => {
        notes(c, 'bass', 'bass', [...funkBar(FUNK_BASS.em, 0), ...funkBar(FUNK_BASS.a, 1)]);
        notes(c, 'bridge', 'bass', [...funkBar(FUNK_BASS.a, 0), ...funkBar(FUNK_BASS.a, 1), ...funkBar(FUNK_BASS.bm, 2), ...funkBar(FUNK_BASS.bm, 3)]);
      },
      check: (p, c) => hasNotes(c, 'bass', 'bass') && hasNotes(c, 'bridge', 'bass') },
    { id: 'guitar', title: 'Chicken-scratch guitar', where: { tab: 'compose', role: 'guitar', scroll: 'tracks', track: 'guitar' },
      text: [
        'The funk rhythm guitar plays tiny, choked chords on the **16ths between the beats**: the “chicken scratch”.',
        '• Voicing: just the **3rd, 5th and 7th** of each chord, high up, no root (the bass has it).',
        '• Very short notes (1 step), loud on the main hits and soft “ghost” scratches between.',
        '• It almost never plays on the beat, where the kick and snare are. The guitar fills the holes.',
      ],
      do: (p, c) => {
        abstractNotes(p, c, 'guitar', 'guitar', stabs(c.view('guitar'), SCRATCH, [1, 2, 3]));
        abstractNotes(p, c, 'bridge', 'guitar', stabs(c.view('bridge'), SCRATCH, [1, 2, 3]));
      },
      check: (p, c) => hasNotes(c, 'guitar', 'guitar') },
    { id: 'horns', title: 'Horn stabs', where: { tab: 'compose', role: 'horns', scroll: 'tracks', track: 'horns' },
      text: [
        'A **horn section** (trumpet, sax, trombone) plays short, punchy phrases: the hook of a funk tune.',
        '• **Short and loud**, mostly chord notes, with rests between phrases.',
        '• Call and answer over 4 bars: a phrase, an answer on the A7, a bar of rest, a pickup into the next round.',
        '• Horns usually come in only after the groove is established, as a reward.',
      ],
      do: (p, c) => notes(c, 'horns', 'horns', barsToNotes(FUNK_HORNS, 0.85)),
      check: (p, c) => hasNotes(c, 'horns', 'horns') },
    { id: 'mix', title: 'Mix: tight and dry', where: { tab: 'mix' },
      text: [
        'Funk is mixed **tight and dry**: every hit should be crisp and separate.',
        '• Very little reverb. Compress drums and bass hard so every note sits at the same level.',
        '• **Pan** the guitar left and the horns right, the organ a little left: each in its own space.',
        '• High-pass the guitar heavily (~300 Hz): it is a rhythmic sparkle, not a full sound.',
      ],
      do: (p, c) => {
        fx(p.drums, { comp: 0.5, reverb: 0.06 });
        fx(c.track('bass'), { comp: 0.5, drive: 0.12 });
        fx(c.track('guitar'), { hpCut: 300, comp: 0.3, reverb: 0.08 });
        Object.assign(c.track('guitar'), { pan: -0.35, volume: 0.7 });
        fx(c.track('horns'), { reverb: 0.18, comp: 0.3, hpCut: 160 });
        Object.assign(c.track('horns'), { pan: 0.3 });
        fx(p.chords, { reverb: 0.15, hpCut: 200 });
        Object.assign(p.chords, { pan: -0.15 });
        Object.assign(p.fxBus, { reverbSize: 1.4 });
      },
      check: (p, c) => c.track('guitar').fx.hpCut > 10 },
    { id: 'arrange', title: 'Arrange: layers on a vamp', where: { tab: 'arrange' },
      get text() {
        return songArrangeText(funk, ['With only two chords, the song’s shape comes from **which instruments are playing**: start thin, add parts, break down to drums and bass, then everybody at once.']);
      },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 15 },
    songFinish,
  ],
};

// ---------- AMBIENT ----------
const ambient = {
  id: 'ambient', name: 'Ambient', category: 'electronic', bpm: 70, root: 0, scale: 'lydian', swing: 0,
  test: { lowNotes: 20, minDrums: 0, minSecs: 300, minNotes: 400 },
  blurb: 'No beat at all. Slow chords in the dreamy lydian mode, a drone, scattered piano notes and a shimmering bell arpeggio drowned in reverb and delay.',
  lanes: [{ name: 'Drone', roles: ['drone'] }, { name: 'Pad', roles: ['pad'] }, { name: 'Piano', roles: ['motes'] }, { name: 'Shimmer', roles: ['shimmer'] }],
  patterns: [['drone', 'Drone', 16], ['pad', 'Pad chords', 16], ['motes', 'Piano', 16], ['shimmer', 'Shimmer', 16]],
  tracks: [['drone', 'Drone', 'am_drone', 2], ['motes', 'Piano', 'piano', 4], ['bell', 'Shimmer', 'am_bell', 5]],
  chordsPatch: ['am_pad', 3],
  patches: {
    am_pad: synth('Glass Pad', { wave: 'sawtooth', wave2: 'triangle', mix2: 0.55, detune: 20, unison: 4, attack: 2.5, decay: 2, sustain: 0.8, release: 4,
      cutoff: 1400, resonance: 0.8, vibrato: 5, vibratoRate: 0.4, vibratoDelay: 1, volume: 0.36 }),
    am_drone: synth('Drone', { wave: 'sine', wave2: 'sawtooth', mix2: 0.2, detune: 6, unison: 2, attack: 3, decay: 2, sustain: 0.9, release: 4, cutoff: 500, volume: 0.5 }),
    am_bell: synth('Shimmer Bell', { wave: 'sine', fm: 2.4, fmRatio: 3.5, fmDecay: 0.7, attack: 0.002, decay: 1.6, sustain: 0, release: 1.2, cutoff: 9000, volume: 0.28 }),
  },
  drumParams: {},
  sections: [
    { name: 'Emergence', bars: 16, layers: ['drone'], note: 'the drone alone, fading in.' },
    { name: 'Bloom', bars: 32, layers: ['drone', 'pad', 'motes@16'], note: 'the chords swell in; piano notes appear later.' },
    { name: 'Shimmer', bars: 32, layers: ['drone', 'pad', 'motes', 'shimmer'], note: 'the bell arpeggio joins: the fullest part.' },
    { name: 'Thin out', bars: 16, layers: ['pad', 'shimmer'], note: 'the drone drops away, the music floats.' },
    { name: 'Return', bars: 16, layers: ['drone', 'motes'], note: 'just the drone and piano.' },
    { name: 'Fade', bars: 16, layers: ['drone', 'pad'], note: 'the chords once more, fading to nothing.' },
  ],
  steps: [
    { id: 'setup', title: 'Ambient: music as a place', where: { tab: 'arrange' },
      text: [
        '**Ambient** music has no beat and no drama; it is music you can live inside. Brian Eno: “as ignorable as it is interesting.”',
        'The tempo (70 BPM) only sets how slowly things move. Each chord lasts **4 bars**, and every pattern is 16 bars long.',
        'The key is **C lydian**: a major scale with a **raised 4th** (F♯ instead of F). That one note makes it float: it never quite feels grounded, like a dream.',
        'One pattern per layer: drone, pad, piano and shimmer. **Play** loops them while you work.',
      ],
      check: () => true },
    { id: 'chords', title: 'Slow, open chords', where: { tab: 'compose', role: 'pad', scroll: 'chords' },
      text: [
        'Four chords, **4 bars each**: **C – D – Am – G**, all as **add9** chords (a triad plus the 9th: an open, glassy sound).',
        '• **D major** is the lydian chord: in plain C major it would be Dm. Its F♯ is the floating note.',
        '• The pad has a very slow attack (2.5 s) and release (4 s), so chords blur into each other.',
        '• Set the slot length to **4 bars** (Slot length in the chord lane) and each slot’s type to **add9**.',
      ],
      do: (p, c) => { setChords(p, c, [0, 1, 5, 4], 64, 'add9', ['pad']); Object.assign(p.chords, { style: 'block', octave: 3, voiceLead: true, volume: 0.45 }); },
      check: (p, c) => hasChords(c, 'pad') && !c.pat('pad').chordsGuide },
    { id: 'drone', title: 'The drone', where: { tab: 'compose', role: 'drone', scroll: 'tracks', track: 'drone' },
      text: [
        'A **drone** is a low note held for a long time. It is the floor of ambient music.',
        '• One note per chord, on its **root**, held for the whole 4 bars, with the 5th above it more quietly.',
        '• The drone synth fades in over 3 seconds, so its notes never start, they appear.',
        '• Keep it quiet. You should feel it in the room more than hear it.',
      ],
      do: (p, c) => {
        const v = c.view('drone'), out = [];
        for (let s = 0; s < v.bars * 16; s += 64) {
          const ch = chordAt(v, s), r = fold(ch.semis[0]);
          out.push({ step: s, len: 64, semis: r, vel: 0.75 }, { step: s, len: 64, semis: r + 7, vel: 0.5 });
        }
        abstractNotes(p, c, 'drone', 'drone', out);
      },
      check: (p, c) => hasNotes(c, 'drone', 'drone') },
    { id: 'motes', title: 'Piano: notes like raindrops', where: { tab: 'compose', role: 'motes', scroll: 'tracks', track: 'motes' },
      text: [
        'Sparse, **single piano notes** at irregular times, high up, soft. Each one rings out and dies in the reverb before the next.',
        '• Use the chord’s notes (teal rows), and the 9th.',
        '• **Irregular** spacing: not every 4 beats. Unpredictable timing keeps it from sounding like a rhythm.',
        '• Two or three notes per 4 bars is plenty. Silence is the main instrument.',
      ],
      do: (p, c) => {
        const v = c.view('motes'), rnd = rng(11), out = [];
        for (let s = 2; s < v.bars * 16; s += 5 + Math.floor(rnd() * 14)) {
          const ch = chordAt(v, s), r = fold(ch.semis[0]);
          const t = ch.semis[Math.floor(rnd() * ch.semis.length)] - ch.semis[0];
          out.push({ step: s, len: 12, semis: r + t + (rnd() < 0.4 ? 12 : 0), vel: 0.35 + rnd() * 0.25 });
        }
        abstractNotes(p, c, 'motes', 'motes', out);
      },
      check: (p, c) => hasNotes(c, 'motes', 'motes') },
    { id: 'shimmer', title: 'Shimmer arpeggio', where: { tab: 'compose', role: 'shimmer', scroll: 'tracks', track: 'bell' },
      text: [
        'A soft **FM bell** playing the chord notes in a slow pattern, one note every **3 steps** (a dotted 8th).',
        '• 3 steps against a 4-beat bar never lines up the same way twice in a row: it drifts against the bar like ripples.',
        '• With a long **delay** that also repeats in dotted 8ths, the notes multiply into a shimmering cloud.',
        '• Keep it quiet and high: it is light on water, not a melody.',
      ],
      do: (p, c) => abstractNotes(p, c, 'shimmer', 'bell', arp(c.view('shimmer'), { rate: 3, len: 2, shape: [0, 2, 3, 1, 4, 2], vels: [0.5, 0.36, 0.42, 0.34, 0.4] })),
      check: (p, c) => hasNotes(c, 'shimmer', 'bell') },
    { id: 'mix', title: 'Mix: space is the instrument', where: { tab: 'mix' },
      text: [
        'Ambient mixing is mostly **reverb and delay**: they turn a few notes into a whole space.',
        '• A **huge reverb** (Reverb size up) with a lot sent from the pad, piano and bell.',
        '• **Delay** in dotted 8ths on the bell and piano, with lots of feedback.',
        '• Low-pass the pad and high-pass everything but the drone. Nothing should be sharp.',
      ],
      do: (p, c) => {
        fx(p.chords, { reverb: 0.6, cutoff: 5000, hpCut: 120 });
        fx(c.track('drone'), { reverb: 0.3, cutoff: 1200 });
        fx(c.track('motes'), { reverb: 0.7, delay: 0.35, hpCut: 200 });
        fx(c.track('bell'), { reverb: 0.65, delay: 0.45, hpCut: 400 });
        Object.assign(c.track('bell'), { volume: 0.6 });
        Object.assign(p.fxBus, { reverbSize: 6, delaySteps: 3, delayFeedback: 0.55 });
      },
      check: (p, c) => c.track('bell').fx.reverb > 0 },
    { id: 'arrange', title: 'Arrange: very slow changes', where: { tab: 'arrange' },
      get text() {
        return songArrangeText(ambient, ['In ambient, layers enter and leave **slowly**, 16 or 32 bars at a time. The changes should feel like the weather changing, not like events.']);
      },
      do: (p, c) => arrange(p, c),
      check: (p, c) => songBars(p) >= totalBars(c.G) * 0.8 && p.song.clips.length >= 10 },
    { id: 'automate', title: 'Automation: slow tides', where: { tab: 'arrange' },
      text: [
        'Ambient lives on **very slow** movement:',
        '• The pad’s **Low-pass** opening and closing over minutes, like a tide.',
        '• The drone fading **in** at the start (volume from zero).',
        '• A long **fade-out** on the master over the last 16 bars.',
        'In Arrange use **+ Automate…**; draw long gentle curves with Shift+drag.',
      ],
      do: (p, c) => {
        const S = sectionStarts(c.G);
        lane(p, 'chords|cutoff', [[S.Bloom, 0.5], [S.Shimmer, 0.8], [S['Thin out'], 0.65], [S.Return, 0.5], [S.Fade, 0.7], [S.END, 0.45]]);
        lane(p, `${c.track('drone').id}|volume`, [[0, 0], [8, 0.6], [S.END, 0.6]]);
        lane(p, 'master|master', [[S.END - 16, 0.667], [S.END, 0]]);
      },
      check: p => p.song.auto.some(l => l.points.length >= 2) },
    songFinish,
  ],
};

export const GUIDES2 = { sadminor, blues, rock, pop, lofi, funk, ambient };
