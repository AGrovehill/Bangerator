// Automation lane editor, shared by the pattern (Compose) and the song (Arrange).
// Click to add a point, drag to move it, right-click to delete, Shift+drag to draw freely.

import { store, commit, touch, uid } from '../state.js';
import { PARAMS, targetGroups, targetLabel, staticNorm, valueAt } from '../automation.js';
import { h, toast } from './common.js';

export const LANE_H = 56;

// scope: 'pattern' (the open pattern's lanes) or 'song'
export const lanesOf = scope => (scope === 'song' ? store.project.song.auto : store.project.patAuto);

export function addLane(scope, target) {
  const lanes = lanesOf(scope);
  if (lanes.some(l => l.target === target)) {
    toast(`${targetLabel(store.project, target)} already has a lane in the ${scope}.`);
    return null;
  }
  const lane = { id: uid('a'), target, points: [] };
  lanes.push(lane);
  commit(scope === 'song' ? 'song' : 'all');
  return lane;
}

export function targetSelect(value, onChange, placeholder) {
  const p = store.project;
  const sel = h('select', { class: 'auto-target', onchange: e => e.target.value && onChange(e.target.value) },
    placeholder ? h('option', { value: '' }, placeholder) : null,
    ...targetGroups(p).map(g => h('optgroup', { label: g.name },
      ...g.targets.map(t => h('option', { value: t.id, selected: t.id === value }, `${g.name.replace('Drum: ', '')} · ${t.label}`)))));
  return sel;
}

// A lane's canvas. opts: { steps(), px() (pixels per step), snap() (steps), color, onCommit() }
export class AutoLane {
  constructor(lane, opts) {
    this.lane = lane;
    this.opts = opts;
    this.canvas = h('canvas', { class: 'auto-cv' });
    this.drag = null;
    this.bind();
  }

  get w() { return this.opts.steps() * this.opts.px(); }

  render() {
    const w = Math.max(1, this.w), hgt = LANE_H;
    const dpr = Math.min(window.devicePixelRatio || 1, 32000 / w);
    const c = this.canvas;
    c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr);
    c.style.width = w + 'px'; c.style.height = hgt + 'px';
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1a1c24';
    g.fillRect(0, 0, w, hgt);
    const px = this.opts.px(), steps = this.opts.steps();
    const every = px * 4 < 12 ? 16 : 4; // beat lines only when there's room
    for (let s = 0; s <= steps; s += every) {
      g.fillStyle = s % 16 === 0 ? '#3a3f52' : '#262a36';
      g.fillRect(Math.round(s * px), 0, 1, hgt);
    }
    const p = store.project;
    const y = v => 4 + (1 - v) * (hgt - 8);
    // the mixer's own value, used outside automation and when stopped
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(0, y(staticNorm(p, this.lane.target)) + 0.5); g.lineTo(w, y(staticNorm(p, this.lane.target)) + 0.5); g.stroke();
    g.setLineDash([]);
    const pts = this.lane.points;
    if (!pts.length) {
      g.fillStyle = '#6b7189';
      g.font = '11px system-ui';
      g.fillText('Click to add points · Shift+drag to draw', 8, hgt / 2 + 4);
      return;
    }
    const color = this.opts.color || '#ffd43b';
    g.beginPath();
    g.moveTo(0, y(pts[0].value));
    for (const pt of pts) g.lineTo(pt.step * px, y(pt.value));
    g.lineTo(w, y(pts[pts.length - 1].value));
    g.lineTo(w, hgt); g.lineTo(0, hgt); g.closePath();
    g.globalAlpha = 0.18; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    g.beginPath();
    g.moveTo(0, y(pts[0].value));
    for (const pt of pts) g.lineTo(pt.step * px, y(pt.value));
    g.lineTo(w, y(pts[pts.length - 1].value));
    g.strokeStyle = color; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
    g.fillStyle = '#fff';
    for (const pt of pts) { g.beginPath(); g.arc(pt.step * px, y(pt.value), 3.5, 0, Math.PI * 2); g.fill(); }
    if (this.drag?.pt) {
      const [, key] = this.lane.target.split('|');
      const P = PARAMS[key];
      const pt = this.drag.pt;
      g.fillStyle = '#e9ecf5'; g.font = '600 11px system-ui';
      const label = P ? P.fmt(P.to(pt.value)) : '';
      const lx = Math.min(w - 70, pt.step * px + 8);
      g.fillText(label, Math.max(2, lx), Math.max(12, y(pt.value) - 6));
    }
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    const px = this.opts.px(), snap = this.opts.snap();
    const x = e.clientX - r.left, yy = e.clientY - r.top;
    const step = Math.max(0, Math.min(this.opts.steps(), Math.round(x / px / snap) * snap));
    const value = Math.max(0, Math.min(1, 1 - (yy - 4) / (LANE_H - 8)));
    return { x, y: yy, step, value };
  }

  hit(x, y) {
    const px = this.opts.px();
    return this.lane.points.find(pt => Math.abs(pt.step * px - x) < 7 && Math.abs(4 + (1 - pt.value) * (LANE_H - 8) - y) < 7);
  }

  setPoint(step, value) {
    const pts = this.lane.points;
    let pt = pts.find(q => q.step === step);
    if (pt) pt.value = value;
    else { pt = { step, value }; pts.push(pt); pts.sort((a, b) => a.step - b.step); }
    return pt;
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      const { x, y, step, value } = this.pos(e);
      const hit = this.hit(x, y);
      if (e.button === 2) {
        if (hit) { this.lane.points.splice(this.lane.points.indexOf(hit), 1); this.render(); this.opts.onCommit(); }
        return;
      }
      c.setPointerCapture(e.pointerId);
      if (e.shiftKey) { this.drag = { draw: true }; this.setPoint(step, value); }
      else this.drag = { pt: hit || this.setPoint(step, value) };
      this.render();
      touch('auto-live');
    });
    c.addEventListener('pointermove', e => {
      const { x, y, step, value } = this.pos(e);
      if (!this.drag) { c.style.cursor = this.hit(x, y) ? 'grab' : 'crosshair'; return; }
      if (this.drag.draw) this.setPoint(step, value);
      else {
        const pt = this.drag.pt;
        const other = this.lane.points.find(q => q !== pt && q.step === step);
        if (!other) pt.step = step;
        pt.value = value;
        this.lane.points.sort((a, b) => a.step - b.step);
      }
      this.render();
      touch('auto-live');
    });
    const end = () => {
      if (!this.drag) return;
      this.drag = null;
      this.render();
      this.opts.onCommit();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }
}

// Record a controller move into a lane (used when Record is on and a knob turns).
export function writeAutomation(scope, target, step, value) {
  let lane = lanesOf(scope).find(l => l.target === target);
  if (!lane) { lane = { id: uid('a'), target, points: [] }; lanesOf(scope).push(lane); }
  const pts = lane.points;
  const at = pts.findIndex(q => q.step === step);
  if (at >= 0) pts[at].value = value;
  else { pts.push({ step, value }); pts.sort((a, b) => a.step - b.step); }
  return lane;
}

export { valueAt };
