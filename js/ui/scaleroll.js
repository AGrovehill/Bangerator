// The scale roll: like a piano roll, but every row is a scale degree (1, 2, 3...) instead of a key.
// Rows that belong to the chord playing at that moment get tinted, so it's easy to see which
// numbers will sound "right" over the harmony.

import { scaleSteps, harmonyScaleId, degToSemis, intervalLabel, midiName, chordPitchClasses, chordFunction, prefersFlats, mod } from '../theory.js';
import { STEPS_PER_BAR } from '../state.js';

const FN_RGB = { home: '81,207,102', away: '77,171,247', tension: '255,146,43' };
export const KEYS_W = 84;

export class ScaleRoll {
  constructor(track, opts) {
    this.track = track;
    this.opts = opts; // { project(), cellW(), rowH, loopSteps(), onPreview(track, deg, alt), onCommit(), onTouch() }
    this.keys = document.createElement('canvas');
    this.keys.className = 'keys';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'roll';
    this.lastLen = 2;
    this.drag = null;
    this.bind();
  }

  get p() { return this.opts.project(); }
  get steps() { return scaleSteps(this.p.scale); }
  get n() { return this.steps.length; }
  get rows() { return this.n * this.track.range + 1; }
  rowToDeg(r) { return this.rows - 1 - r; }
  degToRow(d) { return this.rows - 1 - d; }

  size() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.opts.loopSteps() * this.opts.cellW();
    const h = this.rows * this.opts.rowH;
    for (const [c, cw] of [[this.canvas, w], [this.keys, KEYS_W]]) {
      if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(cw * dpr); c.height = Math.round(h * dpr);
      }
      c.style.width = cw + 'px'; c.style.height = h + 'px';
    }
    return { w, h, dpr };
  }

  render() {
    const { w, h, dpr } = this.size();
    this.drawKeys(h, dpr);
    const g = this.canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = this.p, cw = this.opts.cellW(), rh = this.opts.rowH, L = this.opts.loopSteps();
    g.fillStyle = '#1a1c24';
    g.fillRect(0, 0, w, h);

    // row bands: tonic rows stand out
    for (let r = 0; r < this.rows; r++) {
      const deg = this.rowToDeg(r);
      if (mod(deg, this.n) === 0) { g.fillStyle = 'rgba(255,212,59,0.07)'; g.fillRect(0, r * rh, w, rh); }
    }
    // chord-tone tint per chord slot
    const c = p.chords;
    const hSteps = scaleSteps(harmonyScaleId(p.scale));
    for (let s = 0; s * c.slotSteps < L; s++) {
      const slot = c.slots[s];
      if (!slot) continue;
      const pcs = chordPitchClasses(p.root, p.scale, slot.deg, slot.type);
      const rgb = FN_RGB[chordFunction(slot.deg, hSteps)];
      const x0 = s * c.slotSteps * cw, x1 = Math.min(L, (s + 1) * c.slotSteps) * cw;
      for (let r = 0; r < this.rows; r++) {
        const pc = mod(p.root + degToSemis(this.steps, this.rowToDeg(r)), 12);
        if (!pcs.includes(pc)) continue;
        g.fillStyle = `rgba(${rgb},${pc === pcs[0] ? 0.2 : 0.11})`;
        g.fillRect(x0, r * rh, x1 - x0, rh);
      }
    }
    // grid lines
    g.lineWidth = 1;
    for (let s = 0; s <= L; s++) {
      const x = Math.round(s * cw) + 0.5;
      g.strokeStyle = s % STEPS_PER_BAR === 0 ? '#5a6078' : s % 4 === 0 ? '#383d50' : '#262a36';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    for (let r = 0; r <= this.rows; r++) {
      const y = Math.round(r * rh) + 0.5;
      const deg = this.rowToDeg(r - 1);
      g.strokeStyle = r > 0 && mod(deg, this.n) === 0 ? '#4a5066' : '#262a36';
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }

    // notes
    const flats = prefersFlats(p.root, p.scale);
    g.font = '600 11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const note of this.track.notes) {
      if (note.step >= L) continue;
      let r = this.degToRow(note.deg);
      let clipped = 0;
      if (r < 0) { clipped = -1; r = 0; } else if (r >= this.rows) { clipped = 1; r = this.rows - 1; }
      const x = note.step * cw + 1, y = r * rh + 1;
      const nw = Math.min(note.len, L - note.step) * cw - 2, nh = rh - 2;
      g.fillStyle = this.track.color;
      g.globalAlpha = clipped ? 0.4 : 0.35 + 0.65 * (note.vel ?? 0.85);
      roundRect(g, x, y, nw, nh, 4); g.fill();
      g.globalAlpha = 1;
      if (note.alt) { // not in the scale: sits between rows, so flag it
        g.save(); g.strokeStyle = '#ff6b6b'; g.lineWidth = 2; g.setLineDash([4, 3]);
        roundRect(g, x + 1, y + 1, nw - 2, nh - 2, 4); g.stroke(); g.restore();
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + nw - 4, y + 2, 2, nh - 4); // resize grip
      g.fillStyle = '#111';
      let label = String(mod(note.deg, this.n) + 1);
      if (note.alt) label = (note.alt > 0 ? '♯' : '♭') + label;
      if (clipped) label = (clipped < 0 ? '▲' : '▼') + label;
      if (p.showNoteNames) label += ' ' + midiName(this.midiOf(note), flats);
      if (nw > 12) {
        g.save(); g.beginPath(); g.rect(x, y, nw - 5, nh); g.clip();
        g.fillText(label, x + 4, y + nh / 2 + 1);
        g.restore();
      }
    }
  }

  midiOf(note) {
    return 12 * (this.track.octave + 1) + this.p.root + degToSemis(this.steps, note.deg) + (note.alt || 0);
  }

  drawKeys(h, dpr) {
    const g = this.keys.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rh = this.opts.rowH, p = this.p;
    const flats = prefersFlats(p.root, p.scale);
    g.fillStyle = '#20232d';
    g.fillRect(0, 0, KEYS_W, h);
    g.textBaseline = 'middle';
    for (let r = 0; r < this.rows; r++) {
      const deg = this.rowToDeg(r);
      const d = mod(deg, this.n);
      const y = r * rh;
      if (d === 0) { g.fillStyle = '#3b3520'; g.fillRect(0, y, KEYS_W, rh); }
      g.strokeStyle = d === 0 ? '#4a5066' : '#2a2e3a';
      g.beginPath(); g.moveTo(0, y + rh + 0.5); g.lineTo(KEYS_W, y + rh + 0.5); g.stroke();
      g.fillStyle = d === 0 ? '#ffd43b' : '#e9ecf5';
      g.font = `800 ${Math.min(13, rh - 4)}px system-ui, sans-serif`;
      g.fillText(String(d + 1), 8, y + rh / 2 + 1);
      g.fillStyle = '#8b91a8';
      g.font = `500 ${Math.min(10, rh - 6)}px system-ui, sans-serif`;
      g.fillText(intervalLabel(this.steps, deg), 26, y + rh / 2 + 1);
      if (p.showNoteNames) {
        g.fillStyle = '#ffd43b';
        g.fillText(midiName(this.midiOf({ deg }), flats), 50, y + rh / 2 + 1);
      }
    }
  }

  cellAt(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const cw = this.opts.cellW();
    return { x, y, step: Math.floor(x / cw), fx: x / cw, row: Math.floor(y / this.opts.rowH) };
  }

  hit(step, fx, row) {
    const deg = this.rowToDeg(row);
    const notes = this.track.notes;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const nr = Math.max(0, Math.min(this.rows - 1, this.degToRow(n.deg)));
      if (nr === this.degToRow(deg) && fx >= n.step && fx < n.step + n.len) {
        const edge = (n.step + n.len - fx) * this.opts.cellW() < 7 && n.len >= 1;
        return { note: n, edge };
      }
    }
    return null;
  }

  bind() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      const { step, fx, row } = this.cellAt(e);
      const L = this.opts.loopSteps();
      if (step < 0 || step >= L || row < 0 || row >= this.rows) return;
      this.opts.onSelect?.(this.track);
      const h = this.hit(step, fx, row);
      if (e.button === 2) { // right click deletes
        if (h) { this.track.notes.splice(this.track.notes.indexOf(h.note), 1); this.opts.onCommit(); }
        return;
      }
      cv.setPointerCapture(e.pointerId);
      if (h) {
        this.drag = { mode: h.edge ? 'resize' : 'move', note: h.note, startStep: step, startRow: row,
          orig: { step: h.note.step, deg: h.note.deg, len: h.note.len }, moved: false, shift: e.shiftKey };
        if (!h.edge) this.opts.onPreview(this.track, h.note.deg, h.note.alt || 0);
      } else {
        const note = { step, len: Math.min(this.lastLen, L - step), deg: this.rowToDeg(row), vel: 0.85 };
        this.track.notes.push(note);
        this.drag = { mode: 'resize', note, startStep: step, startRow: row, orig: { ...note }, moved: true, created: true };
        this.opts.onPreview(this.track, note.deg, 0);
        this.render();
      }
    });
    cv.addEventListener('pointermove', e => {
      const { step, fx, row } = this.cellAt(e);
      if (!this.drag) {
        const h = step >= 0 && row >= 0 && row < this.rows ? this.hit(step, fx, row) : null;
        cv.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : 'crosshair';
        return;
      }
      const d = this.drag, L = this.opts.loopSteps();
      if (d.mode === 'resize') {
        const len = Math.max(1, Math.min(L - d.note.step, Math.ceil(fx) - d.note.step));
        if (len !== d.note.len) { d.note.len = len; d.moved = true; this.render(); }
      } else {
        const ds = step - d.startStep, dr = row - d.startRow;
        if (!ds && !dr && !d.moved) return;
        const nstep = Math.max(0, Math.min(L - d.note.len, d.orig.step + ds));
        const origRow = Math.max(0, Math.min(this.rows - 1, this.degToRow(d.orig.deg)));
        const nrow = Math.max(0, Math.min(this.rows - 1, origRow + dr));
        const ndeg = this.rowToDeg(nrow);
        if (ndeg !== d.note.deg) this.opts.onPreview(this.track, ndeg, d.note.alt || 0);
        if (nstep !== d.note.step || ndeg !== d.note.deg) { d.note.step = nstep; d.note.deg = ndeg; d.moved = true; this.render(); }
      }
    });
    const end = () => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (!d.moved && d.mode !== 'resize') {
        if (d.shift) { // cycle natural -> sharp -> flat
          d.note.alt = d.note.alt === 1 ? -1 : d.note.alt === -1 ? 0 : 1;
          this.opts.onPreview(this.track, d.note.deg, d.note.alt);
        } else {
          this.track.notes.splice(this.track.notes.indexOf(d.note), 1);
        }
      } else if (d.mode === 'resize' && !d.moved && !d.created) {
        // clicked the edge without dragging: treat as delete too
        this.track.notes.splice(this.track.notes.indexOf(d.note), 1);
      }
      if (d.note.len && (d.mode === 'resize')) this.lastLen = d.note.len;
      if (d.moved || d.shift) delete d.note.src;
      this.opts.onCommit();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    this.keys.addEventListener('pointerdown', e => {
      const rect = this.keys.getBoundingClientRect();
      const row = Math.floor((e.clientY - rect.top) / this.opts.rowH);
      if (row >= 0 && row < this.rows) this.opts.onPreview(this.track, this.rowToDeg(row), 0);
      this.opts.onSelect?.(this.track);
    });
  }
}

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
