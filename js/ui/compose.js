// Compose view: ruler, chord lane, melody tracks (scale rolls) and the drum step sequencer.
// Every lane shares the same horizontal step grid so everything lines up.

import { store, commit, touch, loopSteps, newTrack, TRACK_COLORS, uid, saveSampleData, STEPS_PER_BAR,
  sections, sectionIndexAt, keyAt, addKeyChange, removeKeyChange, setTrackMode, deleteTrack, deleteDrumRow, defaultFx, withPatterns } from '../state.js';
import { romanNumeral, chordName, chordFunction, scaleSteps, harmonyScaleId, CHORD_TYPES, FUNCTION_INFO, SCALES, keyName, mod } from '../theory.js';
import { audio, playBuffer, decodeUserSample } from '../audio.js';
import { ScaleRoll, KEYS_W, getActiveRoll } from './scaleroll.js';
import { AutoLane, addLane, targetSelect } from './autolane.js';
import { VelLane, accentBeats, evenOut, humanize } from './vellane.js';
import { GENRES } from '../guides.js';
import { ui, h, previewDeg, previewTrackMidi, previewChord, toast, patchOf, popupMenu } from './common.js';
import { transport, syncMixer } from '../sequencer.js';

let rolls = [];
let playFrom = () => {};
let onSelectTrack = () => {};

export function initCompose(opts) { playFrom = opts.playFrom; onSelectTrack = opts.onSelectTrack || onSelectTrack; }
let drumCols = [];     // step index -> [buttons]
let lastLitCol = -1;

const lanesEl = () => document.getElementById('lanes');

export function renderCompose() {
  const p = store.project;
  const L = loopSteps();
  const cw = ui.cellW;
  document.documentElement.style.setProperty('--cell-w', cw + 'px');
  const lanes = lanesEl();
  lanes.replaceChildren();
  rolls = [];
  drumCols = [];
  lastLitCol = -1;

  const show = visibleLanes(p, L);
  const open = key => ui.expandedLanes.has(key);
  lanes.append(rulerLane(L, cw));
  lanes.append(keyLane(p, L, cw));
  if (show.chords || open('chords')) {
    lanes.append(sectionTitle('Chords', 'The harmony. Pick chords from the sidebar, or click a slot and then click a chord.'));
    lanes.append(chordLane(p, L, cw));
  } else lanes.append(collapsedLane('chords', 'Chords', '#ffd43b', 'not used in this pattern'));
  lanes.append(sectionTitle('Melody & Bass', 'Scale tracks: rows are scale degrees (1 is home). Piano tracks: rows are the 12 notes. Teal rows are the notes of the chord playing above: R = its root (strongest), 3 = third, 5 = fifth, 7 = seventh. Long notes on teal rows always fit.'));
  for (const t of p.tracks) {
    if (show.tracks.includes(t) || open('t:' + t.id)) lanes.append(...[].concat(trackLane(t, L)));
    else lanes.append(collapsedLane('t:' + t.id, t.name, t.color, 'no notes in this pattern'));
  }
  const drumsOpen = show.rows.length || open('drums');
  if (!drumsOpen) lanes.append(collapsedLane('drums', 'Drums & Samples', '#ff6b6b', `${p.drums.rows.length} rows, none used in this pattern`));
  if (drumsOpen) lanes.append(sectionTitle('Drums & Samples', 'Click steps to toggle, or drag across to paint. Shift or right-click for a loud accent. ⋯ on a row fills it with a rhythm or repeats it. Drop audio files here to add sample rows.', lane => {
    drumSectionDrop()(lane);
    lane.querySelector('.lane-body').append(h('div', { class: 'drum-tools' },
      h('span', { class: 'hint' }, 'All rows:'),
      h('button', { class: 'btn small', title: 'Copy bar 1 of every drum row across the whole pattern', onclick: () => repeatAllRows(1) }, 'Repeat bar 1'),
      L >= 32 ? h('button', { class: 'btn small', title: 'Copy bars 1–2 of every drum row across the whole pattern', onclick: () => repeatAllRows(2) }, 'Repeat bars 1–2') : null,
      L >= 64 ? h('button', { class: 'btn small', title: 'Copy bars 1–4 of every drum row across the whole pattern', onclick: () => repeatAllRows(4) }, 'Repeat bars 1–4') : null,
      h('button', { class: 'btn small', title: 'Remove every drum hit in this pattern', onclick: () => { if (confirm('Clear all drums in this pattern?')) { store.project.drums.rows.forEach(r => { r.steps = []; }); commit('drums'); } } }, 'Clear')));
  }));
  if (drumsOpen) {
    // all rows when the section was opened by hand, else the used rows with the others as thin lines
    for (const r of p.drums.rows) {
      if (!show.rows.length || show.rows.includes(r) || open('d:' + r.id)) lanes.append(drumLane(r, L, cw));
      else lanes.append(collapsedLane('d:' + r.id, r.name, DRUM_COLORS[r.kind] || '#e9ecf5', 'empty', true));
    }
    lanes.append(addSampleLane());
  }
  lanes.append(sectionTitle('Automation', 'Moves a mixer setting over the pattern, every time the pattern plays (also inside the song). Click to add points, drag them, right-click deletes, Shift+drag draws. The dashed line is the mixer’s own setting.'));
  for (const lane of p.patAuto) lanes.append(autoLaneRow(lane, L));
  lanes.append(h('div', { class: 'lane' },
    h('div', { class: 'lane-head drum-head' }, targetSelect('', v => addLane('pattern', v), '+ Automate…')),
    h('div', { class: 'lane-body' })));
  rolls.forEach(r => r.render());
}

// ---------- Showing only the lanes a pattern uses ----------
// With "Hide unused lanes" on: drum patterns show only drum rows that have hits, melodic patterns only
// the tracks with notes (plus the selected track), and an empty pattern shows what it is meant for
// (in a guide project the guide knows; otherwise the selected track and every drum row).
function patternKind(p, anyNotes, anyDrums) {
  if (anyNotes && anyDrums) return 'mixed';
  if (anyDrums) return 'drums';
  if (anyNotes) return 'notes';
  const role = p.guide && Object.entries(p.guide.roles?.pats || {}).find(([, id]) => id === p.currentPattern)?.[0];
  const steps = role ? GENRES[p.guide.genre]?.steps.filter(s => s.where?.role === role) || [] : [];
  if (steps.some(s => s.where.scroll === 'drums')) return 'drums';
  if (steps.some(s => s.where.track)) return 'notes';
  if (steps.some(s => s.where.scroll === 'chords')) return 'chords';
  return 'empty';
}

function visibleLanes(p, L) {
  const trackHas = t => t.notes.some(n => n.step < L);
  const rowHas = r => (r.steps || []).some((v, i) => v && i < L);
  if (!ui.focusLanes || ui.showAllLanes) return { tracks: p.tracks, rows: p.drums.rows, chords: true, hiddenTracks: 0, hiddenRows: 0 };
  const kind = patternKind(p, p.tracks.some(trackHas), p.drums.rows.some(rowHas));
  const tracks = kind === 'drums' || kind === 'chords' ? [] : p.tracks.filter(t => trackHas(t) || t.id === ui.selectedTrackId);
  const used = p.drums.rows.filter(rowHas);
  // a drum pattern with no hits yet shows every row, so there is something to click
  const rows = kind === 'notes' || kind === 'chords' ? [] : used.length ? used : p.drums.rows;
  return { tracks, rows, chords: kind !== 'drums', hiddenTracks: p.tracks.length - tracks.length, hiddenRows: p.drums.rows.length - rows.length };
}

// A lane that isn't used in this pattern, folded into a thin line. Click it to open just that lane.
function collapsedLane(key, name, color, why, small = false) {
  return h('div', { class: 'lane collapsed-lane' + (small ? ' small' : ''), title: `${name}: ${why}. Click to show it.`,
    onclick: () => { ui.expandedLanes.add(key); renderCompose(); } },
    h('div', { class: 'lane-head' }, h('span', { class: 'color-dot', style: { background: color } }), h('span', { class: 'cl-name' }, name), h('span', { class: 'cl-open' }, '▸')),
    h('div', { class: 'lane-body' }, h('span', { class: 'cl-why' }, why)));
}

// Keyboard shortcuts for the note editors (select all, copy/paste, delete, arrows...). Returns true when used.
export function composeKey(e) {
  const live = rolls.filter(r => r instanceof ScaleRoll);
  const active = getActiveRoll();
  const roll = (live.includes(active) && active.track.id === ui.selectedTrackId ? active : null)
    || live.find(r => r.track.id === ui.selectedTrackId);
  return roll ? !!roll.key(e) : false;
}

// Only redraw the canvases (cheap), e.g. after a note edit or chord change.
export function redrawRolls() { rolls.forEach(r => r.render()); }

function sectionTitle(text, hint, extraAttrs) {
  const lane = h('div', { class: 'lane section-title' },
    h('div', { class: 'lane-head' }, text),
    h('div', { class: 'lane-body' }, h('p', { class: 'hint', style: { margin: '10px 12px 6px' } }, hint)));
  if (extraAttrs) extraAttrs(lane);
  return lane;
}

// ---------- Ruler ----------
function rulerLane(L, cw) {
  const dpr = Math.min(window.devicePixelRatio || 1, 32000 / (L * cw));
  const c = h('canvas');
  c.width = L * cw * dpr; c.height = 24 * dpr;
  c.style.width = L * cw + 'px'; c.style.height = '24px';
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#1c1e26'; g.fillRect(0, 0, L * cw, 24);
  g.font = '600 11px system-ui'; g.textBaseline = 'middle';
  for (let s = 0; s < L; s++) {
    const x = s * cw;
    if (s % STEPS_PER_BAR === 0) {
      g.fillStyle = '#5a6078'; g.fillRect(x, 0, 1, 24);
      g.fillStyle = '#e9ecf5'; g.fillText(String(s / STEPS_PER_BAR + 1), x + 4, 12);
    } else if (s % 4 === 0) {
      g.fillStyle = '#3a3f52'; g.fillRect(x, 14, 1, 10);
      g.fillStyle = '#6b7189'; g.font = '10px system-ui'; g.fillText(`.${s % 16 / 4 + 1}`, x + 3, 18); g.font = '600 11px system-ui';
    }
  }
  c.title = 'Click to play from here';
  c.addEventListener('click', e => playFrom(Math.floor((e.offsetX / cw) / 4) * 4));
  return h('div', { class: 'lane ruler' },
    h('div', { class: 'lane-head' }, 'Bar'),
    h('div', { class: 'lane-body' }, c));
}

// ---------- Key lane: key/scale sections ----------
const SECTION_COLORS = ['#b197fc', '#4dabf7', '#63e6be', '#ffa94d', '#f783ac', '#ffd43b'];

function keyLane(p, L, cw) {
  const secs = sections(p);
  const body = h('div', { class: 'lane-body key-body' });
  for (let bar = 0; bar * STEPS_PER_BAR < L; bar++) {
    const i = sectionIndexAt(p, bar * STEPS_PER_BAR);
    const sec = secs[i];
    const isStart = sec.bar === bar;
    const cell = h('div', { class: 'key-cell' + (isStart ? ' start' : '') + (ui.selectedSection === i ? ' selected' : ''),
      style: { width: STEPS_PER_BAR * cw + 'px', '--sec': SECTION_COLORS[i % SECTION_COLORS.length] } });
    if (isStart) {
      cell.append(h('span', { class: 'key-label' }, `${keyName(sec.root, sec.scale)} ${SCALES[sec.scale].name.split(' (')[0]}`));
      cell.title = i === 0
        ? 'The song’s starting key. Click to edit it with Key/Scale in the top bar.'
        : `Key change at bar ${bar + 1}. Click to edit it in the top bar. Right-click to remove it.`;
      cell.addEventListener('click', () => { ui.selectedSection = i; touch('selection'); });
      cell.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (i === 0) return;
        ui.selectedSection = 0;
        removeKeyChange(i);
        toast(`Removed the key change at bar ${bar + 1}.`);
      });
    } else {
      cell.append(h('span', { class: 'key-plus' }, '+'));
      cell.title = `Change key or scale from bar ${bar + 1}`;
      cell.addEventListener('click', () => {
        const idx = addKeyChange(bar);
        if (idx < 0) return;
        ui.selectedSection = idx;
        touch('selection');
        toast(`New section from bar ${bar + 1}. Pick its key and scale in the top bar.`);
      });
    }
    body.append(cell);
  }
  return h('div', { class: 'lane key-lane' },
    h('div', { class: 'lane-head' }, h('div', { class: 'head-controls' },
      h('b', { title: 'Click a bar to change key or scale from there. Click a section to edit it in the top bar. Right-click a section to remove it.' }, 'Key'),
      h('span', { class: 'hint', style: { margin: 0 } }, 'Click a bar to change key there'))),
    body);
}

// ---------- Chord lane ----------
function slotCount(p) { return Math.ceil(loopSteps() / p.chords.slotSteps); }

function chordLane(p, L, cw) {
  const c = p.chords;
  const body = h('div', { class: 'lane-body' });
  const n = slotCount(p);
  for (let i = 0; i < n; i++) {
    const s = c.slots[i];
    const k = keyAt(p, i * c.slotSteps);
    const steps = scaleSteps(harmonyScaleId(k.scale));
    const w = Math.min(c.slotSteps, L - i * c.slotSteps) * cw;
    let el;
    if (s) {
      const fn = chordFunction(s.deg, steps);
      el = h('div', { class: 'chord-slot', style: { width: w + 'px', '--fn': FUNCTION_INFO[fn].color } },
        h('div', { class: 'rn' }, romanNumeral(steps, s.deg, s.type)),
        h('div', { class: 'cn' }, chordName(k.root, k.scale, s.deg, s.type)),
        h('div', { class: 'fn' }, FUNCTION_INFO[fn].label));
      el.style.setProperty('--fn', FUNCTION_INFO[fn].color);
      el.title = `${FUNCTION_INFO[fn].label}: ${FUNCTION_INFO[fn].help}\nRight-click to clear.`;
    } else {
      el = h('div', { class: 'chord-slot empty', style: { width: w + 'px' } }, '+ chord');
      el.title = 'Empty. Click, then pick a chord in the sidebar.';
    }
    if (ui.selectedSlot === i) el.classList.add('selected');
    el.addEventListener('click', () => {
      ui.selectedSlot = ui.selectedSlot === i ? null : i;
      if (ui.selectedSlot != null) ui.selectedSection = sectionIndexAt(p, i * c.slotSteps);
      if (s) previewChord(s.deg, s.type, 0.9, i * c.slotSteps);
      touch('selection');
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      c.slots[i] = null;
      commit('chords');
    });
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('dragover'); });
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      const data = e.dataTransfer.getData('text/bangerator-chord');
      if (!data) return;
      const { deg, type } = JSON.parse(data);
      c.slots[i] = { deg, type };
      previewChord(deg, type, 0.9, i * c.slotSteps);
      commit('chords');
    });
    body.append(el);
  }

  const head = h('div', { class: 'lane-head' }, h('div', { class: 'head-controls' },
    h('div', { class: 'head-row' },
      h('span', { class: 'color-dot', style: { background: '#ffd43b' } }),
      h('b', {}, 'Chords'),
      muteSolo(c)),
    h('div', { class: 'head-row' },
      patchSelect(c.patch, v => { c.patch = v; commit('chords'); }),
      h('select', { title: 'How the chord is played', onchange: e => { c.style = e.target.value; commit('chords'); } },
        ...[['block', 'Block'], ['strum', 'Strum'], ['stabs', 'Off-beat stabs'], ['gate', 'Gated 16ths'], ['arp-up', 'Arp ↑'], ['arp-down', 'Arp ↓'], ['arp-updown', 'Arp ↕']]
          .map(([v, t]) => h('option', { value: v, selected: c.style === v }, t)))),
    h('div', { class: 'head-row' },
      h('select', { title: 'How long each chord lasts', onchange: e => setSlotSteps(Number(e.target.value)) },
        ...[[8, '½ bar'], [16, '1 bar'], [32, '2 bars'], [64, '4 bars']].map(([v, t]) => h('option', { value: v, selected: c.slotSteps === v }, t))),
      octaveCtl(c, 'chords'),
      h('label', { title: 'Pick chord shapes that move as little as possible (smooth!)' },
        h('input', { type: 'checkbox', checked: c.voiceLead, onchange: e => { c.voiceLead = e.target.checked; commit('chords'); } }), 'smooth')),
    h('div', { class: 'head-row' }, volCtl(c)),
    h('div', { class: 'head-row' },
      h('label', { title: 'Guide only: these chords stay silent in this pattern, but still tint the rolls and feed the suggestions. Use it when another pattern plays the chords.' },
        h('input', { type: 'checkbox', checked: !!p.chordsGuide, onchange: e => { p.chordsGuide = e.target.checked; commit('chords'); } }), 'guide only'),
      h('button', { class: 'btn', title: 'Copy these chords into every other pattern as a silent guide, so basslines and melodies there can follow them', onclick: copyChordsToAll }, '→ all patterns'))));
  return h('div', { class: 'lane chord-lane' + (p.chordsGuide ? ' chords-guide-only' : '') }, head, body);
}

function copyChordsToAll() {
  const p = store.project;
  if (p.patterns.length < 2) { toast('There is only one pattern.'); return; }
  withPatterns(q => {
    const src = q.patterns.find(x => x.id === q.currentPattern);
    for (const pat of q.patterns) {
      if (pat === src) continue;
      const n = Math.ceil(pat.bars * STEPS_PER_BAR / src.slotSteps);
      const len = Math.max(1, Math.ceil(src.bars * STEPS_PER_BAR / src.slotSteps));
      pat.chordSlots = Array.from({ length: n }, (_, i) => (src.chordSlots[i % len] ? { ...src.chordSlots[i % len] } : null));
      pat.slotSteps = src.slotSteps;
      pat.chordsGuide = true;
      pat.root = src.root; pat.scale = src.scale;
    }
  });
  commit('all');
  toast(`Chords copied to ${p.patterns.length - 1} other pattern${p.patterns.length > 2 ? 's' : ''} as a silent guide (their key now matches too).`, 4000);
}

function setSlotSteps(v) {
  const c = store.project.chords;
  const old = c.slotSteps;
  const out = [];
  const total = Math.ceil(32 * 16 / v);
  for (let i = 0; i < total; i++) {
    const src = Math.floor((i * v) / old);
    out.push(c.slots[src] ? { ...c.slots[src] } : null);
  }
  c.slots = out;
  c.slotSteps = v;
  ui.selectedSlot = null;
  commit('chords');
}

// ---------- Shared head controls ----------
function patchSelect(value, onChange) {
  const p = store.project;
  const groups = { sampler: [], synth: [] };
  for (const [id, pt] of Object.entries(p.patches)) groups[pt.kind].push(h('option', { value: id, selected: id === value }, pt.name));
  return h('select', { title: 'Instrument (edit sounds in the Sound Design tab)', onchange: e => onChange(e.target.value) },
    h('optgroup', { label: 'Sampled' }, ...groups.sampler),
    h('optgroup', { label: 'Synths' }, ...groups.synth));
}

function muteSolo(obj) {
  return [
    h('button', { class: 'btn mute' + (obj.mute ? ' on' : ''), title: 'Mute', onclick: () => { obj.mute = !obj.mute; commit('mix'); } }, 'M'),
    h('button', { class: 'btn solo' + (obj.solo ? ' on' : ''), title: 'Solo', onclick: () => { obj.solo = !obj.solo; commit('mix'); } }, 'S'),
  ];
}

function volCtl(obj, key = 'volume') {
  return h('label', { title: 'Volume' }, 'Vol',
    h('input', { type: 'range', min: 0, max: 1.2, step: 0.01, value: obj[key],
      oninput: e => { obj[key] = Number(e.target.value); syncMixer(); },
      onchange: () => commit('mix') }));
}

function octaveCtl(obj, what) {
  // The label is updated here too: a 'notes' change only redraws the rolls, not the lane headers.
  const label = h('span', { style: { fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap' }, title: 'Octave' }, `Oct ${obj.octave}`);
  const set = v => {
    if (v === obj.octave) return;
    obj.octave = v;
    label.textContent = `Oct ${v}`;
    commit(what);
  };
  return [
    h('button', { class: 'btn', title: 'Octave down', onclick: () => set(Math.max(0, obj.octave - 1)) }, '−'),
    label,
    h('button', { class: 'btn', title: 'Octave up', onclick: () => set(Math.min(7, obj.octave + 1)) }, '+'),
  ];
}

// ---------- Melody track lanes ----------
function trackLane(t, L) {
  const roll = new ScaleRoll(t, {
    project: () => store.project,
    cellW: () => ui.cellW,
    rowH: ui.rowH,
    loopSteps: () => loopSteps(),
    labelSection: () => ui.selectedSection,
    onPreviewDeg: (tr, deg, alt, step) => previewDeg(tr, deg, alt, 0.35, step),
    onPreviewMidi: (tr, midi) => previewTrackMidi(tr, midi),
    onCommit: () => commit('notes'),
    onSelect: tr => selectTrack(tr.id),
  });
  rolls.push(roll);
  const lane = h('div', { class: 'lane track-lane' + (ui.selectedTrackId === t.id ? ' selected' : ''), 'data-track': t.id });
  const controls = h('div', { class: 'head-controls' },
    h('div', { class: 'head-row' },
      h('span', { class: 'color-dot', style: { background: t.color } }),
      h('input', { class: 'track-name', value: t.name, onchange: e => { t.name = e.target.value; commit('mix'); } }),
      muteSolo(t)),
    h('div', { class: 'head-row' }, patchSelect(t.patch, v => { t.patch = v; commit('mix'); })),
    h('div', { class: 'head-row mode-row' },
      h('button', { class: 'btn' + (t.mode !== 'piano' ? ' on' : ''), title: 'Rows are scale degrees. Notes follow key and scale changes.',
        onclick: () => switchMode(t, 'scale') }, 'Scale'),
      h('button', { class: 'btn' + (t.mode === 'piano' ? ' on' : ''), title: 'A normal piano roll: rows are the 12 notes and notes keep their pitch when the key or scale changes.',
        onclick: () => switchMode(t, 'piano') }, 'Piano')),
    h('div', { class: 'head-row' },
      octaveCtl(t, 'notes'),
      h('select', { title: 'How many octaves of rows to show', style: { flex: '0 0 auto' }, onchange: e => { t.range = Number(e.target.value); commit('all'); } },
        ...[1, 2, 3, 4].map(v => h('option', { value: v, selected: t.range === v }, `${v} oct`)))),
    h('div', { class: 'head-row' }, volCtl(t)),
    h('div', { class: 'head-row' },
      h('button', { class: 'btn', title: 'Remove all notes', onclick: () => { if (t.notes.length && confirm(`Clear all notes in “${t.name}”?`)) { t.notes = []; commit('notes'); } } }, 'Clear'),
      h('button', { class: 'btn', title: 'Copy the first bar(s) across the loop', onclick: () => fillFromStart(t) }, 'Repeat'),
      h('button', { class: 'btn' + (ui.velLanes.has(t.id) ? ' on' : ''), title: 'Velocity lane: how hard each note is played. Drag bars up and down, or across to paint', onclick: () => { if (ui.velLanes.has(t.id)) ui.velLanes.delete(t.id); else ui.velLanes.add(t.id); renderCompose(); } }, 'Vel'),
      h('button', { class: 'btn', title: 'Delete this track', onclick: () => {
        if (!confirm(`Delete track “${t.name}”? Its notes go from every pattern.`)) return;
        deleteTrack(t);
      } }, '✕')));
  const head = h('div', { class: 'lane-head' }, controls, roll.keys);
  head.addEventListener('pointerdown', () => selectTrack(t.id));
  lane.append(head, h('div', { class: 'lane-body' }, roll.canvas));
  if (!ui.velLanes.has(t.id)) return lane;
  // velocity lane under the roll
  const vl = new VelLane(t, { steps: () => L, px: () => ui.cellW, getSelection: () => roll.sel, onChange: () => roll.render(), onCommit: () => commit('notes') });
  rolls.push(vl);
  const inPattern = () => t.notes.filter(n => n.step < L);
  const tool = (label, title, fn) => h('button', { class: 'btn', title, onclick: () => { fn(roll.sel.size ? [...roll.sel] : inPattern()); commit('notes'); } }, label);
  const velRow = h('div', { class: 'lane vel-lane' + (ui.selectedTrackId === t.id ? ' selected' : ''), 'data-track': t.id },
    h('div', { class: 'lane-head vel-head' },
      h('div', { class: 'head-controls' },
        h('div', { class: 'head-row' }, h('b', {}, 'Velocity'), h('span', { class: 'hint', style: { margin: 0 } }, 'drag bars · right-click = accent')),
        h('div', { class: 'head-row' },
          tool('Accent beats', 'Notes on the beat loud, the ones between softer: the quickest way to make a part groove', accentBeats),
          tool('Even', 'Every note the same velocity', evenOut),
          tool('Humanize', 'Small random differences, like a player', humanize)))),
    h('div', { class: 'lane-body' }, vl.canvas));
  return [lane, velRow];
}

function switchMode(t, mode) {
  if ((t.mode || 'scale') === mode) return;
  setTrackMode(t, mode);
  toast(mode === 'piano'
    ? `“${t.name}” is now a piano roll: notes keep their exact pitch, the scale is only highlighted.`
    : `“${t.name}” now uses scale degrees: notes follow the key and scale.`, 4000);
}

// Repeat the first N bars that contain notes across the whole loop.
function fillFromStart(t) {
  const L = loopSteps();
  if (!t.notes.length) return;
  const lastStep = Math.max(...t.notes.map(n => n.step));
  const blockBars = Math.max(1, Math.ceil((lastStep + 1) / STEPS_PER_BAR));
  const block = blockBars * STEPS_PER_BAR;
  if (block >= L) { toast('The notes already fill the loop. Make the loop longer first (Bars).'); return; }
  const src = t.notes.filter(n => n.step < block);
  t.notes = [...src];
  for (let off = block; off < L; off += block) for (const n of src) if (n.step + off < L) t.notes.push({ ...n, step: n.step + off });
  commit('notes');
  toast(`Repeated the first ${blockBars} bar${blockBars > 1 ? 's' : ''} across the loop.`);
}

export function selectTrack(id) {
  ui.ctlChannel = id; // a MIDI keyboard follows the clicked track
  if (ui.selectedTrackId === id) return;
  ui.selectedTrackId = id;
  // a hidden (unused) track gets shown once it's selected
  if (ui.focusLanes && !document.querySelector(`.track-lane[data-track="${id}"]`)) renderCompose();
  document.querySelectorAll('.track-lane').forEach(l => l.classList.toggle('selected', l.dataset.track === id));
  onSelectTrack(id);
}

export function addTrack() {
  const p = store.project;
  const color = TRACK_COLORS[p.tracks.length % TRACK_COLORS.length];
  const t = newTrack(`Track ${p.tracks.length + 1}`, 'saw', 4, color);
  p.tracks.push(t);
  ui.selectedTrackId = t.id;
  commit('all');
}

// ---------- Automation lanes ----------
export function channelColor(p, ch) {
  if (ch === 'chords') return '#ffd43b';
  if (ch === 'master') return '#e9ecf5';
  if (ch === 'drums') return '#ff6b6b';
  if (ch.startsWith('row:')) return DRUM_COLORS[p.drums.rows.find(r => r.id === ch.slice(4))?.kind] || '#e9ecf5';
  return p.tracks.find(t => t.id === ch)?.color || '#e9ecf5';
}

function autoLaneRow(lane, L) {
  const p = store.project;
  const al = new AutoLane(lane, { steps: () => L, px: () => ui.cellW, snap: () => 1,
    color: channelColor(p, lane.target.split('|')[0]), onCommit: () => commit('auto') });
  rolls.push(al);
  const head = h('div', { class: 'lane-head drum-head auto-head' },
    h('span', { class: 'color-dot', style: { background: channelColor(p, lane.target.split('|')[0]) } }),
    targetSelect(lane.target, v => {
      if (p.patAuto.some(l => l !== lane && l.target === v)) { toast('That setting already has a lane.'); renderCompose(); return; }
      lane.target = v;
      commit('all');
    }),
    h('button', { class: 'btn', title: 'Clear all points', onclick: () => { lane.points = []; commit('all'); } }, 'Clear'),
    h('button', { class: 'btn', title: 'Remove this lane', onclick: () => { p.patAuto.splice(p.patAuto.indexOf(lane), 1); commit('all'); } }, '✕'));
  return h('div', { class: 'lane auto-lane' }, head, h('div', { class: 'lane-body' }, al.canvas));
}

// ---------- Drum lanes ----------
const DRUM_COLORS = { kick: '#ff6b6b', snare: '#ffa94d', clap: '#ffd43b', rim: '#fcc419', chat: '#69db7c', ohat: '#38d9a9',
  ltom: '#4dabf7', mtom: '#748ffc', htom: '#9775fa', cowbell: '#da77f2', cymbal: '#f783ac', shaker: '#63e6be', ride: '#e599f7', riser: '#99e9f2', impact: '#ffc9c9', downer: '#a5d8ff', sample: '#e9ecf5' };

let painting = null; // value being painted while the mouse is held

function drumLane(r, L, cw) {
  const body = h('div', { class: 'lane-body drum-body' });
  body.style.setProperty('--row-color', DRUM_COLORS[r.kind] || '#fff');
  for (let s = 0; s < L; s++) {
    const v = r.steps[s] || 0;
    const b = h('button', { class: `step${Math.floor(s / 4) % 2 ? ' alt' : ''}${v ? ' v' + v : ''}`, style: { width: cw - 2 + 'px' } });
    const set = val => {
      r.steps[s] = val;
      b.className = `step${Math.floor(s / 4) % 2 ? ' alt' : ''}${val ? ' v' + val : ''}`;
      if (val) auditionRow(r, val === 2 ? 1 : 0.7);
    };
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      const cur = r.steps[s] || 0;
      const accent = e.shiftKey || e.button === 2;
      painting = accent ? (cur === 2 ? 0 : 2) : (cur ? 0 : 1);
      set(painting);
      b.releasePointerCapture?.(e.pointerId);
    });
    b.addEventListener('pointerenter', () => { if (painting != null && (r.steps[s] || 0) !== painting) set(painting); });
    b.addEventListener('contextmenu', e => e.preventDefault());
    b.__row = r;
    (drumCols[s] ||= []).push(b);
    body.append(b);
  }
  const nameEl = h('span', { class: 'dname', title: `${r.name}${r.pitch ? ` (pitch ${r.pitch > 0 ? '+' : ''}${r.pitch})` : ''}
Click to hear it` },
    r.name, r.pitch ? h('span', { class: 'dpitch' }, `${r.pitch > 0 ? '+' : ''}${r.pitch}`) : null);
  nameEl.addEventListener('click', () => auditionRow(r, 0.9));
  const head = h('div', { class: 'lane-head drum-head' },
    h('span', { class: 'color-dot', style: { background: DRUM_COLORS[r.kind] || '#fff' } }),
    nameEl,
    h('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: r.vol, title: 'Volume',
      oninput: e => { r.vol = Number(e.target.value); syncMixer(); }, onchange: () => commit('mix') }),
    ...muteSolo(r),
    h('button', { class: 'btn', title: 'Fill this row with a rhythm, repeat it, shift it, change its pitch', onclick: e => drumRowMenu(e, r) }, '⋯'),
  );
  const lane = h('div', { class: 'lane drum-lane' }, head, body);
  if (r.kind === 'sample') attachDrop(lane, file => loadSampleInto(r, file));
  return lane;
}

window.addEventListener('pointerup', () => {
  if (painting != null) { painting = null; commit('drums'); }
});

// ---------- Drum fills and repeats ----------
// Rhythms by step within a bar (16 steps): which steps get a hit, and which of those are accents.
const RHYTHMS = [
  ['Every beat (quarter notes)', s => s % 4 === 0],
  ['Every 8th', s => s % 2 === 0],
  ['Every 16th', () => true, s => s % 4 === 0],
  ['Off-beats (between the beats)', s => s % 4 === 2],
  ['Beats 2 and 4 (backbeat)', s => s % 16 === 4 || s % 16 === 12],
  ['16ths without the beat (x.xx)', s => s % 4 !== 1],
  ['Dotted 8ths (every 3 steps)', s => s % 16 % 3 === 0 && s % 16 < 15],
];

function fillRow(r, test, accent = null) {
  const L = loopSteps();
  r.steps = Array.from({ length: L }, (_, s) => (test(s) ? (accent?.(s) ? 2 : 1) : 0));
}

// Copy the first `bars` bars of a row across the whole pattern.
function repeatRow(r, bars) {
  const L = loopSteps();
  const n = bars * STEPS_PER_BAR;
  const src = Array.from({ length: n }, (_, i) => r.steps[i] || 0);
  r.steps = Array.from({ length: L }, (_, s) => src[s % n]);
}

function repeatAllRows(bars) {
  if (loopSteps() <= bars * STEPS_PER_BAR) { toast('The pattern is not longer than that. Make it longer first (Bars).'); return; }
  store.project.drums.rows.forEach(r => repeatRow(r, bars));
  commit('drums');
  toast(`Bar${bars > 1 ? 's 1–' + bars : ' 1'} repeated across the pattern for every drum row. Ctrl+Z undoes it.`);
}

function setPitch(r, v) {
  r.pitch = Math.max(-24, Math.min(24, v));
  auditionRow(r, 0.85);
  commit('all'); // redraws the row name with its pitch badge
}

function drumRowMenu(e, r) {
  const L = loopSteps();
  const apply = (fn, msg) => () => { fn(); commit('drums'); auditionRow(r, 0.8); if (msg) toast(msg); };
  const rotate = d => apply(() => { const old = Array.from({ length: L }, (_, i) => r.steps[i] || 0); r.steps = old.map((_, s) => old[(s - d + L) % L]); });
  popupMenu(e, [
    ...RHYTHMS.map(([label, test, acc]) => [label, apply(() => fillRow(r, test, acc), `${r.name}: ${label.toLowerCase()} across the pattern.`)]),
    '-',
    L > 16 ? ['Repeat bar 1 across the pattern', apply(() => repeatRow(r, 1))] : null,
    L > 32 ? ['Repeat bars 1–2 across the pattern', apply(() => repeatRow(r, 2))] : null,
    L > 64 ? ['Repeat bars 1–4 across the pattern', apply(() => repeatRow(r, 4))] : null,
    ['Shift right one step', rotate(1)],
    ['Shift left one step', rotate(-1)],
    '-',
    [`Pitch up a semitone (now ${r.pitch > 0 ? '+' : ''}${r.pitch || 0})`, () => setPitch(r, (r.pitch || 0) + 1)],
    ['Pitch down a semitone', () => setPitch(r, (r.pitch || 0) - 1)],
    ['Pitch up an octave', () => setPitch(r, (r.pitch || 0) + 12)],
    ['Pitch down an octave', () => setPitch(r, (r.pitch || 0) - 12)],
    r.pitch ? ['Reset pitch', () => setPitch(r, 0)] : null,
    '-',
    ['Clear this row', apply(() => { r.steps = []; })],
    r.kind === 'sample' ? ['Remove this sample row', () => { if (confirm(`Remove sample row “${r.name}” (from every pattern)?`)) deleteDrumRow(r); }] : null,
  ]);
}

function auditionRow(r, vel) {
  if (!audio.ctx || transport.playing) return;
  const buf = r.kind === 'sample' ? audio.userBuffers[r.sampleId] : audio.drumBuffers[r.kind];
  syncMixer();
  playBuffer(audio.ctx, audio.mixer.rowStrip(r.id).gain, buf, audio.ctx.currentTime + 0.005, vel, r.pitch);
}

function addSampleLane() {
  const input = h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true,
    onchange: e => { [...e.target.files].forEach(addSampleRow); e.target.value = ''; } });
  return h('div', { class: 'lane' },
    h('div', { class: 'lane-head drum-head' },
      h('button', { class: 'btn', onclick: () => input.click(), title: 'Load your own sounds (wav, mp3, ogg)' }, '+ Sample row'), input),
    h('div', { class: 'lane-body' }, h('p', { class: 'hint', style: { margin: '8px 12px' } }, 'Tip: drag audio files from your computer onto the drum area.')));
}

function drumSectionDrop() {
  return lane => attachDrop(lane, addSampleRow);
}

function attachDrop(el, onFile) {
  el.addEventListener('dragover', e => {
    if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); el.classList.add('drop'); }
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', e => {
    el.classList.remove('drop');
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('audio') || /\.(wav|mp3|ogg|flac|aiff?|m4a)$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    files.forEach(onFile);
  });
}

async function addSampleRow(file) {
  const r = { id: uid('d'), name: file.name.replace(/\.[^.]+$/, ''), kind: 'sample', sampleId: uid('s'), vol: 0.9, pan: 0, pitch: 0, mute: false, solo: false, steps: [], fx: defaultFx() };
  if (await loadSampleInto(r, file, false)) {
    store.project.drums.rows.push(r);
    commit('all');
    toast(`Added sample “${r.name}”`);
  }
}

async function loadSampleInto(r, file, doCommit = true) {
  try {
    const ab = await file.arrayBuffer();
    const buf = await decodeUserSample(ab);
    if (buf.duration > 20) { toast('That file is over 20 seconds. Use short one-shots for the step sequencer.'); return false; }
    audio.userBuffers[r.sampleId] = buf;
    await saveSampleData(r.sampleId, file.name, ab);
    if (doCommit) { r.name = file.name.replace(/\.[^.]+$/, ''); commit('all'); }
    return true;
  } catch (e) {
    console.error(e);
    toast('Could not read that audio file.');
    return false;
  }
}

// ---------- Playhead ----------
export function drawPlayhead(step) {
  const ph = document.getElementById('playhead');
  if (step < 0) {
    ph.style.display = 'none';
    if (lastLitCol >= 0) (drumCols[lastLitCol] || []).forEach(b => b.classList.remove('now'));
    lastLitCol = -1;
    return;
  }
  ph.style.display = 'block';
  const headW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-w')) || 250;
  ph.style.left = headW + step * ui.cellW + 'px';
  if (step !== lastLitCol) {
    (drumCols[lastLitCol] || []).forEach(b => b.classList.remove('now'));
    (drumCols[step] || []).forEach(b => b.classList.add('now'));
    lastLitCol = step;
  }
}

export function resetDrumCols() { drumCols = []; lastLitCol = -1; }

// Refresh the drum grid from the data (after steps were changed from somewhere else, e.g. a MIDI controller).
export function syncDrumCells() {
  drumCols.forEach((col, s) => col.forEach(b => {
    const v = b.__row.steps[s] || 0;
    b.className = `step${Math.floor(s / 4) % 2 ? ' alt' : ''}${v ? ' v' + v : ''}${s === lastLitCol ? ' now' : ''}`;
  }));
}
export { slotCount, KEYS_W, CHORD_TYPES, mod, patchOf };
