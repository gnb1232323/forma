import { state, view, load, subscribe, today, iso } from './store.js';
import { goals, dayStats, currentWeight, equivalents, setsSummary, MODES } from './calc.js';
import { openWorkout, recentExercises } from './workout.js';
import { openFood, openBarcode, SLOTS } from './food.js';
import { openWelcome, openSettings, openWeight, openModePicker } from './settings.js';
import { $, $$, esc, icon, fmt, r1, clamp, hydratePhotos } from './ui.js';

// ---------- Верх: дата и режим ----------
function dateLabel(s) {
  const t = today();
  const y = iso(new Date(Date.now() - 864e5));
  if (s === t) return 'Сегодня';
  if (s === y) return 'Вчера';
  return new Date(s + 'T12:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
}

function headerHtml() {
  const isToday = view.date === today();
  return `
    <div class="date-nav">
      <button class="icon-btn" data-act="prev" aria-label="Предыдущий день">${icon('chevL')}</button>
      <button class="date-label" data-act="today">${esc(dateLabel(view.date))}</button>
      <button class="icon-btn" data-act="next" aria-label="Следующий день" ${isToday ? 'disabled' : ''}>${icon('chevR')}</button>
    </div>
    <div class="hdr-r">
      <button class="mode-chip" data-act="mode">${esc(MODES[state.profile.mode].t)}${icon('chevD')}</button>
      <button class="icon-btn" data-act="settings" aria-label="Настройки">${icon('sliders')}</button>
    </div>`;
}

// ---------- Сводка дня ----------
function summaryHtml() {
  const p = state.profile;
  const kg = currentWeight(state);
  const g = goals(p, kg);
  const st = dayStats(state, view.date);
  const budget = g.target + st.burned;
  const rem = budget - st.eaten;
  const over = rem < 0;
  const pct = clamp(st.eaten / budget, 0, 1);
  const C = 2 * Math.PI * 50;
  const isToday = view.date === today();

  let advice = '';
  let adviceCls = '';
  let burnBtn = '';
  if (p.mode === 'bulk') {
    if (rem > 0) advice = isToday ? `Нужно добрать ещё ${fmt(rem)} ккал` : `Не добрано ${fmt(rem)} ккал`;
    else {
      advice = 'Норма набора закрыта';
      adviceCls = 'good';
    }
  } else if (over) {
    const eq = equivalents(-rem, kg);
    adviceCls = 'bad';
    advice = isToday
      ? `Перебор ${fmt(-rem)} ккал. Это ≈ ${eq[0].min} мин ходьбы или ${eq[1].min} мин бега`
      : `Перебор ${fmt(-rem)} ккал`;
    if (isToday) burnBtn = `<button class="btn sm" data-act="burn" data-min="${eq[0].min}">${icon('pulse')}Добавить ходьбу ${eq[0].min} мин</button>`;
  } else if (st.eaten === 0 && st.burned === 0) {
    advice = isToday ? 'Начни с первой записи: фото тренажёра или тарелки' : 'В этот день записей нет';
  } else {
    advice = isToday ? `Можно съесть ещё ${fmt(rem)} ккал` : 'В рамках нормы';
    adviceCls = 'good';
    if (isToday && st.eaten > 0 && st.p < g.prot * 0.6 && rem < g.target * 0.5) advice += `. Белка пока ${fmt(st.p)} из ${g.prot} г`;
  }

  const macro = (l, v, goal, cls) =>
    `<div class="macro"><div class="m-top"><span>${l}</span><b>${fmt(v)}<i> / ${goal} г</i></b></div><div class="bar"><div class="${cls}" style="width:${clamp((v / goal) * 100, 0, 100)}%"></div></div></div>`;

  return `
    <section class="card summary">
      <div class="sum-top">
        <div class="ring ${over ? 'over' : ''}">
          <svg viewBox="0 0 120 120"><circle class="rg-bg" cx="60" cy="60" r="50"/><circle class="rg-fg" cx="60" cy="60" r="50" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}" transform="rotate(-90 60 60)"/></svg>
          <div class="ring-c"><b>${fmt(Math.abs(rem))}</b><span>${over ? 'сверх нормы' : 'осталось ккал'}</span></div>
        </div>
        <div class="stats">
          <div class="stat"><span>Норма</span><b>${fmt(g.target)}</b></div>
          <div class="stat"><span>Съедено</span><b>${fmt(st.eaten)}</b></div>
          <div class="stat"><span>Сожжено</span><b>${fmt(st.burned)}</b></div>
        </div>
      </div>
      <div class="macros">${macro('Белки', st.p, g.prot, 'm-p')}${macro('Жиры', st.f, g.fat, 'm-f')}${macro('Углеводы', st.c, g.carb, 'm-c')}</div>
      <div class="advice ${adviceCls}">${icon(over && p.mode !== 'bulk' ? 'flame' : 'bolt')}<span>${esc(advice)}</span></div>
      ${burnBtn}
      <button class="weight-chip" data-act="weight">${icon('scale')}Вес ${r1(kg)} кг<span>записать</span></button>
    </section>`;
}

// ---------- Вкладка «Тренировки» ----------
function workoutsHtml() {
  const st = dayStats(state, view.date);
  const list = [...st.works].sort((a, b) => a.ts - b.ts);
  const recent = recentExercises(8);

  const cards = list
    .map((w) => {
      const sub = w.kind === 'cardio' ? `${w.minutes} мин` : [setsSummary(w.sets), w.minutes ? `~${w.minutes} мин` : ''].filter(Boolean).join(' · ');
      const th = w.photoId ? `<img data-photo="${w.photoId}" alt="">` : icon(w.kind === 'cardio' ? 'pulse' : 'dumbbell');
      return `<button class="entry" data-act="edit-w" data-id="${w.id}">
        <div class="thumb">${th}</div>
        <div class="e-main"><b>${esc(w.name)}</b><span>${esc(sub)}</span>${w.muscles?.length ? `<div class="chips">${w.muscles.slice(0, 3).map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''}</div>
        <div class="e-kcal"><b>${fmt(w.kcal)}</b><span>ккал</span></div>
      </button>`;
    })
    .join('');

  const rec = recent.length
    ? `<div class="sec-title">Повторить</div><div class="chips scroll">${recent.map((w) => `<button class="chip-b" data-act="repeat" data-id="${w.id}">${esc(w.name)}</button>`).join('')}</div>`
    : '';

  return `
    <section class="actions">
      <button class="btn primary big" data-act="w-cam">${icon('camera')}Сфотографировать упражнение</button>
      <div class="row-btns three">
        <button class="btn" data-act="w-gal">${icon('image')}Из галереи</button>
        <button class="btn" data-act="w-cardio">${icon('pulse')}Кардио</button>
        <button class="btn" data-act="w-manual">${icon('plus')}Вручную</button>
      </div>
    </section>
    ${cards ? `<div class="sec-title">Сегодня сделано</div><div class="list">${cards}</div>` : `<div class="empty">${icon('dumbbell')}<p>Пока пусто. Сфотографируй тренажёр, табличку с названием или своё положение в упражнении.</p></div>`}
    ${rec}`;
}

// ---------- Вкладка «Еда» ----------
function foodHtml() {
  const st = dayStats(state, view.date);
  const groups = Object.entries(SLOTS)
    .map(([k, label]) => {
      const items = st.meals.filter((m) => m.slot === k).sort((a, b) => a.ts - b.ts);
      if (!items.length) return '';
      const sum = items.reduce((a, m) => a + m.kcal, 0);
      return `<div class="sec-title"><span>${label}</span><em>${fmt(sum)} ккал</em></div><div class="list">${items
        .map((m) => {
          const th = m.photoId ? `<img data-photo="${m.photoId}" alt="">` : icon('fork');
          return `<button class="entry" data-act="edit-f" data-id="${m.id}">
            <div class="thumb">${th}</div>
            <div class="e-main"><b>${esc(m.name)}</b><span>${m.grams ? m.grams + ' г · ' : ''}Б ${fmt(m.p)} · Ж ${fmt(m.f)} · У ${fmt(m.c)}</span></div>
            <div class="e-kcal"><b>${fmt(m.kcal)}</b><span>ккал</span></div>
          </button>`;
        })
        .join('')}</div>`;
    })
    .join('');

  return `
    <section class="actions">
      <button class="btn primary big" data-act="f-cam">${icon('camera')}Сфотографировать еду</button>
      <div class="row-btns three">
        <button class="btn" data-act="f-text">${icon('text')}Текстом</button>
        <button class="btn" data-act="f-bar">${icon('barcode')}Штрихкод</button>
        <button class="btn" data-act="f-fav">${icon('star')}Мои блюда</button>
      </div>
    </section>
    ${groups || `<div class="empty">${icon('fork')}<p>Пока пусто. Сфотографируй тарелку, опиши словами или отсканируй штрихкод упаковки.</p></div>`}`;
}

// ---------- Отрисовка ----------
function render() {
  if (!state.profile) return;
  $('#hdr').innerHTML = headerHtml();
  const body = view.tab === 'workouts' ? workoutsHtml() : foodHtml();
  $('#main').innerHTML = summaryHtml() + body;
  $$('#tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === view.tab));
  hydratePhotos($('#main'));
}

function shiftDate(days) {
  const d = new Date(view.date + 'T12:00');
  d.setDate(d.getDate() + days);
  const s = iso(d);
  if (s > today()) return;
  view.date = s;
  render();
}

// ---------- События ----------
const pick = (id) => $(id).click();

document.addEventListener('click', (e) => {
  if (e.target.closest('#sheetRoot')) return;
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    view.tab = tab.dataset.tab;
    render();
    window.scrollTo({ top: 0 });
    return;
  }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'prev': return shiftDate(-1);
    case 'next': return shiftDate(1);
    case 'today': view.date = today(); return render();
    case 'settings': return openSettings();
    case 'mode': return openModePicker();
    case 'weight': return openWeight();
    case 'w-cam': return pick('#in-w-cam');
    case 'w-gal': return pick('#in-w-gal');
    case 'w-cardio': return openWorkout({ kind: 'cardio' });
    case 'w-manual': return openWorkout({});
    case 'burn':
      return openWorkout({ kind: 'cardio', preset: { kind: 'cardio', name: 'Ходьба', cardioType: 'walk', met: 3.5, minutes: Number(b.dataset.min) } });
    case 'edit-w': return openWorkout({ edit: state.workouts.find((w) => w.id === id) });
    case 'repeat': {
      const w = state.workouts.find((x) => x.id === id);
      return openWorkout({ preset: w });
    }
    case 'f-cam': return pick('#in-f-cam');
    case 'f-text': return openFood({ mode: 'text' });
    case 'f-bar': return openBarcode();
    case 'f-fav': return openFood({ mode: 'manual', items: [], openFavs: true });
    case 'edit-f': return openFood({ mode: 'edit', edit: state.meals.find((m) => m.id === id) });
  }
});

function fileInput(sel, handler) {
  const el = $(sel);
  el.addEventListener('change', () => {
    const f = el.files?.[0];
    el.value = '';
    if (f) handler(f);
  });
}
fileInput('#in-w-cam', (file) => openWorkout({ file }));
fileInput('#in-w-gal', (file) => openWorkout({ file }));
fileInput('#in-f-cam', (file) => openFood({ mode: 'photo', file }));

// новый день — если приложение стояло открытым
let lastToday = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = today();
  if (t !== lastToday) {
    if (view.date === lastToday) view.date = t;
    lastToday = t;
    render();
  }
});

// ---------- Старт ----------
(async function init() {
  await load();
  subscribe(render);
  if (!state.profile) openWelcome();
  else render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
