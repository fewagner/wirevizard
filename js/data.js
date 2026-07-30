// data.js — the wirevizard domain model: CSV (de)serialization for the three
// data files, port-string parsing, validation, signal-path search, and all
// mutations (with their cascading updates), ported from the original Python
// implementation. Mutations operate on a working state {cables, devices,
// setups} and throw Error with a user-readable message on invalid input.

import { csvToObjects, objectsToCsv, parseCsv, serializeCsv } from './util.js';

export const CABLE_FIELDS = ['cable_id', 'from_device', 'from_port', 'to_device', 'to_port', 'setup', 'comment'];
export const SETUP_FIELDS = ['name', 'description'];
// devices.csv fixed columns before the port columns. Header-driven: the
// leading run of header cells with these names defines where ports start, so
// files from any older layout (no role, no x/y/comment) parse fine and are
// migrated on the next save.
export const DEVICE_FIXED = ['name', 'description', 'role', 'x', 'y', 'comment'];
export const CHIP_ROLE = 'chip';

export const CABLES_PATH = 'cables.csv';
export const DEVICES_PATH = 'devices.csv';
export const SETUPS_PATH = 'setups.csv';
export const DATA_PATHS = [CABLES_PATH, DEVICES_PATH, SETUPS_PATH];
export const IMAGE_DIR = 'images/';

// ---------- ports ----------

// Parse 'A2 (A1) [Charge line]' -> {name: 'A2', conns: ['A1'], category: 'Charge line'}.
// Both the parenthesised internal connections and the bracketed category are optional.
export function parsePortEntry(entry) {
  let s = String(entry || '').trim();
  let category = '';
  const cm = s.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (cm) { s = cm[1].trim(); category = cm[2].trim(); }
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    return {
      name: m[1].trim(),
      conns: m[2].split(',').map(c => c.trim()).filter(Boolean),
      category,
    };
  }
  return { name: s, conns: [], category };
}

export function formatPortEntry({ name, conns = [], category = '' }) {
  return name
    + (conns.length ? ` (${conns.join(', ')})` : '')
    + (category ? ` [${category}]` : '');
}

// Derived view of a device: port names + bidirectional internal-connection map.
export function deviceView(d) {
  const ports = [];
  const connections = {};
  const categories = {};
  for (const ps of d.port_strings || []) {
    const { name, conns, category } = parsePortEntry(ps);
    if (!name) continue;
    ports.push(name);
    if (category) categories[name] = category;
    for (const cp of conns) {
      (connections[name] ||= []).includes(cp) || connections[name].push(cp);
      (connections[cp] ||= []).includes(name) || connections[cp].push(name);
    }
  }
  return {
    name: d.name, description: d.description, role: d.role || '',
    x: d.x || '', y: d.y || '', comment: d.comment || '',
    ports, connections, categories, port_strings: d.port_strings || [],
  };
}

// ---------- (de)serialization ----------

export function parseCables(text) { return csvToObjects(text, CABLE_FIELDS); }
export function serializeCables(cables) { return objectsToCsv(cables, CABLE_FIELDS); }

export function parseDevices(text) {
  const rows = parseCsv(text);
  const header = rows[0] || [];
  // ports start after the leading run of known fixed-column names, whatever
  // subset an older file has; each fixed value is read by its header name
  const known = new Set(DEVICE_FIXED);
  let portsFrom = 0;
  while (portsFrom < header.length && known.has(header[portsFrom])) portsFrom++;
  const idx = Object.fromEntries(header.slice(0, portsFrom).map((h, i) => [h, i]));
  const get = (row, field) => (idx[field] != null ? row[idx[field]] || '' : '');
  const devices = [];
  for (const row of rows.slice(1)) {
    if (!row.length || row.every(c => !c.trim())) continue;
    devices.push({
      name: get(row, 'name').trim(),
      description: get(row, 'description').trim(),
      role: get(row, 'role').trim(),
      x: get(row, 'x').trim(),
      y: get(row, 'y').trim(),
      comment: get(row, 'comment'),
      port_strings: row.slice(portsFrom).map(c => c.trim()).filter(Boolean),
    });
  }
  return devices;
}

export function serializeDevices(devices) {
  return serializeCsv([
    DEVICE_FIXED,
    ...devices.map(d => [d.name, d.description || '', d.role || '', d.x || '', d.y || '', d.comment || '', ...(d.port_strings || [])]),
  ]);
}

export function parseSetups(text) { return csvToObjects(text, SETUP_FIELDS); }
export function serializeSetups(setups) { return objectsToCsv(setups, SETUP_FIELDS); }

// ---------- ids ----------

export function nextCableId(cables) {
  const nums = cables
    .filter(c => /^c\d+$/i.test(c.cable_id || ''))
    .map(c => parseInt(c.cable_id.slice(1), 10));
  const n = nums.length ? Math.max(...nums) + 1 : 1;
  return 'C' + String(n).padStart(3, '0');
}

// ---------- mutations (state = {cables, devices, setups}) ----------

const findDevice = (state, name) => state.devices.find(d => d.name === name);
const findSetup = (state, name) => state.setups.find(s => s.name === name);

export function addCable(state, data) {
  const cable = {};
  for (const f of CABLE_FIELDS) cable[f] = String(data[f] || '').trim();
  if (!cable.cable_id) cable.cable_id = nextCableId(state.cables);
  const missing = ['from_device', 'from_port', 'to_device', 'to_port'].filter(f => !cable[f]);
  if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);
  if (state.devices.length) {
    for (const f of ['from_device', 'to_device']) {
      if (!findDevice(state, cable[f])) throw new Error(`${f} '${cable[f]}' not in devices.csv`);
    }
  }
  for (const [devField, portField] of [['from_device', 'from_port'], ['to_device', 'to_port']]) {
    const d = findDevice(state, cable[devField]);
    if (d) {
      const { ports } = deviceView(d);
      if (ports.length && !ports.includes(cable[portField])) {
        throw new Error(`Port '${cable[portField]}' not defined on device '${cable[devField]}'`);
      }
    }
  }
  if (cable.setup && state.setups.length && !findSetup(state, cable.setup)) {
    throw new Error(`setup '${cable.setup}' not in setups.csv`);
  }
  if (state.cables.some(c => c.cable_id === cable.cable_id)) {
    throw new Error(`Cable ID '${cable.cable_id}' already exists`);
  }
  state.cables.push(cable);
  return cable.cable_id;
}

export function deleteCable(state, cableId) {
  const before = state.cables.length;
  state.cables = state.cables.filter(c => c.cable_id !== cableId);
  if (state.cables.length === before) throw new Error(`Cable '${cableId}' not found`);
}

export function updateCable(state, cableId, field, value) {
  if (!CABLE_FIELDS.includes(field) || field === 'cable_id') {
    throw new Error(`Field '${field}' cannot be edited`);
  }
  const target = state.cables.find(c => c.cable_id === cableId);
  if (!target) throw new Error(`Cable '${cableId}' not found`);
  if (['from_device', 'to_device'].includes(field)) {
    if (state.devices.length && !findDevice(state, value)) throw new Error(`Device '${value}' not in devices.csv`);
  }
  if (field === 'setup' && value) {
    if (state.setups.length && !findSetup(state, value)) throw new Error(`Setup '${value}' not in setups.csv`);
  }
  const updated = { ...target, [field]: value };
  for (const [devField, portField] of [['from_device', 'from_port'], ['to_device', 'to_port']]) {
    if (field === devField || field === portField) {
      const d = findDevice(state, updated[devField]);
      if (d && updated[portField]) {
        const { ports } = deviceView(d);
        if (ports.length && !ports.includes(updated[portField])) {
          throw new Error(`Port '${updated[portField]}' not defined on device '${updated[devField]}'`);
        }
      }
    }
  }
  target[field] = value;
}

export function addDevice(state, { name, description = '', role = '', port_strings = [] }) {
  name = String(name || '').trim();
  if (!name) throw new Error('Name is required');
  if (findDevice(state, name)) throw new Error(`Device '${name}' already exists`);
  state.devices.push({ name, description, role: String(role || '').trim(), port_strings });
}

export function renameDevice(state, oldName, newName) {
  newName = String(newName || '').trim();
  const device = findDevice(state, oldName);
  if (!device) throw new Error(`Device '${oldName}' not found`);
  if (newName !== oldName && findDevice(state, newName)) throw new Error(`Device '${newName}' already exists`);
  device.name = newName;
  if (newName !== oldName) {
    for (const c of state.cables) {
      if (c.from_device === oldName) c.from_device = newName;
      if (c.to_device === oldName) c.to_device = newName;
    }
  }
}

export function updateDeviceDescription(state, name, description) {
  const device = findDevice(state, name);
  if (!device) throw new Error(`Device '${name}' not found`);
  device.description = description;
}

export function setDevicePosition(state, name, x, y) {
  const device = findDevice(state, name);
  if (!device) throw new Error(`Device '${name}' not found`);
  device.x = String(Math.round(x));
  device.y = String(Math.round(y));
}

export function setDeviceRole(state, name, role) {
  const device = findDevice(state, name);
  if (!device) throw new Error(`Device '${name}' not found`);
  device.role = String(role || '').trim();
}

export function setDeviceComment(state, name, comment) {
  const device = findDevice(state, name);
  if (!device) throw new Error(`Device '${name}' not found`);
  device.comment = comment;
}

export function setCableComment(state, cableId, comment) {
  const cable = state.cables.find(c => c.cable_id === cableId);
  if (!cable) throw new Error(`Cable '${cableId}' not found`);
  cable.comment = comment;
}

export function updatePort(state, deviceName, oldPort, newPortString) {
  newPortString = String(newPortString || '').trim();
  const { name: newPort, conns: newConns } = parsePortEntry(newPortString);
  if (!newPort) throw new Error('Port name cannot be empty');
  const device = findDevice(state, deviceName);
  if (!device) throw new Error(`Device '${deviceName}' not found`);
  const { ports } = deviceView(device);
  if (!ports.includes(oldPort)) throw new Error(`Port '${oldPort}' not found on '${deviceName}'`);
  if (newPort !== oldPort && ports.includes(newPort)) throw new Error(`Port '${newPort}' already exists on '${deviceName}'`);
  const portsAfter = ports.map(p => (p === oldPort ? newPort : p));
  for (const c of newConns) {
    if (!portsAfter.includes(c)) throw new Error(`Connection target '${c}' is not a port on '${deviceName}'`);
  }
  device.port_strings = device.port_strings.map(ps => {
    const parsed = parsePortEntry(ps);
    if (parsed.name === oldPort) return newPortString;
    parsed.conns = parsed.conns.map(c => (c === oldPort ? newPort : c));
    return formatPortEntry(parsed);
  });
  if (newPort !== oldPort) {
    for (const c of state.cables) {
      if (c.from_device === deviceName && c.from_port === oldPort) c.from_port = newPort;
      if (c.to_device === deviceName && c.to_port === oldPort) c.to_port = newPort;
    }
  }
}

export function addPortToDevice(state, deviceName, portString) {
  portString = String(portString || '').trim();
  const device = findDevice(state, deviceName);
  if (!device) throw new Error(`Device '${deviceName}' not found`);
  const { name } = parsePortEntry(portString);
  if (!name) throw new Error('Port name cannot be empty');
  if (deviceView(device).ports.includes(name)) throw new Error(`Port '${name}' already exists on '${deviceName}'`);
  device.port_strings.push(portString);
}

export function deletePortFromDevice(state, deviceName, portName) {
  const device = findDevice(state, deviceName);
  if (!device) throw new Error(`Device '${deviceName}' not found`);
  if (!deviceView(device).ports.includes(portName)) throw new Error(`Port '${portName}' not found on '${deviceName}'`);
  device.port_strings = device.port_strings
    .filter(ps => parsePortEntry(ps).name !== portName)
    .map(ps => {
      const parsed = parsePortEntry(ps);
      parsed.conns = parsed.conns.filter(c => c !== portName);
      return formatPortEntry(parsed);
    });
  state.cables = state.cables.filter(c => !(
    (c.from_device === deviceName && c.from_port === portName) ||
    (c.to_device === deviceName && c.to_port === portName)
  ));
}

export function deleteDevice(state, name) {
  if (!findDevice(state, name)) throw new Error(`Device '${name}' not found`);
  state.devices = state.devices.filter(d => d.name !== name);
  state.cables = state.cables.filter(c => c.from_device !== name && c.to_device !== name);
}

export function addSetup(state, { name, description = '' }) {
  name = String(name || '').trim();
  if (!name) throw new Error('Name is required');
  if (findSetup(state, name)) throw new Error(`Setup '${name}' already exists`);
  state.setups.push({ name, description });
}

export function renameSetup(state, oldName, newName) {
  newName = String(newName || '').trim();
  const setup = findSetup(state, oldName);
  if (!setup) throw new Error(`Setup '${oldName}' not found`);
  if (newName !== oldName && findSetup(state, newName)) throw new Error(`Setup '${newName}' already exists`);
  setup.name = newName;
  if (newName !== oldName) {
    for (const c of state.cables) if (c.setup === oldName) c.setup = newName;
  }
}

export function updateSetupDescription(state, name, description) {
  const setup = findSetup(state, name);
  if (!setup) throw new Error(`Setup '${name}' not found`);
  setup.description = description;
}

export function deleteSetup(state, name) {
  if (!findSetup(state, name)) throw new Error(`Setup '${name}' not found`);
  state.setups = state.setups.filter(s => s.name !== name);
  for (const c of state.cables) if (c.setup === name) c.setup = '';
}

// ---------- validation ----------

export function validate(cables, devices, setups) {
  const errors = [], warnings = [];
  const seenIds = {};
  const portUsage = {};
  const required = ['cable_id', 'from_device', 'from_port', 'to_device', 'to_port'];
  const deviceNames = new Set(devices.map(d => d.name));
  const setupNames = new Set(setups.map(s => s.name));
  const views = new Map(devices.map(d => [d.name, deviceView(d)]));

  cables.forEach((c, i) => {
    const row = `Row ${i + 2} (${c.cable_id || '?'})`;
    for (const f of required) if (!c[f]) errors.push(`${row}: missing field '${f}'`);
    if (c.cable_id) {
      if (seenIds[c.cable_id]) errors.push(`${row}: duplicate cable_id '${c.cable_id}'`);
      else seenIds[c.cable_id] = i + 2;
    }
    if (c.from_device && deviceNames.size && !deviceNames.has(c.from_device)) {
      errors.push(`${row}: from_device '${c.from_device}' not in devices.csv`);
    }
    if (c.to_device && deviceNames.size && !deviceNames.has(c.to_device)) {
      errors.push(`${row}: to_device '${c.to_device}' not in devices.csv`);
    }
    if (c.setup && setupNames.size && !setupNames.has(c.setup)) {
      errors.push(`${row}: setup '${c.setup}' not in setups.csv`);
    }
    for (const [dev, port, field] of [[c.from_device, c.from_port, 'from_port'], [c.to_device, c.to_port, 'to_port']]) {
      if (!dev || !port) continue;
      const v = views.get(dev);
      if (v && v.ports.length && !v.ports.includes(port)) {
        errors.push(`${row}: ${field} '${port}' not defined on device '${dev}'`);
      }
      const key = `${dev}::${port}`;
      (portUsage[key] ||= []).push(c.cable_id);
    }
  });
  for (const [k, ids] of Object.entries(portUsage)) {
    if (ids.length > 1) {
      const [dev, port] = k.split('::');
      warnings.push(`Port conflict: ${dev} [${port}] used by: ${ids.join(', ')}`);
    }
  }
  return { errors, warnings };
}

// ---------- signal paths ----------

// Returns an array of path objects:
//   { steps, incompleteStart: {dev, port}|null, incompleteEnd: {dev, port}|null }
// A path is complete when both markers are null: it runs from one terminal
// port (cable-connected, no internal connections) to another. Chains that
// dead-end mid-way — e.g. because a link is missing from the data or a cable
// isn't assigned to the setup — are still returned, marked incomplete, so one
// gap never silently hides the whole chain. Complete paths sort first.
// Shared traversal machinery: adjacency of cables + internal connections.
function buildGraph(cables, devices) {
  // internalMap: deviceName -> {portName -> [connectedPortName, ...]}
  const internalMap = {};
  for (const d of devices) {
    const { connections } = deviceView(d);
    if (Object.keys(connections).length) internalMap[d.name] = connections;
  }
  // cableAdj: "dev\x00port" -> [{cable_id, dev, port}, ...]  (bidirectional)
  const cableAdj = {};
  const adjKey = (dev, port) => dev + '\x00' + port;
  for (const c of cables) {
    (cableAdj[adjKey(c.from_device, c.from_port)] ||= []).push({ cable_id: c.cable_id, dev: c.to_device, port: c.to_port });
    (cableAdj[adjKey(c.to_device, c.to_port)] ||= []).push({ cable_id: c.cable_id, dev: c.from_device, port: c.from_port });
  }
  return { internalMap, cableAdj, adjKey };
}

// BFS from one port outward through cables and internal connections.
// Returns every maximal branch: { steps, end, endTerminal }.
function graphWalk(graph, start) {
  const { internalMap, cableAdj, adjKey } = graph;
  const found = [];
  const queue = [{ dev: start.dev, port: start.port, steps: [], visited: new Set([adjKey(start.dev, start.port)]) }];
  while (queue.length) {
    const { dev, port, steps, visited } = queue.shift();
    const hops = (cableAdj[adjKey(dev, port)] || []).filter(h => !visited.has(adjKey(h.dev, h.port)));
    if (!hops.length) {
      // arrived here via an internal connection and there is no cable onward
      if (steps.length) found.push({ steps, end: { dev, port }, endTerminal: false });
      continue;
    }
    for (const hop of hops) {
      const newVisited = new Set(visited);
      newVisited.add(adjKey(hop.dev, hop.port));
      const newSteps = [...steps, {
        type: 'cable', cable_id: hop.cable_id,
        fromDev: dev, fromPort: port, toDev: hop.dev, toPort: hop.port,
      }];
      const intConns = (internalMap[hop.dev] && internalMap[hop.dev][hop.port]) || [];
      const conts = intConns.filter(cp => !newVisited.has(adjKey(hop.dev, cp)));
      if (!intConns.length) {
        found.push({ steps: newSteps, end: { dev: hop.dev, port: hop.port }, endTerminal: true });
      } else if (!conts.length) {
        found.push({ steps: newSteps, end: { dev: hop.dev, port: hop.port }, endTerminal: false });
      } else {
        for (const connPort of conts) {
          const v2 = new Set(newVisited);
          v2.add(adjKey(hop.dev, connPort));
          queue.push({
            dev: hop.dev, port: connPort,
            steps: [...newSteps, { type: 'internal', fromDev: hop.dev, fromPort: hop.port, toDev: hop.dev, toPort: connPort }],
            visited: v2,
          });
        }
      }
    }
  }
  return found;
}

// Longest chain reachable from one specific port (used by the setup tables).
export function tracePathFrom(cables, devices, dev, port) {
  const branches = graphWalk(buildGraph(cables, devices), { dev, port });
  if (!branches.length) return [];
  branches.sort((a, b) => b.steps.length - a.steps.length);
  return branches[0].steps;
}

export function computeSignalPaths(cables, devices) {
  const graph = buildGraph(cables, devices);
  const { internalMap, cableAdj, adjKey } = graph;

  // Terminal ports: have a cable connection AND no internal connections
  const terminalPorts = [];
  for (const key of Object.keys(cableAdj)) {
    const sep = key.indexOf('\x00');
    const dev = key.slice(0, sep);
    const port = key.slice(sep + 1);
    const hasInternal = internalMap[dev] && (internalMap[dev][port] || []).length > 0;
    if (!hasInternal) terminalPorts.push({ dev, port });
  }

  const walk = start => graphWalk(graph, start);

  const complete = [];
  const partial = [];
  const seenComplete = new Set();
  const usedCables = new Set();
  const canonicalKey = (a, b) => {
    const ka = adjKey(a.dev, a.port), kb = adjKey(b.dev, b.port);
    return ka <= kb ? ka + '||' + kb : kb + '||' + ka;
  };
  const cableIds = steps => steps.filter(s => s.type === 'cable').map(s => s.cable_id);
  const markUsed = steps => cableIds(steps).forEach(id => usedCables.add(id));

  // 1) chains starting at terminal ports
  for (const start of terminalPorts) {
    for (const f of walk(start)) {
      if (f.endTerminal) {
        const pk = canonicalKey(start, f.end);
        if (seenComplete.has(pk)) continue;
        seenComplete.add(pk);
        complete.push({ steps: f.steps, incompleteStart: null, incompleteEnd: null });
      } else {
        partial.push({ steps: f.steps, incompleteStart: null, incompleteEnd: f.end });
      }
      markUsed(f.steps);
    }
  }

  // 2) orphan segments with no terminal port anywhere (both ends dead-end
  //    after internal connections) — start from an unused cable's endpoints
  //    and keep the longest branch.
  for (let guard = 0; guard < cables.length; guard++) {
    const orphan = cables.find(c => c.cable_id && !usedCables.has(c.cable_id));
    if (!orphan) break;
    usedCables.add(orphan.cable_id);
    const cands = [];
    for (const [dev, port] of [[orphan.from_device, orphan.from_port], [orphan.to_device, orphan.to_port]]) {
      for (const f of walk({ dev, port })) cands.push({ start: { dev, port }, ...f });
    }
    if (!cands.length) continue;
    cands.sort((a, b) => b.steps.length - a.steps.length);
    const best = cands[0];
    partial.push({
      steps: best.steps,
      incompleteStart: best.start,
      incompleteEnd: best.endTerminal ? null : best.end,
    });
    markUsed(best.steps);
  }

  // Drop partial branches that are just sub-chains of a longer path (e.g. the
  // unused positions of a switch whose selected position continues onward).
  const asSet = p => new Set(cableIds(p.steps));
  const isSubset = (a, b) => a.size < b.size && [...a].every(x => b.has(x));
  const allSets = [...complete, ...partial].map(asSet);
  const seenPartialKey = new Set();
  const keptPartials = partial.filter(p => {
    const s = asSet(p);
    if (allSets.some(o => isSubset(s, o))) return false;
    const key = [...s].sort().join('|');       // identical cable sets (e.g. switch
    if (seenPartialKey.has(key)) return false; // fan-out) collapse to one branch
    seenPartialKey.add(key);
    return true;
  });

  return [...complete, ...keptPartials];
}

// ---------- setup wiring tables ----------

// Compile the per-setup wiring tables from chip-port categories. Rows anchor
// on ports of devices with role "chip" that carry a [category]; each row is
// the longest chain traced from that port through the setup's cables.
// Columns are device roles, aligned across rows by a greedy order-preserving
// merge; consecutive same-role hops (e.g. switch chains) share one cell.
// Everything is derived from cables.csv + devices.csv — there is no second
// source of truth.
export function compileWiringTables(cables, devices, setupName) {
  const setupCables = cables.filter(c => c.setup === setupName);
  const chips = devices.filter(d => (d.role || '').trim().toLowerCase() === CHIP_ROLE);
  const roleOf = new Map(devices.map(d => [d.name, (d.role || '').trim() || d.name]));

  const rows = [];
  for (const chip of chips) {
    for (const ps of chip.port_strings || []) {
      const { name: port, category } = parsePortEntry(ps);
      if (!port || !category) continue;
      const steps = tracePathFrom(setupCables, devices, chip.name, port);
      // visits: one entry per device stay, with the arriving/departing cables
      const visits = [{ dev: chip.name, inPort: '', inCable: '', outPort: port, outCable: '' }];
      for (const s of steps) {
        if (s.type === 'cable') {
          visits[visits.length - 1].outCable = s.cable_id;
          visits.push({ dev: s.toDev, inPort: s.toPort, inCable: s.cable_id, outPort: '', outCable: '' });
        } else {
          visits[visits.length - 1].outPort = s.toPort;
        }
      }
      const cells = [];
      for (const v of visits) {
        const role = roleOf.get(v.dev) || v.dev;
        const last = cells[cells.length - 1];
        if (last && last.role === role) last.visits.push(v);
        else cells.push({ role, visits: [v] });
      }
      const lastV = visits[visits.length - 1];
      rows.push({
        category, chip: chip.name, port, cells,
        connected: steps.length > 0,
        dangling: lastV.outCable ? null : { dev: lastV.dev, port: lastV.outPort || lastV.inPort },
      });
    }
  }

  const byCat = new Map();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category).push(r);
  }

  const tables = [];
  for (const [category, catRows] of byCat) {
    const columns = [];
    for (const r of catRows) {
      let ptr = 0;
      for (const cell of r.cells) {
        let found = -1;
        for (let i = ptr; i < columns.length; i++) if (columns[i] === cell.role) { found = i; break; }
        if (found === -1) { columns.splice(ptr, 0, cell.role); found = ptr; }
        ptr = found + 1;
      }
    }
    for (const r of catRows) {
      const slots = new Array(columns.length).fill(null);
      let ptr = 0;
      for (const cell of r.cells) {
        for (let i = ptr; i < columns.length; i++) {
          if (columns[i] === cell.role) { slots[i] = cell; ptr = i + 1; break; }
        }
      }
      r.slots = slots;
    }
    tables.push({ category, columns, rows: catRows });
  }
  return tables;
}
