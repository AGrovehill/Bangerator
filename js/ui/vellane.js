// Velocity lane under a track's roll: one bar per note, as tall as the note is loud.
// Drag a bar up or down, or drag across to paint several. Works the same for short and long notes.
// Notes at full velocity count as accents (drawn with a cap here, and a bright stripe in the roll).

import { h } from './common.js';

export const VEL_H = 46;
export const ACCENT = 1;
export const NORMAL = 0.75;
export const isAccent = n => (n.vel ?? 0.85) >= 0.95;

export class VelLane {
  // opts: { steps(), px(), getSelection(), onChange() (live), onCommit() }
  constructor(track, opts) {
    this.track = track;
    this.opts = opts;
    this.canvas = h('canvas', { class: 'vel-cv' });
    this.bind();
  }

  notesIn() { const L = this.opts.steps(); return this.track.notes.filter(n => n.step < L); }

  render() {
    const w = Math.max(1, this.opts.steps() * this.opts.px()), hh = VEL_H;
    const dpr = Math.min(window.devicePixelRatio || 1, 32000 / w);
    const c = this.canvas;
    c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
    c.style.width = w + 'px'; c.style.height = hh + 'px';
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#16171d';
    g.fillRect(0, 0, w, hh);
    const px = this.opts.px(), steps = this.opts.steps();
    for (let s = 0; s <= steps; s += 4) { g.fillStyle = s % 16 ? '#22252f' : '#383d50'; g.fillRect(Math.round(s * px), 0, 1, hh); }
    // guide lines at the normal and accent levels
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, Math.round(hh - NORMAL * (hh - 4)) - 2, w, 1);
    const sel = this.opts.getSelection?.() || new Set();
    for (const n of this.notesIn()) {
      const v = n.vel ?? 0.85;
      const x = n.step * px + 1;
      const bw = Math.max(3, Math.min(px - 2, n.len * px - 2));
      const top = hh - v * (hh - 4);
      g.fillStyle = this.track.color;
      g.globalAlpha = 0.45 + 0.55 * v;
      g.fillRect(x, top, bw, hh - top);
      g.globalAlpha = 1;
      if (isAccent(n)) { g.fillStyle = '#fff'; g.fillRect(x, top, bw, 2); }
      if (sel.has(n)) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x + 0.5, top + 0.5, bw - 1, hh - top - 1); }
    }
  }

  valueAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const y = e.clientY - r.top;
    return Math.round(Math.max(0.05, Math.min(1, (VEL_H - y) / (VEL_H - 4))) * 100) / 100;
  }

  stepAt(e) {
    const r = this.canvas.getBoundingClientRect();
    return (e.clientX - r.left) / this.opts.px();
  }

  // Notes whose bar is under step position `f` (a short note's bar is at least a step wide).
  notesAt(f) {
    return this.notesIn().filter(n => f >= n.step && f < n.step + Math.max(1, Math.min(n.len, 1)));
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const sel = this.opts.getSelection?.() || new Set();
      let last = this.stepAt(e);
      const apply = (from, to, v) => {
        const lo = Math.min(from, to), hi = Math.max(from, to);
        let hit = this.notesIn().filter(n => n.step + 1 > lo && n.step <= hi);
        if (!hit.length) hit = this.notesAt(to);
        // dragging a selected note sets the whole selection
        if (hit.some(n => sel.has(n))) hit = [...new Set([...hit, ...sel])];
        if (e.button === 2) v = isAccent(hit[0] || {}) ? NORMAL : ACCENT; // right-click toggles accent
        for (const n of hit) n.vel = v;
        if (hit.length) { this.render(); this.opts.onChange?.(); }
      };
      apply(last, last, this.valueAt(e));
      const move = ev => { const f = this.stepAt(ev); apply(last, f, this.valueAt(ev)); last = f; };
      const up = () => {
        c.removeEventListener('pointermove', move);
        c.removeEventListener('pointerup', up);
        this.opts.onCommit();
      };
      if (e.button !== 2) c.addEventListener('pointermove', move);
      c.addEventListener('pointerup', up);
    });
    c.addEventListener('pointermove', () => { c.style.cursor = 'ns-resize'; });
  }
}

// One-click tools for a track's notes in the open pattern.
export function accentBeats(notes) { for (const n of notes) n.vel = n.step % 4 === 0 ? ACCENT : n.step % 2 === 0 ? 0.8 : 0.68; }
export function evenOut(notes) { for (const n of notes) n.vel = 0.85; }
export function humanize(notes) { for (const n of notes) n.vel = Math.round(Math.max(0.3, Math.min(1, (n.vel ?? 0.85) + (Math.random() - 0.5) * 0.16)) * 100) / 100; }
