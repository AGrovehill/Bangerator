// Sidebar: circle of fifths, scale info, chord palette, "what comes next" and progressions.

import { store, commit, changeKey, loopSteps, STEPS_PER_BAR, MAX_BARS, sections, keyAt } from '../state.js';
import { SCALES, scaleSteps, harmonyScaleId, spellScale, intervalLabel, stepPattern, keySignature, keyName,
  romanNumeral, chordName, chordFunction, CHORD_TYPES, FUNCTION_INFO, PROGRESSIONS, suggestNext, harmonize, chordSemis, chordQuality, mod } from '../theory.js';
import { renderCircle } from './circle.js';
import { ui, h, previewChord, previewDeg, toast, selectedKey } from './common.js';
import { slotCount } from './compose.js';
import { noteMidi } from '../sequencer.js';

// Modes from brightest to darkest: swapping along this line changes the mood step by step.
const BRIGHTNESS = ['lydian', 'major', 'mixolydian', 'dorian', 'minor', 'phrygian', 'locrian'];

export function renderSidebar() {
  const proj = store.project;
  // Everything here describes the key section being edited (selected in the Key lane).
  const k = selectedKey();
  const p = { ...proj, root: k.root, scale: k.scale };
  renderCircle(document.getElementById('circle'), p, {
    onPickRoot: (root, fam) => {
      const flip = (p.scale === 'major' && fam === 'minor') || (p.scale === 'minor' && fam === 'major');
      changeKey(root, flip ? fam : p.scale, ui.selectedSection);
    },
    onAudition: deg => previewChord(deg, 'triad'),
  });
  renderScaleCard(p);
  renderPalette(p);
  renderSuggestions(proj);
  renderProgressions(p);
}

function renderScaleCard(p) {
  const card = document.getElementById('scale-card');
  const sc = SCALES[p.scale];
  const steps = sc.steps;
  const names = spellScale(p.root, p.scale);
  const pattern = stepPattern(steps);
  const chips = [];
  const previewTrack = store.project.tracks.find(t => t.id === ui.selectedTrackId) || store.project.tracks[0]
    || { patch: 'piano', octave: 4, id: 'preview' };
  steps.forEach((s, i) => {
    chips.push(h('div', { class: 'deg-chip' + (i === 0 ? ' tonic' : ''), title: 'Click to hear',
      onclick: () => previewDeg({ ...previewTrack, octave: Math.max(3, previewTrack.octave) }, i) },
      h('span', { class: 'num' }, i + 1),
      h('span', { class: 'iv' }, intervalLabel(steps, i)),
      p.showNoteNames ? h('span', { class: 'nm' }, names[i]) : null));
    chips.push(h('span', { class: 'step-gap', title: pattern[i] === 'W' ? 'Whole step (2 keys)' : pattern[i] === 'H' ? 'Half step (1 key)' : 'Bigger jump' }, pattern[i]));
  });
  const sig = keySignature(p.root, p.scale);
  const idx = BRIGHTNESS.indexOf(p.scale);
  const moodBtns = idx >= 0 ? h('div', { class: 'type-row' },
    idx > 0 ? h('button', { class: 'btn', onclick: () => swapTo(BRIGHTNESS[idx - 1]) }, `☀ Brighter: ${SCALES[BRIGHTNESS[idx - 1]].name.split(' (')[0]}`) : null,
    idx < BRIGHTNESS.length - 1 ? h('button', { class: 'btn', onclick: () => swapTo(BRIGHTNESS[idx + 1]) }, `☾ Darker: ${SCALES[BRIGHTNESS[idx + 1]].name.split(' (')[0]}`) : null) : null;

  const secs = sections(store.project);
  card.replaceChildren(
    h('h3', {}, secs.length > 1 ? `Scale from bar ${secs[ui.selectedSection].bar + 1}` : 'Your scale'),
    h('div', { class: 'scale-title' }, `${keyName(p.root, p.scale)} ${sc.name}`),
    h('div', { class: 'scale-mood' }, sc.mood),
    h('div', { class: 'degrees' }, ...chips),
    h('div', { class: 'keysig' }, `Steps: ${pattern.join(' ')} · Key signature: ${sig === 0 ? 'none' : Math.abs(sig) + (sig > 0 ? '♯' : '♭')}`),
    moodBtns || '',
    h('p', { class: 'hint' }, 'Swap the scale and your melody keeps its numbers, so the same loop gets a new mood.'));
}

function swapTo(id) {
  changeKey(selectedKey().root, id, ui.selectedSection);
  toast(`Now in ${SCALES[id].name}. Same numbers, new mood.`);
}

function renderPalette(p) {
  const card = document.getElementById('chord-palette');
  const hid = harmonyScaleId(p.scale);
  const steps = scaleSteps(hid);
  const typeRow = h('div', { class: 'type-row' }, ...Object.entries(CHORD_TYPES).map(([id, t]) =>
    h('button', { class: 'btn' + (ui.chordType === id ? ' on' : ''), title: t.help, onclick: () => {
      ui.chordType = id;
      // also change the selected slot's type
      const s = ui.selectedSlot != null ? store.project.chords.slots[ui.selectedSlot] : null;
      if (s) { s.type = id; previewChord(s.deg, id); commit('chords'); } else renderPalette(p);
    } }, t.name)));
  const grid = h('div', { class: 'chord-grid' });
  steps.forEach((_, d) => {
    const fn = chordFunction(d, steps);
    const b = h('button', { class: 'chord-btn', draggable: true, title: `${FUNCTION_INFO[fn].label}: ${FUNCTION_INFO[fn].help}\nClick to hear${ui.selectedSlot != null ? ' and place' : ''}; drag onto the chord lane.` },
      h('span', { class: 'rn' }, romanNumeral(steps, d, ui.chordType)),
      h('span', { class: 'cn' }, chordName(p.root, p.scale, d, ui.chordType)));
    b.style.setProperty('--fn', FUNCTION_INFO[fn].color);
    b.addEventListener('click', () => placeChord(d, ui.chordType));
    b.addEventListener('dragstart', e => e.dataTransfer.setData('text/bangerator-chord', JSON.stringify({ deg: d, type: ui.chordType })));
    grid.append(b);
  });
  const selInfo = ui.selectedSlot != null
    ? h('p', { class: 'hint' }, `Slot ${ui.selectedSlot + 1} selected. Click a chord to put it there.`)
    : h('p', { class: 'hint' }, 'Click a slot in the chord lane first, or drag chords onto it.');
  card.replaceChildren(
    h('h3', {}, hid !== p.scale ? `Chords (from ${SCALES[hid].name.split(' (')[0]})` : 'Chords in this key'),
    typeRow, grid,
    h('div', { class: 'legend' },
      ...Object.values(FUNCTION_INFO).map(f => h('span', { title: f.help }, h('i', { style: { background: f.color } }), f.label))),
    selInfo,
    h('div', { class: 'type-row' },
      h('button', { class: 'btn', onclick: autoHarmonize, title: 'Look at your melody notes and pick chords that contain them' }, '✨ Chords for my melody'),
      h('button', { class: 'btn', onclick: () => { store.project.chords.slots = []; commit('chords'); } }, 'Clear chords')));
}

function placeChord(deg, type) {
  const p = store.project;
  previewChord(deg, type);
  if (ui.selectedSlot == null) return;
  p.chords.slots[ui.selectedSlot] = { deg, type };
  const n = slotCount(p);
  ui.selectedSlot = ui.selectedSlot + 1 < n ? ui.selectedSlot + 1 : null;
  commit('chords');
}

function renderSuggestions(p) {
  const card = document.getElementById('suggest-card');
  const slots = p.chords.slots;
  const n = slotCount(p);
  // Which slot are we filling, and what came before it?
  let target = ui.selectedSlot;
  if (target == null) { target = 0; while (target < n && slots[target]) target++; }
  if (target >= n) target = null;
  const k = target != null ? keyAt(p, target * p.chords.slotSteps) : selectedKey();
  const steps = scaleSteps(harmonyScaleId(k.scale));
  let prev = null;
  if (target != null) { for (let i = target - 1; i >= 0; i--) if (slots[i]) { prev = slots[i].deg; break; } }
  else { for (let i = n - 1; i >= 0; i--) if (slots[i]) { prev = slots[i].deg; break; } }
  const list = suggestNext(prev);
  const title = prev == null ? 'Where to start?' : `After ${romanNumeral(steps, prev)}, try…`;
  card.replaceChildren(
    h('h3', {}, 'What comes next?'),
    h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, title),
    h('div', { class: 'sugg' }, ...list.map(({ deg, why }) => {
      const fn = chordFunction(deg, steps);
      const el = h('div', { class: 'sugg-item', title: target != null ? `Click to place in slot ${target + 1}` : 'Click to hear' },
        h('span', { class: 'rn' }, romanNumeral(steps, deg)),
        h('div', {}, h('div', { style: { fontSize: '12px' } }, chordName(k.root, k.scale, deg)), h('div', { class: 'why' }, why)));
      el.style.setProperty('--fn', FUNCTION_INFO[fn].color);
      el.addEventListener('click', () => {
        previewChord(deg, 'triad', 0.9, target != null ? target * p.chords.slotSteps : null);
        if (target != null) {
          slots[target] = { deg, type: ui.chordType };
          ui.selectedSlot = null;
          commit('chords');
        }
      });
      return el;
    })),
    h('p', { class: 'hint' }, target != null ? `Fills slot ${target + 1}.` : 'All slots are full. Click a slot to replace it.'));
}

function renderProgressions(p) {
  const card = document.getElementById('prog-card');
  const hid = harmonyScaleId(p.scale);
  const steps = scaleSteps(hid);
  const fam = SCALES[p.scale].family;
  card.replaceChildren(
    h('h3', {}, 'Famous progressions'),
    h('div', { class: 'prog-list' }, ...PROGRESSIONS.map(pr => {
      const romans = pr.degs.map(d => romanNumeral(steps, d)).join(' – ');
      const hasDim = pr.degs.some(d => chordQuality(chordSemis(steps, d)).quality === 'dim');
      const el = h('div', { class: 'prog-item' + (pr.family === fam && !hasDim ? ' fits' : ''), title: 'Click to use these chords' },
        h('div', { class: 'pn' }, h('span', {}, pr.name)),
        h('div', { class: 'pr' }, romans),
        h('div', { class: 'ph' }, pr.help));
      el.addEventListener('click', () => useProgression(pr));
      return el;
    })),
    h('p', { class: 'hint' }, 'Numbers are the same in every key. Swap scales to hear how a progression changes.'));
}

function useProgression(pr) {
  const p = store.project;
  const c = p.chords;
  const needSteps = pr.degs.length * c.slotSteps;
  if (needSteps > loopSteps()) {
    const bars = Math.min(MAX_BARS, Math.ceil(needSteps / STEPS_PER_BAR));
    if (bars !== p.bars) { p.bars = bars; toast(`Loop extended to ${bars} bars to fit ${pr.name}.`); }
  }
  const n = slotCount(p);
  c.slots = [];
  for (let i = 0; i < n; i++) c.slots.push({ deg: pr.degs[i % pr.degs.length], type: ui.chordType });
  ui.selectedSlot = null;
  previewChord(pr.degs[0], ui.chordType);
  commit('all');
}

function autoHarmonize() {
  const p = store.project;
  const c = p.chords;
  const n = slotCount(p);
  const bySlot = Array.from({ length: n }, () => []);
  for (const t of p.tracks) {
    if (t.mute) continue;
    for (const note of t.notes) {
      if (note.step >= loopSteps()) continue;
      const slot = Math.floor(note.step / c.slotSteps);
      const onBeat = note.step % 4 === 0 ? 1.5 : 1;
      const slotStart = note.step % c.slotSteps === 0 ? 1.5 : 1;
      bySlot[slot].push({ pc: mod(noteMidi(p, t, note), 12), weight: Math.min(note.len, 8) * onBeat * slotStart });
    }
  }
  if (!bySlot.some(s => s.length)) { toast('Write some melody notes first, then I can pick chords for them.'); return; }
  const ranked = harmonize(i => keyAt(p, i * c.slotSteps), bySlot);
  c.slots = ranked.map((r, i) => (bySlot[i].length ? { deg: r[0].deg, type: ui.chordType } : (c.slots[i] || null)));
  commit('chords');
  toast('Picked chords that contain your melody notes. Ctrl+Z to undo.');
}

export { mod };
