// settings.js — modal with the GitHub connection (data repo + token), real
// read/write probes, the share link, and draft management. All connection
// settings live in this browser's localStorage; the token is the login.

import { store } from './store.js';
import { toast } from './ui.js';
import { b64EncodeUtf8, debounce } from './util.js';

let scrim, modal;
const $ = sel => modal.querySelector(sel);

export function initSettings() {
  scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.hidden = true;

  modal = document.createElement('div');
  modal.className = 'modal settings';
  modal.hidden = true;
  modal.innerHTML = `
    <header class="modal-head">
      <h2>Settings</h2>
      <button class="icon-btn s-close" title="Close">✕</button>
    </header>
    <div class="modal-body">

      <section>
        <h3>GitHub data repository</h3>
        <p class="hint">The cabling data (three CSV files) lives in its own — typically private — GitHub
        repository. This app reads and writes it directly through the GitHub API; every save is one commit.</p>
        <div class="field-grid">
          <label class="field"><span class="field-name">Owner</span><input class="s-owner" placeholder="user or org" autocapitalize="off"></label>
          <label class="field"><span class="field-name">Repository</span><input class="s-repo" placeholder="wirevizard-data" autocapitalize="off"></label>
          <label class="field"><span class="field-name">Branch</span><input class="s-branch" placeholder="main" autocapitalize="off"></label>
        </div>
        <label class="field">
          <span class="field-name">Token (fine-grained PAT with read/write access to this repository's contents)</span>
          <span class="token-row">
            <input class="s-token" type="password" placeholder="github_pat_…" autocomplete="off">
            <button class="mini-btn s-showtoken" title="Show/hide">👁</button>
          </span>
        </label>
        <p class="hint">Create one at github.com → Settings → Developer settings → Fine-grained tokens:
        Repository access = only the data repository, Permissions → Contents: Read and write.
        The token stays in this browser; it is needed to save (and to read private repositories).</p>
        <div class="btn-row">
          <button class="btn s-test">Test connection</button>
          <button class="btn s-reload">Reload data from GitHub</button>
        </div>
        <p class="s-testresult hint"></p>
      </section>

      <section>
        <h3>Share link</h3>
        <p class="hint">Copies a link to this page with the repository settings <b>and your token</b> embedded.
        Opening it stores the token in that browser. Anyone with the link can write to your data repo — share it
        only with people you'd hand your token to, and never post it publicly.</p>
        <button class="btn s-copylink">Copy link with token</button>
      </section>

      <section>
        <h3>Local data</h3>
        <p class="hint s-draftinfo"></p>
        <div class="btn-row">
          <button class="btn danger s-discard">Discard unsaved changes</button>
        </div>
      </section>

    </div>`;

  document.body.appendChild(scrim);
  document.body.appendChild(modal);

  scrim.addEventListener('pointerdown', closeSettings);
  $('.s-close').addEventListener('click', closeSettings);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) closeSettings();
  });

  const saveConn = debounce(() => {
    store.saveSettings({
      owner: $('.s-owner').value.trim(),
      repo: $('.s-repo').value.trim(),
      branch: $('.s-branch').value.trim() || 'main',
      token: $('.s-token').value.trim(),
    });
  }, 300);
  for (const sel of ['.s-owner', '.s-repo', '.s-branch', '.s-token']) {
    $(sel).addEventListener('input', saveConn);
  }

  $('.s-showtoken').addEventListener('click', () => {
    const t = $('.s-token');
    t.type = t.type === 'password' ? 'text' : 'password';
  });

  $('.s-test').addEventListener('click', async () => {
    const out = $('.s-testresult');
    out.textContent = 'Testing…';
    try {
      const gh = store.client();
      const repo = await gh.getRepo();
      let msg = `✓ Found ${repo.full_name} (${repo.private ? 'private' : 'public'}, default branch ${repo.default_branch})`;
      if (store.settings.token) {
        // probe the real permissions: fine-grained tokens can pass the repo
        // lookup (public repos, or user-level permissions) yet still be unable
        // to read or write the contents.
        let read = false;
        try { await gh.getHead(); read = true; } catch { }
        let write;
        try {
          // an unreferenced blob is invisible and gets garbage-collected
          await gh.req(`${gh.base()}/git/blobs`, { method: 'POST', body: { content: 'wirevizard permission check', encoding: 'utf-8' } });
          write = true;
        } catch (e) {
          write = !(e.status === 403 || e.code === 'auth');
        }
        msg += ` — token: read ${read ? '✓' : '✗'}, write ${write ? '✓' : '✗'}.`;
        if (!read || !write) msg += ' The token must be scoped to exactly this repository with Contents: Read and write.';
      } else {
        msg += repo.private ? ' — ⚠ private repository: a token is required.' : ' — no token: read-only, saving is disabled.';
      }
      out.textContent = msg;
    } catch (e) {
      out.textContent = '✗ ' + (e.message || e);
    }
  });

  $('.s-reload').addEventListener('click', async () => {
    await store.refresh();
    toast(store.lastError ? 'Reload failed: ' + store.lastError.message : 'Data reloaded from GitHub.', store.lastError ? 'err' : 'ok');
  });

  $('.s-copylink').addEventListener('click', async () => {
    const { owner, repo, branch, token } = store.settings;
    if (!token) { toast('Add a token first.', 'err'); return; }
    const payload = b64EncodeUtf8(JSON.stringify({ owner, repo, branch, token }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = `${location.origin}${location.pathname}#setup=${payload}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. Treat it like the token itself!', 'ok');
    } catch {
      prompt('Copy this link:', url);
    }
  });

  $('.s-discard').addEventListener('click', () => {
    const n = store.changes().length;
    if (!n) { toast('No unsaved changes.', 'info'); return; }
    if (confirm(`Throw away your unsaved changes and go back to the last saved state?`)) {
      store.discardDraft();
      toast('Local changes discarded.', 'ok');
    }
  });
}

export function openSettings() {
  renderAll();
  scrim.hidden = false;
  modal.hidden = false;
}

export function closeSettings() {
  scrim.hidden = true;
  modal.hidden = true;
}

function renderAll() {
  $('.s-owner').value = store.settings.owner;
  $('.s-repo').value = store.settings.repo;
  $('.s-branch').value = store.settings.branch;
  $('.s-token').value = store.settings.token;
  $('.s-testresult').textContent = '';
  const n = store.changes().length;
  $('.s-draftinfo').textContent = store.demo
    ? 'Demo mode: data lives only in this browser until you configure a repository.'
    : n
      ? `${n} changed file(s) are stored in this browser and survive reloads. "Save" commits them to GitHub.`
      : 'Everything is saved. Local edits are kept in this browser until you press Save.';
}
