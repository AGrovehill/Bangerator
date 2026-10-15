// Saving and loading projects.
//
// Every project lives in the on-device library (IndexedDB). When the app is served by the Bangerator
// server and you're logged in, projects are also saved to the server ("cloud"), so they follow you
// to any browser; the device copy is then a cache that keeps working offline and syncs when back.
// Autosave runs shortly after every change. Ctrl+S saves right away and keeps a history point.

import { store, onProjectChanged, flushOpen, migrate, sampleIds, uid, loadSampleData, saveSampleData } from './state.js';
import { idbGet, idbPut, idbDelete, idbAll } from './db.js';

const LAST_KEY = 'bangerator.lastProject';
const LEGACY_KEY = 'bangerator.project.v1'; // the single autosave slot of Bangerator 1

export const session = {
  server: null,    // { auth, loggedIn } when the Bangerator server answers, else null
  id: null,        // open project's id
  cloud: false,    // saved on the server too?
  rev: 0,          // server revision our copy is based on
  status: 'saved', // saved | dirty | saving | offline | conflict | error | local
  savedAt: 0,
};

export const hooks = {
  load: async () => {},     // (project) => put it in the editor
  status: () => {},         // (session) => update the indicator
  conflict: async () => {}, // () => ask the user what to do
};

const newId = () => uid('pr').replace(/[^A-Za-z0-9_-]/g, '');
const cloudReady = () => !!session.server && session.server.loggedIn;

function setStatus(s) {
  session.status = s;
  hooks.status(session);
}

// ---------- Server API ----------
export async function api(path, { method = 'GET', json, body, headers = {}, timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch('api/' + path, {
      method, signal: ctl.signal, credentials: 'same-origin',
      headers: { 'X-Bangerator': '1', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : body,
    });
    const isJson = (r.headers.get('content-type') || '').includes('json');
    const data = isJson ? await r.json() : r;
    if (r.status === 401 && session.server && path !== 'login') { session.server.loggedIn = false; }
    return { ok: r.ok, status: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// The static build (GitHub Pages) has no server: it says so in a meta tag, and we don't even ask.
export const STATIC_BUILD = typeof document !== 'undefined' && !!document.querySelector('meta[name="bangerator-static"]');

export async function detectServer() {
  if (STATIC_BUILD) { session.server = null; return null; }
  try {
    const r = await api('health', { timeout: 4000 });
    session.server = r.ok && r.data?.ok ? { auth: r.data.auth, loggedIn: r.data.loggedIn, local: !!r.data.local } : null;
  } catch {
    session.server = null;
  }
  return session.server;
}

export async function login(password) {
  const r = await api('login', { method: 'POST', json: { password } });
  if (r.ok && session.server) session.server.loggedIn = true;
  return r.ok;
}

export async function logout() {
  await api('logout', { method: 'POST', json: {} }).catch(() => {});
  if (session.server) session.server.loggedIn = false;
}

// ---------- Samples on the server ----------
const uploaded = new Set();

async function uploadSamples(project) {
  for (const id of sampleIds(project)) {
    if (uploaded.has(id)) continue;
    const head = await fetch('api/samples/' + id, { method: 'HEAD', credentials: 'same-origin' });
    if (head.ok) { uploaded.add(id); continue; }
    const s = await loadSampleData(id);
    if (!s) continue;
    const r = await api('samples/' + id, { method: 'PUT', body: s.data, headers: { 'Content-Type': 'application/octet-stream' }, timeout: 120000 });
    if (r.ok) uploaded.add(id);
  }
}

async function downloadMissingSamples(project) {
  for (const r of project.drums?.rows || []) {
    if (r.kind !== 'sample' || !r.sampleId) continue;
    if (await loadSampleData(r.sampleId).catch(() => null)) continue;
    if (!cloudReady()) continue;
    try {
      const res = await fetch('api/samples/' + r.sampleId, { credentials: 'same-origin' });
      if (res.ok) { await saveSampleData(r.sampleId, r.name, await res.arrayBuffer()); uploaded.add(r.sampleId); }
    } catch (e) { console.warn('Could not fetch sample', r.name, e); }
  }
}

// ---------- Device library ----------
// IndexedDB 'projects': id -> { id, name, updated, project, cloud, rev, pending }
//   cloud: also on the server (this is the offline copy); pending: has changes the server hasn't got yet

export async function listLocal() {
  try { return (await idbAll('projects')).map(({ project, ...meta }) => meta); } catch { return []; }
}

export async function listCloud() {
  if (!cloudReady()) return null;
  const r = await api('projects');
  return r.ok ? r.data : null;
}

function rememberLast() {
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ id: session.id, cloud: session.cloud })); } catch { /* private mode */ }
}

function snapshot() {
  flushOpen(store.project);
  return JSON.parse(JSON.stringify(store.project));
}

async function writeLocal(project, extra = {}) {
  const prev = await idbGet('projects', session.id).catch(() => null);
  await idbPut('projects', session.id, {
    ...(prev || {}), id: session.id, name: project.name, updated: Date.now(), project,
    cloud: session.cloud, rev: session.rev, ...extra,
  });
}

// ---------- Autosave ----------
let timer = null;
let saving = null;
let again = false;

onProjectChanged(() => {
  if (!session.id) return;
  if (session.status !== 'conflict') setStatus('dirty');
  clearTimeout(timer);
  timer = setTimeout(() => saveNow(), 1200);
});

// Save immediately. `checkpoint` asks the server to keep a history point.
export async function saveNow({ checkpoint = false, force = false } = {}) {
  clearTimeout(timer);
  if (!session.id || !store.project) return;
  if (saving) { again = true; return saving; }
  saving = (async () => {
    const project = snapshot();
    try {
      await writeLocal(project, { pending: session.cloud });
    } catch (e) {
      console.error('Local save failed', e);
    }
    if (!session.cloud) { session.savedAt = Date.now(); setStatus('local'); return; }
    if (session.status === 'conflict' && !force) return;
    if (!cloudReady()) { setStatus('offline'); return; }
    setStatus('saving');
    try {
      const r = await api('projects/' + session.id, { method: 'PUT', json: { project, baseRev: session.rev, checkpoint, force } });
      if (r.status === 409) { setStatus('conflict'); hooks.conflict(); return; }
      if (r.status === 401) { setStatus('offline'); return; }
      if (!r.ok) throw new Error(r.data?.error || r.status);
      session.rev = r.data.rev;
      session.savedAt = Date.now();
      await writeLocal(project, { pending: false });
      setStatus('saved');
      uploadSamples(project).catch(e => console.warn('Sample upload failed', e));
    } catch (e) {
      console.warn('Cloud save failed, kept on this device', e);
      setStatus('offline');
    }
  })();
  try { await saving; } finally {
    saving = null;
    if (again) { again = false; saveNow({ checkpoint }); }
  }
}

// Retry unsynced changes when the connection comes back.
window.addEventListener('online', () => { if (session.status === 'offline') saveNow(); });
setInterval(() => { if (session.status === 'offline' && navigator.onLine) detectServer().then(() => saveNow()); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && (session.status === 'dirty' || timer)) saveNow();
});
window.addEventListener('beforeunload', e => {
  if (session.status === 'dirty' || session.status === 'saving') { saveNow(); e.preventDefault(); e.returnValue = ''; }
});

// ---------- Open / create ----------
async function open(project, { id, cloud, rev }) {
  await downloadMissingSamples(project);
  session.id = id;
  session.cloud = cloud;
  session.rev = rev || 0;
  rememberLast();
  await hooks.load(project);
  setStatus(cloud ? (cloudReady() ? 'saved' : 'offline') : 'local');
}

export async function openProject(id, cloud) {
  if (session.status === 'dirty' || session.status === 'saving') await saveNow();
  const local = await idbGet('projects', id).catch(() => null);
  if (cloud && cloudReady()) {
    const r = await api('projects/' + id);
    if (r.ok) {
      if (local?.pending && local.rev === r.data.rev) {
        // our device copy has edits the server never got: carry on from those and sync them
        await open(local.project, { id, cloud: true, rev: r.data.rev });
        saveNow();
        return true;
      }
      if (local?.pending) await keepAsLocalCopy(local, 'unsynced copy');
      await idbPut('projects', id, { id, name: r.data.project.name, updated: r.data.updated, project: r.data.project, cloud: true, rev: r.data.rev, pending: false });
      await open(r.data.project, { id, cloud: true, rev: r.data.rev });
      return true;
    }
  }
  if (!local) return false;
  await open(local.project, { id, cloud: !!local.cloud, rev: local.rev });
  if (local.pending && cloudReady()) saveNow();
  return true;
}

async function keepAsLocalCopy(entry, label) {
  const id = newId();
  const project = { ...entry.project, name: `${entry.project.name} (${label})` };
  await idbPut('projects', id, { id, name: project.name, updated: Date.now(), project, cloud: false, rev: 0 });
}

// Start a new project from `project` (a blank one, the demo, an imported file, a copy...).
export async function createProject(project, { cloud = cloudReady() } = {}) {
  if (session.status === 'dirty' || session.status === 'saving') await saveNow();
  await open(project, { id: newId(), cloud, rev: 0 });
  await saveNow({ checkpoint: true });
}

export async function renameProject(id, cloud, name) {
  if (id === session.id) {
    store.project.name = name;
    await saveNow();
    return;
  }
  const local = await idbGet('projects', id).catch(() => null);
  if (cloud && cloudReady()) {
    const r = await api('projects/' + id);
    if (!r.ok) throw new Error('Could not load it');
    r.data.project.name = name;
    const s = await api('projects/' + id, { method: 'PUT', json: { project: r.data.project, baseRev: r.data.rev } });
    if (!s.ok) throw new Error('Could not save it');
    if (local) await idbPut('projects', id, { ...local, name, project: r.data.project, rev: s.data.rev, pending: false });
  } else if (local) {
    local.project.name = name;
    await idbPut('projects', id, { ...local, name, updated: Date.now() });
  }
}

export async function deleteProject(id, cloud) {
  if (cloud && cloudReady()) {
    const r = await api('projects/' + id, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new Error('Delete failed');
  }
  await idbDelete('projects', id).catch(() => {});
}

export async function fetchProject(id, cloud) {
  if (cloud && cloudReady()) {
    const r = await api('projects/' + id);
    if (r.ok) return r.data.project;
  }
  return (await idbGet('projects', id).catch(() => null))?.project || null;
}

// Move a device-only project to the server.
export async function uploadProject(id) {
  if (!cloudReady()) return false;
  if (id === session.id) {
    session.cloud = true;
    session.rev = 0;
    rememberLast();
    await saveNow({ checkpoint: true });
    return session.status === 'saved';
  }
  const local = await idbGet('projects', id);
  if (!local) return false;
  const r = await api('projects/' + id, { method: 'PUT', json: { project: local.project, baseRev: 0, checkpoint: true } });
  if (!r.ok) return false;
  await uploadSamples(local.project);
  await idbPut('projects', id, { ...local, cloud: true, rev: r.data.rev, pending: false });
  return true;
}

export async function listRevisions(id) {
  const r = await api(`projects/${id}/revisions`);
  return r.ok ? r.data : [];
}

export async function fetchRevision(id, rev) {
  const r = await api(`projects/${id}/revisions/${rev}`);
  return r.ok ? r.data.project : null;
}

// Conflict answers
export async function resolveConflict(choice) {
  if (choice === 'mine') {
    session.status = 'dirty';
    await saveNow({ force: true, checkpoint: true });
  } else if (choice === 'theirs') {
    session.status = 'saved';
    const local = await idbGet('projects', session.id).catch(() => null);
    if (local) await idbPut('projects', session.id, { ...local, pending: false });
    await openProject(session.id, true);
  } else if (choice === 'copy') {
    const project = snapshot();
    project.name += ' (my version)';
    session.status = 'saved';
    await createProject(project);
  }
}

// ---------- Boot ----------
// Returns once a project is open: the last one, else a legacy autosave, else `fallback()`.
export async function boot(fallback) {
  await detectServer();
  let last = null;
  try { last = JSON.parse(localStorage.getItem(LAST_KEY)); } catch { /* none */ }
  if (last?.id) {
    try { if (await openProject(last.id, last.cloud)) return; } catch (e) { console.warn('Could not reopen last project', e); }
  }
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch { /* none */ }
  if (legacy?.tracks) {
    try {
      await createProject(migrate(legacy));
      localStorage.removeItem(LEGACY_KEY);
      return;
    } catch (e) { console.warn('Old autosave unreadable', e); }
  }
  // New device: pick up where you left off elsewhere instead of starting another demo.
  const cloud = await listCloud().catch(() => null);
  if (cloud?.length && await openProject(cloud[0].id, true).catch(() => false)) return;
  await createProject(fallback());
}
