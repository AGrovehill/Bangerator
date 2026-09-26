// Bangerator entry point: wires the top bar, views, keyboard shortcuts and the playhead loop.

import { store, subscribe, commit, setProject, loadSaved, defaultProject, changeScale, setBars, undo, redo,
  exportProjectJSON, importProjectJSON, loadSampleData, MAX_BARS, loopSteps } from './state.js';
import { SCALES, SCALE_ORDER, ROOT_NAMES, keySignature, harmonyScaleId, degToSemis, scaleSteps } from './theory.js';
import { initAudio, audio, ensureSampleSet, decodeUserSample } from './audio.js';
import { play, stop, transport, invalidateEvents, syncMixer, currentVisualStep, buildEvents, renderWav } from './sequencer.js';
import { buildMidiFile, gmProgram, midiOut } from './midi.js';
import { renderCompose, redrawRolls, drawPlayhead, addTrack, selectTrack } from './ui/compose.js';
import { renderSidebar } from './ui/sidebar.js';
import { renderSoundDesign, playTest, rebuildDrumKit } from './ui/sounddesign.js';
import { ui, toast, modal, download, previewDeg, h } from './ui/common.js';

const $ = id => document.getElementById(id);
let activeTab = 'compose';

// ---------- Top bar ----------
function initTopbar() {
  for (let b = 1; b <= MAX_BARS; b++) $('in-bars').append(new Option(`${b}`, b));
  ROOT_NAMES.forEach((n, i) => $('in-root').append(new Option(n, i)));
  for (const id of SCALE_ORDER) $('in-scale').append(new Option(SCALES[id].name, id));

  $('btn-play').addEventListener('click', togglePlay);
  $('in-bpm').addEventListener('change', e => { store.project.bpm = clamp(Number(e.target.value) || 100, 40, 220); commit('tempo'); });
  $('in-bars').addEventListener('change', e => setBars(Number(e.target.value)));
  $('in-swing').addEventListener('input', e => { store.project.swing = Number(e.target.value); });
  $('in-swing').addEventListener('change', () => commit('tempo'));
  $('in-root').addEventListener('change', e => { store.project.root = Number(e.target.value); commit('all'); });
  $('in-scale').addEventListener('change', e => changeScale(e.target.value));
  $('btn-scale-prev').addEventListener('click', () => stepScale(-1));
  $('btn-scale-next').addEventListener('click', () => stepScale(1));
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  $('btn-add-track').addEventListener('click', addTrack);
  $('in-zoom').addEventListener('input', e => { ui.cellW = Number(e.target.value); renderCompose(); });
  $('in-notenames').addEventListener('change', e => { store.project.showNoteNames = e.target.checked; commit('all'); });

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

  const menu = $('menu-file');
  $('btn-file').addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
  document.addEventListener('click', () => menu.classList.remove('open'));
  menu.addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (act) { menu.classList.remove('open'); fileAction(act); }
  });
  $('file-open').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const p = await importProjectJSON(await f.text());
      await loadProject(p);
      toast(`Opened “${store.project.name}”`);
    } catch (err) {
      console.error(err);
      toast('That file does not look like a Bangerator project.');
    }
  });
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function stepScale(dir) {
  const p = store.project;
  const i = SCALE_ORDER.indexOf(p.scale);
  const next = SCALE_ORDER[(i + dir + SCALE_ORDER.length) % SCALE_ORDER.length];
  changeScale(next);
  toast(`${SCALES[next].name}: ${SCALES[next].mood}`);
}

function syncTopbar() {
  const p = store.project;
  $('in-bpm').value = p.bpm;
  $('in-bars').value = p.bars;
  $('in-swing').value = p.swing;
  $('in-root').value = p.root;
  $('in-scale').value = p.scale;
  $('in-notenames').checked = p.showNoteNames;
  $('btn-undo').disabled = !store.undoStack.length;
  $('btn-redo').disabled = !store.redoStack.length;
}

function showTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tabpanel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  $('sidebar').style.display = tab === 'learn' ? 'none' : '';
  if (tab === 'sound') renderSoundDesign();
}

async function togglePlay() {
  await initAudio();
  const b = $('btn-play');
  if (transport.playing) {
    stop();
    b.classList.remove('playing'); b.textContent = '▶';
  } else {
    play(0);
    b.classList.add('playing'); b.textContent = '■';
  }
}

// ---------- File actions ----------
async function fileAction(act) {
  const p = store.project;
  const safeName = (p.name || 'banger').replace(/[^\w\- ]+/g, '').trim() || 'banger';
  if (act === 'new') {
    if (!confirm('Start a new empty project? (Your current one is only kept if you saved it to a file.)')) return;
    const d = defaultProject();
    d.name = 'Untitled';
    d.tracks.forEach(t => { t.notes = []; });
    d.chords.slots = [];
    d.drums.rows.forEach(r => { r.steps = []; });
    await loadProject(d);
  } else if (act === 'demo') {
    if (!confirm('Load the demo? This replaces the current project (you can undo).')) return;
    store.project = defaultProject();
    ui.selectedSlot = null;
    ui.selectedTrackId = store.project.tracks[0].id;
    commit('all');
    await afterAudioReady();
  } else if (act === 'save') {
    const name = prompt('Project name:', p.name);
    if (name == null) return;
    p.name = name || p.name;
    commit('mix');
    download(new Blob([await exportProjectJSON()], { type: 'application/json' }), `${safeName}.bangerator.json`);
  } else if (act === 'open') {
    $('file-open').click();
  } else if (act === 'midi') {
    exportMidiDialog(safeName);
  } else if (act === 'wav') {
    exportWavDialog(safeName);
  } else if (act === 'midiout') {
    midiOutDialog();
  }
}

function exportMidiDialog(safeName) {
  modal(`<h2>Export MIDI</h2>
    <p class="hint">Makes a .mid file with one track per instrument (drums on channel 10), plus tempo and key signature. Drop it into any DAW (FL Studio, Ableton, GarageBand…).</p>
    <label class="field">Repeat the loop <input type="number" id="mid-loops" value="4" min="1" max="64"> times</label>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn on" id="mid-go">Download .mid</button></div>`,
  (box, close) => box.querySelector('#mid-go').addEventListener('click', () => {
    exportMidi(safeName, clamp(Number(box.querySelector('#mid-loops').value) || 1, 1, 64));
    close();
  }));
}

function exportMidi(safeName, loops) {
  const p = store.project;
  const events = buildEvents(p).filter(e => e.audible);
  const groups = [];
  p.tracks.forEach((t, i) => groups.push({ name: t.name, channel: i % 9, program: gmProgram(p.patches[t.patch]),
    notes: events.filter(e => e.trackId === t.id) }));
  groups.push({ name: 'Chords', channel: 10, program: gmProgram(p.patches[p.chords.patch]), notes: events.filter(e => e.trackId === 'chords') });
  groups.push({ name: 'Drums', channel: 9, notes: events.filter(e => e.kind === 'drum').map(e => ({ step: e.step, dur: 1, midi: e.gm, vel: e.vel })) });
  const family = SCALES[harmonyScaleId(p.scale)].family;
  const blob = buildMidiFile({ bpm: p.bpm, loops, loopSteps: loopSteps(), keySig: keySignature(p.root, p.scale), minor: family === 'minor',
    groups: groups.filter(g => g.notes.length) });
  download(blob, `${safeName}.mid`);
  toast('MIDI file exported.');
}

function exportWavDialog(safeName) {
  modal(`<h2>Export audio</h2>
    <p class="hint">Renders the loop to a .wav file right in your browser.</p>
    <label class="field">Repeat the loop <input type="number" id="wav-loops" value="2" min="1" max="32"> times</label>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn on" id="wav-go">Render .wav</button></div>`,
  (box, close) => box.querySelector('#wav-go').addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = 'Rendering…';
    try {
      await initAudio();
      const blob = await renderWav(clamp(Number(box.querySelector('#wav-loops').value) || 1, 1, 32));
      download(blob, `${safeName}.wav`);
      toast('Audio exported.');
    } catch (err) {
      console.error(err);
      toast('Rendering failed: ' + err.message);
    }
    close();
  }));
}

async function midiOutDialog() {
  let outputs = [];
  try { outputs = await midiOut.init(); } catch (e) { console.warn(e); }
  if (!navigator.requestMIDIAccess) {
    modal(`<h2>MIDI output</h2><p>Your browser doesn’t support Web MIDI. Try Chrome or Edge, or use <b>Export MIDI</b> instead.</p><div class="actions"><button class="btn" data-close>OK</button></div>`);
    return;
  }
  const opts = outputs.map(o => `<option value="${o.id}" ${midiOut.output?.id === o.id ? 'selected' : ''}>${o.name.replace(/</g, '&lt;')}</option>`).join('');
  modal(`<h2>MIDI output</h2>
    <p class="hint">Send the notes live to a DAW or hardware synth while Bangerator plays. Tracks use channels 1–9, chords channel 11, drums channel 10 (General MIDI drum notes). On Windows you can use loopMIDI to route into a DAW.</p>
    <label class="field">Device <select id="mo-dev"><option value="">(none)</option>${opts}</select></label>
    <label class="field check" style="margin-top:8px"><input type="checkbox" id="mo-mute" ${midiOut.localMute ? 'checked' : ''}> Mute Bangerator’s own sounds</label>
    ${outputs.length ? '' : '<p class="hint">No MIDI outputs found.</p>'}
    <div class="actions"><button class="btn on" data-close>Done</button></div>`,
  box => {
    box.querySelector('#mo-dev').addEventListener('change', e => { midiOut.select(e.target.value); toast(e.target.value ? 'MIDI output on' : 'MIDI output off'); });
    box.querySelector('#mo-mute').addEventListener('change', e => { midiOut.localMute = e.target.checked; });
  });
}

// ---------- Project loading ----------
async function loadProject(p) {
  if (transport.playing) { stop(); $('btn-play').classList.remove('playing'); $('btn-play').textContent = '▶'; }
  setProject(p);
  ui.selectedSlot = null;
  ui.selectedTrackId = store.project.tracks[0]?.id ?? null;
  await afterAudioReady();
}

// Things that need the AudioContext: user samples, the drum kit with project settings, sample preloading.
async function afterAudioReady() {
  if (!audio.ctx) return;
  const p = store.project;
  await rebuildDrumKit();
  for (const r of p.drums.rows) {
    if (r.kind === 'sample' && r.sampleId && !audio.userBuffers[r.sampleId]) {
      try {
        const s = await loadSampleData(r.sampleId);
        if (s) audio.userBuffers[r.sampleId] = await decodeUserSample(s.data);
      } catch (e) { console.warn('Sample missing', r.name, e); }
    }
  }
  for (const pt of Object.values(p.patches)) if (pt.kind === 'sampler') ensureSampleSet(pt.set);
  syncMixer();
}

// ---------- Store updates -> views ----------
function onChange(what) {
  invalidateEvents();
  if (what === 'notes') { redrawRolls(); syncTopbar(); return; }
  if (what === 'drums' || what === 'tempo') { syncTopbar(); return; }
  syncMixer();
  syncTopbar();
  renderCompose();
  renderSidebar();
  if (activeTab === 'sound' && what !== 'patches') renderSoundDesign();
}

// ---------- Keyboard ----------
function initKeys() {
  const held = new Map();
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    // number keys play scale degrees (shift = octave up)
    const m = e.code.match(/^(Digit|Numpad)([1-9])$/);
    if (m && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const n = scaleSteps(store.project.scale).length;
      const deg = Number(m[2]) - 1 + (e.shiftKey ? n : 0);
      if (activeTab === 'sound') { held.set(e.code, playTest(deg, 4, 4)); return; }
      const t = store.project.tracks.find(x => x.id === ui.selectedTrackId) || store.project.tracks[0];
      if (t) held.set(e.code, previewDeg(t, deg, 0, 4));
    }
  });
  document.addEventListener('keyup', e => {
    const stopFn = held.get(e.code);
    if (stopFn) { stopFn(); held.delete(e.code); }
  });
}

// ---------- Playhead animation ----------
function frame() {
  drawPlayhead(transport.playing ? currentVisualStep() : -1);
  requestAnimationFrame(frame);
}

// ---------- Boot ----------
function boot() {
  initTopbar();
  initKeys();
  subscribe(onChange);
  const saved = loadSaved();
  let p = saved;
  if (!p) p = defaultProject();
  try { setProject(p); } catch (e) { console.error('Saved project broken, loading demo', e); setProject(defaultProject()); }
  ui.selectedTrackId = store.project.tracks[0]?.id ?? null;
  renderCompose();
  renderSidebar();
  requestAnimationFrame(frame);

  $('btn-start').addEventListener('click', async () => {
    $('btn-start').textContent = 'Warming up…';
    await initAudio();
    await afterAudioReady();
    $('start-overlay').classList.add('hidden');
  });
}

boot();
export { selectTrack, degToSemis, h };
