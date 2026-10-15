// Arrange view: the song playlist. Patterns on the left; lanes of clips on the right.
// Click empty space to place the open pattern, drag clips to move them, drag a clip's right edge
// to make it longer (the pattern repeats), Ctrl/Alt-drag to copy, right-click to delete.
// Each clip can play its pattern in another key or scale.

import { store, commit, touch, STEPS_PER_BAR, patternView, openPattern, newPattern, clonePattern, deletePattern,
  newClip, newLane, songBars, patternById, uid } from '../state.js';
import { ROOT_NAMES, SCALES, SCALE_ORDER, keyName, mod } from '../theory.js';
import { buildEvents, transport, stepDuration } from '../sequencer.js';
import { ui, h, toast } from './common.js';
import { AutoLane, addLane, targetSelect } from './autolane.js';
import { channelColor } from './compose.js';

const LANE_H = 46;
const HEAD_W = 150;
let onOpenInEditor = () => {};
let onPlayFrom = () => {};
let drag = null;
let playheadEl = null;

export function initArrange(opts) {
  onOpenInEditor = opts.openInEditor;
  onPlayFrom = opts.playFrom;
}

const panel = () => document.getElementById('tab-arrange');
const barW = () => ui.barW;

function viewBars(p) {
  return Math.max(64, Math.ceil((songBars(p) + 16) / 8) * 8);
}

export function renderArrange() {
  const p = store.project;
  if (ui.selectedClip && !p.song.clips.some(c => c.id === ui.selectedClip)) ui.selectedClip = null;
  const scrollEl = panel().querySelector('.arr-scroll');
  const scroll = scrollEl ? [scrollEl.scrollLeft, scrollEl.scrollTop] : [0, 0];
  previewEvents.clear();
  panel().replaceChildren(toolbar(p), h('div', { class: 'arr-wrap' }, patternList(p), playlist(p)), inspector(p));
  const s = panel().querySelector('.arr-scroll');
  s.scrollLeft = scroll[0];
  s.scrollTop = scroll[1];
}

// ---------- Toolbar ----------
function toolbar(p) {
  const bars = songBars(p);
  const secs = bars * STEPS_PER_BAR * stepDuration(p.bpm);
  const len = `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
  return h('div', { class: 'compose-toolbar arr-toolbar' },
    h('span', { class: 'arr-songlen' }, bars ? `Song: ${bars} bars · ${len}` : 'Song is empty'),
    p.song.loop ? h('button', { class: 'btn small', title: 'Play the whole song instead of the loop region',
      onclick: () => { p.song.loop = null; commit('song'); } }, `Loop ${p.song.loop.start + 1}–${p.song.loop.end} ✕`) : null,
    h('label', { class: 'field' }, 'Zoom', h('input', { type: 'range', min: 10, max: 64, value: ui.barW,
      oninput: e => { ui.barW = Number(e.target.value); renderArrange(); } })),
    h('button', { class: 'btn', onclick: () => { p.song.lanes.push(newLane(p.song.lanes.length)); commit('song'); } }, '+ Lane'),
    h('span', { class: 'hint' }, 'Click to place the selected pattern · drag to move · drag the right edge to repeat · Ctrl-drag copies · right-click deletes · double-click edits · drag the ruler to set a loop · click a section tag to play it, Shift+click to loop it'));
}

// ---------- Pattern list ----------
function keyLabel(root, scale) { return `${keyName(mod(root, 12), scale)} ${SCALES[scale].short || SCALES[scale].name.split(' (')[0]}`; }

function patternList(p) {
  const items = p.patterns.map(pat => {
    const v = patternView(p, pat.id);
    const uses = p.song.clips.filter(c => c.pat === pat.id).length;
    const el = h('div', { class: 'arr-pat' + (pat.id === p.currentPattern ? ' active' : ''), draggable: true,
      style: { '--pc': pat.color }, title: 'Click to select (and edit). Drag onto the playlist. Double-click to open in Compose.' },
      h('span', { class: 'arr-pat-sw' }),
      h('div', { class: 'arr-pat-main' },
        h('div', { class: 'arr-pat-name' }, pat.name),
        h('div', { class: 'arr-pat-sub' }, `${v.bars} bar${v.bars > 1 ? 's' : ''} · ${keyLabel(v.root, v.scale)}${uses ? ` · ×${uses}` : ''}`)),
      h('div', { class: 'arr-pat-btns' },
        h('button', { class: 'btn small', title: 'Rename', onclick: e => { e.stopPropagation(); renamePattern(pat); } }, '✎'),
        h('button', { class: 'btn small', title: 'Clone', onclick: e => { e.stopPropagation(); clonePattern(pat.id); } }, '⧉'),
        h('button', { class: 'btn small', title: 'Delete', onclick: e => { e.stopPropagation(); removePattern(pat); } }, '✕')));
    el.addEventListener('click', () => openPattern(pat.id));
    el.addEventListener('dblclick', () => { openPattern(pat.id); onOpenInEditor(); });
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/bangerator-pattern', pat.id); e.dataTransfer.effectAllowed = 'copy'; });
    return el;
  });
  return h('div', { class: 'arr-pats' },
    h('h3', {}, 'Patterns'),
    ...items,
    h('button', { class: 'btn', onclick: () => newPattern() }, '+ New pattern'));
}

export function renamePattern(pat) {
  const name = prompt('Pattern name:', pat.name);
  if (!name) return;
  pat.name = name.slice(0, 60);
  commit('song');
}

export function removePattern(pat) {
  const p = store.project;
  if (p.patterns.length < 2) { toast('A project needs at least one pattern.'); return; }
  const uses = p.song.clips.filter(c => c.pat === pat.id).length;
  if (!confirm(`Delete pattern “${pat.name}”${uses ? ` and its ${uses} clip${uses > 1 ? 's' : ''} in the song` : ''}?`)) return;
  deletePattern(pat.id);
}

// ---------- Playlist ----------
function playlist(p) {
  const nBars = viewBars(p);
  const W = nBars * barW();
  const inner = h('div', { class: 'arr-inner', style: { width: HEAD_W + W + 'px' } });
  inner.append(ruler(p, nBars, W));
  inner.append(markerRow(p, W));
  p.song.lanes.forEach((lane, i) => inner.append(laneRow(p, lane, i, nBars, W)));
  inner.append(h('div', { class: 'arr-row arr-auto-title' },
    h('div', { class: 'arr-head' }, h('b', {}, 'Automation')),
    h('div', { class: 'arr-body hint' }, 'Song-wide automation. It overrides the same setting’s pattern automation. Click to add points, Shift+drag to draw.')));
  for (const lane of p.song.auto) inner.append(songAutoRow(p, lane, nBars, W));
  inner.append(h('div', { class: 'arr-row' },
    h('div', { class: 'arr-head' }, targetSelect('', v => addLane('song', v), '+ Automate…')),
    h('div', { class: 'arr-body' })));
  playheadEl = h('div', { class: 'arr-playhead' });
  inner.append(playheadEl);
  return h('div', { class: 'arr-scroll' }, inner);
}

function ruler(p, nBars, W) {
  const bw = barW();
  const c = h('canvas', { class: 'arr-ruler-cv' });
  const dpr = Math.min(window.devicePixelRatio || 1, 32000 / W);
  c.width = W * dpr; c.height = 26 * dpr;
  c.style.width = W + 'px'; c.style.height = '26px';
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#1c1e26'; g.fillRect(0, 0, W, 26);
  const l = p.song.loop;
  if (l) { g.fillStyle = 'rgba(255,212,59,0.22)'; g.fillRect(l.start * bw, 0, (l.end - l.start) * bw, 26); g.fillStyle = '#ffd43b'; g.fillRect(l.start * bw, 22, (l.end - l.start) * bw, 4); }
  const end = songBars(p);
  g.font = '600 11px system-ui'; g.textBaseline = 'middle';
  const every = bw < 16 ? 4 : bw < 24 ? 2 : 1;
  for (let b = 0; b <= nBars; b++) {
    const x = b * bw;
    g.fillStyle = b % 4 === 0 ? '#5a6078' : '#343849';
    g.fillRect(x, b % 4 === 0 ? 0 : 14, 1, 26);
    if (b % every === 0 && b < nBars) { g.fillStyle = b < end ? '#e9ecf5' : '#6b7189'; g.fillText(String(b + 1), x + 3, 10); }
  }
  if (end) { g.fillStyle = '#ff6b6b'; g.fillRect(end * bw - 1, 0, 2, 26); }
  c.title = 'Click to play from here. Drag to set a loop region. Right-click clears the loop.';
  c.addEventListener('contextmenu', e => { e.preventDefault(); if (p.song.loop) { p.song.loop = null; commit('song'); } });
  c.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    c.setPointerCapture(e.pointerId);
    const bar0 = Math.floor(e.offsetX / bw);
    let moved = false;
    const move = ev => {
      const r = c.getBoundingClientRect();
      const bar1 = Math.max(0, Math.floor((ev.clientX - r.left) / bw));
      if (bar1 !== bar0) moved = true;
      if (!moved) return;
      p.song.loop = { start: Math.min(bar0, bar1), end: Math.max(bar0, bar1) + 1 };
      touch('song-live');
      redrawRuler(c, p, nBars, W);
    };
    const up = () => {
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      if (moved) commit('song');
      else onPlayFrom(bar0 * STEPS_PER_BAR);
    };
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
  });
  return h('div', { class: 'arr-row arr-ruler' }, h('div', { class: 'arr-head' }, 'Bar'), h('div', { class: 'arr-body' }, c));
}

// Section tags (Intro, Build, Drop...): they stay pinned under the ruler.
//   click: play from there · Shift+click: loop that section · drag: move where it starts
//   double-click: rename · right-click: menu · double-click empty space: new section
let markerRowEl = null;

function markerRow(p, W) {
  const bw = barW();
  const end = Math.max(1, songBars(p));
  const body = h('div', { class: 'arr-body arr-markers', style: { width: W + 'px' }, title: 'Double-click to add a section here' });
  const sorted = [...p.song.markers].sort((a, b) => a.bar - b.bar);
  const barAt = e => Math.max(0, Math.floor((e.clientX - body.getBoundingClientRect().left) / bw));
  sorted.forEach((m, i) => {
    const next = sorted[i + 1]?.bar ?? Math.max(m.bar + 4, end);
    const loop = p.song.loop;
    const looped = loop && loop.start === m.bar && loop.end === next;
    const el = h('div', { class: 'arr-marker' + (looped ? ' looped' : ''), 'data-bar': m.bar,
      style: { left: m.bar * bw + 'px', width: Math.max(24, (next - m.bar) * bw) + 'px', '--mc': MARKER_COLORS[i % MARKER_COLORS.length] },
      title: `${m.name}: bars ${m.bar + 1}–${next}\nClick: play from here · Shift+click: loop it · drag: move · double-click: rename · right-click: more` },
    h('span', {}, m.name));
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const x0 = e.clientX, bar0 = m.bar;
      const lo = i ? sorted[i - 1].bar + 1 : 0;
      const hi = sorted[i + 1] ? sorted[i + 1].bar - 1 : Infinity;
      let moved = false;
      const move = ev => {
        if (!moved && Math.abs(ev.clientX - x0) < 5) return;
        moved = true;
        const nb = Math.max(lo, Math.min(hi, bar0 + Math.round((ev.clientX - x0) / bw)));
        if (nb !== m.bar) { m.bar = nb; refreshMarkers(p, W); }
      };
      const up = ev => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) { if (m.bar !== bar0) commit('song'); return; }
        if (ev.shiftKey) loopSection(p, m.bar, next);
        else onPlayFrom(m.bar * STEPS_PER_BAR);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', e => { e.stopPropagation(); renameMarker(p, m, el); });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      const at = barAt(e);
      contextMenu(e, [
        ['Play from here', () => onPlayFrom(m.bar * STEPS_PER_BAR)],
        [looped ? 'Stop looping' : 'Loop this section', () => loopSection(p, m.bar, next)],
        ['Rename', () => renameMarker(p, m, el)],
        at > m.bar ? [`New section at bar ${at + 1}`, () => addMarker(p, W, at)] : null,
        ['Remove', () => { p.song.markers.splice(p.song.markers.indexOf(m), 1); commit('song'); }],
      ]);
    });
    body.append(el);
  });
  body.addEventListener('dblclick', e => { if (e.target === body) addMarker(p, W, barAt(e)); });
  body.addEventListener('contextmenu', e => {
    if (e.target !== body) return;
    e.preventDefault();
    const at = barAt(e);
    contextMenu(e, [[`New section at bar ${at + 1}`, () => addMarker(p, W, at)]]);
  });
  markerRowEl = h('div', { class: 'arr-row arr-marker-row' }, h('div', { class: 'arr-head' }, 'Sections'), body);
  return markerRowEl;
}

function refreshMarkers(p, W) {
  if (!markerRowEl?.isConnected) return;
  markerRowEl.replaceWith(markerRow(p, W));
}

function loopSection(p, start, end) {
  const l = p.song.loop;
  p.song.loop = l && l.start === start && l.end === end ? null : { start, end };
  commit('song');
  if (p.song.loop) toast(`Looping bars ${start + 1}–${end}. Shift+click the section again to stop.`);
}

function addMarker(p, W, bar) {
  let m = p.song.markers.find(x => x.bar === bar);
  if (!m) { m = { bar, name: 'Section' }; p.song.markers.push(m); }
  refreshMarkers(p, W);
  const el = markerRowEl.querySelector(`.arr-marker[data-bar="${bar}"]`);
  if (el) renameMarker(p, m, el, true);
}

// Rename in place. Enter or clicking away saves, Esc cancels, an empty name removes the section.
function renameMarker(p, m, el, isNew = false) {
  const input = h('input', { class: 'arr-marker-input', value: m.name, maxLength: 30 });
  el.replaceChildren(input);
  el.classList.add('editing');
  input.focus();
  input.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name) m.name = name;
    else if ((save && !name) || (!save && isNew)) p.song.markers.splice(p.song.markers.indexOf(m), 1);
    commit('song');
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('pointerdown', e => e.stopPropagation());
}

function contextMenu(e, items) {
  document.querySelector('.ctx-menu')?.remove();
  const menu = h('div', { class: 'ctx-menu', style: { left: e.clientX + 'px', top: e.clientY + 'px' } },
    ...items.filter(Boolean).map(([label, fn]) => h('button', { onclick: () => { menu.remove(); fn(); } }, label)));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  if (r.right > innerWidth) menu.style.left = innerWidth - r.width - 6 + 'px';
  if (r.bottom > innerHeight) menu.style.top = innerHeight - r.height - 6 + 'px';
  const close = ev => {
    if (ev.type === 'keydown' && ev.key !== 'Escape') return;
    if (ev.type === 'pointerdown' && menu.contains(ev.target)) return;
    menu.remove();
    window.removeEventListener('pointerdown', close, true);
    window.removeEventListener('keydown', close, true);
  };
  setTimeout(() => {
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
  });
}
const MARKER_COLORS = ['#4dabf7', '#ffa94d', '#ff6b6b', '#b197fc', '#69db7c', '#ffd43b', '#f783ac', '#63e6be'];

function redrawRuler(c, p, nBars, W) {
  const fresh = ruler(p, nBars, W).querySelector('canvas');
  c.getContext('2d').drawImage(fresh, 0, 0);
}

function laneRow(p, lane, i, nBars, W) {
  const body = h('div', { class: 'arr-body arr-lane-body', style: { width: W + 'px', height: LANE_H + 'px', '--bw': barW() + 'px' } });
  for (const c of p.song.clips) if (c.lane === i) body.append(clipEl(p, c));
  body.addEventListener('pointerdown', e => {
    if (e.target !== body || e.button !== 0) return;
    const bar = Math.floor(e.offsetX / barW());
    const pat = patternById(p, p.currentPattern);
    const v = patternView(p, pat.id);
    const c = newClip(pat.id, i, bar, v.bars);
    p.song.clips.push(c);
    ui.selectedClip = c.id;
    renderArrange();
    startDrag(e, c, 'move', true);
  });
  body.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('text/bangerator-pattern')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  });
  body.addEventListener('drop', e => {
    const id = e.dataTransfer.getData('text/bangerator-pattern');
    if (!id) return;
    e.preventDefault();
    const r = body.getBoundingClientRect();
    const c = newClip(id, i, Math.max(0, Math.floor((e.clientX - r.left) / barW())), patternView(p, id).bars);
    p.song.clips.push(c);
    ui.selectedClip = c.id;
    commit('song');
  });
  const head = h('div', { class: 'arr-head arr-lane-head' },
    h('input', { class: 'track-name', value: lane.name, onchange: e => { lane.name = e.target.value; commit('song'); } }),
    h('button', { class: 'btn mute' + (lane.mute ? ' on' : ''), title: 'Mute this lane', onclick: () => { lane.mute = !lane.mute; commit('song'); } }, 'M'),
    h('button', { class: 'btn', title: 'Delete this lane and its clips', onclick: () => removeLane(p, i) }, '✕'));
  return h('div', { class: 'arr-row' + (lane.mute ? ' muted' : '') }, head, body);
}

function songAutoRow(p, lane, nBars, W) {
  const ch = lane.target.split('|')[0];
  const al = new AutoLane(lane, { steps: () => nBars * STEPS_PER_BAR, px: () => barW() / STEPS_PER_BAR,
    snap: () => (barW() < 20 ? 4 : barW() < 40 ? 2 : 1), color: channelColor(p, ch), onCommit: () => commit('song') });
  al.render();
  const head = h('div', { class: 'arr-head arr-auto-head' },
    targetSelect(lane.target, v => {
      if (p.song.auto.some(l => l !== lane && l.target === v)) { toast('That setting already has a lane.'); renderArrange(); return; }
      lane.target = v;
      commit('song');
    }),
    h('button', { class: 'btn', title: 'Remove this lane', onclick: () => { p.song.auto.splice(p.song.auto.indexOf(lane), 1); commit('song'); } }, '✕'));
  return h('div', { class: 'arr-row' }, head, h('div', { class: 'arr-body', style: { width: W + 'px' } }, al.canvas));
}

function removeLane(p, i) {
  if (p.song.lanes.length < 2) return;
  const n = p.song.clips.filter(c => c.lane === i).length;
  if (n && !confirm(`Delete lane “${p.song.lanes[i].name}” and its ${n} clip${n > 1 ? 's' : ''}?`)) return;
  p.song.lanes.splice(i, 1);
  p.song.clips = p.song.clips.filter(c => c.lane !== i);
  for (const c of p.song.clips) if (c.lane > i) c.lane--;
  commit('song');
}

// ---------- Clips ----------
function clipEl(p, c) {
  const pat = patternById(p, c.pat);
  const v = patternView(p, c.pat, c.key);
  const bw = barW();
  const el = h('div', { class: 'arr-clip' + (ui.selectedClip === c.id ? ' selected' : ''),
    style: { left: c.bar * bw + 'px', width: c.len * bw + 'px', '--pc': pat.color }, 'data-clip': c.id });
  const cv = h('canvas', { class: 'arr-clip-cv' });
  el.append(cv, h('div', { class: 'arr-clip-label' }, pat.name, c.key ? h('span', { class: 'arr-clip-key' }, keyLabel(c.key.root, c.key.scale)) : null));
  drawClipPreview(cv, v, c.len * bw, LANE_H - 4, c.pat + (c.key ? `|${c.key.root}${c.key.scale}` : ''));
  el.addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (e.button === 2) return;
    ui.selectedClip = c.id;
    const r = el.getBoundingClientRect();
    const edge = r.right - e.clientX < 8;
    if (!edge && (e.ctrlKey || e.metaKey || e.altKey)) {
      const copy = { ...structuredClone(c), id: uid('c') };
      p.song.clips.push(copy);
      ui.selectedClip = copy.id;
      renderArrange();
      startDrag(e, copy, 'move', true);
      return;
    }
    panel().querySelectorAll('.arr-clip.selected').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    startDrag(e, c, edge ? 'resize' : 'move', false);
  });
  el.addEventListener('pointermove', e => {
    if (drag) return;
    const r = el.getBoundingClientRect();
    el.style.cursor = r.right - e.clientX < 8 ? 'ew-resize' : 'grab';
  });
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    p.song.clips = p.song.clips.filter(x => x !== c);
    commit('song');
  });
  el.addEventListener('dblclick', () => { openPattern(c.pat); onOpenInEditor(); });
  el.title = `${pat.name}${c.key ? ` in ${keyLabel(c.key.root, c.key.scale)}` : ''} · bars ${c.bar + 1}–${c.bar + c.len}`;
  return el;
}

// Tiny picture of the pattern's notes and drum hits, repeated across the clip.
const previewEvents = new Map(); // pattern (+ key) -> events, for one render pass
function drawClipPreview(cv, v, w, hgt, cacheKey) {
  const dpr = Math.min(window.devicePixelRatio || 1, 8000 / Math.max(1, w));
  cv.width = Math.max(1, w * dpr); cv.height = hgt * dpr;
  cv.style.width = w + 'px'; cv.style.height = hgt + 'px';
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  if (!previewEvents.has(cacheKey)) previewEvents.set(cacheKey, buildEvents(v));
  const evs = previewEvents.get(cacheKey);
  const notes = evs.filter(e => e.kind === 'note' && e.trackId !== 'chords');
  const drums = evs.filter(e => e.kind === 'drum');
  const L = v.bars * STEPS_PER_BAR;
  const sw = barW() / STEPS_PER_BAR;
  const lo = Math.min(...notes.map(n => n.midi), 127), hi = Math.max(...notes.map(n => n.midi), 0);
  const span = Math.max(12, hi - lo);
  const top = 14, noteH = hgt - top - 8;
  for (let off = 0; off * sw < w; off += L) {
    if (off) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(off * sw, 0, 1, hgt); }
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (const n of notes) {
      const x = (off + n.step) * sw;
      if (x > w) continue;
      const y = top + (1 - (n.midi - lo) / span) * (noteH - 2);
      g.fillRect(x, y, Math.max(1, n.dur * sw - 0.5), 2);
    }
    g.fillStyle = 'rgba(0,0,0,0.45)';
    for (const d of drums) {
      const x = (off + d.step) * sw;
      if (x <= w) g.fillRect(x, hgt - 5, Math.max(1, sw * 0.6), d.vel > 0.8 ? 4 : 3);
    }
  }
}

function startDrag(e, c, mode, created) {
  const bw = barW();
  const scroll = panel().querySelector('.arr-scroll');
  const lanesTop = () => panel().querySelector('.arr-lane-body').getBoundingClientRect().top;
  drag = { c, mode, created, x0: e.clientX, y0: e.clientY, bar0: c.bar, lane0: c.lane, len0: c.len, moved: created };
  const p = store.project;
  const el = () => panel().querySelector(`[data-clip="${c.id}"]`);
  const move = ev => {
    const db = Math.round((ev.clientX - drag.x0) / bw);
    if (mode === 'resize') {
      const len = Math.max(1, drag.len0 + db);
      if (len !== c.len) { c.len = len; drag.moved = true; el().style.width = len * bw + 'px'; }
      return;
    }
    const bar = Math.max(0, drag.bar0 + db);
    const lane = Math.max(0, Math.min(p.song.lanes.length - 1, Math.floor((ev.clientY - lanesTop()) / (LANE_H + 1))));
    if (bar !== c.bar || lane !== c.lane) {
      drag.moved = true;
      const laneChanged = lane !== c.lane;
      c.bar = bar; c.lane = lane;
      if (laneChanged) { renderArrange(); } else el().style.left = bar * bw + 'px';
    }
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const d = drag;
    drag = null;
    if (d.moved) commit('song');
    else renderArrange(); // selection only
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  scroll.style.cursor = mode === 'resize' ? 'ew-resize' : 'grabbing';
  window.addEventListener('pointerup', () => { scroll.style.cursor = ''; }, { once: true });
}

// ---------- Inspector for the selected clip ----------
function inspector(p) {
  const c = p.song.clips.find(x => x.id === ui.selectedClip);
  if (!c) return h('div', { class: 'arr-inspector empty' }, h('span', { class: 'hint' }, 'Select a clip to change its key, length or pattern.'));
  const own = patternView(p, c.pat);
  const key = c.key || { root: mod(own.root, 12), scale: own.scale };
  const setKey = (root, scale) => {
    c.key = root === mod(own.root, 12) && scale === own.scale ? null : { root, scale };
    commit('song');
  };
  return h('div', { class: 'arr-inspector' },
    h('b', {}, 'Clip'),
    h('label', { class: 'field' }, 'Pattern',
      h('select', { onchange: e => { c.pat = e.target.value; c.key = null; commit('song'); } },
        ...p.patterns.map(pt => h('option', { value: pt.id, selected: pt.id === c.pat }, pt.name)))),
    h('label', { class: 'field', title: 'Play this clip in another key. Scale tracks keep their numbers, so the melody follows.' }, 'Key',
      h('button', { class: 'btn small', title: 'Down a semitone', onclick: () => setKey(mod(key.root - 1, 12), key.scale) }, '−'),
      h('select', { onchange: e => setKey(Number(e.target.value), key.scale) },
        ...ROOT_NAMES.map((n, i) => h('option', { value: i, selected: i === key.root }, n))),
      h('button', { class: 'btn small', title: 'Up a semitone', onclick: () => setKey(mod(key.root + 1, 12), key.scale) }, '+'),
      h('select', { onchange: e => setKey(key.root, e.target.value) },
        ...SCALE_ORDER.map(id => h('option', { value: id, selected: id === key.scale }, SCALES[id].name)))),
    c.key ? h('button', { class: 'btn small', onclick: () => { c.key = null; commit('song'); } }, `Reset to ${keyLabel(own.root, own.scale)}`) : h('span', { class: 'hint' }, '(pattern’s own key)'),
    h('label', { class: 'field' }, 'Bars', h('input', { type: 'number', min: 1, max: 512, value: c.len,
      onchange: e => { c.len = Math.max(1, Math.min(512, Number(e.target.value) || 1)); commit('song'); } })),
    h('button', { class: 'btn', title: 'Give this clip its own copy of the pattern, so you can change it without changing the others',
      onclick: () => { const src = c.pat; const pat = clonePattern(src); if (pat) { c.pat = pat.id; commit('song'); toast(`This clip now uses “${pat.name}”.`); } } }, 'Make unique'),
    h('button', { class: 'btn', onclick: () => { openPattern(c.pat); onOpenInEditor(); } }, 'Edit pattern'),
    h('button', { class: 'btn', title: 'Delete (Del)', onclick: () => { p.song.clips = p.song.clips.filter(x => x !== c); commit('song'); } }, 'Delete'));
}

// Keyboard: Delete removes the selected clip, Ctrl+D copies it right after itself.
export function arrangeKey(e) {
  const p = store.project;
  const c = p.song.clips.find(x => x.id === ui.selectedClip);
  if (!c) return false;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    p.song.clips = p.song.clips.filter(x => x !== c);
    commit('song');
    return true;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    const copy = { ...structuredClone(c), id: uid('c'), bar: c.bar + c.len };
    p.song.clips.push(copy);
    ui.selectedClip = copy.id;
    commit('song');
    return true;
  }
  return false;
}

export function drawSongPlayhead(step) {
  if (!playheadEl || !playheadEl.isConnected) return;
  if (step < 0 || transport.mode !== 'song') { playheadEl.style.display = 'none'; return; }
  playheadEl.style.display = 'block';
  const headW = panel().querySelector('.arr-head')?.offsetWidth || HEAD_W;
  playheadEl.style.left = headW + (step / STEPS_PER_BAR) * barW() + 'px';
}
