// Шторки: первый запуск, настройки, вес, выбор режима.

import { state, view, commit, exportAll, importAll, wipeAll } from './store.js';
import { ACT, MODES, goals, currentWeight } from './calc.js';
import { listFlashModels, DEFAULT_MODEL, AIError } from './ai.js';
import { openSheet, closeSheet, esc, icon, toast, num, fmt, r1, $, $$ } from './ui.js';

const KEY_URL = 'https://aistudio.google.com/apikey';

function profileHtml(p) {
  const acts = Object.entries(ACT)
    .map(([k, a]) => `<button class="card-opt ${p.activity === k ? 'on' : ''}" data-s="act" data-v="${k}"><b>${a.t}</b><span>${a.d}</span></button>`)
    .join('');
  const modes = Object.entries(MODES)
    .map(([k, a]) => `<button class="card-opt ${p.mode === k ? 'on' : ''}" data-s="mode" data-v="${k}"><b>${a.t}</b><span>${a.d}</span></button>`)
    .join('');
  return `
    <div class="seg">
      <button class="${p.sex === 'm' ? 'on' : ''}" data-s="sex" data-v="m">Мужчина</button>
      <button class="${p.sex === 'f' ? 'on' : ''}" data-s="sex" data-v="f">Женщина</button>
    </div>
    <div class="grid3">
      <label class="field"><span>Возраст</span><input class="input" inputmode="numeric" data-p="age" value="${p.age || ''}" placeholder="30"></label>
      <label class="field"><span>Рост, см</span><input class="input" inputmode="numeric" data-p="height" value="${p.height || ''}" placeholder="175"></label>
      <label class="field"><span>Вес, кг</span><input class="input" inputmode="decimal" data-p="weight" value="${p.weight || ''}" placeholder="80"></label>
    </div>
    <label class="field"><span>Желаемый вес, кг (по желанию)</span><input class="input" inputmode="decimal" data-p="goalWeight" value="${p.goalWeight || ''}" placeholder="например 72"></label>
    <div class="block-h">Обычный день без тренировок</div>
    <div class="opts">${acts}</div>
    <div class="block-h">Режим</div>
    <div class="opts">${modes}</div>`;
}

function bindProfile(root, p, onChange) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s="sex"],[data-s="act"],[data-s="mode"]');
    if (!b) return;
    const k = { sex: 'sex', act: 'activity', mode: 'mode' }[b.dataset.s];
    p[k] = b.dataset.v;
    $$(`[data-s="${b.dataset.s}"]`, root).forEach((x) => x.classList.toggle('on', x === b));
    onChange?.();
  });
  root.addEventListener('input', (e) => {
    const k = e.target.dataset.p;
    if (k) {
      p[k] = num(e.target.value);
      onChange?.();
    }
  });
}

function validProfile(p) {
  if (!(p.age >= 12 && p.age <= 95)) return 'Укажи возраст';
  if (!(p.height >= 120 && p.height <= 230)) return 'Укажи рост в сантиметрах';
  if (!(p.weight >= 30 && p.weight <= 300)) return 'Укажи вес в килограммах';
  return '';
}

// ---------- Первый запуск ----------
export function openWelcome() {
  const p = { sex: 'm', age: 0, height: 0, weight: 0, goalWeight: 0, activity: 'low', mode: 'cut' };
  const ctl = openSheet({ title: 'Давай настроим Форму', dismissible: false, tall: true });
  let step = 1;

  function draw() {
    if (step === 1) {
      ctl.setBody(`<div class="stack">
        <p class="lead">Эти данные нужны, чтобы посчитать твою норму калорий. Они остаются только на этом телефоне.</p>
        ${profileHtml(p)}
        <div class="sheet-actions"><button class="btn primary grow" data-s="next">Дальше</button></div>
      </div>`);
    } else {
      ctl.setBody(`<div class="stack">
        <p class="lead">Чтобы приложение узнавало тренажёры и еду по фото, нужен бесплатный ключ ИИ от Google. Это займёт минуту.</p>
        <ol class="steps">
          <li>Открой <a href="${KEY_URL}" target="_blank" rel="noopener">aistudio.google.com/apikey</a></li>
          <li>Войди в Google-аккаунт и нажми <b>Create API key</b></li>
          <li>Скопируй ключ и вставь сюда</li>
        </ol>
        <label class="field"><span>Ключ ИИ</span><input class="input" id="w-key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Вставь ключ сюда"></label>
        <div class="sheet-actions">
          <button class="btn ghost" data-s="skip">Позже</button>
          <button class="btn primary grow" data-s="finish">Готово</button>
        </div>
      </div>`);
    }
  }

  bindProfile(ctl.body, p);
  ctl.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'next') {
      const err = validProfile(p);
      if (err) return toast(err, 'err');
      step = 2;
      draw();
    } else if (b.dataset.s === 'skip' || b.dataset.s === 'finish') {
      const key = b.dataset.s === 'finish' ? $('#w-key', ctl.body)?.value.trim() : '';
      state.profile = { ...p };
      if (key) state.settings.apiKey = key;
      state.weights = [{ date: view.date, kg: p.weight }];
      commit();
      closeSheet();
      toast(key ? 'Всё готово, ИИ подключён' : 'Готово. Ключ можно добавить в настройках');
    }
  });
  draw();
}

// ---------- Настройки ----------
export function openSettings() {
  const p = { ...state.profile };
  const s = { apiKey: state.settings.apiKey || '', model: state.settings.model || DEFAULT_MODEL };
  let models = [...new Set([s.model, DEFAULT_MODEL, 'gemini-2.5-flash-lite'])];
  let keyStatus = '';
  let keyKind = '';
  const ctl = openSheet({ title: 'Настройки', tall: true });

  const g = () => goals(p, currentWeight(state));
  function goalLine() {
    const x = g();
    return `Норма: <b>${fmt(x.target)}</b> ккал · Б ${x.prot} · Ж ${x.fat} · У ${x.carb}`;
  }

  function draw() {
    ctl.setBody(`<div class="stack">
      <div class="block"><div class="block-h">Профиль</div>${profileHtml(p)}<div class="goal-line" id="goal-line">${goalLine()}</div></div>

      <div class="block">
        <div class="block-h">Бесплатный ИИ (Google Gemini)</div>
        <p class="hint">Ключ хранится только на этом телефоне. Получить: <a href="${KEY_URL}" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. Бесплатный лимит ограничен, при превышении можно вводить вручную.</p>
        <label class="field"><span>Ключ</span><input class="input" id="s-key" type="password" autocomplete="off" spellcheck="false" value="${esc(s.apiKey)}" placeholder="Вставь ключ сюда"></label>
        <label class="field"><span>Модель</span>
          <select class="input" id="s-model">${models.map((m) => `<option value="${esc(m)}" ${m === s.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
        </label>
        <button class="btn ghost full" data-s="check">${icon('check')}Проверить ключ</button>
        ${keyStatus ? `<div class="ai-status inline ${keyKind}">${esc(keyStatus)}</div>` : ''}
      </div>

      <div class="block">
        <div class="block-h">Данные</div>
        <div class="row-btns">
          <button class="btn ghost" data-s="export">Сохранить копию</button>
          <button class="btn ghost" data-s="import">Загрузить копию</button>
        </div>
        <button class="btn ghost full danger-t" data-s="wipe">${icon('trash')}Удалить все данные</button>
        <p class="hint">Данные лежат только в браузере этого телефона. Если сменишь телефон или очистишь браузер, они пропадут, поэтому иногда сохраняй копию.</p>
      </div>

      <div class="sheet-actions"><button class="btn primary grow" data-s="save">Сохранить</button></div>
    </div>`);
  }

  bindProfile(ctl.body, p, () => {
    const el = $('#goal-line', ctl.body);
    if (el && !validProfile(p)) el.innerHTML = goalLine();
  });

  ctl.body.addEventListener('input', (e) => {
    if (e.target.id === 's-key') s.apiKey = e.target.value.trim();
    if (e.target.id === 's-model') s.model = e.target.value;
  });
  ctl.body.addEventListener('change', (e) => {
    if (e.target.id === 's-model') s.model = e.target.value;
  });

  ctl.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const a = b.dataset.s;
    if (a === 'check') {
      if (!s.apiKey) return toast('Сначала вставь ключ', 'err');
      keyStatus = 'Проверяю…';
      keyKind = '';
      draw();
      try {
        const found = await listFlashModels(s.apiKey);
        models = [...new Set([...found, s.model, DEFAULT_MODEL])];
        if (found.length && !found.includes(s.model)) s.model = found.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : found[found.length - 1];
        keyStatus = found.length ? 'Ключ работает' : 'Ключ принят, но подходящих моделей не нашёл';
        keyKind = 'ok';
      } catch (err) {
        keyStatus = err instanceof AIError ? err.message : 'Не получилось проверить';
        keyKind = 'err';
      }
      draw();
    } else if (a === 'save') {
      const err = validProfile(p);
      if (err) return toast(err, 'err');
      const wChanged = p.weight !== state.profile.weight;
      state.profile = { ...p };
      state.settings.apiKey = s.apiKey;
      state.settings.model = s.model;
      if (wChanged) setWeight(p.weight);
      commit();
      closeSheet();
      toast('Сохранено');
    } else if (a === 'export') {
      const blob = new Blob([await exportAll()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `forma-${view.date}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } else if (a === 'import') {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.onchange = async () => {
        try {
          await importAll(await inp.files[0].text());
          closeSheet();
          toast('Данные загружены');
        } catch (err) {
          toast(err.message || 'Не получилось загрузить', 'err');
        }
      };
      inp.click();
    } else if (a === 'wipe') {
      if (confirm('Удалить профиль, тренировки, еду и вес? Это нельзя отменить.')) {
        await wipeAll();
        closeSheet(true);
        openWelcome();
      }
    }
  });
  draw();
}

// ---------- Вес ----------
export function setWeight(kg, date = view.date) {
  const i = state.weights.findIndex((w) => w.date === date);
  if (i >= 0) state.weights[i].kg = kg;
  else state.weights.push({ date, kg });
  if (state.profile) state.profile.weight = currentWeightAfter();
}
function currentWeightAfter() {
  return [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).pop().kg;
}

function spark(points) {
  if (points.length < 2) return '';
  const W = 300, H = 70, pad = 6;
  const ys = points.map((p) => p.kg);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = hi - lo || 1;
  const xy = points.map((p, i) => [pad + (i * (W - pad * 2)) / (points.length - 1), H - pad - ((p.kg - lo) / span) * (H - pad * 2)]);
  const d = xy.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  const last = xy[xy.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="4" fill="var(--accent)"/></svg>`;
}

export function openWeight() {
  const ctl = openSheet({ title: 'Вес' });
  const draw = () => {
    const all = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
    const cur = currentWeight(state);
    const first = all[0]?.kg ?? cur;
    const diff = r1(cur - first);
    const goal = state.profile?.goalWeight;
    const left = goal ? r1(cur - goal) : null;
    const list = [...all].reverse().slice(0, 8).map(
      (w) => `<div class="w-row"><span>${new Date(w.date + 'T12:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span><b>${r1(w.kg)} кг</b><button class="icon-btn sm" data-s="rm" data-d="${w.date}" aria-label="Удалить">${icon('x')}</button></div>`
    ).join('');
    ctl.setBody(`<div class="stack">
      <div class="w-hero"><div><b>${r1(cur)}</b> кг</div><span class="${diff <= 0 ? 'good' : 'bad'}">${all.length > 1 ? (diff > 0 ? '+' : '') + diff + ' кг с начала' : 'первая запись'}</span></div>
      ${goal ? `<div class="hint">${left > 0 ? `До цели ${goal} кг осталось ${left} кг` : left < 0 ? `Ниже цели ${goal} кг на ${Math.abs(left)} кг` : 'Цель достигнута'}</div>` : ''}
      ${spark(all.slice(-30))}
      <div class="ai-row">
        <input class="input" id="w-new" inputmode="decimal" placeholder="Вес сегодня, кг">
        <button class="btn sm primary" data-s="add">Записать</button>
      </div>
      <div class="w-list">${list}</div>
    </div>`);
  };
  ctl.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'add') {
      const v = num($('#w-new', ctl.body).value);
      if (!(v >= 30 && v <= 300)) return toast('Укажи вес в килограммах', 'err');
      setWeight(v, view.date);
      commit();
      toast('Записано');
      draw();
    } else if (b.dataset.s === 'rm') {
      if (state.weights.length <= 1) return toast('Нужна хотя бы одна запись');
      state.weights = state.weights.filter((w) => w.date !== b.dataset.d);
      state.profile.weight = currentWeightAfter();
      commit();
      draw();
    }
  });
  draw();
}

// ---------- Режим ----------
export function openModePicker() {
  const ctl = openSheet({ title: 'Режим' });
  const kg = currentWeight(state);
  const opts = Object.entries(MODES)
    .map(([k, m]) => {
      const x = goals({ ...state.profile, mode: k }, kg);
      return `<button class="card-opt ${state.profile.mode === k ? 'on' : ''}" data-s="pick" data-v="${k}"><b>${m.t}</b><span>${m.d}</span><i>${fmt(x.target)} ккал в день</i></button>`;
    })
    .join('');
  ctl.setBody(`<div class="stack"><div class="opts">${opts}</div></div>`);
  ctl.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s="pick"]');
    if (!b) return;
    state.profile.mode = b.dataset.v;
    commit();
    closeSheet();
    toast(`Режим: ${MODES[b.dataset.v].t}`);
  });
}
