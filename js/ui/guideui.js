// The genre guide panel (right-hand side) and the "pick a genre" dialog.

import { store, commit, openPattern, songBars, saveQuietly } from '../state.js';
import { GENRES, CATEGORIES, createGuideProject, guideOf, runStep, stepPlace, totalBars } from '../guides.js';
import { createProject } from '../storage.js';
import { stepDuration } from '../sequencer.js';
import { h, modal, toast, ui } from './common.js';
import { selectTrack } from './compose.js';
import { rebuildDrumKit } from './sounddesign.js';

const OPEN_KEY = 'bangerator.guideOpen';
let hooks = { showTab: () => {}, setMode: () => {} };
let open = true;
try { open = localStorage.getItem(OPEN_KEY) !== '0'; } catch { /* default */ }

export function initGuide(h2) {
  hooks = h2;
  document.getElementById('btn-guide').addEventListener('click', () => {
    if (!store.project.guide) { showGenreChooser(); return; }
    setOpen(!open);
  });
}

function setOpen(v) {
  open = v;
  try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* private mode */ }
  renderGuide();
}

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const rich = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

// Lines starting with "• " become a list; everything else is a paragraph. **bold** works in both.
function body(lines) {
  const out = h('div', { class: 'guide-text' });
  let ul = null;
  for (const line of lines) {
    if (line.startsWith('• ')) {
      if (!ul) { ul = h('ul'); out.append(ul); }
      const li = h('li'); li.innerHTML = rich(line.slice(2)); ul.append(li);
    } else {
      ul = null;
      const p = h('p'); p.innerHTML = rich(line); out.append(p);
    }
  }
  return out;
}

const mmss = secs => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;

let queued = false;
// Called after every project change; redraws at most once per frame.
export function queueGuide() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; renderGuide(); });
}

export function renderGuide() {
  const el = document.getElementById('guide');
  const btn = document.getElementById('btn-guide');
  const p = store.project;
  const g = p && guideOf(p);
  if (!g) {
    el.hidden = true;
    btn.textContent = 'Guides';
    btn.classList.remove('on');
    btn.title = 'Start a guided track: techno, trance, house or drum & bass';
    return;
  }
  const doneCount = g.steps.filter(s => s.done).length;
  btn.textContent = `Guide ${doneCount}/${g.steps.length}`;
  btn.classList.toggle('on', open);
  btn.title = `${g.G.name} guide: show or hide the steps`;
  el.hidden = !open;
  if (!open) return;

  const i = g.index;
  const step = g.steps[i];
  // moving to a step also takes you to where it happens (its pattern, track and tab)
  const go = n => {
    const to = Math.max(0, Math.min(g.steps.length - 1, n));
    p.guide.step = to;
    saveQuietly();
    renderGuide();
    el.scrollTop = 0;
    if (g.steps[to].where?.tab) goTo(g.steps[to]);
  };
  const bars = songBars(p);
  const arranged = !p.song.loop && bars >= g.total * 0.8;

  const dots = h('div', { class: 'guide-dots' }, ...g.steps.map((s, n) => h('button', {
    class: 'guide-dot' + (s.done ? ' done' : '') + (n === i ? ' current' : ''), title: `${n + 1}. ${s.title}${s.done ? ' (done)' : ''}`, onclick: () => go(n),
  }, s.done ? '✓' : String(n + 1))));

  const actions = h('div', { class: 'guide-actions' },
    step.where?.tab ? h('button', { class: 'btn', title: 'Open the place where this step happens', onclick: () => goTo(step) }, 'Show me') : null,
    step.canDo ? h('button', { class: 'btn on', title: 'Write a typical version for this genre. You can change it afterwards; Ctrl+Z undoes it.', onclick: () => doIt(step) }, step.done ? 'Do it again' : 'Do it for me') : null,
    step.manual ? h('button', { class: 'btn' + (step.done ? '' : ' on'), onclick: () => { p.guide.done[step.id] = !step.done; saveQuietly(); renderGuide(); } }, step.done ? 'Not finished yet' : 'Mark as finished') : null);

  el.replaceChildren(
    h('div', { class: 'guide-head' },
      h('div', {}, h('b', {}, `${g.G.name} guide`), h('span', { class: 'hint' }, ` · ${g.G.bpm} BPM`)),
      h('button', { class: 'btn small', title: 'Hide the guide (the Guide button brings it back)', onclick: () => setOpen(false) }, '✕')),
    dots,
    h('div', { class: 'guide-step' },
      h('div', { class: 'guide-kicker' }, `Step ${i + 1} of ${g.steps.length}`, step.done ? h('span', { class: 'guide-done' }, '✓ done') : null),
      h('h2', {}, step.title),
      body(step.text),
      actions),
    h('div', { class: 'guide-nav' },
      h('button', { class: 'btn', disabled: i === 0, onclick: () => go(i - 1) }, '← Back'),
      h('button', { class: 'btn' + (step.done && i < g.steps.length - 1 ? ' on' : ''), disabled: i === g.steps.length - 1, onclick: () => go(i + 1) }, 'Next →')),
    h('div', { class: 'guide-foot' },
      h('p', { class: 'hint' }, arranged
        ? `Your song: ${bars} bars · ${mmss(bars * 16 * stepDuration(p.bpm))}. Play it in Song mode.`
        : g.G.workSections
          ? `Play plays a short draft of the song while you write. The full ${g.total}-bar song (${mmss(g.total * 16 * stepDuration(p.bpm))}) is laid out in the Arrange step.`
          : `Play loops all your parts together (the work loop). The full ${g.total}-bar song (${mmss(g.total * 16 * stepDuration(p.bpm))}) is laid out in the Arrange step.`),
      h('button', { class: 'btn small', onclick: showGenreChooser }, 'Start another guide…')));
}

function goTo(step) {
  const p = store.project;
  const place = stepPlace(p, step);
  if (place.patternId && p.patterns.some(x => x.id === place.patternId)) openPattern(place.patternId);
  if (place.tab) hooks.showTab(place.tab);
  if (place.trackId) selectTrack(place.trackId);
  if (place.tab !== 'compose') return;
  // bring the right lane into view
  setTimeout(() => {
    const target = place.scroll === 'drums' ? document.querySelector('.drum-lane')
      : place.scroll === 'chords' ? document.querySelector('.chord-lane')
        : place.trackId ? document.querySelector(`.track-lane[data-track="${place.trackId}"]`) : null;
    target?.scrollIntoView({ block: place.scroll === 'tracks' ? 'center' : 'start', behavior: 'smooth' });
  }, 60);
}

async function doIt(step) {
  const p = store.project;
  if (step.done && step.id !== 'setup' && !confirm(`“${step.title}” already has something. Replace it with the guide’s version? (Ctrl+Z undoes it.)`)) return;
  try {
    runStep(p, step.id);
  } catch (e) {
    console.error(e);
    toast('That step needs a pattern or track that was deleted from this project.');
    return;
  }
  commit('all');
  if (step.id === 'build') await rebuildDrumKit(); // the riser's length was set to fit this tempo
  if (step.id === 'arrange' || step.id === 'automate') hooks.setMode('song');
  goTo(step);
  toast(step.id === 'arrange' ? `The whole song is laid out: ${songBars(p)} bars. Press Play.`
    : step.id === 'mix' ? 'Mixer set up. Open Mix & FX to see what changed.'
      : 'Written. Press Play to hear it with the rest, then change it to taste.', 3500);
}

export function showGenreChooser() {
  modal('<h2>Make a track with a guide</h2><div id="genres"></div>', box => box.classList.add('wide'));
  const el = document.getElementById('genres');
  el.replaceChildren(
    h('p', { class: 'hint' }, 'Each guide starts a new project with the right tempo, sounds and instruments, and walks you through writing a whole piece: chords, rhythm, bass, melody, mix and arrangement, with the music theory behind each step. Do each step yourself or let it be done for you; either way you end with a finished song.'),
    ...CATEGORIES.flatMap(cat => [h('h3', { class: 'genre-cat' }, cat.name, h('span', {}, cat.blurb)),
      h('div', { class: 'genre-grid' }, ...Object.values(GENRES).filter(G => G.category === cat.id).map(G => {
      const secs = totalBars(G) * 4 * 60 / G.bpm;
      const card = h('button', { class: 'genre-card' },
        h('b', {}, G.name),
        h('span', { class: 'genre-meta' }, `${G.bpm} BPM · ${G.steps.length} steps · ${mmss(secs)} song`),
        h('span', { class: 'genre-blurb' }, G.blurb));
      card.addEventListener('click', async () => {
        card.disabled = true;
        try {
          await createProject(createGuideProject(G.id));
          hooks.setMode('song');
          hooks.showTab('compose');
          setOpen(true);
          document.getElementById('modal').hidden = true;
          toast(`${G.name} project started. Follow the steps on the right.`, 3500);
        } catch (e) {
          console.error(e);
          toast('Could not start the guide.');
        }
      });
      return card;
    }))]),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { document.getElementById('modal').hidden = true; } }, 'Cancel')));
}
