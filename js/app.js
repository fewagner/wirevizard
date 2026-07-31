// app.js — boot, tabs, save button, sync banner, share-link import, and all
// tab rendering. Ported from the original local-server GUI: every former
// server endpoint is now a store mutation; edits accumulate in the local
// draft and "Save" commits them to the GitHub data repo in one commit.

import { store } from './store.js';
import { initSettings, openSettings } from './settings.js';
import { initDetails, openDetails, detailsBtnHtml, wireDetailsButtons } from './details.js';
import { renderAllDiagram, renderQueryDiagram, isDiagramDragging } from './diagram.js';
import { toast } from './ui.js';
import { esc, b64DecodeUtf8, lsGet, lsSet } from './util.js';
import {
  deviceView, nextCableId, validate, computeSignalPaths, compileWiringTables, CHIP_ROLE,
  addCable, deleteCable, updateCable,
  addDevice, renameDevice, updateDeviceDescription, setDeviceRole,
  updatePort, addPortToDevice, deletePortFromDevice, deleteDevice,
  addSetup, renameSetup, updateSetupDescription, deleteSetup,
} from './data.js';

let selectedDevice = null;
let selectedSetup = null;
let selectedSignalSetup = null;
let selectedWiringSetup = null;
let currentTab = 'query';
let allView = 'table';     // "All cables" sub-tab: table | diagram
let queryView = 'table';   // "Query device" sub-tab: table | diagram

const CABLES = () => store.cables;
const DEVICES = () => store.devices.map(deviceView);
const SETUPS = () => store.setups;

// Run a mutation; on error flash the message into the given flash element.
function tryMutate(fn, flashId) {
  try {
    return { ok: true, value: store.mutate(fn) };
  } catch (e) {
    if (flashId) flash('Error: ' + e.message, false, flashId);
    else toast(e.message, 'err');
    return { ok: false };
  }
}

// ── Flash ──────────────────────────────────────────────────────────────────────

function flash(msg, ok, elId) {
  const el = document.getElementById(elId || 'flash');
  el.textContent = msg;
  el.className = 'flash ' + (ok ? 'ok' : 'err');
  setTimeout(() => { el.textContent = ''; el.className = 'flash'; }, 4000);
}

// ── Share-link import (#setup=…) — before the store boots ──────────────────────

function importSetupHash() {
  const m = location.hash.match(/[#&]setup=([A-Za-z0-9\-_]+)/);
  if (!m) return;
  try {
    const json = JSON.parse(b64DecodeUtf8(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    const prev = lsGet('wv:settings') || {};
    const next = { ...prev };
    for (const k of ['owner', 'repo', 'branch', 'token']) {
      if (typeof json[k] === 'string' && json[k]) next[k] = json[k];
    }
    lsSet('wv:settings', next);
    setTimeout(() => toast(`GitHub settings for ${next.owner}/${next.repo} imported from the link.`, 'ok'), 300);
  } catch {
    setTimeout(() => toast('The setup link could not be read.', 'err'), 300);
  }
  history.replaceState(null, '', location.pathname + location.search);
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

const TAB_NAMES = ['query', 'setup', 'signal-paths', 'wiring', 'all', 'all-devices', 'all-setups', 'add', 'add-device', 'add-setup', 'validate'];

function setTab(t) {
  currentTab = t;
  TAB_NAMES.forEach(n => {
    document.getElementById('tab-' + n).style.display = n === t ? '' : 'none';
  });
  document.querySelectorAll('#tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  if (t === 'add') initCableForm();
  if (t === 'add-device') initRoleDatalist();
  renderTab(t);
}

function renderTab(t) {
  if (t === 'query') { renderDeviceChips(); renderDeviceQuery(); }
  if (t === 'setup') { renderSetupChips(); renderSetupQuery(); }
  if (t === 'all') renderAll();
  if (t === 'validate') renderValidate();
  if (t === 'all-devices') renderAllDevices();
  if (t === 'all-setups') renderAllSetups();
  if (t === 'signal-paths') renderSignalPaths();
  if (t === 'wiring') renderWiring();
}

function initRoleDatalist() {
  const roles = [...new Set(store.devices.map(d => (d.role || '').trim()).filter(Boolean))].sort();
  if (!roles.some(r => r.toLowerCase() === CHIP_ROLE)) roles.unshift('Chip');
  document.getElementById('role-datalist').innerHTML =
    roles.map(r => `<option value="${esc(r)}"></option>`).join('');
}

// Re-render everything visible after data changed — but never yank the DOM out
// from under an in-progress inline edit, drag, or half-filled diagram form.
function renderCurrent() {
  if (isDiagramDragging()) return;
  if (document.querySelector('.container input.inline-input, .container td.editable input')) return;
  if (document.querySelector('#wiring-result select, #wiring-result input')) return;
  const act = document.activeElement;
  if (act && act.closest && act.closest('.dg-form')) return;
  renderTab(currentTab);
}

// ── Top bar / banner ───────────────────────────────────────────────────────────

function updateChrome() {
  const saveBtn = document.getElementById('save-btn');
  const n = store.changes().length;
  if (store.saving) {
    saveBtn.textContent = 'Saving…';
    saveBtn.disabled = true;
  } else {
    saveBtn.textContent = n ? `Save (${n})` : 'Save';
    saveBtn.disabled = n === 0;
  }
  saveBtn.classList.toggle('attention', n > 0 && !store.saving);

  const label = document.getElementById('repo-label');
  if (store.demo) {
    label.textContent = 'demo data';
    label.title = 'Demo mode — nothing is written to GitHub';
  } else if (store.configured()) {
    label.textContent = `${store.settings.owner}/${store.settings.repo}` + (store.syncing ? ' ⟳' : '');
    label.title = `Branch ${store.settings.branch}`;
  } else {
    label.textContent = 'not connected';
    label.title = 'Open settings to connect a GitHub data repository';
  }
  updateBanner();
}

function updateBanner() {
  const banner = document.getElementById('banner');
  const needsToken = !store.demo && store.configured() && !store.settings.token
    && store.lastError && ['not-found', 'auth', 'raw', 'forbidden'].includes(store.lastError.code);
  if (!store.demo && !store.configured()) {
    banner.hidden = false;
    banner.innerHTML = `
      <span>Not connected to GitHub — changes stay in this browser.</span>
      <button class="btn b-settings">Open settings</button>
      <a class="btn" href="?demo=1">Try the demo</a>`;
    banner.querySelector('.b-settings').addEventListener('click', openSettings);
  } else if (needsToken) {
    banner.hidden = false;
    banner.innerHTML = `
      <span>The cabling data lives in a private repository — a GitHub token is needed to read it.</span>
      <button class="btn b-settings">Open settings</button>`;
    banner.querySelector('.b-settings').addEventListener('click', openSettings);
  } else {
    banner.hidden = true;
    banner.innerHTML = '';
  }
}

// ── Save ───────────────────────────────────────────────────────────────────────

async function doSave() {
  try {
    const r = await store.save();
    toast(r.nothing ? 'Nothing to save — the repository is already up to date.' : `Saved to GitHub ✓ (commit ${r.sha.slice(0, 7)})`, 'ok');
  } catch (e) {
    if (e.code === 'no-token' || e.code === 'config' || e.code === 'demo') {
      toast(e.message, 'err');
      openSettings();
    } else if (e.code === 'conflict') {
      toast('GitHub kept rejecting the commit (very busy branch?). Try saving again.', 'err');
    } else {
      toast(e.message || 'Save failed.', 'err');
    }
  }
}

// ── Query device ───────────────────────────────────────────────────────────────

function renderDeviceChips() {
  const names = [...new Set(CABLES().flatMap(c => [c.from_device, c.to_device]))].filter(Boolean).sort();
  document.getElementById('device-chips').innerHTML =
    names.length
      ? names.map(d => `<span class="chip${selectedDevice === d ? ' sel' : ''}" data-dev="${esc(d)}">${esc(d)}</span>`).join('')
      : '<span style="color:var(--text3);font-size:12px">No cables yet.</span>';
}

function renderDeviceQuery() {
  const el = document.getElementById('query-result');
  const dg = document.getElementById('query-diagram');
  el.style.display = queryView === 'table' ? '' : 'none';
  dg.style.display = queryView === 'diagram' ? '' : 'none';
  if (!selectedDevice) {
    el.innerHTML = '<div class="empty">Select a device above to see its cables</div>';
    dg.innerHTML = '<div class="empty">Select a device above to see its diagram</div>';
    return;
  }
  if (queryView === 'diagram') {
    renderQueryDiagram(dg, selectedDevice);
    return;
  }
  const matches = CABLES().filter(c => c.from_device === selectedDevice || c.to_device === selectedDevice);
  if (!matches.length) { el.innerHTML = '<div class="empty">No cables found for this device</div>'; return; }
  const rows = matches.map(c => {
    const out = c.from_device === selectedDevice;
    const dir = out ? '<span class="dir dir-out">→</span>' : '<span class="dir dir-in">←</span>';
    return `<tr>
      <td><code>${esc(c.cable_id)}</code></td>
      <td>${dir}</td>
      <td><code>${esc(out ? c.from_port : c.to_port)}</code></td>
      <td><strong>${esc(out ? c.to_device : c.from_device)}</strong></td>
      <td><code>${esc(out ? c.to_port : c.from_port)}</code></td>
      <td style="color:var(--text2)">${esc(c.setup)}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<div class="card" style="overflow-x:auto">
    <div style="font-size:13px;font-weight:500;margin-bottom:10px">
      ${esc(selectedDevice)}
      <span style="color:var(--text2);font-weight:400"> — ${matches.length} cable(s)</span>
    </div>
    <table>
      <thead><tr>
        <th>Cable</th><th>Dir</th><th>Local port</th>
        <th>Remote device</th><th>Remote port</th><th>Setup</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ── Query setup ────────────────────────────────────────────────────────────────

function renderSetupChips() {
  const setups = SETUPS();
  document.getElementById('setup-chips').innerHTML =
    setups.length
      ? setups.map(s => `<span class="chip${selectedSetup === s.name ? ' sel' : ''}" data-setup="${esc(s.name)}">${esc(s.name)}</span>`).join('')
      : '<span style="color:var(--text3);font-size:12px">No setups defined yet — use "+ Add setup".</span>';
}

function renderSetupQuery() {
  const el = document.getElementById('setup-result');
  if (!selectedSetup) {
    el.innerHTML = '<div class="empty">Select a setup above to see its cables</div>';
    return;
  }
  const matches = CABLES().filter(c => c.setup === selectedSetup);
  if (!matches.length) { el.innerHTML = '<div class="empty">No cables assigned to this setup</div>'; return; }
  const rows = matches.map(c => `<tr>
    <td><code>${esc(c.cable_id)}</code></td>
    <td>${esc(c.from_device)}</td><td><code>${esc(c.from_port)}</code></td>
    <td>${esc(c.to_device)}</td><td><code>${esc(c.to_port)}</code></td>
  </tr>`).join('');
  el.innerHTML = `<div class="card" style="overflow-x:auto">
    <div style="font-size:13px;font-weight:500;margin-bottom:10px">
      ${esc(selectedSetup)}
      <span style="color:var(--text2);font-weight:400"> — ${matches.length} cable(s)</span>
    </div>
    <table>
      <thead><tr>
        <th>Cable</th><th>From device</th><th>From port</th>
        <th>To device</th><th>To port</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ── All cables ─────────────────────────────────────────────────────────────────

function renderAll() {
  document.getElementById('all-table').style.display = allView === 'table' ? '' : 'none';
  document.getElementById('all-diagram').style.display = allView === 'diagram' ? '' : 'none';
  if (allView === 'diagram') {
    renderAllDiagram(document.getElementById('all-diagram'));
    return;
  }

  // Don't re-render while a cell edit is in progress
  if (document.querySelector('#all-tbody input')) return;

  const q = (document.getElementById('search').value || '').toLowerCase();
  const filtered = CABLES().filter(c => !q || Object.values(c).some(v => (v || '').toLowerCase().includes(q)));

  function editCell(cid, field, val, mono) {
    const inner = mono ? `<code>${esc(val)}</code>` : esc(val);
    return `<td class="editable" data-cable-id="${esc(cid)}" data-field="${field}">${inner}</td>`;
  }

  document.getElementById('all-tbody').innerHTML = filtered.map(c =>
    `<tr>
      <td><code>${esc(c.cable_id)}</code></td>
      ${editCell(c.cable_id, 'from_device', c.from_device, false)}
      ${editCell(c.cable_id, 'from_port', c.from_port, true)}
      ${editCell(c.cable_id, 'to_device', c.to_device, false)}
      ${editCell(c.cable_id, 'to_port', c.to_port, true)}
      ${editCell(c.cable_id, 'setup', c.setup, false)}
      <td style="width:64px;padding:4px 6px;white-space:nowrap">
        ${detailsBtnHtml('cable', c.cable_id, c.comment)}
        <button class="del-btn" data-cable-id="${esc(c.cable_id)}" title="Delete cable">×</button>
      </td>
    </tr>`
  ).join('') || '<tr><td colspan="7" class="empty">No matches</td></tr>';

  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="stat-label">Total cables</div><div class="stat-val">${CABLES().length}</div></div>
    <div class="stat"><div class="stat-label">Devices</div><div class="stat-val">${store.devices.length}</div></div>
    <div class="stat"><div class="stat-label">Setups</div><div class="stat-val">${SETUPS().length}</div></div>
    <div class="stat"><div class="stat-label">Unassigned</div><div class="stat-val">${CABLES().filter(c => !c.setup).length}</div></div>
  `;
}

// ── Inline editing (All cables) ────────────────────────────────────────────────

function startEdit(td) {
  if (td.querySelector('input')) return;  // already editing

  const original = td.textContent.trim();
  const cableId = td.dataset.cableId;
  const field = td.dataset.field;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = original;

  // Attach datalist for device/setup fields
  let dlId = null;
  if (field === 'from_device' || field === 'to_device') {
    dlId = 'edit-dl-' + Date.now();
    const dl = document.createElement('datalist');
    dl.id = dlId;
    DEVICES().forEach(d => { const o = document.createElement('option'); o.value = d.name; dl.appendChild(o); });
    document.body.appendChild(dl);
    input.setAttribute('list', dlId);
  } else if (field === 'setup') {
    dlId = 'edit-dl-' + Date.now();
    const dl = document.createElement('datalist');
    dl.id = dlId;
    SETUPS().forEach(s => { const o = document.createElement('option'); o.value = s.name; dl.appendChild(o); });
    document.body.appendChild(dl);
    input.setAttribute('list', dlId);
  }

  td.textContent = '';
  td.appendChild(input);
  input.focus();
  input.select();

  function cleanup() { if (dlId) document.getElementById(dlId)?.remove(); }

  function commit() {
    cleanup();
    const newVal = input.value.trim();
    input.remove();
    if (newVal === original) { renderAll(); return; }
    const r = tryMutate(s => updateCable(s, cableId, field, newVal));
    renderAll();
    if (!r.ok) flash('Edit failed — see message above.', false);
  }

  function cancel() { cleanup(); input.remove(); renderAll(); }

  let done = false;
  function onBlur() { if (!done) { done = true; commit(); } }
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!done) { done = true; input.removeEventListener('blur', onBlur); commit(); }
    }
    if (e.key === 'Escape') {
      if (!done) { done = true; input.removeEventListener('blur', onBlur); cancel(); }
    }
  });
}

// ── Validate ───────────────────────────────────────────────────────────────────

function renderValidate() {
  const { errors, warnings, portConflicts } = validate(CABLES(), store.devices, SETUPS());
  const nWarn = warnings.length + portConflicts.length;
  let html = '';
  if (!errors.length && !nWarn) {
    html = `<div class="card ok-card">
      <div class="ok-title">✓ All ${CABLES().length} cables valid</div>
      <div style="font-size:12px;color:var(--text2)">No errors or conflicts detected.</div>
    </div>`;
  } else {
    if (errors.length) html += `<div class="card err-card">
      <div class="err-title">✗ ${errors.length} error(s)</div>
      ${errors.map(e => `<div class="vrow">${esc(e)}</div>`).join('')}
    </div>`;
    if (nWarn) {
      const conflictHtml = portConflicts.map(pc => `
        <div class="vrow">
          <div>Port conflict: <strong>${esc(pc.dev)}</strong> <code>[${esc(pc.port)}]</code> is used by ${pc.entries.length} cables:${pc.duplicate
            ? ' <span class="v-dup">two cables connect the same two ports — likely a duplicate entry</span>' : ''}</div>
          ${pc.entries.map(e => `
            <div class="v-detail">
              <a class="v-cable" data-v-cable="${esc(e.cable_id)}"><code>${esc(e.cable_id)}</code></a>
              → ${esc(e.farDev)} <code>[${esc(e.farPort)}]</code>
              ${e.setup ? `<span style="color:var(--text3)"> · ${esc(e.setup)}</span>` : ''}
            </div>`).join('')}
        </div>`).join('');
      html += `<div class="card warn-card">
        <div class="warn-title">⚠ ${nWarn} warning(s)</div>
        ${warnings.map(w => `<div class="vrow">${esc(w)}</div>`).join('')}
        ${conflictHtml}
      </div>`;
    }
  }
  document.getElementById('validate-out').innerHTML = html;
}

// ── Add cable ──────────────────────────────────────────────────────────────────

// The form keeps its values across tab switches and after adding a cable, so
// checking another tab mid-entry (or adding several similar cables) never
// means starting over. Rebuilds preserve the current selection when possible.
function rebuildPortInput(side, keepValue = true) {
  const devSel = document.getElementById(`f-${side}-dev`);
  const wrap = document.getElementById(`f-${side}-port-wrap`);
  const prev = keepValue ? (document.getElementById(`f-${side}-port`)?.value ?? '') : '';
  const devName = devSel ? devSel.value : '';
  const device = DEVICES().find(d => d.name === devName);
  wrap.innerHTML = '';
  if (device && device.ports.length > 0) {
    const sel = document.createElement('select');
    sel.id = `f-${side}-port`;
    device.ports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      sel.appendChild(opt);
    });
    if (device.ports.includes(prev)) sel.value = prev;
    wrap.appendChild(sel);
  } else {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.id = `f-${side}-port`;
    inp.placeholder = side === 'from' ? 'e.g. 1 out, eth0' : 'e.g. A2, port-06';
    inp.value = prev;
    wrap.appendChild(inp);
  }
}

function initCableForm() {
  const keep = sel => {
    const el = document.getElementById(sel);
    const prev = el.value;
    return () => { if ([...el.options].some(o => o.value === prev)) el.value = prev; };
  };
  const restoreFrom = keep('f-from-dev'), restoreTo = keep('f-to-dev'), restoreSetup = keep('f-setup');
  const devOpts = DEVICES().map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('');
  document.getElementById('f-from-dev').innerHTML = devOpts;
  document.getElementById('f-to-dev').innerHTML = devOpts;
  document.getElementById('f-setup').innerHTML =
    `<option value=""></option>` +
    SETUPS().map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
  restoreFrom(); restoreTo(); restoreSetup();
  rebuildPortInput('from');
  rebuildPortInput('to');
  const f = document.getElementById('f-id');
  f.placeholder = nextCableId(CABLES());
}

function clearCableForm() {
  document.getElementById('f-id').value = '';
  document.getElementById('flash').textContent = '';
  initCableForm();  // repopulates and rebuilds port inputs
}

function submitCable() {
  const get = id => document.getElementById(id).value.trim();
  const required = [['f-from-dev', 'From device'], ['f-from-port', 'From port'],
                    ['f-to-dev', 'To device'], ['f-to-port', 'To port']];
  for (const [id, label] of required) {
    if (!get(id)) { flash(`"${label}" is required.`, false); document.getElementById(id).focus(); return; }
  }
  const r = tryMutate(s => addCable(s, {
    cable_id: get('f-id'),
    from_device: get('f-from-dev'), from_port: get('f-from-port'),
    to_device: get('f-to-dev'), to_port: get('f-to-port'),
    setup: get('f-setup'),
  }), 'flash');
  if (r.ok) {
    flash(`✓ Cable ${r.value} added — press Save to commit.`, true);
    // keep all field values for the next (likely similar) cable; only clear a
    // manually-typed id, which would now collide
    document.getElementById('f-id').value = '';
    document.getElementById('f-id').placeholder = nextCableId(CABLES());
  }
}

// ── Add device ─────────────────────────────────────────────────────────────────

function addPortEntry(portStr) {
  const list = document.getElementById('d-port-list');
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;align-items:center';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'e.g. A1 or A2 (A1)';
  inp.value = portStr || '';
  inp.style.cssText = 'margin-bottom:0;flex:1';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'del-btn';
  btn.title = 'Remove port';
  btn.textContent = '×';
  btn.onclick = () => div.remove();
  div.appendChild(inp);
  div.appendChild(btn);
  list.appendChild(div);
}

function getPortStrings() {
  return Array.from(document.querySelectorAll('#d-port-list input'))
    .map(i => i.value.trim()).filter(Boolean);
}

function clearDeviceForm() {
  ['d-name', 'd-desc', 'd-role'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('d-port-list').innerHTML = '';
  document.getElementById('flash-device').textContent = '';
}

function submitDevice() {
  const name = document.getElementById('d-name').value.trim();
  if (!name) { flash('Name is required.', false, 'flash-device'); return; }
  const r = tryMutate(s => addDevice(s, {
    name,
    description: document.getElementById('d-desc').value.trim(),
    role: document.getElementById('d-role').value.trim(),
    port_strings: getPortStrings(),
  }), 'flash-device');
  if (r.ok) { flash(`✓ Device '${name}' added — press Save to commit.`, true, 'flash-device'); clearDeviceForm(); }
}

// ── Add setup ──────────────────────────────────────────────────────────────────

function clearSetupForm() {
  ['s-name', 's-desc'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('flash-setup').textContent = '';
}

function submitSetup() {
  const name = document.getElementById('s-name').value.trim();
  if (!name) { flash('Name is required.', false, 'flash-setup'); return; }
  const r = tryMutate(s => addSetup(s, {
    name,
    description: document.getElementById('s-desc').value.trim(),
  }), 'flash-setup');
  if (r.ok) { flash(`✓ Setup '${name}' added — press Save to commit.`, true, 'flash-setup'); clearSetupForm(); }
}

// ── All devices ────────────────────────────────────────────────────────────────

function renderAllDevices() {
  document.getElementById('all-devices-tbody').innerHTML =
    DEVICES().map(d => {
      const portBadges = d.ports.map((p, i) => {
        const connBadge = (d.connections[p] && d.connections[p].length)
          ? `<span class="port-conn">⇄ ${esc(d.connections[p].join(', '))}</span>` : '';
        const ps = esc(d.port_strings[i] || p);
        return `<span class="port-chip">` +
          `<code>${esc(p)}</code>${connBadge}` +
          `<button class="icon-btn" data-action="rename-port" data-device="${esc(d.name)}" data-port="${esc(p)}" data-port-string="${ps}" title="Edit port">✎</button>` +
          `<button class="icon-btn danger" data-action="delete-port" data-device="${esc(d.name)}" data-port="${esc(p)}" title="Delete port">✕</button>` +
          `</span>`;
      }).join('');
      return `<tr>
        <td class="editable" data-dtype="device-name" data-device="${esc(d.name)}">${esc(d.name)}</td>
        <td class="editable" data-dtype="device-desc" data-device="${esc(d.name)}">${esc(d.description || '')}</td>
        <td class="editable" data-dtype="device-role" data-device="${esc(d.name)}">${esc(d.role || '')}</td>
        <td>${portBadges}<button class="icon-btn add-port" data-action="add-port" data-device="${esc(d.name)}" title="Add port">＋ port</button></td>
        <td style="white-space:nowrap">${detailsBtnHtml('device', d.name, d.comment)}<button class="btn-sm danger" data-action="delete-device" data-device="${esc(d.name)}">Delete</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="empty">No devices yet</td></tr>';
}

function startDeviceFieldEdit(td) {
  const dtype = td.dataset.dtype;
  const device = td.dataset.device;
  const original = td.textContent.trim();
  const input = document.createElement('input');
  input.type = 'text'; input.value = original;
  td.textContent = ''; td.appendChild(input);
  input.focus(); input.select();
  let done = false;
  function commit() {
    const newVal = input.value.trim();
    input.remove();
    // role and description may be cleared; a name may not
    if (newVal === original || (!newVal && dtype === 'device-name')) { renderAllDevices(); return; }
    tryMutate(s => {
      if (dtype === 'device-name') renameDevice(s, device, newVal);
      else if (dtype === 'device-role') setDeviceRole(s, device, newVal);
      else updateDeviceDescription(s, device, newVal);
    }, 'flash-devices');
    renderAllDevices();
  }
  function cancel() { input.remove(); renderAllDevices(); }
  function onBlur() { if (!done) { done = true; commit(); } }
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (!done) { done = true; input.removeEventListener('blur', onBlur); commit(); } }
    if (e.key === 'Escape') { if (!done) { done = true; input.removeEventListener('blur', onBlur); cancel(); } }
  });
}

function startRenamePort(btn) {
  const device = btn.dataset.device, oldPort = btn.dataset.port;
  const oldPortString = btn.dataset.portString || oldPort;
  const chip = btn.closest('.port-chip');
  const inputWidth = Math.max(120, oldPortString.length * 8);
  chip.innerHTML =
    `<input class="inline-input" value="${esc(oldPortString)}" style="width:${inputWidth}px" title="Format: portname  or  portname (conn1, conn2)">` +
    `<button class="icon-btn sp-save" title="Save">✓</button>` +
    `<button class="icon-btn sp-cancel" title="Cancel">✗</button>`;
  const inp = chip.querySelector('input'); inp.focus(); inp.select();
  function save() {
    const newPortString = inp.value.trim();
    if (!newPortString || newPortString === oldPortString) { renderAllDevices(); return; }
    tryMutate(s => updatePort(s, device, oldPort, newPortString), 'flash-devices');
    renderAllDevices();
  }
  chip.querySelector('.sp-save').onclick = save;
  chip.querySelector('.sp-cancel').onclick = () => renderAllDevices();
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') renderAllDevices(); };
}

function startAddPort(device, portsCell) {
  if (portsCell.querySelector('.new-port-inp')) return;
  const chip = document.createElement('span');
  chip.className = 'port-chip';
  chip.innerHTML =
    `<input class="inline-input new-port-inp" placeholder="port name (or name (conn))">` +
    `<button class="icon-btn ap-save" title="Add">✓</button>` +
    `<button class="icon-btn ap-cancel" title="Cancel">✗</button>`;
  portsCell.insertBefore(chip, portsCell.querySelector('[data-action="add-port"]'));
  const inp = chip.querySelector('input'); inp.focus();
  function save() {
    const ps = inp.value.trim();
    if (!ps) { renderAllDevices(); return; }
    tryMutate(s => addPortToDevice(s, device, ps), 'flash-devices');
    renderAllDevices();
  }
  chip.querySelector('.ap-save').onclick = save;
  chip.querySelector('.ap-cancel').onclick = () => renderAllDevices();
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') renderAllDevices(); };
}

function doDeletePort(device, port) {
  if (!confirm(`Delete port "${port}" from "${device}"?\nAll cables connected to this port will also be deleted.`)) return;
  tryMutate(s => deletePortFromDevice(s, device, port), 'flash-devices');
  renderAllDevices();
}

function doDeleteDevice(name) {
  if (!confirm(`Delete device "${name}"?\nAll cables connected to this device will also be deleted.`)) return;
  tryMutate(s => deleteDevice(s, name), 'flash-devices');
  renderAllDevices();
}

// ── All setups ─────────────────────────────────────────────────────────────────

function renderAllSetups() {
  document.getElementById('all-setups-tbody').innerHTML =
    SETUPS().map(s => `<tr>
      <td class="editable" data-stype="setup-name" data-setup="${esc(s.name)}">${esc(s.name)}</td>
      <td class="editable" data-stype="setup-desc" data-setup="${esc(s.name)}">${esc(s.description || '')}</td>
      <td><button class="btn-sm danger" data-action="delete-setup" data-setup="${esc(s.name)}">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="3" class="empty">No setups yet</td></tr>';
}

function startSetupFieldEdit(td) {
  const stype = td.dataset.stype, setup = td.dataset.setup;
  const original = td.textContent.trim();
  const input = document.createElement('input');
  input.type = 'text'; input.value = original;
  td.textContent = ''; td.appendChild(input);
  input.focus(); input.select();
  let done = false;
  function commit() {
    const newVal = input.value.trim();
    input.remove();
    if (!newVal || newVal === original) { renderAllSetups(); return; }
    tryMutate(s => stype === 'setup-name'
      ? renameSetup(s, setup, newVal)
      : updateSetupDescription(s, setup, newVal), 'flash-setups');
    renderAllSetups();
  }
  function cancel() { input.remove(); renderAllSetups(); }
  function onBlur() { if (!done) { done = true; commit(); } }
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (!done) { done = true; input.removeEventListener('blur', onBlur); commit(); } }
    if (e.key === 'Escape') { if (!done) { done = true; input.removeEventListener('blur', onBlur); cancel(); } }
  });
}

function doDeleteSetup(name) {
  if (!confirm(`Delete setup "${name}"?\nCables in this setup will remain but their setup field will be cleared.`)) return;
  tryMutate(s => deleteSetup(s, name), 'flash-setups');
  renderAllSetups();
}

// ── Signal paths ───────────────────────────────────────────────────────────────

function renderSignalSetupChips() {
  const setups = SETUPS();
  document.getElementById('signal-setup-chips').innerHTML =
    setups.length
      ? setups.map(s => `<span class="chip${selectedSignalSetup === s.name ? ' sel' : ''}" data-sig-setup="${esc(s.name)}">${esc(s.name)}</span>`).join('')
      : '<span style="color:var(--text3);font-size:12px">No setups defined yet — use "+ Add setup".</span>';
}

// Build the horizontal chain html for one path: device pills joined by cable
// arrows; a device's internal connection shows as "entry ⇢ exit" inside its
// pill. Shared by the signal-paths tab; pills/arrows open the detail popup.
function chainHtml(p) {
  const pills = [];
  const parts = [];
  const first = p.steps[0];
  if (first) pills.push({ dev: first.fromDev, entry: '', exit: first.fromPort });
  for (const s of p.steps) {
    if (s.type === 'cable') {
      pills.push({ dev: s.toDev, entry: s.toPort, exit: '' });
      pills[pills.length - 2].arrowAfter = s.cable_id;
    } else {
      pills[pills.length - 1].exit = s.toPort;
    }
  }
  const known = new Set(store.devices.map(d => d.name));
  if (p.incompleteStart) {
    parts.push(`<span class="sp-warn" title="Earlier links are missing from the data or not assigned to this setup">⚠ mid-chain start</span>`);
  }
  for (const pill of pills) {
    const ports = pill.entry && pill.exit && pill.entry !== pill.exit
      ? `${esc(pill.entry)} ⇢ ${esc(pill.exit)}`
      : esc(pill.entry || pill.exit || '');
    parts.push(`<span class="sp-pill${known.has(pill.dev) ? ' sp-click' : ''}" data-sp-dev="${esc(pill.dev)}">
      <span class="sp-dev">${esc(pill.dev)}</span>
      <span class="sp-ports">${ports}</span>
    </span>`);
    if (pill.arrowAfter) {
      parts.push(`<span class="sp-arrow sp-click" data-sp-cable="${esc(pill.arrowAfter)}" title="Cable ${esc(pill.arrowAfter)}">
        <span class="sp-cid">${esc(pill.arrowAfter)}</span><span class="sp-line">⟶</span>
      </span>`);
    }
  }
  if (p.incompleteEnd) {
    parts.push(`<span class="sp-warn" title="No onward cable or internal connection in this setup">⚠ dead end at ${esc(p.incompleteEnd.port)}</span>`);
  }
  return `<div class="sp-chain">${parts.join('')}</div>`;
}

function renderSignalPaths() {
  renderSignalSetupChips();
  const el = document.getElementById('signal-paths-result');
  if (!selectedSignalSetup) {
    el.innerHTML = '<div class="empty">Select a setup above to see signal paths</div>';
    return;
  }
  const setupCables = CABLES().filter(c => c.setup === selectedSignalSetup);
  if (!setupCables.length) {
    el.innerHTML = '<div class="empty">No cables in this setup</div>';
    return;
  }
  const paths = computeSignalPaths(setupCables, store.devices);
  if (!paths.length) {
    el.innerHTML = '<div class="empty">No signal paths found</div>';
    return;
  }
  el.innerHTML = paths.map((p, i) => {
    const incomplete = p.incompleteStart || p.incompleteEnd;
    const title = `Path ${i + 1}` + (incomplete
      ? ' <span style="color:var(--amber-text);font-weight:400">— incomplete</span>' : '');
    return `<div class="card" style="margin-bottom:12px${incomplete ? ';border-color:var(--amber-text)' : ''}">
      <div style="font-size:11px;font-weight:500;color:var(--text2);margin-bottom:8px">${title}</div>
      ${chainHtml(p)}
    </div>`;
  }).join('');
}

// ── Setup tables ───────────────────────────────────────────────────────────────
// One table per port category (Charge line, Flux line, …): rows are chip
// ports carrying that category, traced through the setup's cables; columns
// are device roles. Cells edit in place — every change compiles to the same
// validated cable mutations as the rest of the app.

let wiringTables = [];

function renderWiringSetupChips() {
  const setups = SETUPS();
  document.getElementById('wiring-setup-chips').innerHTML =
    setups.length
      ? setups.map(s => `<span class="chip${selectedWiringSetup === s.name ? ' sel' : ''}" data-wire-setup="${esc(s.name)}">${esc(s.name)}</span>`).join('')
      : '<span style="color:var(--text3);font-size:12px">No setups defined yet — use "+ Add setup".</span>';
}

// One line per device stay: the device name (unless it equals the column
// header) plus the entry ⇢ exit ports — so the path reads from the table.
function wiringCellHtml(cell, colLabel) {
  return cell.visits.map(v => {
    const ports = v.outPort && v.outPort !== v.inPort
      ? `${esc(v.inPort)} ⇢ ${esc(v.outPort)}`
      : esc(v.inPort || v.outPort);
    const dev = v.dev !== colLabel ? `<span class="wt-vdev">${esc(v.dev)}</span> ` : '';
    return `<div class="wt-visit">${dev}<code>${ports}</code></div>`;
  }).join('');
}

function renderWiring() {
  renderWiringSetupChips();
  const el = document.getElementById('wiring-result');
  if (!selectedWiringSetup) {
    el.innerHTML = '<div class="empty">Select a setup above to see its wiring tables</div>';
    return;
  }
  const chips = store.devices.filter(d => (d.role || '').trim().toLowerCase() === CHIP_ROLE);
  if (!chips.length) {
    el.innerHTML = `<div class="empty">No chip device yet. Give the sample a device entry with role
      <code>Chip</code> and add a category in square brackets to its ports, e.g.
      <code>qb1 drive [Charge line]</code> — each such port becomes a row here.</div>`;
    return;
  }
  wiringTables = compileWiringTables(CABLES(), store.devices, selectedWiringSetup);
  if (!wiringTables.length) {
    el.innerHTML = `<div class="empty">No categorized chip ports found. Add categories in square
      brackets to the chip's ports, e.g. <code>qb1 drive [Charge line]</code>.</div>`;
    return;
  }
  const multiChip = chips.length > 1;
  el.innerHTML = wiringTables.map((t, ti) => `
    <div class="card" style="overflow-x:auto;margin-bottom:16px">
      <div style="font-size:13px;font-weight:500;margin-bottom:10px">${esc(t.category)}
        <span style="color:var(--text2);font-weight:400"> — ${t.rows.length} line(s)</span></div>
      <table class="wt-table">
        <thead><tr>
          <th>line</th>
          ${t.columns.map(c => `<th>${esc(c)}</th>`).join('')}
          <th></th>
        </tr></thead>
        <tbody>
          ${t.rows.map((r, ri) => `<tr>
            <td style="font-weight:500;white-space:nowrap">${esc(r.port)}${multiChip
              ? `<span class="wt-vdev" style="display:block">${esc(r.chip)}</span>` : ''}</td>
            ${r.slots.map((cell, ci) => cell
              ? `<td class="wt-cell${cell.visits.some(v => v.inCable || v.outCable) ? ' wt-edit' : ''}" data-t="${ti}" data-r="${ri}" data-c="${ci}">${wiringCellHtml(cell, t.columns[ci])}</td>`
              : `<td class="wt-none">—</td>`).join('')}
            <td style="white-space:nowrap">${r.dangling
              ? `<button class="icon-btn add-port wt-connect" data-t="${ti}" data-r="${ri}" title="Extend this line from ${esc(r.dangling.dev)} [${esc(r.dangling.port)}]">＋ connect</button>`
              : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('') + `<p class="hint">Rows are chip ports with a [category]; they are traced live through
    this setup's cables. Click a cell to re-plug that hop, ＋ connect to extend the line.</p>`;
}

// Click a cell → inline editor with one port dropdown per cable endpoint on
// that device; committing runs updateCable on the changed endpoints.
function startWiringCellEdit(td) {
  if (td.querySelector('select, input')) return;
  const cell = wiringTables[td.dataset.t].rows[td.dataset.r].slots[td.dataset.c];
  const endpoints = [];
  for (const v of cell.visits) {
    if (v.inCable) endpoints.push({ cable: v.inCable, dev: v.dev, port: v.inPort, label: `${v.inCable} in` });
    if (v.outCable) endpoints.push({ cable: v.outCable, dev: v.dev, port: v.outPort || v.inPort || '', label: `${v.outCable} out` });
  }
  if (!endpoints.length) return;
  td.innerHTML = endpoints.map((ep, i) => {
    const d = store.devices.find(x => x.name === ep.dev);
    const ports = d ? deviceView(d).ports : [];
    const input = ports.length
      ? `<select class="wt-ep" data-i="${i}">${ports.map(p => `<option value="${esc(p)}"${p === ep.port ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>`
      : `<input class="wt-ep inline-input" data-i="${i}" value="${esc(ep.port)}">`;
    return `<div class="wt-ep-row"><span class="wt-ep-label">${esc(ep.label)}</span>${input}</div>`;
  }).join('') +
    `<div class="wt-ep-row"><button class="icon-btn wt-ok" title="Apply">✓</button><button class="icon-btn wt-cancel" title="Cancel">✗</button></div>`;
  td.querySelector('.wt-cancel').addEventListener('click', e => { e.stopPropagation(); renderWiring(); });
  td.querySelector('.wt-ok').addEventListener('click', e => {
    e.stopPropagation();
    for (const elp of td.querySelectorAll('.wt-ep')) {
      const ep = endpoints[Number(elp.dataset.i)];
      const val = elp.value.trim();
      if (!val || val === ep.port) continue;
      const cable = CABLES().find(c => c.cable_id === ep.cable);
      if (!cable) continue;
      const field = cable.to_device === ep.dev && cable.to_port === ep.port ? 'to_port'
        : cable.from_device === ep.dev && cable.from_port === ep.port ? 'from_port'
          : cable.to_device === ep.dev ? 'to_port' : 'from_port';
      tryMutate(s => updateCable(s, ep.cable, field, val));
    }
    renderWiring();
  });
}

// "+ connect" → inline mini-form extending the line from its dangling port.
function startWiringConnect(btn) {
  const row = wiringTables[btn.dataset.t].rows[btn.dataset.r];
  const td = btn.closest('td');
  const devOpts = store.devices.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('');
  td.innerHTML = `
    <span class="hint">from ${esc(row.dangling.dev)} [${esc(row.dangling.port)}] to</span>
    <select class="wt-cdev">${devOpts}</select>
    <span class="wt-cport-wrap"><input class="wt-cport inline-input" placeholder="port"></span>
    <button class="icon-btn wt-ok" title="Add cable">✓</button>
    <button class="icon-btn wt-cancel" title="Cancel">✗</button>`;
  const rebuild = () => {
    const d = store.devices.find(x => x.name === td.querySelector('.wt-cdev').value);
    const ports = d ? deviceView(d).ports : [];
    td.querySelector('.wt-cport-wrap').innerHTML = ports.length
      ? `<select class="wt-cport">${ports.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>`
      : `<input class="wt-cport inline-input" placeholder="port">`;
  };
  td.querySelector('.wt-cdev').addEventListener('change', rebuild);
  rebuild();
  td.querySelector('.wt-cancel').addEventListener('click', () => renderWiring());
  td.querySelector('.wt-ok').addEventListener('click', () => {
    const r = tryMutate(s => addCable(s, {
      from_device: row.dangling.dev, from_port: row.dangling.port,
      to_device: td.querySelector('.wt-cdev').value,
      to_port: td.querySelector('.wt-cport').value.trim(),
      setup: selectedWiringSetup,
    }));
    if (r.ok) toast(`✓ Cable ${r.value} added — press Save to commit.`, 'ok');
    renderWiring();
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────────

function boot() {
  importSetupHash();
  initSettings();
  initDetails();

  document.getElementById('tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (b) setTab(b.dataset.tab);
  });

  // sub-tabs (table | diagram)
  document.getElementById('all-subtabs').addEventListener('click', e => {
    const b = e.target.closest('.subtab');
    if (!b) return;
    allView = b.dataset.view;
    document.querySelectorAll('#all-subtabs .subtab').forEach(s => s.classList.toggle('active', s === b));
    renderAll();
  });
  document.getElementById('query-subtabs').addEventListener('click', e => {
    const b = e.target.closest('.subtab');
    if (!b) return;
    queryView = b.dataset.view;
    document.querySelectorAll('#query-subtabs .subtab').forEach(s => s.classList.toggle('active', s === b));
    renderDeviceQuery();
  });

  // comment buttons in tables; clicking a far-end box in the query diagram
  // jumps to that device
  for (const id of ['all-tbody', 'all-devices-tbody']) {
    wireDetailsButtons(document.getElementById(id));
  }
  document.getElementById('query-diagram').addEventListener('jump-device', e => {
    selectedDevice = e.detail;
    renderDeviceChips();
    renderDeviceQuery();
  });

  document.getElementById('device-chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-dev]');
    if (!chip) return;
    selectedDevice = chip.dataset.dev === selectedDevice ? null : chip.dataset.dev;
    renderDeviceChips();
    renderDeviceQuery();
  });

  document.getElementById('setup-chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-setup]');
    if (!chip) return;
    selectedSetup = chip.dataset.setup === selectedSetup ? null : chip.dataset.setup;
    renderSetupChips();
    renderSetupQuery();
  });

  document.getElementById('signal-setup-chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-sig-setup]');
    if (!chip) return;
    selectedSignalSetup = chip.dataset.sigSetup === selectedSignalSetup ? null : chip.dataset.sigSetup;
    renderSignalPaths();
  });

  // chain pills/arrows open the detail popup
  document.getElementById('signal-paths-result').addEventListener('click', e => {
    const pill = e.target.closest('[data-sp-dev].sp-click');
    if (pill) { openDetails('device', pill.dataset.spDev); return; }
    const arrow = e.target.closest('[data-sp-cable]');
    if (arrow) openDetails('cable', arrow.dataset.spCable);
  });

  document.getElementById('wiring-setup-chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-wire-setup]');
    if (!chip) return;
    selectedWiringSetup = chip.dataset.wireSetup === selectedWiringSetup ? null : chip.dataset.wireSetup;
    renderWiring();
  });
  document.getElementById('wiring-result').addEventListener('click', e => {
    const connect = e.target.closest('.wt-connect');
    if (connect) { startWiringConnect(connect); return; }
    const cell = e.target.closest('td.wt-edit');
    if (cell) startWiringCellEdit(cell);
  });

  // conflicting-cable links in the Validate tab open the cable popup
  document.getElementById('validate-out').addEventListener('click', e => {
    const link = e.target.closest('[data-v-cable]');
    if (link) openDetails('cable', link.dataset.vCable);
  });

  document.getElementById('search').addEventListener('input', renderAll);

  document.getElementById('all-tbody').addEventListener('dblclick', e => {
    const td = e.target.closest('td.editable');
    if (td) startEdit(td);
  });
  document.getElementById('all-tbody').addEventListener('click', e => {
    const btn = e.target.closest('.del-btn');
    if (!btn) return;
    const cableId = btn.dataset.cableId;
    if (!confirm(`Delete cable ${cableId}?`)) return;
    tryMutate(s => deleteCable(s, cableId));
    renderAll();
  });

  document.getElementById('all-devices-tbody').addEventListener('click', e => {
    const td = e.target.closest('td.editable');
    if (td && !td.querySelector('input')) { startDeviceFieldEdit(td); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action, device = btn.dataset.device;
    if (action === 'rename-port') { startRenamePort(btn); return; }
    if (action === 'delete-port') { doDeletePort(device, btn.dataset.port); return; }
    if (action === 'add-port') { startAddPort(device, btn.closest('td')); return; }
    if (action === 'delete-device') { doDeleteDevice(device); return; }
  });

  document.getElementById('all-setups-tbody').addEventListener('click', e => {
    const td = e.target.closest('td.editable');
    if (td && !td.querySelector('input')) { startSetupFieldEdit(td); return; }
    const btn = e.target.closest('[data-action="delete-setup"]');
    if (btn) doDeleteSetup(btn.dataset.setup);
  });

  document.getElementById('submit-cable').addEventListener('click', submitCable);
  document.getElementById('clear-cable').addEventListener('click', clearCableForm);
  // switching device on purpose resets the port choice (ports are per-device)
  document.getElementById('f-from-dev').addEventListener('change', () => rebuildPortInput('from', false));
  document.getElementById('f-to-dev').addEventListener('change', () => rebuildPortInput('to', false));
  document.getElementById('add-port-entry').addEventListener('click', () => addPortEntry());
  document.getElementById('submit-device').addEventListener('click', submitDevice);
  document.getElementById('clear-device').addEventListener('click', clearDeviceForm);
  document.getElementById('submit-setup').addEventListener('click', submitSetup);
  document.getElementById('clear-setup').addEventListener('click', clearSetupForm);

  document.getElementById('save-btn').addEventListener('click', doSave);
  document.getElementById('reload-btn').addEventListener('click', async () => {
    await store.refresh();
    if (store.lastError) toast('Refresh failed: ' + store.lastError.message, 'err');
  });
  document.getElementById('settings-btn').addEventListener('click', openSettings);

  store.on('change', () => { updateChrome(); renderCurrent(); });
  store.on('error', e => toast(e.message || String(e), 'err'));
  store.on('merged', rep => {
    if (rep.conflicts.length) {
      const list = rep.conflicts.slice(0, 3).join(' · ');
      toast(`Merged remote changes. Both sides edited: ${list}${rep.conflicts.length > 3 ? ' …' : ''} — kept your version.`, 'info', 8000);
    } else if (rep.pulled) {
      toast(`Merged ${rep.pulled} remote change(s) into your unsaved work.`, 'info');
    }
  });

  // the draft write is debounced — make sure the last edit survives a quick tab close
  window.addEventListener('pagehide', () => {
    if (store._hasDraft) store._persistDraftNow();
  });

  // keep long-lived tabs fresh: pull whenever the tab regains focus
  const maybeRefresh = () => {
    if (!document.hidden && Date.now() - (store.lastSync || 0) > 15000) store.refresh();
  };
  window.addEventListener('focus', maybeRefresh);
  document.addEventListener('visibilitychange', maybeRefresh);

  // a second tab of this browser wrote to localStorage — adopt while hidden
  window.addEventListener('storage', e => {
    if (!e.key) return;
    if (e.key === 'wv:settings') {
      store.loadSettings();
      store.emit('change', { source: 'settings' });
    } else if ((e.key === store.key('draft') || e.key === store.key('cache')) && document.hidden) {
      store.adoptExternal();
    }
  });

  store.init();
  setTab('query');
  updateChrome();

  // debugging/console access
  window.WV = { store };
}

boot();
