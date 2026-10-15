// Bangerator entry point: wires the top bar, views, keyboard shortcuts, saving and the playhead loop.

import { store, subscribe, commit, setProject, defaultProject, blankProject, changeKey, setBars, undo, redo,
  outOfScaleCount, snapToScale, duplicateLoop, sections, STEPS_PER_BAR, patternView, openPattern, newPattern, clonePattern,
  exportProjectJSON, importProjectJSON, loadSampleData, MAX_BARS, songBars } from './state.js';
import { SCALES, SCALE_ORDER, ROOT_NAMES, keySignature, harmonyScaleId, degToSemis, scaleSteps } from './theory.js';
import { initAudio, audio, ensureSampleSet, decodeUserSample } from './audio.js';
import { play, stop, transport, invalidateEvents, syncMixer, currentVisualStep, renderWav,
  patternTimeline, songTimeline, openPatternStep } from './sequencer.js';
import { buildMidiFile, gmProgram, midiOut } from './midi.js';
import { renderCompose, redrawRolls, drawPlayhead, addTrack, selectTrack, initCompose, syncDrumCells, composeKey } from './ui/compose.js';
import { renderArrange, initArrange, arrangeKey, drawSongPlayhead } from './ui/arrange.js';
import { renderSidebar, renderAdvice } from './ui/sidebar.js';
import { renderSoundDesign, playTest, rebuildDrumKit } from './ui/sounddesign.js';
import { ui, toast, modal, download, previewDeg, selectedKey, h } from './ui/common.js';
import { renderMixer } from './ui/mixer.js';
import { session, hooks, boot as bootStorage, detectServer, saveNow, createProject } from './storage.js';
import { showLibrary, showLogin, showConflict, importFile, ago } from './ui/library.js';
import { ctl, updateLeds, autoConnect } from './controller.js';
import { showControllerDialog, syncControllerChip } from './ui/controllerui.js';
import { initGuide, queueGuide, showGenreChooser } from './ui/guideui.js';
import { initHistory } from './ui/history.js';

const $ = id => document.getElementById(id);
let activeTab = 'compose';

// ---------- Top bar ----------
function initTopbar() {
  for (let b = 1; b <= MAX_BARS; b++) $('in-bars').append(new Option(`${b}`, b));
  ROOT_NAMES.forEach((n, i) => $('in-root').append(new Option(n, i)));
  for (const id of SCALE_ORDER) $('in-scale').append(new Option(SCALES[id].name, id));

  $('btn-play').addEventListener('click', togglePlay);
  $('mode-toggle').addEventListener('click', e => { if (e.target.dataset.mode) setMode(e.target.dataset.mode); });
  $('in-bpm').addEventListener('change', e => { store.project.bpm = clamp(Number(e.target.value) || 100, 40, 220); commit('tempo'); });
  $('in-bars').addEventListener('change', e => setBars(Number(e.target.value)));
  $('in-swing').addEventListener('input', e => { store.project.swing = Number(e.target.value); });
  $('in-swing').addEventListener('change', () => commit('tempo'));
  $('in-root').addEventListener('change', e => changeKey(Number(e.target.value), selectedKey().scale, ui.selectedSection));
  $('in-scale').addEventListener('change', e => changeKey(selectedKey().root, e.target.value, ui.selectedSection));
  $('in-pattern').addEventListener('change', e => openPattern(e.target.value));
  $('btn-pat-new').addEventListener('click', () => { newPattern(); toast('New pattern. Place it in the song from the Arrange tab.'); });
  $('btn-pat-clone').addEventListener('click', () => { const pt = clonePattern(); if (pt) toast(`Cloned as “${pt.name}”.`); });
  $('btn-scale-prev').addEventListener('click', () => stepScale(-1));
  $('btn-scale-next').addEventListener('click', () => stepScale(1));
  $('btn-undo').addEventListener('click', () => undo());
  $('btn-redo').addEventListener('click', () => redo());
  $('btn-add-track').addEventListener('click', addTrack);
  $('save-status').addEventListener('click', showLibrary);
  $('ctl-status').addEventListener('click', showControllerDialog);
  $('in-zoom').addEventListener('input', e => { ui.cellW = Number(e.target.value); renderCompose(); });
  $('btn-dup').addEventListener('click', () => {
    if (duplicateLoop()) toast(`Pattern doubled to ${store.project.bars} bars. Change the copy to build the next part.`);
    else toast('The pattern is already at the 32-bar limit.');
  });
  $('btn-snap').addEventListener('click', () => { snapToScale(); toast('Every note moved to its nearest scale note.'); });
  $('in-notenames').addEventListener('change', e => { store.project.showNoteNames = e.target.checked; commit('all'); });
  $('in-focus').checked = ui.focusLanes;
  $('in-focus').addEventListener('change', e => {
    ui.focusLanes = e.target.checked;
    ui.showAllLanes = false;
    try { localStorage.setItem('bangerator.focusLanes', ui.focusLanes ? '1' : '0'); } catch { /* private mode */ }
    renderCompose();
  });

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

  const menu = $('menu-file');
  $('btn-file').addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
  document.addEventListener('click', () => menu.classList.remove('open'));
  menu.addEventListener('click', e => {
    const act = e.target.closest('button')?.dataset.act;
    if (act) { menu.classList.remove('open'); fileAction(act); }
  });
  $('file-open').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      await importFile(f);
      toast(`Imported “${store.project.name}”`);
    } catch (err) {
      console.error(err);
      toast('That file does not look like a Bangerator project.');
    }
  });
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function stepScale(dir) {
  const k = selectedKey();
  const i = SCALE_ORDER.indexOf(k.scale);
  const next = SCALE_ORDER[(i + dir + SCALE_ORDER.length) % SCALE_ORDER.length];
  changeKey(k.root, next, ui.selectedSection);
  toast(`${SCALES[next].name}: ${SCALES[next].mood}`);
}

// The "notes outside the scale" counter in the compose toolbar.
function syncNoteMode() {
  const n = outOfScaleCount();
  $('scale-status').hidden = !n;
  $('scale-status-text').textContent = `${n} note${n === 1 ? '' : 's'} outside the scale`;
}

function syncTopbar() {
  syncNoteMode();
  const p = store.project;
  $('in-bpm').value = p.bpm;
  $('in-bars').value = p.bars;
  $('in-swing').value = p.swing;
  const k = selectedKey();
  $('in-root').value = k.root;
  $('in-scale').value = k.scale;
  const secs = sections(p);
  $('key-where').textContent = secs.length > 1 ? `from bar ${k.bar + 1}` : '';
  $('in-notenames').checked = p.showNoteNames;
  $('btn-undo').disabled = !store.undoStack.length;
  $('btn-redo').disabled = !store.redoStack.length;
  const sel = $('in-pattern');
  sel.replaceChildren(...p.patterns.map(pt => new Option(pt.name, pt.id)));
  sel.value = p.currentPattern;
  const cur = p.patterns.find(pt => pt.id === p.currentPattern);
  $('pat-dot').style.background = cur?.color || '#888';
  document.title = `${p.name} · Bangerator`;
}

function showTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tabpanel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  $('sidebar').style.display = tab === 'learn' || tab === 'arrange' ? 'none' : '';
  if (tab === 'sound') renderSoundDesign();
  if (tab === 'mix') renderMixer();
  if (tab === 'arrange') renderArrange();
  if (tab === 'compose') renderCompose();
}

// ---------- Transport ----------
function syncPlayButton() {
  const b = $('btn-play');
  b.classList.toggle('playing', transport.playing);
  b.textContent = transport.playing ? '■' : '▶';
  document.querySelectorAll('#mode-toggle button').forEach(x => x.classList.toggle('on', x.dataset.mode === transport.mode));
}

function setMode(mode) {
  if (transport.mode === mode) return;
  const was = transport.playing;
  if (was) stop();
  transport.mode = mode;
  invalidateEvents();
  if (was) startPlaying(0);
  syncPlayButton();
}

function startPlaying(fromStep) {
  if (transport.mode === 'song' && !songBars(store.project)) {
    toast('The song is empty, so playing the pattern. Place patterns in the Arrange tab.');
    transport.mode = 'pattern';
  }
  if (transport.mode === 'song' && fromStep === 0 && store.project.song.loop) fromStep = store.project.song.loop.start * STEPS_PER_BAR;
  play(fromStep);
  syncPlayButton();
}

async function togglePlay() {
  await initAudio();
  if (transport.playing) stop();
  else startPlaying(0);
  syncPlayButton();
}

// Click on a ruler: play from there in that ruler's mode.
async function playFrom(step, mode) {
  await initAudio();
  if (transport.playing) stop();
  transport.mode = mode;
  invalidateEvents();
  startPlaying(step);
}

// ---------- File actions ----------
async function fileAction(act) {
  const p = store.project;
  const safeName = (p.name || 'banger').replace(/[^\w\- ]+/g, '').trim() || 'banger';
  if (act === 'library') {
    showLibrary();
  } else if (act === 'new') {
    await createProject(blankProject());
    toast('New project. Your previous one is in Projects.');
  } else if (act === 'demo') {
    await createProject(defaultProject());
    toast('Demo opened as a new project.');
  } else if (act === 'guide') {
    showGenreChooser();
  } else if (act === 'rename') {
    const name = prompt('Project name:', p.name);
    if (!name) return;
    p.name = name.slice(0, 200);
    commit('mix');
  } else if (act === 'save') {
    await saveNow({ checkpoint: true });
    toast(session.status === 'saved' ? 'Saved, with a history point.' : session.status === 'local' ? 'Saved on this device.' : 'Saved on this device; will sync when the server is back.');
  } else if (act === 'export') {
    download(new Blob([await exportProjectJSON()], { type: 'application/json' }), `${safeName}.bangerator.json`);
  } else if (act === 'open') {
    $('file-open').click();
  } else if (act === 'midi') {
    exportMidiDialog(safeName);
  } else if (act === 'wav') {
    exportWavDialog(safeName);
  } else if (act === 'midiout') {
    midiOutDialog();
  } else if (act === 'controller') {
    showControllerDialog();
  }
}

const whatToExport = () => {
  const has = songBars(store.project) > 0;
  return `<label class="field check"><input type="radio" name="what" value="song" ${has ? 'checked' : 'disabled'}> The whole song${has ? ` (${songBars(store.project)} bars)` : ' (empty)'}</label>
    <label class="field check"><input type="radio" name="what" value="pattern" ${has ? '' : 'checked'}> The pattern “${store.project.patterns.find(x => x.id === store.project.currentPattern).name.replace(/</g, '&lt;')}”, repeated
      <input type="number" id="ex-loops" value="4" min="1" max="64"> times</label>`;
};

function exportMidiDialog(safeName) {
  modal(`<h2>Export MIDI</h2>
    <p class="hint">Makes a .mid file with one track per instrument (drums on channel 10), plus tempo and key signatures. Drop it into any DAW (FL Studio, Ableton, GarageBand…).</p>
    <div class="ex-what">${whatToExport()}</div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn on" id="mid-go">Download .mid</button></div>`,
  (box, close) => box.querySelector('#mid-go').addEventListener('click', () => {
    const song = box.querySelector('input[name=what]:checked').value === 'song';
    exportMidi(safeName, song, clamp(Number(box.querySelector('#ex-loops').value) || 1, 1, 64));
    close();
  }));
}

function exportMidi(safeName, song, loops) {
  const p = store.project;
  const tl = song ? songTimeline(p) : patternTimeline(p);
  const events = tl.events.filter(e => e.audible);
  const groups = [];
  p.tracks.forEach((t, i) => groups.push({ name: t.name, channel: i % 9, program: gmProgram(p.patches[t.patch]),
    notes: events.filter(e => e.trackId === t.id) }));
  groups.push({ name: 'Chords', channel: 10, program: gmProgram(p.patches[p.chords.patch]), notes: events.filter(e => e.trackId === 'chords') });
  groups.push({ name: 'Drums', channel: 9, notes: events.filter(e => e.kind === 'drum').map(e => ({ step: e.step, dur: 1, midi: e.gm, vel: e.vel })) });
  const sig = (k, step) => ({ step, sf: keySignature(((k.root % 12) + 12) % 12, k.scale), minor: SCALES[harmonyScaleId(k.scale)].family === 'minor' });
  let keySigs;
  if (song) {
    // the key of each clip (and its key changes), first clip wins where clips overlap
    const byStep = new Map();
    for (const c of [...p.song.clips].sort((a, b) => a.bar - b.bar)) {
      const v = patternView(p, c.pat, c.key);
      for (const k of sections(v)) {
        if (k.bar >= c.len) continue;
        const step = (c.bar + k.bar) * STEPS_PER_BAR;
        if (!byStep.has(step)) byStep.set(step, sig(k, step));
      }
    }
    keySigs = [...byStep.values()].sort((a, b) => a.step - b.step);
    loops = 1;
  } else {
    keySigs = sections(p).map(k => sig(k, k.bar * STEPS_PER_BAR));
  }
  const blob = buildMidiFile({ bpm: p.bpm, loops, loopSteps: tl.length, keySigs, groups: groups.filter(g => g.notes.length) });
  download(blob, `${safeName}${song ? '' : '-pattern'}.mid`);
  toast('MIDI file exported.');
}

function exportWavDialog(safeName) {
  modal(`<h2>Export audio</h2>
    <p class="hint">Renders to a .wav file right in your browser.</p>
    <div class="ex-what">${whatToExport()}</div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn on" id="wav-go">Render .wav</button></div>`,
  (box, close) => box.querySelector('#wav-go').addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = 'Rendering…';
    const song = box.querySelector('input[name=what]:checked').value === 'song';
    try {
      await initAudio();
      const blob = await renderWav({ song, loops: clamp(Number(box.querySelector('#ex-loops').value) || 1, 1, 64) });
      download(blob, `${safeName}${song ? '' : '-pattern'}.wav`);
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

// ---------- Project loading (called by storage.js) ----------
async function loadProject(p) {
  if (transport.playing) stop();
  ui.selectedSection = 0;
  ui.selectedSlot = null;
  ui.selectedClip = null;
  setProject(p);
  ui.selectedTrackId = store.project.tracks[0]?.id ?? null;
  syncPlayButton();
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

// ---------- Save indicator ----------
const STATUS = {
  saved: ['ok', 'Saved'],
  local: ['ok', 'Saved on this device'],
  dirty: ['busy', 'Unsaved changes'],
  saving: ['busy', 'Saving…'],
  offline: ['warn', 'Offline: saved on this device'],
  conflict: ['bad', 'Changed elsewhere!'],
  error: ['bad', 'Save failed'],
};

function showStatus(s) {
  const [cls, text] = STATUS[s.status] || STATUS.saved;
  const el = $('save-status');
  el.className = 'save-status ' + cls;
  el.querySelector('.txt').textContent = `${store.project?.name || ''} · ${text}`;
  el.title = `${s.cloud ? 'Saved on the server' : 'Saved in this browser'}${s.savedAt ? `, last ${ago(s.savedAt)}` : ''}. Click for your projects (Ctrl+O).`;
}

// ---------- Store updates -> views ----------
function onChange(what) {
  invalidateEvents();
  if (what !== 'song-live' && what !== 'auto-live') queueGuide();
  if (what === 'song-live' || what === 'auto-live') return;
  if (what === 'auto') { syncTopbar(); if (activeTab === 'arrange') renderArrange(); if (activeTab === 'mix') renderMixer(); return; }
  if (what === 'fx') { syncMixer(); syncTopbar(); if (activeTab === 'mix') renderMixer(); return; }
  if (what === 'notes') { redrawRolls(); syncTopbar(); renderAdvice(); return; }
  if (what === 'drums' || what === 'tempo') { syncTopbar(); syncDrumCells(); renderAdvice(); if (activeTab === 'arrange') renderArrange(); return; }
  if (what === 'song') { syncTopbar(); if (activeTab === 'arrange') renderArrange(); return; }
  if (what === 'pattern') { ui.selectedSlot = null; ui.selectedSection = 0; ui.showAllLanes = false; }
  syncMixer();
  syncTopbar();
  if (activeTab === 'compose') renderCompose();
  if (activeTab === 'arrange') renderArrange();
  renderSidebar();
  if (activeTab === 'sound' && what !== 'patches') renderSoundDesign();
  if (activeTab === 'mix') renderMixer();
}

// ---------- Keyboard ----------
function initKeys() {
  const held = new Map();
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    // these work everywhere, even in text fields
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); fileAction('save'); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); showLibrary(); return; }
    const tag = e.target.tagName;
    if (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (!$('modal').hidden) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
    if (activeTab === 'compose' && composeKey(e)) { e.preventDefault(); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (activeTab === 'arrange' && arrangeKey(e)) { e.preventDefault(); return; }
    if (!mod && !e.altKey && e.key.toLowerCase() === 'l') { setMode(transport.mode === 'song' ? 'pattern' : 'song'); return; }
    // number keys play scale degrees (shift = octave up)
    const m = e.code.match(/^(Digit|Numpad)([1-9])$/);
    if (m && !e.repeat && !mod && !e.altKey) {
      const n = scaleSteps(selectedKey().scale).length;
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
  const step = transport.playing ? currentVisualStep() : -1;
  drawPlayhead(openPatternStep(step));
  drawSongPlayhead(step);
  updateLeds();
  requestAnimationFrame(frame);
}

// ---------- Boot ----------
async function boot() {
  initTopbar();
  initKeys();
  initCompose({ playFrom: step => playFrom(step, 'pattern'), onSelectTrack: renderAdvice });
  initArrange({ playFrom: step => playFrom(step, 'song'), openInEditor: () => showTab('compose') });
  subscribe(onChange);
  hooks.load = loadProject;
  hooks.status = showStatus;
  hooks.conflict = showConflict;
  ctl.hooks = { togglePlay, setMode };
  initGuide({ showTab, setMode });
  initHistory();
  ctl.onChange = syncControllerChip;

  // Something to look at behind the start screen until the saved project is loaded.
  setProject(defaultProject());
  ui.selectedTrackId = store.project.tracks[0]?.id ?? null;
  renderCompose();
  renderSidebar();
  syncTopbar();
  requestAnimationFrame(frame);

  const startBtn = $('btn-start');
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.textContent = 'Warming up…';
    await initAudio();
    const srv = await detectServer();
    $('start-overlay').classList.add('hidden');
    if (srv?.auth && !srv.loggedIn) await showLogin();
    try {
      await bootStorage(defaultProject);
    } catch (e) {
      console.error('Could not open a saved project', e);
      toast('Could not open your saved project. Started the demo instead.');
      await createProject(defaultProject()).catch(() => {});
    }
    await afterAudioReady();
    autoConnect();
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('No offline mode', e));
  }
}

boot();
export { selectTrack, degToSemis, h, blankProject, importProjectJSON };
