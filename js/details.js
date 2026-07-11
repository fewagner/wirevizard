// details.js — popup with the free-text comment and attached images of a
// device or cable. Opened from the ℹ buttons in the tables and by clicking
// boxes/lines in the diagrams. The comment is stored in the CSV row and
// committed on Save like everything else; images land in images/ in the
// data repo.

import { store } from './store.js';
import { toast } from './ui.js';
import { setDeviceComment, setCableComment } from './data.js';
import { esc, debounce, renderMarkdown } from './util.js';

let scrim, modal;
let current = null; // { type: 'device'|'cable', key }
const $ = sel => modal.querySelector(sel);

function record() {
  if (!current) return null;
  return current.type === 'device'
    ? store.devices.find(d => d.name === current.key)
    : store.cables.find(c => c.cable_id === current.key);
}

export function initDetails() {
  scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.hidden = true;

  modal = document.createElement('div');
  modal.className = 'modal details';
  modal.hidden = true;
  modal.innerHTML = `
    <header class="modal-head">
      <h2 class="dt-title"></h2>
      <button class="icon-btn dt-close" title="Close">✕</button>
    </header>
    <div class="modal-body">
      <p class="hint dt-sub"></p>
      <label class="field">
        <span class="field-name">Comment (Markdown; link images like <code>![label](images/…)</code>)</span>
        <textarea class="dt-comment" rows="5" placeholder="free-text notes…"></textarea>
      </label>
      <div class="btn-row">
        <button class="btn dt-attach">📎 Attach image…</button>
        <input class="dt-file" type="file" accept="image/*" multiple hidden>
      </div>
      <div class="dt-preview md-preview"></div>
      <p class="hint">Comments and images are saved to GitHub when you press Save.</p>
    </div>`;

  document.body.appendChild(scrim);
  document.body.appendChild(modal);

  scrim.addEventListener('pointerdown', closeDetails);
  $('.dt-close').addEventListener('click', closeDetails);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) closeDetails();
  });

  const commitComment = debounce(() => {
    if (!current) return;
    const text = $('.dt-comment').value;
    const { type, key } = current;
    try {
      store.mutate(s => type === 'device' ? setDeviceComment(s, key, text) : setCableComment(s, key, text));
    } catch (e) {
      toast(e.message, 'err');
    }
    renderPreview();
  }, 300);
  $('.dt-comment').addEventListener('input', commitComment);

  $('.dt-attach').addEventListener('click', () => $('.dt-file').click());
  $('.dt-file').addEventListener('change', async e => {
    for (const file of e.target.files || []) {
      try {
        const dataUrl = await downscale(file);
        const path = store.addImage(file.name, dataUrl);
        const ta = $('.dt-comment');
        ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + '\n\n' : '') + `![${file.name}](${path})`;
        ta.dispatchEvent(new Event('input'));
      } catch (err) {
        toast(`Could not read ${file.name}: ${err.message || err}`, 'err');
      }
    }
    e.target.value = '';
  });
}

// Downscale client-side so the data repo (and localStorage draft) stay small.
function downscale(file, maxDim = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const keepPng = file.type === 'image/png' && scale === 1 && file.size < 500_000;
      resolve(canvas.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not a readable image')); };
    img.src = url;
  });
}

function renderPreview() {
  const rec = record();
  const host = $('.dt-preview');
  host.innerHTML = renderMarkdown(rec?.comment || '');
  // <img> can't authenticate against the private data repo — swap each image
  // source for a blob URL fetched through the API (or a pending data URL).
  for (const img of host.querySelectorAll('img[data-src]')) {
    store.imageUrl(img.dataset.src).then(url => {
      if (url) img.src = url;
      else img.alt = `⚠ ${img.dataset.src} (not loadable — save first, or check the path)`;
    });
  }
}

export function openDetails(type, key) {
  current = { type, key };
  const rec = record();
  if (!rec) { toast(`${type} '${key}' not found`, 'err'); return; }
  $('.dt-title').textContent = type === 'device' ? `Device ${key}` : `Cable ${key}`;
  $('.dt-sub').textContent = type === 'device'
    ? (rec.description || '')
    : `${rec.from_device} [${rec.from_port}] → ${rec.to_device} [${rec.to_port}]${rec.setup ? ` · ${rec.setup}` : ''}`;
  $('.dt-comment').value = rec.comment || '';
  renderPreview();
  scrim.hidden = false;
  modal.hidden = false;
}

export function closeDetails() {
  current = null;
  scrim.hidden = true;
  modal.hidden = true;
}

// A small ℹ button for table rows; filled when a comment exists.
export function detailsBtnHtml(type, key, comment) {
  return `<button class="icon-btn dt-open${comment ? ' has-comment' : ''}" data-dt-type="${type}" data-dt-key="${esc(key)}" title="${comment ? 'View/edit comment' : 'Add comment'}">💬</button>`;
}

// Event delegation helper — call once per container.
export function wireDetailsButtons(container) {
  container.addEventListener('click', e => {
    const btn = e.target.closest('.dt-open');
    if (btn) openDetails(btn.dataset.dtType, btn.dataset.dtKey);
  });
}
