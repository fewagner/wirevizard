// util.js — small helpers: HTML escaping, debounce, localStorage, base64, CSV.

export const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export const clone = o => JSON.parse(JSON.stringify(o));

export const lsGet = k => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; }
};
export const lsSet = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
};
export const lsDel = k => { try { localStorage.removeItem(k); } catch { } };

export function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function b64DecodeUtf8(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------- CSV (RFC 4180) ----------

// Parse CSV text into an array of rows (arrays of strings).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false, i = 0;
  const s = String(text || '');
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { pushField(); i++; continue; }
    if (c === '\r') { if (s[i + 1] === '\n') i++; pushRow(); i++; continue; }
    if (c === '\n') { pushRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) pushRow();
  // drop fully-empty trailing rows
  while (rows.length && rows[rows.length - 1].every(f => f === '')) rows.pop();
  return rows;
}

const csvField = v => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// Serialize rows (arrays of strings) to canonical CSV text (\n endings, trailing newline).
export function serializeCsv(rows) {
  return rows.map(r => r.map(csvField).join(',')).join('\n') + '\n';
}

// Parse CSV with a header row into objects with the given field names.
export function csvToObjects(text, fields) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0];
  const idx = fields.map(f => header.indexOf(f));
  return rows.slice(1).map(r => {
    const o = {};
    fields.forEach((f, j) => { o[f] = idx[j] >= 0 ? (r[idx[j]] ?? '') : ''; });
    return o;
  });
}

export function objectsToCsv(objects, fields) {
  return serializeCsv([fields, ...objects.map(o => fields.map(f => o[f] ?? ''))]);
}
