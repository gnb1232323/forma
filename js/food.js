// Шторки вкладки «Еда»: добавить блюдо (фото / текст / вручную), штрихкод, мои блюда.

import { state, view, commit, uid, putPhoto, dropPhotoIfUnused } from './store.js';
import { analyzeFood, prepareImage, lookupBarcode, AIError } from './ai.js';
import { openSheet, closeSheet, esc, icon, toast, num, fmt, r1, hydratePhotos, $ } from './ui.js';

export const SLOTS = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };

export function guessSlot() {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}

const blank = () => ({ name: '', grams: 0, kcal: 0, p: 0, f: 0, c: 0, fav: false });
// «опорная» порция: от неё считаем, когда меняют граммы (так калории не теряются, если поле на секунду очистили)
const anchor = (it) => {
  it.base = it.grams > 0 ? { grams: it.grams, kcal: it.kcal, p: it.p, f: it.f, c: it.c } : null;
  return it;
};
const fromAI = (i) => ({
  name: i.name,
  grams: Number(i.grams) || 0,
  kcal: Number(i.kcal) || 0,
  p: Number(i.protein) || 0,
  f: Number(i.fat) || 0,
  c: Number(i.carbs) || 0,
  fav: false,
});

// mode: 'photo' | 'text' | 'manual' | 'edit'
export async function openFood({ mode = 'manual', file = null, items = [], edit = null, slot = null, openFavs = false } = {}) {
  const m = {
    items: edit ? [{ name: edit.name, grams: edit.grams || 0, kcal: edit.kcal, p: edit.p, f: edit.f, c: edit.c, fav: false }] : items.map((i) => ({ ...blank(), ...i })),
    slot: edit?.slot || slot || guessSlot(),
    text: '',
  };
  if (!m.items.length && mode !== 'text' && mode !== 'photo') m.items.push(blank());
  m.items.forEach(anchor);
  let thumb = null;
  let b64 = null;
  const photoId = edit?.photoId || null;
  const ui = { busy: false, status: '', kind: '', note: '' };
  const hasKey = () => !!state.settings.apiKey?.trim();

  const ctl = openSheet({ title: edit ? 'Блюдо' : mode === 'text' ? 'Описать едой' : mode === 'photo' ? 'Фото еды' : 'Добавить еду', tall: true });

  const totals = () => m.items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.p, f: a.f + i.f, c: a.c + i.c }), { kcal: 0, p: 0, f: 0, c: 0 });

  function itemHtml(it, i) {
    return `<div class="food-item" data-i="${i}">
      <div class="fi-top">
        <input class="input" data-f="name" data-i="${i}" value="${esc(it.name)}" placeholder="Название">
        <button class="icon-btn sm ${it.fav ? 'fav' : ''}" data-s="fav" data-i="${i}" aria-label="В мои блюда">${icon('star')}</button>
        <button class="icon-btn sm" data-s="rm" data-i="${i}" aria-label="Убрать">${icon('x')}</button>
      </div>
      <div class="fi-nums">
        ${[
          ['grams', 'г', it.grams],
          ['kcal', 'ккал', it.kcal],
          ['p', 'Б', it.p],
          ['f', 'Ж', it.f],
          ['c', 'У', it.c],
        ]
          .map(
            ([k, l, v]) =>
              `<label><input class="input num" inputmode="decimal" data-f="${k}" data-i="${i}" value="${v ? r1(v) : ''}" placeholder="0"><em>${l}</em></label>`
          )
          .join('')}
      </div>
      <div class="per100" data-per="${i}">${per100(it)}</div>
    </div>`;
  }

  // подсказка: сколько это на 100 г — сразу видно, если цифры нереальные
  function per100(it) {
    return it.grams > 0 && it.kcal > 0 ? `≈ ${fmt((it.kcal / it.grams) * 100)} ккал на 100 г` : '';
  }

  function draw() {
    const t = totals();
    const src = thumb ? `src="${thumb}"` : photoId ? `data-photo="${photoId}"` : '';
    const photo = src
      ? `<div class="photo-prev"><img ${src} alt="">${ui.status ? `<div class="ai-status ${ui.kind}">${ui.busy ? '<span class="spin"></span>' : ''}${esc(ui.status)}</div>` : ''}</div>`
      : ui.status
        ? `<div class="ai-status inline ${ui.kind}">${ui.busy ? '<span class="spin"></span>' : ''}${esc(ui.status)}</div>`
        : '';
    const textBox =
      mode === 'text' || (!thumb && !edit && hasKey())
        ? `<div class="ai-row col">
        <textarea class="input" rows="2" data-in="text" placeholder="Например: 2 яйца, бутерброд с сыром и кофе с молоком">${esc(m.text)}</textarea>
        <button class="btn sm" data-s="analyze" ${ui.busy ? 'disabled' : ''}>${icon('sparkles')}Посчитать ИИ</button>
      </div>`
        : '';
    const noKey = !hasKey() && (mode === 'photo' || mode === 'text') && !edit
      ? `<div class="note">${icon('sparkles')}<span>Для расчёта по фото и тексту нужен бесплатный ключ ИИ (в настройках). Пока можно ввести значения вручную.</span></div>`
      : '';
    const slots = Object.entries(SLOTS)
      .map(([k, v]) => `<button class="${m.slot === k ? 'on' : ''}" data-s="slot" data-v="${k}">${v}</button>`)
      .join('');
    ctl.setBody(`<div class="stack">
      ${photo}${noKey}${textBox}
      ${ui.note ? `<div class="hint">${esc(ui.note)}</div>` : ''}
      <div class="seg small">${slots}</div>
      <div class="items">${m.items.map(itemHtml).join('')}</div>
      <div class="row-btns">
        <button class="btn ghost" data-s="add">${icon('plus')}Вручную</button>
        <button class="btn ghost" data-s="favs">${icon('star')}Мои блюда</button>
      </div>
      <div class="total-line"><b id="f-kcal">${fmt(t.kcal)}</b> ккал<span id="f-macro">Б ${fmt(t.p)} · Ж ${fmt(t.f)} · У ${fmt(t.c)}</span></div>
      <div class="sheet-actions">
        ${edit ? `<button class="btn danger" data-s="del">${icon('trash')}</button>` : ''}
        <button class="btn primary grow" data-s="save">${icon('check')}Сохранить</button>
      </div>
    </div>`);
    hydratePhotos(ctl.body);
  }

  function refreshTotals() {
    const t = totals();
    $('#f-kcal', ctl.body).textContent = fmt(t.kcal);
    $('#f-macro', ctl.body).textContent = `Б ${fmt(t.p)} · Ж ${fmt(t.f)} · У ${fmt(t.c)}`;
  }

  async function analyze() {
    if (ui.busy) return;
    if (!b64 && !m.text.trim()) {
      toast('Опиши еду или сфотографируй');
      return;
    }
    ui.busy = true;
    ui.status = 'ИИ считает калории…';
    ui.kind = '';
    draw();
    try {
      const r = await analyzeFood({ b64, text: m.text.trim() });
      const got = (r.items || []).map(fromAI).filter((i) => i.name);
      if (!got.length) throw new AIError('ИИ не нашёл еду. Попробуй описать словами.', 'empty');
      got.forEach(anchor);
      m.items = m.items.filter((i) => i.name || i.kcal).concat(got);
      ui.status = 'Готово. Поправь граммы, если нужно';
      ui.kind = 'ok';
      ui.note = r.note || '';
    } catch (e) {
      ui.status = e instanceof AIError ? e.message : 'Не получилось посчитать';
      ui.kind = 'err';
    }
    ui.busy = false;
    draw();
  }

  async function save() {
    const list = m.items.filter((i) => i.name.trim() || i.kcal > 0);
    if (!list.length) {
      toast('Добавь хотя бы одно блюдо');
      return;
    }
    let pid = photoId;
    if (thumb) pid = await putPhoto(thumb);
    const base = { date: edit?.date || view.date, slot: m.slot };
    list.forEach((it, idx) => {
      const entry = {
        id: idx === 0 && edit ? edit.id : uid(),
        ts: idx === 0 && edit ? edit.ts : Date.now() + idx,
        ...base,
        name: it.name.trim() || 'Без названия',
        grams: Math.round(it.grams) || 0,
        kcal: Math.round(it.kcal),
        p: r1(it.p),
        f: r1(it.f),
        c: r1(it.c),
        photoId: idx === 0 ? pid : null,
      };
      if (idx === 0 && edit) state.meals = state.meals.map((x) => (x.id === edit.id ? entry : x));
      else state.meals.push(entry);
      if (it.fav) saveFav(entry);
    });
    commit();
    closeSheet();
    toast(`Записано: ${fmt(totals().kcal)} ккал`);
  }

  function saveFav(e) {
    const key = e.name.toLowerCase();
    const f = { id: uid(), name: e.name, grams: e.grams, kcal: e.kcal, p: e.p, f: e.f, c: e.c };
    const i = state.favorites.findIndex((x) => x.name.toLowerCase() === key);
    if (i >= 0) state.favorites[i] = { ...f, id: state.favorites[i].id };
    else state.favorites.push(f);
  }

  ctl.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const a = b.dataset.s;
    const i = Number(b.dataset.i);
    if (a === 'slot') {
      m.slot = b.dataset.v;
      draw();
    } else if (a === 'fav') {
      m.items[i].fav = !m.items[i].fav;
      b.classList.toggle('fav', m.items[i].fav);
    } else if (a === 'rm') {
      m.items.splice(i, 1);
      draw();
    } else if (a === 'add') {
      m.items.push(blank());
      draw();
    } else if (a === 'analyze') {
      analyze();
    } else if (a === 'favs') {
      showFavorites();
    } else if (a === 'save') {
      await save();
    } else if (a === 'del') {
      if (confirm('Удалить это блюдо?')) {
        state.meals = state.meals.filter((x) => x.id !== edit.id);
        commit();
        dropPhotoIfUnused(edit.photoId);
        closeSheet();
        toast('Удалено');
      }
    }
  });

  ctl.body.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.in === 'text') {
      m.text = t.value;
      return;
    }
    const k = t.dataset.f;
    if (!k) return;
    const it = m.items[Number(t.dataset.i)];
    if (k === 'name') {
      it.name = t.value;
      return;
    }
    const v = num(t.value);
    if (k === 'grams') {
      it.grams = v;
      if (v > 0 && it.base) {
        // граммы поменяли — калории и БЖУ пересчитываются от опорной порции
        const ratio = v / it.base.grams;
        for (const f of ['kcal', 'p', 'f', 'c']) {
          it[f] = it.base[f] * ratio;
          const inp = $(`[data-f="${f}"][data-i="${t.dataset.i}"]`, ctl.body);
          if (inp) inp.value = it[f] ? r1(it[f]) : '';
        }
      } else if (v > 0 && it.kcal > 0) {
        anchor(it); // вес до этого не был указан: считаем, что введённые калории относятся к нему
      }
    } else {
      it[k] = v;
      anchor(it); // значения поправили руками — от них и считаем дальше
    }
    const hint = $(`[data-per="${t.dataset.i}"]`, ctl.body);
    if (hint) hint.textContent = per100(it);
    refreshTotals();
  });

  function showFavorites() {
    openFavorites({
      ctl,
      pick: (f) => {
        m.items = m.items.filter((x) => x.name || x.kcal);
        m.items.push(anchor({ ...f, fav: false }));
      },
      redraw: draw,
    });
  }

  draw();
  if (openFavs) showFavorites();

  if (file) {
    ui.busy = true;
    ui.status = 'Готовлю фото…';
    draw();
    try {
      const p = await prepareImage(file);
      thumb = p.thumb;
      b64 = p.b64;
    } catch {
      ui.busy = false;
      ui.status = 'Не удалось открыть фото';
      ui.kind = 'err';
      draw();
      return;
    }
    ui.busy = false;
    ui.status = '';
    draw();
    if (hasKey()) analyze();
    else {
      ui.status = 'Фото сохранится вместе с записью';
      draw();
    }
  }
}

// ---------- Мои блюда ----------
function openFavorites({ pick, redraw, ctl }) {
  // слой внутри текущей шторки, чтобы не терять введённое
  const keep = ctl;
  const favs = [...state.favorites].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  // мини-оверлей внутри текущей шторки, чтобы не терять введённое
  const box = document.createElement('div');
  box.className = 'fav-overlay';
  box.innerHTML = `<div class="fav-head"><b>Мои блюда</b><button class="icon-btn sm" data-x>${icon('x')}</button></div>
    ${favs.length ? `<div class="fav-list">${favs.map((f) => `<button class="fav-row" data-id="${f.id}"><span>${esc(f.name)}</span><em>${f.grams ? f.grams + ' г · ' : ''}${fmt(f.kcal)} ккал</em></button>`).join('')}</div>` : `<div class="empty-sm">Пока пусто. Нажми звёздочку у блюда, чтобы сохранить его сюда.</div>`}`;
  keep.sheet.appendChild(box);
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return box.remove();
    const row = e.target.closest('.fav-row');
    if (!row) return;
    const f = state.favorites.find((x) => x.id === row.dataset.id);
    if (f) {
      pick({ name: f.name, grams: f.grams, kcal: f.kcal, p: f.p, f: f.f, c: f.c });
      box.remove();
      redraw();
    }
  });
}

// ---------- Штрихкод ----------
export function openBarcode() {
  let stream = null;
  let stopped = false;
  const supported = 'BarcodeDetector' in window;

  const ctl = openSheet({
    title: 'Штрихкод',
    html: `<div class="stack">
      ${supported ? `<div class="scan"><video id="scan-v" playsinline muted></video><div class="scan-frame"></div></div><div class="hint" id="scan-s">Наведи камеру на штрихкод упаковки</div>` : `<div class="note">${icon('info')}<span>Этот браузер не умеет сканировать штрихкод камерой. Введи цифры с упаковки.</span></div>`}
      <div class="ai-row">
        <input class="input" id="scan-code" inputmode="numeric" placeholder="Цифры штрихкода">
        <button class="btn sm" data-s="go">Найти</button>
      </div>
    </div>`,
  });
  ctl.onClose = () => {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
  };

  async function found(code) {
    const st = $('#scan-s', ctl.body);
    if (st) st.textContent = 'Ищу в базе продуктов…';
    try {
      const p = await lookupBarcode(code);
      if (!p) {
        toast('Товар не найден в базе. Введи вручную', 'err');
        closeSheet(true);
        openFood({ mode: 'manual', items: [{ name: `Штрихкод ${code}` }] });
        return;
      }
      closeSheet(true);
      openFood({ mode: 'manual', items: [p] });
    } catch (e) {
      toast(e.message || 'Ошибка поиска', 'err');
      stopped = false;
    }
  }

  ctl.body.addEventListener('click', (e) => {
    if (!e.target.closest('[data-s="go"]')) return;
    const c = $('#scan-code', ctl.body).value.replace(/\D/g, '');
    if (c.length < 6) return toast('Слишком короткий код');
    found(c);
  });

  if (!supported) return;
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      const v = $('#scan-v', ctl.body);
      if (!v) return stream.getTracks().forEach((t) => t.stop());
      v.srcObject = stream;
      await v.play();
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await det.detect(v);
          if (codes.length) {
            stopped = true;
            stream.getTracks().forEach((t) => t.stop());
            return found(codes[0].rawValue);
          }
        } catch {}
        setTimeout(tick, 250);
      };
      tick();
    } catch {
      const st = $('#scan-s', ctl.body);
      if (st) st.textContent = 'Нет доступа к камере. Введи цифры вручную.';
    }
  })();
}
