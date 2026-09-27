// Shared UI state and helpers (auditioning notes/chords, toasts, modals).

import { audio, playNote, ensureSampleSet, initAudio } from '../audio.js';
import { store, sections, keyAt, STEPS_PER_BAR } from '../state.js';
import { scaleSteps, degToSemis, harmonyScaleId, chordSemis } from '../theory.js';
import { syncMixer } from '../sequencer.js';

export const ui = {
  selectedTrackId: null,
  selectedSlot: null,
  chordType: 'triad',
  cellW: 26,
  rowH: 17,
  soundPatchId: 'keys',
  selectedSection: 0, // which key section the top bar and sidebar are editing
};

// The key section being edited (top bar, sidebar, circle of fifths).
export function selectedKey() {
  const secs = sections(store.project);
  if (ui.selectedSection >= secs.length) ui.selectedSection = 0;
  return secs[ui.selectedSection];
}

// Key used when auditioning: the one at `step` if given, else the edited section's.
function previewKey(step) {
  return step != null ? keyAt(store.project, step) : selectedKey();
}

export function patchOf(id) { return store.project.patches[id]; }

export function previewDeg(track, deg, alt = 0, dur = 0.35, step = null) {
  const k = previewKey(step);
  return previewTrackMidi(track, 12 * (track.octave + 1) + k.root + degToSemis(scaleSteps(k.scale), deg) + alt, dur);
}

export function previewTrackMidi(track, midi, dur = 0.35) {
  if (!audio.ctx) return;
  const patch = patchOf(track.patch);
  if (!patch) return;
  if (patch.kind === 'sampler') ensureSampleSet(patch.set);
  syncMixer();
  return playNote(audio.ctx, audio.mixer.strip(track.id).gain, patch, midi, audio.ctx.currentTime + 0.005, dur, 0.8);
}

export function previewChord(deg, type = 'triad', dur = 0.9, step = null) {
  if (!audio.ctx) return;
  const p = store.project;
  const c = p.chords;
  const patch = patchOf(c.patch);
  if (!patch) return;
  if (patch.kind === 'sampler') ensureSampleSet(patch.set);
  syncMixer();
  const k = previewKey(step);
  const base = 12 * (c.octave + 1) + k.root;
  const t = audio.ctx.currentTime + 0.005;
  chordSemis(scaleSteps(harmonyScaleId(k.scale)), deg, type).forEach((s, i) =>
    playNote(audio.ctx, audio.mixer.strip('chords').gain, patch, base + s, t + i * 0.012, dur, 0.65));
}

export function previewMidi(patchId, midi, dur = 0.5, stripId = 'preview') {
  if (!audio.ctx) return;
  const patch = patchOf(patchId);
  if (!patch) return;
  if (patch.kind === 'sampler') ensureSampleSet(patch.set);
  const s = audio.mixer.strip(stripId);
  s.gain.gain.value = 0.9;
  s.filter.frequency.value = 20000;
  return playNote(audio.ctx, s.gain, patch, midi, audio.ctx.currentTime + 0.005, dur, 0.8);
}

let toastTimer;
export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function modal(html, onMount) {
  const m = document.getElementById('modal');
  const box = document.getElementById('modal-box');
  box.innerHTML = html;
  m.hidden = false;
  const close = () => { m.hidden = true; box.innerHTML = ''; };
  m.onclick = e => { if (e.target === m) close(); };
  box.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  onMount?.(box, close);
  return close;
}

export function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) e.style.setProperty(prop, val); // custom properties need setProperty
        else e.style[prop] = val;
      }
    }
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export { STEPS_PER_BAR };
export async function ensureAudio() { return initAudio(); }
