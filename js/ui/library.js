// Project library, login, version history and save-conflict dialogs.

import { blankProject, defaultProject, migrate, importProjectJSON } from '../state.js';
import { session, listLocal, listCloud, openProject, createProject, renameProject, deleteProject, fetchProject,
  uploadProject, listRevisions, fetchRevision, login, logout, resolveConflict, saveNow, hooks, STATIC_BUILD } from '../storage.js';
import { modal, h, toast } from './common.js';
import { showGenreChooser } from './guideui.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function ago(t) {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}

// ---------- Login ----------
export function showLogin({ allowOffline = true } = {}) {
  return new Promise(resolve => {
    modal(`<h2>Log in</h2>
      <p class="hint">This Bangerator keeps your projects on its server. Enter the password to get them.</p>
      <form id="lg-form"><input type="password" id="lg-pw" placeholder="Password" autocomplete="current-password" style="width:100%">
      <p class="hint" id="lg-err" style="color:var(--danger)"></p>
      <div class="actions">${allowOffline ? '<button type="button" class="btn" id="lg-off">Use offline (this device only)</button>' : ''}
      <button class="btn on" type="submit">Log in</button></div></form>`,
    (box, close) => {
      const pw = box.querySelector('#lg-pw');
      pw.focus();
      box.querySelector('#lg-off')?.addEventListener('click', () => { close(); resolve(false); });
      box.querySelector('#lg-form').addEventListener('submit', async e => {
        e.preventDefault();
        box.querySelector('#lg-err').textContent = '';
        try {
          if (await login(pw.value)) { close(); resolve(true); return; }
          box.querySelector('#lg-err').textContent = 'Wrong password.';
        } catch {
          box.querySelector('#lg-err').textContent = 'Could not reach the server.';
        }
        pw.select();
      });
    });
  });
}

// ---------- Library ----------
export async function showLibrary() {
  const close = modal('<h2>Projects</h2><div id="lib">Loading…</div>', box => box.classList.add('wide'));
  const box = document.getElementById('modal-box');
  const lib = box.querySelector('#lib');
  if (session.status === 'dirty') await saveNow();
  const [local, cloud] = await Promise.all([listLocal(), listCloud().catch(() => null)]);
  const cloudIds = new Set((cloud || []).map(x => x.id));
  // cloud projects (or their offline copies when the server isn't reachable)
  const cloudRows = cloud || local.filter(x => x.cloud).map(x => ({ ...x, offline: true }));
  const deviceRows = local.filter(x => !x.cloud && !cloudIds.has(x.id));
  const srv = session.server;

  const row = (x, isCloud) => {
    const current = x.id === session.id;
    const el = h('div', { class: 'lib-row' + (current ? ' current' : '') },
      h('div', { class: 'lib-name' }, h('b', {}, x.name || 'Untitled'),
        h('span', { class: 'hint' }, `${ago(x.updated)}${current ? ' · open now' : ''}${x.offline ? ' · offline copy' : ''}${x.pending ? ' · not synced yet' : ''}`)),
      h('div', { class: 'lib-btns' },
        current ? null : h('button', { class: 'btn on', onclick: () => act(() => openProject(x.id, isCloud), `Opened “${x.name}”`) }, 'Open'),
        h('button', { class: 'btn', title: 'Rename', onclick: () => {
          const name = prompt('Project name:', x.name);
          if (name) act(() => renameProject(x.id, isCloud, name.slice(0, 200)), 'Renamed.', true);
        } }, '✎'),
        h('button', { class: 'btn', title: 'Make a copy', onclick: () => act(async () => {
          const p = await fetchProject(x.id, isCloud);
          if (!p) throw new Error('Could not load it');
          p.name = `${p.name} (copy)`;
          await createProject(migrate(p));
        }, 'Copy made and opened.') }, '⧉'),
        isCloud && srv?.loggedIn ? h('button', { class: 'btn', title: 'Version history', onclick: () => showHistory(x) }, '🕘') : null,
        !isCloud && srv?.loggedIn ? h('button', { class: 'btn', title: 'Save to the server so it’s on all your devices',
          onclick: () => act(() => uploadProject(x.id).then(ok => { if (!ok) throw new Error('Upload failed'); }), 'Uploaded to the server.', true) }, '☁ Upload') : null,
        h('button', { class: 'btn', title: 'Delete', onclick: () => {
          if (!confirm(`Delete “${x.name}”${isCloud ? ' from the server' : ' from this device'}?${isCloud ? ' (The server keeps it in its trash folder.)' : ''}`)) return;
          act(async () => {
            await deleteProject(x.id, isCloud);
            if (current) await createProject(blankProject());
          }, 'Deleted.', true);
        } }, '✕')));
    return el;
  };

  const act = async (fn, msg, reopen = false) => {
    try {
      await fn();
      toast(msg);
      if (reopen) showLibrary(); else close();
    } catch (e) {
      console.error(e);
      toast(e.message || 'That did not work.');
    }
  };

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: e => {
    const f = e.target.files[0];
    if (f) act(() => importFile(f), `Imported “${f.name}”`);
  } });

  lib.replaceChildren(...[
    h('div', { class: 'type-row' },
      h('button', { class: 'btn on', onclick: () => act(() => createProject(blankProject()), 'New project started.') }, '+ New project'),
      h('button', { class: 'btn', onclick: () => act(() => createProject(defaultProject()), 'Demo opened as a new project.') }, 'New from demo'),
      h('button', { class: 'btn', onclick: () => { close(); showGenreChooser(); } }, 'Guided track…'),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Import file…'), fileInput),
    srv ? h('div', { class: 'lib-sec' },
      h('h3', {}, srv.loggedIn ? 'On the server (all your devices)' : 'On the server'),
      srv.loggedIn || !srv.auth
        ? (cloudRows.length ? h('div', {}, ...cloudRows.map(x => row(x, true))) : h('p', { class: 'hint' }, 'Nothing here yet.'))
        : h('div', {}, h('p', { class: 'hint' }, 'Log in to see the projects saved on the server.'),
          h('button', { class: 'btn', onclick: async () => { close(); if (await showLogin({ allowOffline: false })) showLibrary(); } }, 'Log in'))) : null,
    h('div', { class: 'lib-sec' },
      h('h3', {}, 'On this device only'),
      deviceRows.length ? h('div', {}, ...deviceRows.map(x => row(x, false))) : h('p', { class: 'hint' }, 'Nothing here.'),
      srv ? null : h('p', { class: 'hint' }, STATIC_BUILD
        ? 'Projects are kept in this browser. Use File → Export project file to back them up or move them to another computer (File → Import).'
        : 'This copy of Bangerator has no server, so projects are kept in this browser. Use File → Export to back them up, or run the Bangerator server to sync them everywhere.')),
    h('div', { class: 'actions' },
      srv?.auth && srv.loggedIn && !srv.local ? h('button', { class: 'btn', onclick: async () => { await logout(); close(); toast('Logged out. Changes now stay on this device.'); } }, 'Log out') : null,
      h('button', { class: 'btn', 'data-close': true, onclick: close }, 'Close'))].filter(Boolean));
}

export async function importFile(file) {
  const p = await importProjectJSON(await file.text());
  await createProject(migrate(p));
}

// ---------- History ----------
async function showHistory(x) {
  const close = modal(`<h2>History: ${esc(x.name)}</h2><div id="hist">Loading…</div>`, box => box.classList.add('wide'));
  const el = document.getElementById('hist');
  const revs = await listRevisions(x.id);
  if (!revs.length) { el.textContent = 'No history points yet.'; return; }
  el.replaceChildren(
    h('p', { class: 'hint' }, 'The server keeps a history point every 10 minutes while you work, and every time you press Ctrl+S.'),
    h('div', { class: 'lib-list' }, ...revs.map(r => h('div', { class: 'lib-row' },
      h('div', { class: 'lib-name' }, h('b', {}, new Date(r.time).toLocaleString()), h('span', { class: 'hint' }, `${ago(r.time)} · version ${r.rev}`)),
      h('div', { class: 'lib-btns' },
        h('button', { class: 'btn', title: 'Open this version as a new project', onclick: async () => {
          const p = await fetchRevision(x.id, r.rev);
          if (!p) { toast('Could not load that version.'); return; }
          p.name = `${p.name} (${new Date(r.time).toLocaleDateString()})`;
          await createProject(migrate(p));
          close();
          toast('Opened that version as a new project.');
        } }, 'Open as copy'),
        h('button', { class: 'btn on', title: 'Make this version the current one (the newer one stays in history)', onclick: async () => {
          if (!confirm('Restore this version? The current state stays in the history too.')) return;
          const p = await fetchRevision(x.id, r.rev);
          if (!p) { toast('Could not load that version.'); return; }
          if (x.id !== session.id) await openProject(x.id, true);
          await saveNow({ checkpoint: true });
          await hooks.load(migrate(p));
          await saveNow({ checkpoint: true });
          close();
          toast('Version restored.');
        } }, 'Restore'))))),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Close')));
}

// ---------- Conflict ----------
export function showConflict() {
  modal(`<h2>Changed somewhere else</h2>
    <p>This project was saved from another tab or device after you opened it here. Which version do you want?</p>
    <div class="actions" style="flex-wrap:wrap">
      <button class="btn" id="cf-theirs">Load the other version</button>
      <button class="btn" id="cf-copy">Keep mine as a copy</button>
      <button class="btn on" id="cf-mine">Keep mine (overwrite)</button>
    </div>`,
  (box, close) => {
    for (const [id, choice] of [['cf-theirs', 'theirs'], ['cf-copy', 'copy'], ['cf-mine', 'mine']]) {
      box.querySelector('#' + id).addEventListener('click', async () => { close(); await resolveConflict(choice); });
    }
  });
  document.getElementById('modal').onclick = null; // must choose
}

