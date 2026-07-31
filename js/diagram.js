// diagram.js — the two SVG diagram views.
//
// All-cables diagram: every device as a draggable box (position persisted in
// devices.csv as x/y), connected ports as labeled anchor rows, cables as
// orthogonal lines. Query-device diagram: one device with all its ports and
// every cable fanning out to a labeled far end, plus inline add-cable /
// add-port forms.

import { store } from './store.js';
import { toast } from './ui.js';
import { openDetails } from './details.js';
import { deviceView, setDevicePosition, addCable, addPortToDevice } from './data.js';
import { esc } from './util.js';

const SNAP = 10;  // drag positions snap to this grid

const ROW = 16;         // port row height
const TITLE_H = 24;     // box title bar height
const FOOT_H = 15;      // "N ports" badge row
const PAD = 6;
const CHAR_W = 6.6;     // ≈ width of one character at font-size 11

let dragging = false;
export const isDiagramDragging = () => dragging;

const textW = s => String(s).length * CHAR_W;

// ---------- shared box geometry ----------

// rows: port names shown as anchor rows. Returns geometry for one device box.
function boxGeom(name, rows, totalPorts, x, y) {
  const w = Math.max(130, textW(name) + 2 * PAD + 14, ...rows.map(p => textW(p) + 2 * PAD + 10)) + 8;
  const h = TITLE_H + rows.length * ROW + FOOT_H + PAD;
  const anchors = {};
  rows.forEach((p, i) => { anchors[p] = y + TITLE_H + i * ROW + ROW / 2; });
  return { name, x, y, w, h, rows, totalPorts, anchors };
}

function boxSvg(g, { clickable = true } = {}) {
  const rowsHtml = g.rows.map((p, i) => `
    <text x="${g.x + PAD + 4}" y="${g.y + TITLE_H + i * ROW + ROW / 2 + 3.5}" class="dg-port">${esc(p)}</text>
    <circle cx="${g.x}" cy="${g.anchors[p]}" r="2.5" class="dg-dot"/>
    <circle cx="${g.x + g.w}" cy="${g.anchors[p]}" r="2.5" class="dg-dot"/>`).join('');
  return `
  <g class="dg-box${clickable ? ' dg-clickable' : ''}" data-device="${esc(g.name)}">
    <rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="7" class="dg-rect"/>
    <rect x="${g.x}" y="${g.y}" width="${g.w}" height="${TITLE_H}" rx="7" class="dg-titlebg"/>
    <text x="${g.x + g.w / 2}" y="${g.y + TITLE_H / 2 + 4}" text-anchor="middle" class="dg-title">${esc(g.name)}</text>
    ${rowsHtml}
    <text x="${g.x + g.w / 2}" y="${g.y + g.h - PAD}" text-anchor="middle" class="dg-badge">${g.totalPorts} port${g.totalPorts === 1 ? '' : 's'}</text>
  </g>`;
}

// Orthogonal Z-route between two anchor points; `spread` staggers parallel runs.
function routePath(x1, y1, x2, y2, spread) {
  const mid = (x1 + x2) / 2 + spread;
  return `M ${x1} ${y1} L ${mid} ${y1} L ${mid} ${y2} L ${x2} ${y2}`;
}

function cableSvg(id, d, label, lx, ly) {
  return `
  <g class="dg-cable" data-cable="${esc(id)}">
    <path d="${d}" class="dg-cable-hit"/>
    <path d="${d}" class="dg-cable-line"/>
    <text x="${lx}" y="${ly}" text-anchor="middle" class="dg-cable-label">${esc(label)}</text>
  </g>`;
}

// ---------- all-cables diagram ----------

export function renderAllDiagram(container) {
  const cables = store.cables;
  const views = new Map(store.devices.map(d => [d.name, deviceView(d)]));

  // devices referenced by cables but missing from the registry still get a box
  const names = new Set(store.devices.map(d => d.name));
  for (const c of cables) { if (c.from_device) names.add(c.from_device); if (c.to_device) names.add(c.to_device); }

  // connected ports per device, in registry order where defined
  const connected = new Map([...names].map(n => [n, new Set()]));
  for (const c of cables) {
    if (c.from_device) connected.get(c.from_device).add(c.from_port);
    if (c.to_device) connected.get(c.to_device).add(c.to_port);
  }

  // First pass: compute each box's size, note which have stored positions.
  const pending = [];
  const geoms = new Map();
  const placed = [];
  for (const name of names) {
    const d = store.devices.find(x => x.name === name);
    const v = views.get(name);
    const orderedPorts = v ? v.ports.filter(p => connected.get(name).has(p)) : [];
    const extraPorts = [...connected.get(name)].filter(p => p && !orderedPorts.includes(p));
    const rows = [...orderedPorts, ...extraPorts];
    const totalPorts = v ? v.ports.length : rows.length;
    const x = d && d.x !== '' ? Number(d.x) : NaN;
    const y = d && d.y !== '' ? Number(d.y) : NaN;
    if (isFinite(x) && isFinite(y)) {
      const g = boxGeom(name, rows, totalPorts, x, y);
      geoms.set(name, g);
      placed.push(g);
    } else {
      pending.push({ name, rows, totalPorts });
    }
  }

  // Second pass: slot unplaced boxes into actual free space (margin 24px),
  // scanning candidate grid positions so nothing overlaps.
  const MARGIN = 24;
  const overlaps = (x, y, w, h) => placed.some(o =>
    x < o.x + o.w + MARGIN && o.x < x + w + MARGIN &&
    y < o.y + o.h + MARGIN && o.y < y + h + MARGIN);
  for (const p of pending) {
    const probe = boxGeom(p.name, p.rows, p.totalPorts, 0, 0);
    let px = 40, py = 40;
    outer:
    for (let y = 40; y < 6000; y += 80) {
      for (let x = 40; x < 2400; x += 100) {
        if (!overlaps(x, y, probe.w, probe.h)) { px = x; py = y; break outer; }
      }
    }
    const g = boxGeom(p.name, p.rows, p.totalPorts, px, py);
    geoms.set(p.name, g);
    placed.push(g);
  }

  const W = Math.max(1200, ...placed.map(g => g.x + g.w)) + 60;
  const H = Math.max(700, ...placed.map(g => g.y + g.h)) + 60;

  let cablesHtml = '';
  cables.forEach((c, i) => {
    const a = geoms.get(c.from_device), b = geoms.get(c.to_device);
    if (!a || !b) return;
    const y1 = a.anchors[c.from_port] ?? a.y + TITLE_H / 2;
    const y2 = b.anchors[c.to_port] ?? b.y + TITLE_H / 2;
    const aRight = a.x + a.w / 2 <= b.x + b.w / 2;
    const x1 = aRight ? a.x + a.w : a.x;
    const x2 = aRight ? b.x : b.x + b.w;
    const spread = ((i % 9) - 4) * 7;
    cablesHtml += cableSvg(c.cable_id, routePath(x1, y1, x2, y2, spread),
      c.cable_id, (x1 + x2) / 2 + spread, Math.min(y1, y2) + Math.abs(y2 - y1) / 2 - 4);
  });

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap">
      <p class="hint" style="margin:0;flex:1">Drag devices to arrange them — positions are stored in
      <code>devices.csv</code> and committed on Save. Click a box or cable for its comment.</p>
      <button class="btn dg-arrange" title="Lay out all devices by signal flow">✨ Auto-arrange</button>
    </div>
    <div class="card dg-wrap" style="overflow:auto;max-height:75vh;padding:0">
      <svg class="dg-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        ${cablesHtml}
        ${placed.map(g => boxSvg(g)).join('')}
      </svg>
    </div>`;

  container.querySelector('.dg-arrange').addEventListener('click', () => {
    if (!confirm('Auto-arrange all devices by signal flow? This overwrites the current positions (undo by not saving).')) return;
    autoArrange(placed, cables);
  });

  wireDiagram(container.querySelector('svg'), { draggable: true });
}

// Layered layout: within each connected component, BFS from the best-connected
// device; layers become columns, boxes stack inside a column, components stack
// vertically. Writes every device's position in one mutation.
export function autoArrange(geoms, cables) {
  const degree = new Map(geoms.map(g => [g.name, 0]));
  const adj = new Map(geoms.map(g => [g.name, new Set()]));
  for (const c of cables) {
    if (!adj.has(c.from_device) || !adj.has(c.to_device) || c.from_device === c.to_device) continue;
    adj.get(c.from_device).add(c.to_device);
    adj.get(c.to_device).add(c.from_device);
    degree.set(c.from_device, degree.get(c.from_device) + 1);
    degree.set(c.to_device, degree.get(c.to_device) + 1);
  }
  const byName = new Map(geoms.map(g => [g.name, g]));
  const unvisited = new Set(byName.keys());
  const GAP_X = 70, GAP_Y = 30, GAP_COMP = 60;
  let compY = 40;
  const pos = new Map();

  while (unvisited.size) {
    // hub of the largest remaining degree starts the component
    const hub = [...unvisited].sort((a, b) => degree.get(b) - degree.get(a))[0];
    const layers = [[hub]];
    unvisited.delete(hub);
    for (let li = 0; layers[li] && layers[li].length; li++) {
      const next = [];
      for (const n of layers[li]) {
        for (const m of adj.get(n)) {
          if (unvisited.has(m)) { unvisited.delete(m); next.push(m); }
        }
      }
      if (next.length) layers.push(next);
    }
    let x = 40;
    let compH = 0;
    for (const layer of layers) {
      let y = compY;
      let w = 0;
      for (const n of layer) {
        const g = byName.get(n);
        pos.set(n, { x, y });
        y += g.h + GAP_Y;
        w = Math.max(w, g.w);
      }
      compH = Math.max(compH, y - compY);
      x += w + GAP_X;
    }
    compY += compH + GAP_COMP;
  }

  store.mutate(s => {
    for (const [name, p] of pos) {
      if (s.devices.some(d => d.name === name)) setDevicePosition(s, name, p.x, p.y);
    }
  });
  toast('Devices arranged by signal flow — press Save to keep the layout.', 'ok');
}

// ---------- query-device diagram ----------

const MAX_ROWS = 40;

export function renderQueryDiagram(container, deviceName) {
  const dev = store.devices.find(d => d.name === deviceName);
  const v = dev ? deviceView(dev) : { ports: [], connections: {} };
  const cables = store.cables.filter(c => c.from_device === deviceName || c.to_device === deviceName);

  // all ports: connected first (in registry order), then the rest, capped
  const connectedSet = new Set(cables.flatMap(c =>
    c.from_device === deviceName && c.to_device === deviceName ? [c.from_port, c.to_port]
      : [c.from_device === deviceName ? c.from_port : c.to_port]));
  const orderedPorts = [
    ...v.ports.filter(p => connectedSet.has(p)),
    ...[...connectedSet].filter(p => p && !v.ports.includes(p)),   // used but undefined
    ...v.ports.filter(p => !connectedSet.has(p)),
  ];
  const rows = orderedPorts.slice(0, Math.max(MAX_ROWS, connectedSet.size));
  const hidden = orderedPorts.length - rows.length;

  const g = boxGeom(deviceName, rows, v.ports.length, 20, 20);

  // one row per cable on the right, in port order
  const items = [];
  for (const p of rows) {
    for (const c of cables) {
      const fromHere = c.from_device === deviceName && c.from_port === p;
      const toHere = c.to_device === deviceName && c.to_port === p;
      if (!fromHere && !toHere) continue;
      const otherDev = fromHere ? c.to_device : c.from_device;
      const otherPort = fromHere ? c.to_port : c.from_port;
      const self = c.from_device === c.to_device;
      if (self && toHere) continue; // loopback: draw once, from the from-port row
      items.push({ cable: c, port: p, label: `${otherDev} [${otherPort}]${self ? ' (same device)' : ''}`, otherDev });
    }
  }

  const rx = g.x + g.w;                 // line start x
  const lx = rx + 150;                  // endpoint boxes x
  let ey = 30;
  let cablesHtml = '', endsHtml = '';
  for (const [i, it] of items.entries()) {
    const y1 = g.anchors[it.port];
    const y2 = ey + 9;
    const w = textW(it.label) + 14;
    cablesHtml += cableSvg(it.cable.cable_id, routePath(rx, y1, lx, y2, ((i % 7) - 3) * 6),
      it.cable.cable_id, (rx + lx) / 2, Math.min(y1, y2) + Math.abs(y2 - y1) / 2 - 4);
    endsHtml += `
      <g class="dg-end dg-clickable" data-jump="${esc(it.otherDev)}">
        <rect x="${lx}" y="${ey}" width="${w}" height="18" rx="5" class="dg-endrect"/>
        <text x="${lx + 7}" y="${ey + 13}" class="dg-port">${esc(it.label)}</text>
      </g>`;
    ey += 26;
  }

  const W = lx + Math.max(220, ...items.map(it => textW(it.label) + 20)) + 40;
  const H = Math.max(g.y + g.h, ey) + 30;

  const devOpts = store.devices.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('');
  const portOpts = v.ports.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  const setupOpts = `<option value=""></option>` + store.setups.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');

  container.innerHTML = `
    <div class="card dg-wrap" style="overflow:auto;max-height:65vh;padding:0">
      <svg class="dg-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        ${cablesHtml}
        ${boxSvg(g)}
        ${endsHtml}
        ${hidden > 0 ? `<text x="${g.x}" y="${g.y + g.h + 16}" class="dg-badge">+ ${hidden} more unconnected port(s) not shown</text>` : ''}
      </svg>
    </div>
    <details class="dg-form">
      <summary>＋ Add cable from ${esc(deviceName)}</summary>
      <div class="dg-form-grid">
        <label>This port ${v.ports.length
          ? `<select class="qd-fport">${portOpts}</select>`
          : `<input class="qd-fport" type="text" placeholder="port">`}</label>
        <label>Other device <select class="qd-tdev">${devOpts}</select></label>
        <label>Other port <span class="qd-tport-wrap"><input class="qd-tport" type="text" placeholder="port"></span></label>
        <label>Setup <select class="qd-setup">${setupOpts}</select></label>
        <button class="btn qd-addcable">Add cable</button>
      </div>
    </details>
    <details class="dg-form">
      <summary>＋ Add port to ${esc(deviceName)}</summary>
      <div class="dg-form-grid">
        <label>Port <input class="qd-pstring" type="text" placeholder="name  or  name (conn1, conn2)"></label>
        <button class="btn qd-addport">Add port</button>
      </div>
    </details>`;

  wireDiagram(container.querySelector('svg'), { draggable: false });

  // clicking a far-end box jumps to that device
  container.querySelectorAll('[data-jump]').forEach(el =>
    el.addEventListener('click', () => container.dispatchEvent(
      new CustomEvent('jump-device', { detail: el.dataset.jump, bubbles: true }))));

  // to-port input becomes a dropdown when the target device has defined ports
  const tdev = container.querySelector('.qd-tdev');
  const rebuildToPort = () => {
    const target = store.devices.find(d => d.name === tdev.value);
    const tv = target ? deviceView(target) : null;
    const wrap = container.querySelector('.qd-tport-wrap');
    wrap.innerHTML = tv && tv.ports.length
      ? `<select class="qd-tport">${tv.ports.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>`
      : `<input class="qd-tport" type="text" placeholder="port">`;
  };
  tdev.addEventListener('change', rebuildToPort);
  rebuildToPort();

  container.querySelector('.qd-addcable').addEventListener('click', () => {
    const val = sel => container.querySelector(sel)?.value.trim() || '';
    try {
      const id = store.mutate(s => addCable(s, {
        cable_id: '',
        from_device: deviceName, from_port: val('.qd-fport'),
        to_device: val('.qd-tdev'), to_port: val('.qd-tport'),
        setup: val('.qd-setup'),
      }));
      toast(`✓ Cable ${id} added — press Save to commit.`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  container.querySelector('.qd-addport').addEventListener('click', () => {
    const ps = container.querySelector('.qd-pstring').value.trim();
    if (!ps) return;
    try {
      store.mutate(s => addPortToDevice(s, deviceName, ps));
      toast(`✓ Port added to ${deviceName} — press Save to commit.`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  });
}

// ---------- interaction (click for details, drag to move) ----------

function wireDiagram(svg, { draggable }) {
  if (!svg) return;

  svg.addEventListener('click', e => {
    const cable = e.target.closest('.dg-cable');
    if (cable) { openDetails('cable', cable.dataset.cable); return; }
  });

  for (const box of svg.querySelectorAll('.dg-box')) {
    const name = box.dataset.device;
    box.addEventListener('pointerdown', ev => {
      if (ev.button !== undefined && ev.button !== 0) return;
      const startX = ev.clientX, startY = ev.clientY;
      const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width || 1;
      let moved = false;

      const move = e => {
        if (!draggable) return;
        const dx = (e.clientX - startX) / scale, dy = (e.clientY - startY) / scale;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        moved = true;
        dragging = true;
        box.setAttribute('transform', `translate(${dx}, ${dy})`);
      };
      const up = e => {
        cleanup();
        if (moved) {
          dragging = false;
          const dx = (e.clientX - startX) / scale, dy = (e.clientY - startY) / scale;
          const d = store.devices.find(x => x.name === name);
          const rect = box.querySelector('.dg-rect');
          const nx = Math.max(0, Math.round((Number(rect.getAttribute('x')) + dx) / SNAP) * SNAP);
          const ny = Math.max(0, Math.round((Number(rect.getAttribute('y')) + dy) / SNAP) * SNAP);
          if (d) {
            try { store.mutate(s => setDevicePosition(s, name, nx, ny)); } catch { }
          } else {
            box.removeAttribute('transform');
            toast(`'${name}' is not in the device registry — add it to be able to place it.`, 'err');
          }
        } else {
          openDetails('device', name);
        }
      };
      const cancel = () => { cleanup(); dragging = false; box.removeAttribute('transform'); };
      function cleanup() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    });
  }
}
