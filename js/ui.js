// Мелкие UI-помощники: экранирование, иконки, шторки (bottom sheet), тосты.
import { getPhoto } from './store.js';

// <img data-photo="id"> -> подставляет сохранённое фото
export function hydratePhotos(root = document) {
  root.querySelectorAll('img[data-photo]').forEach((im) => {
    const id = im.dataset.photo;
    if (!id || im.dataset.done === id) return;
    im.dataset.done = id;
    getPhoto(id).then((src) => {
      if (src) im.src = src;
    });
  });
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-8 9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  fork: '<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 21V3c-2.5 1.5-3.5 5-3.5 8h3.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  barcode: '<path d="M4 6v12M7 6v12M11 6v12M14 6v12M17 6v12M20 6v12"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  scale: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10a4 4 0 0 1 8 0"/><path d="m12 10 2-2"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  sparkles: '<path d="M12 4l1.8 4.7 4.7 1.8-4.7 1.8L12 17l-1.8-4.7L5.5 10.5l4.7-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  flame: '<path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

export const icon = (n, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

// ---------- Шторка ----------
let current = null;

export function openSheet({ title = '', html = '', onMount, dismissible = true, tall = false } = {}) {
  closeSheet(true);
  const root = $('#sheetRoot');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-bg"></div>
    <div class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>
      <div class="sheet-head">
        <h2>${esc(title)}</h2>
        ${dismissible ? `<button class="icon-btn" data-s="close" aria-label="Закрыть">${icon('x')}</button>` : ''}
      </div>
      <div class="sheet-body">${html}</div>
    </div>`;
  root.appendChild(wrap);
  document.body.classList.add('lock');
  requestAnimationFrame(() => wrap.classList.add('open'));

  const ctl = {
    el: wrap,
    body: $('.sheet-body', wrap),
    sheet: $('.sheet', wrap),
    setBody(h) {
      this.body.innerHTML = h;
    },
    setTitle(t) {
      $('.sheet-head h2', wrap).textContent = t;
    },
    close() {
      closeSheet();
    },
    onClose: null,
  };
  if (dismissible) {
    $('.sheet-bg', wrap).addEventListener('click', () => closeSheet());
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-s="close"]')) closeSheet();
    });
  }
  current = ctl;
  onMount?.(ctl);
  return ctl;
}

export function closeSheet(instant = false) {
  if (!current) return;
  const c = current;
  current = null;
  c.onClose?.();
  if (instant) {
    c.el.remove();
  } else {
    c.el.classList.remove('open');
    setTimeout(() => c.el.remove(), 260);
  }
  document.body.classList.remove('lock');
}

export const sheetOpen = () => !!current;

// ---------- Тост ----------
let toastTimer;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3200);
}

// ---------- Форматирование ----------
export const num = (v, d = 0) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : d;
};
export const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
export const r1 = (n) => Math.round(n * 10) / 10;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
