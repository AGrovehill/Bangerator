// Compose view: ruler, chord lane, melody tracks (scale rolls) and the drum step sequencer.
// Every lane shares the same horizontal step grid so everything lines up.

import { store, commit, touch, loopSteps, newTrack, TRACK_COLORS, uid, saveSampleData, STEPS_PER_BAR } from '../state.js';
import { romanNumeral, chordName, chordFunction, scaleSteps, harmonyScaleId, CHORD_TYPES, FUNCTION_INFO, mod } from '../theory.js';
import { audio, playBuffer, decodeUserSample } from '../audio.js';
import { ScaleRoll, KEYS_W } from './scaleroll.js';
import { ui, h, previewDeg, previewChord, toast, patchOf } from './common.js';
import { play, stop, transport, syncMixer } from '../sequencer.js';

let rolls = [];
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

  lanes.append(rulerLane(L, cw));
  lanes.append(sectionTitle('Chords', 'The harmony. Pick chords from the sidebar, or click a slot and then click a chord.'));
  lanes.append(chordLane(p, L, cw));
  lanes.append(sectionTitle('Melody & Bass', 'Rows are scale degrees. 1 is home. Tinted rows are notes of the chord playing above them.'));
  for (const t of p.tracks) lanes.append(trackLane(t, L));
  lanes.append(sectionTitle('Drums & Samples', 'Click steps to toggle. Shift or right-click for a loud accent. Drop audio files here to add sample rows.', drumSectionDrop()));
  for (const r of p.drums.rows) lanes.append(drumLane(r, L, cw));
  lanes.append(addSampleLane());
  rolls.forEach(r => r.render());
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
  const dpr = window.devicePixelRatio || 1;
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
  c.addEventListener('click', e => {
    const step = Math.floor((e.offsetX / cw) / 4) * 4;
    if (transport.playing) stop();
    play(step);
    document.getElementById('btn-play').classList.add('playing');
    document.getElementById('btn-play').textContent = '■';
  });
  return h('div', { class: 'lane ruler' },
    h('div', { class: 'lane-head' }, 'Bar'),
    h('div', { class: 'lane-body' }, c));
}

// ---------- Chord lane ----------
function slotCount(p) { return Math.ceil(loopSteps() / p.chords.slotSteps); }

function chordLane(p, L, cw) {
  const c = p.chords;
  const steps = scaleSteps(harmonyScaleId(p.scale));
  const body = h('div', { class: 'lane-body' });
  const n = slotCount(p);
  for (let i = 0; i < n; i++) {
    const s = c.slots[i];
    const w = Math.min(c.slotSteps, L - i * c.slotSteps) * cw;
    let el;
    if (s) {
      const fn = chordFunction(s.deg, steps);
      el = h('div', { class: 'chord-slot', style: { width: w + 'px', '--fn': FUNCTION_INFO[fn].color } },
        h('div', { class: 'rn' }, romanNumeral(steps, s.deg, s.type)),
        h('div', { class: 'cn' }, chordName(p.root, p.scale, s.deg, s.type)),
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
      if (s) previewChord(s.deg, s.type);
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
      previewChord(deg, type);
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
        ...[['block', 'Block'], ['strum', 'Strum'], ['stabs', 'Off-beat stabs'], ['arp-up', 'Arp ↑'], ['arp-down', 'Arp ↓'], ['arp-updown', 'Arp ↕']]
          .map(([v, t]) => h('option', { value: v, selected: c.style === v }, t)))),
    h('div', { class: 'head-row' },
      h('select', { title: 'How long each chord lasts', onchange: e => setSlotSteps(Number(e.target.value)) },
        ...[[8, '½ bar'], [16, '1 bar'], [32, '2 bars']].map(([v, t]) => h('option', { value: v, selected: c.slotSteps === v }, t))),
      octaveCtl(c, 'chords'),
      h('label', { title: 'Pick chord shapes that move as little as possible (smooth!)' },
        h('input', { type: 'checkbox', checked: c.voiceLead, onchange: e => { c.voiceLead = e.target.checked; commit('chords'); } }), 'smooth')),
    h('div', { class: 'head-row' }, volCtl(c))));
  return h('div', { class: 'lane chord-lane' }, head, body);
}

function setSlotSteps(v) {
  const c = store.project.chords;
  const old = c.slotSteps;
  const out = [];
  const total = Math.ceil(16 * 16 / v);
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
  return [
    h('button', { class: 'btn', title: 'Octave down', onclick: () => { obj.octave = Math.max(0, obj.octave - 1); commit(what); } }, '−'),
    h('span', { style: { fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap' }, title: 'Octave' }, `Oct ${obj.octave}`),
    h('button', { class: 'btn', title: 'Octave up', onclick: () => { obj.octave = Math.min(7, obj.octave + 1); commit(what); } }, '+'),
  ];
}

// ---------- Melody track lanes ----------
function trackLane(t, L) {
  const roll = new ScaleRoll(t, {
    project: () => store.project,
    cellW: () => ui.cellW,
    rowH: ui.rowH,
    loopSteps: () => loopSteps(),
    onPreview: (tr, deg, alt) => previewDeg(tr, deg, alt),
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
    h('div', { class: 'head-row' },
      octaveCtl(t, 'notes'),
      h('select', { title: 'How many octaves of rows to show', style: { flex: '0 0 auto' }, onchange: e => { t.range = Number(e.target.value); commit('all'); } },
        ...[1, 2, 3, 4].map(v => h('option', { value: v, selected: t.range === v }, `${v} oct`)))),
    h('div', { class: 'head-row' }, volCtl(t)),
    h('div', { class: 'head-row' },
      h('button', { class: 'btn', title: 'Remove all notes', onclick: () => { if (t.notes.length && confirm(`Clear all notes in “${t.name}”?`)) { t.notes = []; commit('notes'); } } }, 'Clear'),
      h('button', { class: 'btn', title: 'Copy the first bar(s) across the loop', onclick: () => fillFromStart(t) }, 'Repeat'),
      h('button', { class: 'btn', title: 'Delete this track', onclick: () => {
        if (!confirm(`Delete track “${t.name}”?`)) return;
        const p = store.project;
        p.tracks.splice(p.tracks.indexOf(t), 1);
        commit('all');
      } }, '✕')));
  const head = h('div', { class: 'lane-head' }, controls, roll.keys);
  head.addEventListener('pointerdown', () => selectTrack(t.id));
  lane.append(head, h('div', { class: 'lane-body' }, roll.canvas));
  return lane;
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
  if (ui.selectedTrackId === id) return;
  ui.selectedTrackId = id;
  document.querySelectorAll('.track-lane').forEach(l => l.classList.toggle('selected', l.dataset.track === id));
}

export function addTrack() {
  const p = store.project;
  const color = TRACK_COLORS[p.tracks.length % TRACK_COLORS.length];
  const t = newTrack(`Track ${p.tracks.length + 1}`, 'saw', 4, color);
  p.tracks.push(t);
  ui.selectedTrackId = t.id;
  commit('all');
}

// ---------- Drum lanes ----------
const DRUM_COLORS = { kick: '#ff6b6b', snare: '#ffa94d', clap: '#ffd43b', rim: '#fcc419', chat: '#69db7c', ohat: '#38d9a9',
  ltom: '#4dabf7', mtom: '#748ffc', htom: '#9775fa', cowbell: '#da77f2', cymbal: '#f783ac', shaker: '#63e6be', sample: '#e9ecf5' };

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
    (drumCols[s] ||= []).push(b);
    body.append(b);
  }
  const nameEl = h('span', { class: 'dname', title: 'Click to hear it' }, r.name);
  nameEl.addEventListener('click', () => auditionRow(r, 0.9));
  const head = h('div', { class: 'lane-head drum-head' },
    h('span', { class: 'color-dot', style: { background: DRUM_COLORS[r.kind] || '#fff' } }),
    nameEl,
    h('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: r.vol, title: 'Volume',
      oninput: e => { r.vol = Number(e.target.value); syncMixer(); }, onchange: () => commit('mix') }),
    h('input', { type: 'range', min: -12, max: 12, step: 1, value: r.pitch, title: 'Pitch (semitones)',
      oninput: e => { r.pitch = Number(e.target.value); auditionRow(r, 0.8); }, onchange: () => commit('drums') }),
    ...muteSolo(r),
    r.kind === 'sample' ? h('button', { class: 'btn', title: 'Remove this sample row', onclick: () => {
      const rows = store.project.drums.rows;
      rows.splice(rows.indexOf(r), 1);
      commit('all');
    } }, '✕') : null);
  const lane = h('div', { class: 'lane drum-lane' }, head, body);
  if (r.kind === 'sample') attachDrop(lane, file => loadSampleInto(r, file));
  return lane;
}

window.addEventListener('pointerup', () => {
  if (painting != null) { painting = null; commit('drums'); }
});

function auditionRow(r, vel) {
  if (!audio.ctx || transport.playing) return;
  const buf = r.kind === 'sample' ? audio.userBuffers[r.sampleId] : audio.drumBuffers[r.kind];
  syncMixer();
  playBuffer(audio.ctx, audio.mixer.strip(r.id).gain, buf, audio.ctx.currentTime + 0.005, vel, r.pitch);
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
  const r = { id: uid('d'), name: file.name.replace(/\.[^.]+$/, ''), kind: 'sample', sampleId: uid('s'), vol: 0.9, pitch: 0, mute: false, solo: false, steps: [] };
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
export { slotCount, KEYS_W, CHORD_TYPES, mod, patchOf };
