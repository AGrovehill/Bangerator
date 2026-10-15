// Undo history: a list of recent changes next to the undo button. Clicking one jumps back (or forward)
// to it in one go. The stack only stores whole-project snapshots, so each change is described by
// comparing two neighbouring snapshots.

import { store, undo, redo } from '../state.js';
import { h } from './common.js';

const SHOW = 40; // changes listed in each direction

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Drum steps compared by their actual hits (missing rows, empty rows and trailing zeros are the same thing)
const hits = ds => Object.entries(ds || {}).map(([k, v]) => [k, (v || []).map((x, i) => (x ? `${i}:${x}` : '')).filter(Boolean).join(',')]).filter(([, v]) => v).sort().join(';');
const slotsOf = sl => JSON.stringify((sl || []).map(x => x || null)).replace(/(,null)+\]$/, ']');
const nameOf = (p, id) => p.tracks.find(t => t.id === id)?.name || (id === 'chords' ? 'Chords' : id === 'drums' ? 'Drums' : 'a track');

// A short description of what changed between two project states.
export function describe(a, b) {
  const out = [];
  const add = s => { if (!out.includes(s)) out.push(s); };
  if (a.name !== b.name) add('Renamed the project');
  if (a.bpm !== b.bpm) add(`Tempo ${a.bpm} → ${b.bpm}`);
  if (a.swing !== b.swing) add('Swing');

  // patterns: added, removed, renamed, and what changed inside them
  const pa = new Map(a.patterns.map(x => [x.id, x]));
  const pb = new Map(b.patterns.map(x => [x.id, x]));
  for (const [id, x] of pb) if (!pa.has(id)) add(`New pattern “${x.name}”`);
  for (const [id, x] of pa) if (!pb.has(id)) add(`Deleted pattern “${x.name}”`);
  for (const [id, y] of pb) {
    const x = pa.get(id);
    if (!x) continue;
    if (x.name !== y.name) add(`Renamed pattern “${x.name}” → “${y.name}”`);
    const ids = new Set([...Object.keys(x.notes || {}), ...Object.keys(y.notes || {})]);
    const tracks = [...ids].filter(t => !same(x.notes?.[t] || [], y.notes?.[t] || []));
    if (tracks.length) {
      const before = tracks.reduce((s, t) => s + (x.notes?.[t]?.length || 0), 0);
      const after = tracks.reduce((s, t) => s + (y.notes?.[t]?.length || 0), 0);
      const verb = after > before ? `+${after - before} notes` : after < before ? `−${before - after} notes` : 'edited notes';
      add(`${verb} in ${tracks.map(t => nameOf(b, t)).join(', ')} (${y.name})`);
    }
    if (hits(x.drumSteps) !== hits(y.drumSteps)) add(`Drums in ${y.name}`);
    if (slotsOf(x.chordSlots) !== slotsOf(y.chordSlots) || x.slotSteps !== y.slotSteps || x.chordsGuide !== y.chordsGuide) add(`Chords in ${y.name}`);
    if (x.bars !== y.bars) add(`${y.name}: ${x.bars} → ${y.bars} bars`);
    if (x.root !== y.root || x.scale !== y.scale || !same(x.keyChanges, y.keyChanges)) add(`Key / scale of ${y.name}`);
    if (!same(x.auto, y.auto)) add(`Automation in ${y.name}`);
  }

  // instruments and the mixer
  const ta = new Map(a.tracks.map(t => [t.id, t]));
  for (const t of b.tracks) {
    const x = ta.get(t.id);
    if (!x) { add(`New track “${t.name}”`); continue; }
    const strip = o => ({ volume: o.volume, pan: o.pan, mute: o.mute, solo: o.solo, fx: o.fx });
    if (!same(strip(x), strip(t))) add(`Mix: ${t.name}`);
    if (x.patch !== t.patch) add(`${t.name}: instrument`);
    if (x.octave !== t.octave || x.mode !== t.mode || x.range !== t.range || x.name !== t.name) add(`${t.name}: track settings`);
  }
  for (const t of a.tracks) if (!b.tracks.some(y => y.id === t.id)) add(`Deleted track “${t.name}”`);
  const chordStrip = c => ({ ...c, slots: undefined, slotSteps: undefined });
  if (!same(chordStrip(a.chords), chordStrip(b.chords))) add('Chord channel (sound or mix)');
  if (!same({ ...a.drums, rows: a.drums.rows.map(r => ({ ...r, steps: undefined })) }, { ...b.drums, rows: b.drums.rows.map(r => ({ ...r, steps: undefined })) })) add('Mix: drums');
  if (!same(a.fxBus, b.fxBus)) add('Mix: effects & master');
  if (!same(a.patches, b.patches)) add('Sound design');
  if (!same(a.drumParams, b.drumParams)) add('Drum sounds');

  // the song
  if (!same(a.song.clips, b.song.clips)) {
    const d = b.song.clips.length - a.song.clips.length;
    add(d > 0 ? `Arrangement: +${d} clip${d > 1 ? 's' : ''}` : d < 0 ? `Arrangement: −${-d} clip${d < -1 ? 's' : ''}` : 'Arrangement: moved / changed clips');
  }
  if (!same(a.song.lanes, b.song.lanes)) add('Playlist lanes');
  if (!same(a.song.markers, b.song.markers)) add('Section tags');
  if (!same(a.song.loop, b.song.loop)) add('Loop region');
  if (!same(a.song.auto, b.song.auto)) add('Song automation');
  if (!out.length) add('Small change');
  return out.length > 2 ? `${out.slice(0, 2).join(' · ')} +${out.length - 2} more` : out.join(' · ');
}

const ago = t => {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function initHistory() {
  const btn = document.getElementById('btn-history');
  const menu = document.getElementById('menu-history');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (menu.classList.toggle('open')) renderHistory(menu);
  });
  document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.classList.remove('open'); });
}

function renderHistory(menu) {
  const U = store.undoStack, R = store.redoStack;
  const parse = s => JSON.parse(s);
  const items = [];
  // redo side (undone changes), farthest first so the list reads top = newest
  const redoN = Math.min(SHOW, R.length);
  if (redoN) {
    const states = [store.lastSnapshot, ...R.slice(-redoN).reverse()].map(parse); // now, then 1, 2... steps forward
    for (let j = redoN; j >= 1; j--) {
      items.push(h('button', { class: 'hist-item redo', title: `Redo ${j} step${j > 1 ? 's' : ''}`, onclick: () => { menu.classList.remove('open'); redo(j); } },
        h('span', { class: 'hist-label' }, describe(states[j - 1], states[j])),
        h('span', { class: 'hist-time' }, `undone · ${ago(store.redoTimes[R.length - j])}`)));
    }
  }
  items.push(h('div', { class: 'hist-now' }, '● Now'));
  const undoN = Math.min(SHOW, U.length);
  if (undoN) {
    const states = [store.lastSnapshot, ...U.slice(-undoN).reverse()].map(parse); // now, then 1, 2... steps back
    for (let i = 1; i <= undoN; i++) {
      items.push(h('button', { class: 'hist-item', title: `Undo ${i} step${i > 1 ? 's' : ''}: back to before this change`, onclick: () => { menu.classList.remove('open'); undo(i); } },
        h('span', { class: 'hist-label' }, describe(states[i], states[i - 1])),
        h('span', { class: 'hist-time' }, `${i > 1 ? `${i} steps · ` : ''}${ago(store.undoTimes[U.length - i])}`)));
    }
  } else {
    items.push(h('p', { class: 'hint', style: { padding: '4px 10px' } }, 'Nothing to undo yet.'));
  }
  if (U.length > SHOW) items.push(h('p', { class: 'hint', style: { padding: '4px 10px' } }, `${U.length - SHOW} older steps not shown.`));
  menu.replaceChildren(h('div', { class: 'hist-head' }, 'History: click a change to go back to before it'), ...items);
}
