// store.js — single source of truth for the app.
//
// `base` = the data as it exists in the GitHub data repo (or the local cache
// of it). `cables`/`devices`/`setups` = the working copy shown in the UI.
// Every mutation is written to localStorage immediately (the "draft"), so
// nothing is lost when switching tabs or reloading. "Save" turns the diff
// between working copy and base into one git commit.
//
// Concurrency: the draft stores its fork point (commit sha + parsed snapshot).
// Before every save — and whenever the remote head moves — remote changes are
// three-way-merged into the draft with the fork as ancestor, so a save never
// reverts other people's commits.

import { GitHubClient, GHError } from './github.js';
import { DEMO_FILES } from './demo.js';
import {
  CABLES_PATH, DEVICES_PATH, SETUPS_PATH, DATA_PATHS, IMAGE_DIR,
  parseCables, serializeCables, parseDevices, serializeDevices,
  parseSetups, serializeSetups,
} from './data.js';
import { lsGet, lsSet, lsDel, clone, debounce, slugify, uid } from './util.js';

const SETTINGS_KEY = 'wv:settings';

function parseFiles(sha, files) {
  return {
    sha,
    files,
    cables: parseCables(files[CABLES_PATH]?.text || ''),
    devices: parseDevices(files[DEVICES_PATH]?.text || ''),
    setups: parseSetups(files[SETUPS_PATH]?.text || ''),
  };
}

// The three collections, described uniformly so merge/diff code can loop.
const COLLECTIONS = [
  {
    name: 'cables', path: CABLES_PATH, key: c => c.cable_id,
    fields: ['from_device', 'from_port', 'to_device', 'to_port', 'setup', 'comment'],
    serialize: serializeCables,
  },
  {
    name: 'devices', path: DEVICES_PATH, key: d => d.name,
    fields: ['description', 'role', 'x', 'y', 'comment', 'port_strings'],
    serialize: serializeDevices,
  },
  {
    name: 'setups', path: SETUPS_PATH, key: s => s.name,
    fields: ['description'],
    serialize: serializeSetups,
  },
];

const fieldEq = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
const recordEq = (col, a, b) => col.fields.every(f => fieldEq(a[f], b[f]));

export const store = {
  settings: { owner: '', repo: '', branch: 'main', token: '' },
  base: parseFiles(null, {}),
  cables: [],
  devices: [],
  setups: [],
  pendingImages: {},   // repo path -> data URL, committed on save
  _imgUrlCache: new Map(),
  demo: false,
  syncing: false,
  saving: false,
  lastError: null,
  lastSync: 0,
  _hasDraft: false,
  _draftBaseSha: null, // commit the draft forked from
  _fork: null,         // {cables, devices, setups} snapshot at that commit (merge ancestor)
  _subs: {},

  on(evt, fn) { (this._subs[evt] ||= []).push(fn); },
  emit(evt, data) {
    for (const fn of this._subs[evt] || []) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  },

  configured() { return !!(this.settings.owner && this.settings.repo); },
  client() { return new GitHubClient(this.settings); },
  repoKey() { return this.demo ? 'demo' : `${this.settings.owner}/${this.settings.repo}#${this.settings.branch}`; },
  key(name) { return `wv:${this.repoKey()}:${name}`; },

  // The working state object the mutation functions in data.js operate on.
  // They may replace the arrays (filter), so proxy get/set onto the store.
  state() {
    const s = this;
    return {
      get cables() { return s.cables; }, set cables(v) { s.cables = v; },
      get devices() { return s.devices; }, set devices(v) { s.devices = v; },
      get setups() { return s.setups; }, set setups(v) { s.setups = v; },
    };
  },

  // ----- settings -----

  loadSettings() {
    const s = lsGet(SETTINGS_KEY) || {};
    this.settings = { owner: '', repo: '', branch: 'main', token: '', ...s };
    // Sensible defaults when served from GitHub Pages: owner = subdomain,
    // data repo = "<app repo>-data".
    if (!this.settings.owner && location.hostname.endsWith('.github.io')) {
      this.settings.owner = location.hostname.split('.')[0];
      if (!this.settings.repo) {
        const seg = location.pathname.split('/').filter(Boolean)[0];
        if (seg) this.settings.repo = seg + '-data';
      }
    }
  },

  saveSettings(patch) {
    Object.assign(this.settings, patch);
    lsSet(SETTINGS_KEY, this.settings);
    this.emit('change', { source: 'settings' });
  },

  // ----- boot -----

  async init() {
    this.demo = new URLSearchParams(location.search).has('demo');
    this.loadSettings();

    if (this.demo) {
      const files = Object.fromEntries(Object.entries(DEMO_FILES).map(([p, text]) => [p, { sha: 'demo:' + p, text }]));
      this.base = parseFiles('demo', files);
    } else {
      const cache = lsGet(this.key('cache'));
      if (cache && cache.files) this.base = parseFiles(cache.sha, cache.files);
    }

    const draft = lsGet(this.key('draft'));
    if (draft && draft.cables) {
      this.cables = draft.cables;
      this.devices = draft.devices || [];
      this.setups = draft.setups || [];
      this.pendingImages = draft.pendingImages || {};
      this._draftBaseSha = draft.baseSha ?? null;
      this._fork = draft.fork || this._snapshot(this.base);
      this._hasDraft = true;
      // cache moved ahead of this draft (e.g. another tab synced) — merge now
      if (this._draftBaseSha !== this.base.sha) {
        const report = this._mergeIntoDraft(this.base);
        if (report.pulled || report.conflicts.length) this.emit('merged', report);
      }
    } else {
      this.resetToBase();
    }
    this.emit('change');
    if (!this.demo && this.configured()) this.refresh();
  },

  _snapshot(src) {
    return { cables: clone(src.cables), devices: clone(src.devices), setups: clone(src.setups) };
  },

  resetToBase() {
    this.cables = clone(this.base.cables);
    this.devices = clone(this.base.devices);
    this.setups = clone(this.base.setups);
    this.pendingImages = {};
    this._hasDraft = false;
    this._draftBaseSha = this.base.sha;
    this._fork = null;
  },

  // ----- draft persistence -----

  _persistDraft: null, // debounced, set up below

  _persistDraftNow() {
    const ok = lsSet(this.key('draft'), {
      baseSha: this._draftBaseSha,
      cables: this.cables,
      devices: this.devices,
      setups: this.setups,
      pendingImages: this.pendingImages,
      fork: this._fork,
      ts: Date.now(),
    });
    if (!ok) this.emit('error', new GHError('Could not store the draft in the browser (storage full?). Changes only live in this tab until you save.', 'storage'));
  },

  touch(source) {
    if (!this._hasDraft) {
      this._hasDraft = true;
      this._draftBaseSha = this.base.sha;
      this._fork = this._snapshot(this.base);
    }
    this._persistDraft();
    this.emit('change', { source });
  },

  // Run a mutation from data.js against the working copy; persists + notifies.
  mutate(fn) {
    const result = fn(this.state());
    this.touch();
    return result;
  },

  // ----- images -----

  // Register an image (data URL) for commit on the next save; returns its
  // repo path for linking in comments.
  addImage(name, dataUrl) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'png';
    const path = `${IMAGE_DIR}${slugify(dot > 0 ? name.slice(0, dot) : name) || 'img'}-${uid().slice(0, 4)}.${ext}`;
    this.pendingImages[path] = dataUrl;
    this.touch();
    return path;
  },

  // Resolve an image path from a comment to something an <img> can display.
  // Pending uploads render from their data URL; committed images in the
  // (private) data repo are fetched through the authenticated contents API.
  async imageUrl(path) {
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    const p = path.replace(/^\.\//, '');
    if (this.pendingImages[p]) return this.pendingImages[p];
    if (this.demo || !this.configured()) return null;
    const key = `${this.repoKey()}:${p}`;
    if (!this._imgUrlCache.has(key)) {
      try {
        this._imgUrlCache.set(key, await this.client().getFileBlobUrl(p));
      } catch {
        return null;
      }
    }
    return this._imgUrlCache.get(key);
  },

  // ----- diff -----

  // List of file-level changes between working copy and base.
  changes() {
    const list = [];
    for (const col of COLLECTIONS) {
      const text = col.serialize(this[col.name]);
      const baseFile = this.base.files[col.path];
      if (!baseFile) {
        // file doesn't exist in the repo yet — create it only once there is content
        if (this[col.name].length) list.push({ path: col.path, text });
      } else if (col.serialize(this.base[col.name]) !== text) {
        list.push({ path: col.path, text });
      }
    }
    for (const [path, dataUrl] of Object.entries(this.pendingImages)) {
      list.push({ path, base64: String(dataUrl).split(',')[1] || '' });
    }
    return list;
  },

  isDirty() { return this.changes().length > 0; },

  _commitMessage() {
    const parts = [];
    for (const col of COLLECTIONS) {
      const baseBy = new Map(this.base[col.name].map(r => [col.key(r), r]));
      const workBy = new Map(this[col.name].map(r => [col.key(r), r]));
      let add = 0, upd = 0, del = 0;
      for (const [k, r] of workBy) {
        const b = baseBy.get(k);
        if (!b) add++;
        else if (!recordEq(col, r, b)) upd++;
      }
      for (const k of baseBy.keys()) if (!workBy.has(k)) del++;
      const bits = [];
      if (add) bits.push(`+${add}`);
      if (upd) bits.push(`~${upd}`);
      if (del) bits.push(`-${del}`);
      if (bits.length) parts.push(`${col.name} ${bits.join(' ')}`);
    }
    const nImg = Object.keys(this.pendingImages).length;
    if (nImg) parts.push(`images +${nImg}`);
    return `wirevizard: ${parts.join(', ') || 'update'}`;
  },

  // ----- remote sync -----

  async _fetchBase(gh, head) {
    const tree = await gh.getTree(head.treeSha);
    const wanted = tree.filter(f => f.type === 'blob' && DATA_PATHS.includes(f.path));
    const files = {};
    for (const f of wanted) {
      const prev = this.base.files[f.path];
      files[f.path] = prev && prev.sha === f.sha
        ? prev
        : { sha: f.sha, text: this.settings.token ? await gh.getBlobText(f.sha) : await gh.getRawText(head.sha, f.path) };
    }
    return parseFiles(head.sha, files);
  },

  _setBase(newBase) {
    this.base = newBase;
    lsSet(this.key('cache'), { sha: newBase.sha, files: newBase.files });
  },

  // Three-way merge of remote changes (newBase) into the local draft, with the
  // draft's fork point as common ancestor. Records merge per field; when both
  // sides changed the same field, the local value wins and the conflict is
  // reported (the losing value is still in git history). Returns
  // { pulled, conflicts }.
  _mergeIntoDraft(newBase) {
    const fork = this._fork || this._snapshot(this.base);
    const report = { pulled: 0, conflicts: [] };

    for (const col of COLLECTIONS) {
      const forkBy = new Map(fork[col.name].map(r => [col.key(r), r]));
      const localBy = new Map(this[col.name].map(r => [col.key(r), r]));
      const remoteBy = new Map(newBase[col.name].map(r => [col.key(r), r]));
      const keys = new Set([...forkBy.keys(), ...localBy.keys(), ...remoteBy.keys()]);

      const merged = new Map();
      for (const k of keys) {
        const f = forkBy.get(k) || null;
        const l = localBy.get(k) || null;
        const r = remoteBy.get(k) || null;
        const label = `${col.name.slice(0, -1)} "${k}"`;
        if (l && r) {
          const out = { ...l };
          let pulled = false;
          for (const field of col.fields) {
            if (fieldEq(l[field], r[field])) continue;
            if (f && fieldEq(l[field], f[field])) { out[field] = clone(r[field]); pulled = true; } // only remote changed
            else if (f && fieldEq(r[field], f[field])) { /* only local changed — keep */ }
            else report.conflicts.push(`${label}: ${field}`);                                      // both changed — local wins
          }
          if (pulled) report.pulled++;
          merged.set(k, out);
        } else if (l && !r) {
          if (!f) merged.set(k, l);                              // created here — keep
          else if (recordEq(col, l, f)) report.pulled++;         // deleted remotely, untouched here — accept
          else {
            merged.set(k, l);
            report.conflicts.push(`${label}: deleted remotely but edited here — kept`);
          }
        } else if (!l && r) {
          if (!f) { merged.set(k, clone(r)); report.pulled++; }  // created remotely — adopt
          else if (recordEq(col, r, f)) { /* deleted here, unchanged remotely — stays deleted */ }
          else {
            merged.set(k, clone(r));
            report.conflicts.push(`${label}: deleted here but edited remotely — restored`);
          }
        }
      }

      // Order: remote order for surviving records, then local-only additions —
      // so an unchanged merge serializes identically to the new base.
      const out = [];
      for (const r of newBase[col.name]) {
        const k = col.key(r);
        if (merged.has(k)) { out.push(merged.get(k)); merged.delete(k); }
      }
      for (const l of this[col.name]) {
        const k = col.key(l);
        if (merged.has(k)) { out.push(merged.get(k)); merged.delete(k); }
      }
      this[col.name] = out;
    }

    this._setBase(newBase);
    this._draftBaseSha = newBase.sha;
    this._fork = this._snapshot(newBase);
    if (!this.changes().length) {
      lsDel(this.key('draft'));
      this.resetToBase();
    } else {
      this._persistDraftNow();
    }
    this.emit('change', { source: 'merge' });
    return report;
  },

  async refresh() {
    if (this.demo || !this.configured() || this.syncing) return;
    this.syncing = true;
    this.lastError = null;
    this.emit('change', { source: 'sync' });
    try {
      const gh = this.client();
      const head = await gh.getHead();
      if (!head) {
        // repo exists but the branch has no commits yet
        this.base = parseFiles(null, {});
        lsDel(this.key('cache'));
        if (!this._hasDraft) this.resetToBase();
      } else if (head.sha !== this.base.sha) {
        const newBase = await this._fetchBase(gh, head);
        if (this._hasDraft) {
          const report = this._mergeIntoDraft(newBase);
          if (report.pulled || report.conflicts.length) this.emit('merged', report);
        } else {
          this._setBase(newBase);
          this.resetToBase();
        }
      }
      this.lastSync = Date.now();
    } catch (e) {
      this.lastError = e;
      this.emit('error', e);
    } finally {
      this.syncing = false;
      this.emit('change', { source: 'sync' });
    }
  },

  // Another tab of this browser wrote a newer draft/cache to localStorage —
  // adopt it (callers only do this while the tab is hidden, so we never
  // clobber typing in progress).
  adoptExternal() {
    if (this.saving || this.syncing) return;
    const cache = this.demo ? null : lsGet(this.key('cache'));
    if (cache && cache.files && cache.sha !== this.base.sha) {
      this.base = parseFiles(cache.sha, cache.files);
    }
    const draft = lsGet(this.key('draft'));
    if (draft && draft.cables) {
      this.cables = draft.cables;
      this.devices = draft.devices || [];
      this.setups = draft.setups || [];
      this.pendingImages = draft.pendingImages || {};
      this._draftBaseSha = draft.baseSha ?? null;
      this._fork = draft.fork || this._snapshot(this.base);
      this._hasDraft = true;
    } else {
      this.resetToBase();
    }
    this.emit('change', { source: 'external' });
  },

  // ----- save -----

  // Save = pull + merge + commit. Remote commits made since the draft forked
  // are merged in first, so a save never reverts other people's work; if
  // someone pushes in the tiny window between our pull and our ref update,
  // GitHub rejects the fast-forward and we pull/merge/retry once.
  async save() {
    if (this.demo) throw new GHError('Demo mode: open Settings and configure your own repository to save.', 'demo');
    if (!this.configured()) throw new GHError('Configure the GitHub data repository in Settings first.', 'config');
    if (!this.settings.token) throw new GHError('Add a GitHub token in Settings to be able to save.', 'no-token');
    if (!this.changes().length) return { nothing: true };

    this.saving = true;
    this.emit('change', { source: 'save' });
    try {
      const gh = this.client();
      const pullMerge = async () => {
        const head = await gh.getHead();
        if (head && head.sha !== this._draftBaseSha) {
          const report = this._mergeIntoDraft(await this._fetchBase(gh, head));
          if (report.pulled || report.conflicts.length) this.emit('merged', report);
        }
        return head;
      };

      let head = await pullMerge();
      let changes = this.changes();
      if (!changes.length) return { nothing: true }; // remote already contained our edits

      let res;
      try {
        res = await gh.commitFiles({ message: this._commitMessage(), parent: head, changes });
      } catch (e) {
        if (e.code !== 'conflict') throw e;
        head = await pullMerge();
        changes = this.changes();
        if (!changes.length) return { nothing: true };
        res = await gh.commitFiles({ message: this._commitMessage(), parent: head, changes });
      }

      const files = { ...this.base.files };
      for (const c of changes) {
        if (c.delete) delete files[c.path];
        else if (c.text != null) files[c.path] = { sha: 'local:' + res.sha, text: c.text };
      }
      this.base = parseFiles(res.sha, files);
      this.pendingImages = {};
      this._hasDraft = false;
      this._draftBaseSha = res.sha;
      this._fork = null;
      lsSet(this.key('cache'), { sha: res.sha, files });
      lsDel(this.key('draft'));
      return { sha: res.sha, count: changes.length };
    } finally {
      this.saving = false;
      this.emit('change', { source: 'save' });
    }
  },

  discardDraft() {
    lsDel(this.key('draft'));
    this.resetToBase();
    this.emit('change');
  },
};

store._persistDraft = debounce(() => store._persistDraftNow(), 250);
