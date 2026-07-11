// util.js — small helpers: HTML escaping, debounce, localStorage, base64, CSV.

export const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export const uid = () => Math.random().toString(36).slice(2, 8);

export const slugify = s => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

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

// ---------- Markdown subset renderer (escape first, then transform) ----------
// Used for the free-text comments on devices and cables. Placeholders use
// private-use characters U+E000/U+E001 so user text can't forge them.

export function renderMarkdown(md, resolveImg = s => s) {
  if (!md || !String(md).trim()) return '';
  let text = esc(String(md).replace(/\r\n/g, '\n'));
  const slots = [];
  const put = html => { slots.push(html); return `\uE000${slots.length - 1}\uE001`; };

  text = text.replace(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm, (_, code) => put(`<pre><code>${code}</code></pre>`));

  const inline = s => {
    s = s.replace(/`([^`\n]+)`/g, (_, c) => put(`<code>${c}</code>`));
    s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
      const raw = src.replace(/&amp;/g, '&');
      return put(`<img src="${esc(resolveImg(raw))}" alt="${alt}" loading="lazy" data-src="${esc(raw)}">`);
    });
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
      const raw = href.replace(/&amp;/g, '&');
      const safe = /^(https?:|mailto:)/i.test(raw) ? raw : '#';
      return put(`<a href="${esc(safe)}" target="_blank" rel="noopener">${t}</a>`);
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    return s;
  };

  const lines = text.split('\n');
  const out = [];
  const para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para.length = 0;
  };
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { flushPara(); i++; continue; }
    if (/^\uE000\d+\uE001$/.test(t)) { flushPara(); out.push(t); i++; continue; }
    let m;
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++; continue;
    }
    if (/^[-*]\s+/.test(t)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`); i++;
      }
      out.push(`<ul>${items.join('')}</ul>`); continue;
    }
    if (/^\d+[.)]\s+/.test(t)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^\d+[.)]\s+/, ''))}</li>`); i++;
      }
      out.push(`<ol>${items.join('')}</ol>`); continue;
    }
    para.push(t); i++;
  }
  flushPara();

  let html = out.join('\n');
  let guard = 0;
  while (/\uE000/.test(html) && guard++ < 10) {
    html = html.replace(/\uE000(\d+)\uE001/g, (_, n) => slots[+n] ?? '');
  }
  return html;
}
