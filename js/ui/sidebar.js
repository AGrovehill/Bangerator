// Sidebar: circle of fifths, scale info, chord palette, "what comes next" and progressions.

import { store, commit, changeKey, loopSteps, STEPS_PER_BAR, MAX_BARS, sections, keyAt, snapToScale } from '../state.js';
import { SCALES, scaleSteps, harmonyScaleId, spellScale, intervalLabel, stepPattern, keySignature, keyName,
  romanNumeral, chordName, chordFunction, CHORD_TYPES, FUNCTION_INFO, PROGRESSIONS, suggestNext, harmonize, chordSemis, chordQuality, mod } from '../theory.js';
import { renderCircle } from './circle.js';
import { ui, h, previewChord, previewDeg, previewTrackMidi, toast, selectedKey } from './common.js';
import { slotCount, selectTrack } from './compose.js';
import { noteMidi, stepDuration, syncMixer } from '../sequencer.js';
import { audio, playNote, ensureSampleSet } from '../audio.js';
import { spellMidi } from '../theory.js';
import { BASS_STYLES, bassLine, bassTrack, toTrackNotes, makeBassTrack, nextNotes, semisToNote, coach } from '../advisor.js';

// Click a card's title to fold it away; remembered per browser.
const FOLD_KEY = 'bangerator.sidebarFolded';
let folded = {};
try { folded = JSON.parse(localStorage.getItem(FOLD_KEY)) || {}; } catch { /* none */ }
const sidebarEl = document.getElementById('sidebar');
for (const card of sidebarEl.querySelectorAll('.card')) if (folded[card.id]) card.classList.add('collapsed');
sidebarEl.addEventListener('click', e => {
  const title = e.target.closest('.card > h3');
  const card = title?.parentElement;
  if (!card?.id) return;
  folded[card.id] = card.classList.toggle('collapsed');
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch { /* private mode */ }
});

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
  renderAdvice();
}

// The cards that depend on the notes themselves (cheap, so they refresh on every edit).
export function renderAdvice() {
  const p = store.project;
  renderCoach(p);
  renderNextNote(p);
  renderBass(p);
}

// ---------- Coach ----------
const KIND_ICON = { fix: '!', tip: '→', good: '✓' };

function renderCoach(p) {
  const card = document.getElementById('coach-card');
  let findings = [];
  try { findings = coach(p); } catch (e) { console.warn('Coach failed', e); }
  card.replaceChildren(
    h('h3', {}, 'Coach'),
    findings.length ? h('div', { class: 'coach-list' }, ...findings.map(f => h('div', { class: 'coach-item ' + f.kind },
      h('span', { class: 'coach-icon' }, KIND_ICON[f.kind]),
      h('div', { class: 'coach-body' },
        h('div', { class: 'coach-title' }, f.title),
        h('div', { class: 'coach-why' }, f.why),
        f.fixLabel ? h('button', { class: 'btn', onclick: () => {
          if (f.action === 'harmonize') return autoHarmonize();
          if (f.action === 'snap') { snapToScale(); toast('Every note moved to its nearest scale note.'); return; }
          f.fix(store.project);
          commit('all');
          toast('Done. Ctrl+Z to undo.');
        } }, f.fixLabel) : null))))
      : h('p', { class: 'hint' }, 'Write some notes or chords and I’ll point out what could be better, and why.'),
    h('p', { class: 'hint' }, 'Looks at this pattern: melody against chords, the bass, the mix. These are habits that usually work, not rules.'));
}

// ---------- What note next? ----------
function renderNextNote(p) {
  const card = document.getElementById('note-card');
  const t = p.tracks.find(x => x.id === ui.selectedTrackId) || p.tracks[0];
  if (!t) { card.replaceChildren(h('h3', {}, 'Next note?'), h('p', { class: 'hint' }, 'Add a melody track first.')); return; }
  const { step, len, ideas } = nextNotes(p, t);
  if (step == null) {
    card.replaceChildren(h('h3', {}, 'Next note?'), h('p', { class: 'hint' }, `“${t.name}” is written to the end of the pattern. Make the pattern longer (Bars) to continue.`));
    return;
  }
  const k = keyAt(p, step);
  const n = SCALES[k.scale].steps.length;
  const where = `bar ${Math.floor(step / STEPS_PER_BAR) + 1}, beat ${Math.floor((step % STEPS_PER_BAR) / 4) + 1}${step % 4 ? ' +' : ''}`;
  card.replaceChildren(
    h('h3', {}, 'Next note?'),
    h('div', { style: { fontWeight: 700, marginBottom: '6px' } }, `For “${t.name}” at ${where}`),
    h('div', { class: 'sugg' }, ...ideas.map(idea => {
      const asDeg = semisToNote(p, { mode: 'scale' }, idea.semis, step);
      const midi = 12 * (t.octave + 1) + k.root + idea.semis;
      const label = (asDeg.alt ? (asDeg.alt > 0 ? '♯' : '♭') : '') + (mod(asDeg.deg, n) + 1);
      const el = h('div', { class: 'sugg-item', title: 'Click to hear it. + adds it to the track.' },
        h('span', { class: 'rn' }, label, p.showNoteNames ? h('small', {}, ' ' + spellMidi(midi, k.root, k.scale)) : null),
        h('div', { style: { flex: 1 } }, h('div', { class: 'why' }, idea.why)),
        h('button', { class: 'btn small', title: 'Add this note', onclick: e => {
          e.stopPropagation();
          t.notes.push({ step, len: Math.min(len, loopSteps() - step), vel: 0.85, ...semisToNote(p, t, idea.semis, step) });
          previewTrackMidi(t, midi);
          commit('notes');
        } }, '+'));
      el.style.setProperty('--fn', idea.isChordTone ? 'rgb(72,220,190)' : 'var(--line-strong)');
      el.addEventListener('click', () => previewTrackMidi(t, midi));
      return el;
    })),
    h('p', { class: 'hint' }, 'Teal = a note of the chord playing there (the teal rows in the roll). Click a track to get ideas for it.'));
}

// ---------- Bassline ideas ----------
let previewStops = [];

function previewLine(p, track, line) {
  previewStops.forEach(s => s?.());
  previewStops = [];
  if (!audio.ctx) return;
  const patch = p.patches[track.patch];
  if (!patch) return;
  if (patch.kind === 'sampler') ensureSampleSet(patch.set);
  syncMixer();
  const strip = audio.mixer.strip(track.id);
  if (track.id === 'preview') strip.gain.gain.value = 0.9;
  const sd = stepDuration(p.bpm);
  const t0 = audio.ctx.currentTime + 0.05;
  const limit = Math.min(loopSteps(), 2 * Math.max(STEPS_PER_BAR, p.chords.slotSteps)); // the first two chords or so
  for (const n of line) {
    if (n.step >= limit) continue;
    const midi = 12 * (track.octave + 1) + keyAt(p, n.step).root + n.semis;
    previewStops.push(playNote(audio.ctx, strip.gain, patch, midi, t0 + n.step * sd, n.len * sd * 0.95, n.vel));
  }
}

function renderBass(p) {
  const card = document.getElementById('bass-card');
  const target = ui.bassTarget === '' ? null : (p.tracks.find(t => t.id === ui.bassTarget) || bassTrack(p));
  const voice = target || { id: 'preview', patch: 'sawbass', octave: 2 };
  const hasChords = p.chords.slots.slice(0, slotCount(p)).some(Boolean);
  const sel = h('select', { title: 'Which track gets the bassline', onchange: e => { ui.bassTarget = e.target.value; renderBass(store.project); } },
    ...p.tracks.map(t => h('option', { value: t.id, selected: t === target }, t.name)),
    h('option', { value: '', selected: !target }, '(new Bass track)'));
  card.replaceChildren(
    h('h3', {}, 'Bassline ideas'),
    h('div', { class: 'type-row', style: { alignItems: 'center' } }, h('span', { class: 'hint', style: { margin: 0 } }, 'Write to'), sel),
    h('div', { class: 'prog-list' }, ...BASS_STYLES.map(st => {
      const el = h('div', { class: 'prog-item', title: 'Click to hear the start of it' },
        h('div', { class: 'pn' }, h('span', {}, st.name),
          h('button', { class: 'btn small', title: 'Write this bassline into the track (replaces its notes in this pattern)', onclick: e => { e.stopPropagation(); useBass(st); } }, 'Use')),
        h('div', { class: 'ph' }, st.help));
      el.addEventListener('click', () => previewLine(store.project, voice, bassLine(store.project, st.id)));
      return el;
    })),
    h('p', { class: 'hint' }, hasChords ? 'Built from your chord lane, so they always fit. Change a chord and “Use” again.' : 'No chords yet, so these stay on the home note. Add chords first for basslines that follow them.'));
}

function useBass(st) {
  const p = store.project;
  let t = ui.bassTarget === '' ? null : (p.tracks.find(x => x.id === ui.bassTarget) || bassTrack(p));
  if (!t) { t = makeBassTrack(p); p.tracks.push(t); }
  ui.bassTarget = t.id;
  const L = loopSteps();
  const had = t.notes.some(n => n.step < L);
  t.notes = toTrackNotes(p, t, bassLine(p, st.id));
  selectTrack(t.id);
  commit('all');
  toast(`${st.name} bass written to “${t.name}”${had ? ' (replaced what was there; Ctrl+Z brings it back)' : ''}.`);
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
