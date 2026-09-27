// The note editor for a melody track. Two modes:
//  - Scale roll: every row is a scale degree (1, 2, 3...). Notes follow the key/scale of the section they're in.
//  - Piano roll: every row is one of the 12 notes, like a normal DAW. Notes keep their exact pitch;
//    the current scale is only highlighted, and notes outside it get a red dashed outline.
// In both modes, rows that belong to the chord playing at that moment are tinted.

import { scaleSteps, degToSemis, intervalLabel, spellMidi, chordPitchClasses, chordFunction, harmonyScaleId, mod } from '../theory.js';
import { STEPS_PER_BAR, sections, sectionRange, keyAt, inScale } from '../state.js';

const FN_RGB = { home: '81,207,102', away: '77,171,247', tension: '255,146,43' };
const BLACK = [1, 3, 6, 8, 10];
export const KEYS_W = 84;
const MAX_CANVAS = 32000; // browsers refuse canvases wider than ~32k pixels

export class ScaleRoll {
  constructor(track, opts) {
    this.track = track;
    // opts: { project(), cellW(), rowH, loopSteps(), labelSection(), onPreviewDeg(track, deg, alt, step),
    //         onPreviewMidi(track, midi), onCommit(), onSelect(track) }
    this.opts = opts;
    this.keys = document.createElement('canvas');
    this.keys.className = 'keys';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'roll';
    this.lastLen = 2;
    this.drag = null;
    this.bind();
  }

  get p() { return this.opts.project(); }
  get piano() { return this.track.mode === 'piano'; }
  get secs() { return sections(this.p); }
  get rows() {
    if (this.piano) return 12 * this.track.range + 1;
    return Math.max(...this.secs.map(s => scaleSteps(s.scale).length)) * this.track.range + 1;
  }
  get lowMidi() { return 12 * (this.track.octave + 1); }

  // row <-> value (a degree in scale mode, a MIDI note in piano mode)
  rowValue(r) { return this.piano ? this.lowMidi + this.rows - 1 - r : this.rows - 1 - r; }
  valueRow(v) { return this.piano ? this.lowMidi + this.rows - 1 - v : this.rows - 1 - v; }
  noteValue(n) { return this.piano ? n.midi : n.deg; }
  setNoteValue(n, v) { if (this.piano) n.midi = v; else n.deg = v; }

  size() {
    const w = this.opts.loopSteps() * this.opts.cellW();
    const h = this.rows * this.opts.rowH;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS / Math.max(1, w));
    for (const [c, cw, d] of [[this.canvas, w, dpr], [this.keys, KEYS_W, window.devicePixelRatio || 1]]) {
      if (c.width !== Math.round(cw * d) || c.height !== Math.round(h * d)) {
        c.width = Math.round(cw * d); c.height = Math.round(h * d);
      }
      c.style.width = cw + 'px'; c.style.height = h + 'px';
    }
    return { w, h, dpr };
  }

  render() {
    const { w, h, dpr } = this.size();
    this.drawKeys(h);
    const g = this.canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = this.p, cw = this.opts.cellW(), rh = this.opts.rowH, L = this.opts.loopSteps();
    g.fillStyle = '#1a1c24';
    g.fillRect(0, 0, w, h);

    // background per key section
    this.secs.forEach((sec, i) => {
      const [s0, s1] = sectionRange(p, i);
      const x0 = s0 * cw, x1 = Math.min(s1, L) * cw;
      if (x1 <= x0) return;
      const steps = scaleSteps(sec.scale);
      for (let r = 0; r < this.rows; r++) {
        const v = this.rowValue(r);
        let fill = null;
        if (this.piano) {
          const rel = mod(v - sec.root, 12);
          if (BLACK.includes(mod(v, 12))) fill = 'rgba(0,0,0,0.25)';
          if (rel === 0) fill = 'rgba(255,212,59,0.10)';
          else if (steps.includes(rel)) fill = 'rgba(255,255,255,0.045)';
        } else {
          if (v > steps.length * this.track.range) fill = 'rgba(0,0,0,0.45)'; // beyond this scale's range
          else if (mod(v, steps.length) === 0) fill = 'rgba(255,212,59,0.07)';
        }
        if (fill) { g.fillStyle = fill; g.fillRect(x0, r * rh, x1 - x0, rh); }
      }
    });

    // chord-tone tint per chord slot
    const c = p.chords;
    for (let s = 0; s * c.slotSteps < L; s++) {
      const slot = c.slots[s];
      if (!slot) continue;
      const k = keyAt(p, s * c.slotSteps);
      const pcs = chordPitchClasses(k.root, k.scale, slot.deg, slot.type);
      const rgb = FN_RGB[chordFunction(slot.deg, scaleSteps(harmonyScaleId(k.scale)))];
      const x0 = s * c.slotSteps * cw, x1 = Math.min(L, (s + 1) * c.slotSteps) * cw;
      for (let r = 0; r < this.rows; r++) {
        const pc = this.rowPitchClass(r, k);
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
    const n0 = scaleSteps(this.secs[0].scale).length;
    for (let r = 0; r <= this.rows; r++) {
      const y = Math.round(r * rh) + 0.5;
      const v = this.rowValue(r - 1);
      const strong = r > 0 && (this.piano ? mod(v, 12) === 0 : mod(v, n0) === 0);
      g.strokeStyle = strong ? '#4a5066' : '#262a36';
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }

    // section boundaries, with the degree numbers of that section at its left edge
    g.font = '700 9px system-ui, sans-serif';
    g.textBaseline = 'middle';
    this.secs.forEach((sec, i) => {
      if (i === 0) return;
      const x = sec.bar * STEPS_PER_BAR * cw;
      if (x >= w) return;
      g.fillStyle = '#b197fc';
      g.fillRect(x - 1, 0, 2, h);
      if (!this.piano) {
        const n = scaleSteps(sec.scale).length;
        g.fillStyle = 'rgba(177,151,252,0.8)';
        for (let r = 0; r < this.rows; r++) {
          const v = this.rowValue(r);
          if (v <= n * this.track.range) g.fillText(String(mod(v, n) + 1), x + 3, r * rh + rh / 2 + 1);
        }
      }
    });

    // notes
    g.font = '600 11px system-ui, sans-serif';
    for (const note of this.track.notes) {
      if (note.step >= L) continue;
      let r = this.valueRow(this.noteValue(note));
      let clipped = 0;
      if (r < 0) { clipped = -1; r = 0; } else if (r >= this.rows) { clipped = 1; r = this.rows - 1; }
      const x = note.step * cw + 1, y = r * rh + 1;
      const nw = Math.min(note.len, L - note.step) * cw - 2, nh = rh - 2;
      g.fillStyle = this.track.color;
      g.globalAlpha = clipped ? 0.4 : 0.35 + 0.65 * (note.vel ?? 0.85);
      roundRect(g, x, y, nw, nh, 4); g.fill();
      g.globalAlpha = 1;
      const out = this.piano ? !inScale(p, note.midi, note.step) : !!note.alt;
      if (out) { // not in the scale: flag it
        g.save(); g.strokeStyle = '#ff6b6b'; g.lineWidth = 2; g.setLineDash([4, 3]);
        roundRect(g, x + 1, y + 1, nw - 2, nh - 2, 4); g.stroke(); g.restore();
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + nw - 4, y + 2, 2, nh - 4); // resize grip
      g.fillStyle = '#111';
      const k = keyAt(p, note.step);
      let label;
      if (this.piano) {
        label = spellMidi(note.midi, k.root, k.scale);
      } else {
        const n = scaleSteps(k.scale).length;
        label = String(mod(note.deg, n) + 1);
        if (note.alt) label = (note.alt > 0 ? '♯' : '♭') + label;
        if (p.showNoteNames) label += ' ' + spellMidi(this.midiOf(note), k.root, k.scale);
      }
      if (clipped) label = (clipped < 0 ? '▲' : '▼') + label;
      if (nw > 12) {
        g.save(); g.beginPath(); g.rect(x, y, nw - 5, nh); g.clip();
        g.fillText(label, x + 4, y + nh / 2 + 1);
        g.restore();
      }
    }
  }

  rowPitchClass(r, k) {
    const v = this.rowValue(r);
    return this.piano ? mod(v, 12) : mod(k.root + degToSemis(scaleSteps(k.scale), v), 12);
  }

  midiOf(note) {
    if (this.piano) return note.midi;
    const k = keyAt(this.p, note.step);
    return 12 * (this.track.octave + 1) + k.root + degToSemis(scaleSteps(k.scale), note.deg) + (note.alt || 0);
  }

  // Row labels. Scale mode shows the degrees of the section being edited; piano mode draws a keyboard.
  drawKeys(h) {
    const dpr = window.devicePixelRatio || 1;
    const g = this.keys.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rh = this.opts.rowH, p = this.p;
    const sec = this.secs[Math.min(this.opts.labelSection(), this.secs.length - 1)];
    const steps = scaleSteps(sec.scale);
    const n = steps.length;
    g.fillStyle = '#20232d';
    g.fillRect(0, 0, KEYS_W, h);
    g.textBaseline = 'middle';
    for (let r = 0; r < this.rows; r++) {
      const v = this.rowValue(r);
      const y = r * rh;
      if (this.piano) {
        const black = BLACK.includes(mod(v, 12));
        const rel = mod(v - sec.root, 12);
        g.fillStyle = black ? '#15161c' : '#d8dce8';
        g.fillRect(0, y, black ? KEYS_W * 0.62 : KEYS_W, rh);
        if (steps.includes(rel)) { // scale highlight, like a DAW's scale overlay
          g.fillStyle = rel === 0 ? '#ffd43b' : '#b197fc';
          g.fillRect(KEYS_W - 6, y + 1, 5, rh - 2);
        }
        g.strokeStyle = '#2a2e3a';
        g.beginPath(); g.moveTo(0, y + rh + 0.5); g.lineTo(KEYS_W, y + rh + 0.5); g.stroke();
        g.font = `${mod(v, 12) === 0 ? 800 : 500} ${Math.min(10, rh - 5)}px system-ui, sans-serif`;
        g.fillStyle = black ? '#9aa1b8' : '#222';
        g.fillText(spellMidi(v, sec.root, sec.scale), 6, y + rh / 2 + 1);
        if (steps.includes(rel)) {
          g.fillStyle = black ? '#ffd43b' : '#6b4fd6';
          g.font = `800 ${Math.min(10, rh - 5)}px system-ui, sans-serif`;
          g.fillText(String(steps.indexOf(rel) + 1), 52, y + rh / 2 + 1);
        }
        continue;
      }
      const beyond = v > n * this.track.range;
      const d = mod(v, n);
      if (!beyond && d === 0) { g.fillStyle = '#3b3520'; g.fillRect(0, y, KEYS_W, rh); }
      g.strokeStyle = d === 0 ? '#4a5066' : '#2a2e3a';
      g.beginPath(); g.moveTo(0, y + rh + 0.5); g.lineTo(KEYS_W, y + rh + 0.5); g.stroke();
      if (beyond) continue;
      g.fillStyle = d === 0 ? '#ffd43b' : '#e9ecf5';
      g.font = `800 ${Math.min(13, rh - 4)}px system-ui, sans-serif`;
      g.fillText(String(d + 1), 8, y + rh / 2 + 1);
      g.fillStyle = '#8b91a8';
      g.font = `500 ${Math.min(10, rh - 6)}px system-ui, sans-serif`;
      g.fillText(intervalLabel(steps, v), 26, y + rh / 2 + 1);
      if (p.showNoteNames) {
        g.fillStyle = '#ffd43b';
        g.fillText(spellMidi(12 * (this.track.octave + 1) + sec.root + degToSemis(steps, v), sec.root, sec.scale), 50, y + rh / 2 + 1);
      }
    }
  }

  cellAt(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const cw = this.opts.cellW();
    return { x, y, step: Math.floor(x / cw), fx: x / cw, row: Math.floor(y / this.opts.rowH) };
  }

  hit(fx, row) {
    const notes = this.track.notes;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const nr = Math.max(0, Math.min(this.rows - 1, this.valueRow(this.noteValue(n))));
      if (nr === row && fx >= n.step && fx < n.step + n.len) {
        const edge = (n.step + n.len - fx) * this.opts.cellW() < 7;
        return { note: n, edge };
      }
    }
    return null;
  }

  preview(note) {
    if (this.piano) this.opts.onPreviewMidi(this.track, note.midi);
    else this.opts.onPreviewDeg(this.track, note.deg, note.alt || 0, note.step);
  }

  bind() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      const { step, fx, row } = this.cellAt(e);
      const L = this.opts.loopSteps();
      if (step < 0 || step >= L || row < 0 || row >= this.rows) return;
      this.opts.onSelect?.(this.track);
      const h = this.hit(fx, row);
      if (e.button === 2) { // right click deletes
        if (h) { this.track.notes.splice(this.track.notes.indexOf(h.note), 1); this.opts.onCommit(); }
        return;
      }
      cv.setPointerCapture(e.pointerId);
      if (h) {
        this.drag = { mode: h.edge ? 'resize' : 'move', note: h.note, startStep: step, startRow: row,
          orig: { step: h.note.step, value: this.noteValue(h.note), len: h.note.len }, moved: false, shift: e.shiftKey };
        if (!h.edge) this.preview(h.note);
      } else {
        const note = { step, len: Math.min(this.lastLen, L - step), vel: 0.85 };
        this.setNoteValue(note, this.rowValue(row));
        this.track.notes.push(note);
        this.drag = { mode: 'resize', note, startStep: step, startRow: row, orig: { ...note }, moved: true, created: true };
        this.preview(note);
        this.render();
      }
    });
    cv.addEventListener('pointermove', e => {
      const { step, fx, row } = this.cellAt(e);
      if (!this.drag) {
        const h = step >= 0 && row >= 0 && row < this.rows ? this.hit(fx, row) : null;
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
        const origRow = Math.max(0, Math.min(this.rows - 1, this.valueRow(d.orig.value)));
        const nval = this.rowValue(Math.max(0, Math.min(this.rows - 1, origRow + dr)));
        const changed = nval !== this.noteValue(d.note);
        if (nstep !== d.note.step || changed) {
          d.note.step = nstep; this.setNoteValue(d.note, nval); d.moved = true;
          if (changed) this.preview(d.note);
          this.render();
        }
      }
    });
    const end = () => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (!d.moved && d.mode !== 'resize') {
        if (d.shift && !this.piano) { // cycle natural -> sharp -> flat
          d.note.alt = d.note.alt === 1 ? -1 : d.note.alt === -1 ? 0 : 1;
          this.preview(d.note);
        } else {
          this.track.notes.splice(this.track.notes.indexOf(d.note), 1);
        }
      } else if (d.mode === 'resize' && !d.moved && !d.created) {
        // clicked the edge without dragging: treat as delete too
        this.track.notes.splice(this.track.notes.indexOf(d.note), 1);
      }
      if (d.note.len && d.mode === 'resize') this.lastLen = d.note.len;
      if (d.moved || d.shift) delete d.note.src;
      this.opts.onCommit();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    this.keys.addEventListener('pointerdown', e => {
      const rect = this.keys.getBoundingClientRect();
      const row = Math.floor((e.clientY - rect.top) / this.opts.rowH);
      if (row >= 0 && row < this.rows) {
        const v = this.rowValue(row);
        if (this.piano) this.opts.onPreviewMidi(this.track, v);
        else this.opts.onPreviewDeg(this.track, v, 0, null);
      }
      this.opts.onSelect?.(this.track);
    });
  }
}

function roundRect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
