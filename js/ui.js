// ui.js — shared UI primitives.

export function toast(msg, type = 'info', ms = 3800, href = null) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement(href ? 'a' : 'div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  if (href) {
    el.href = href;
    el.target = '_blank';
    el.rel = 'noopener';
  }
  el.addEventListener('click', () => el.remove());
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
