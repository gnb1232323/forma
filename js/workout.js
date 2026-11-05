// Шторка «Упражнение»: фото -> ИИ -> подходы/повторы/вес -> сохранить.

import { state, view, commit, uid, putPhoto, dropPhotoIfUnused } from './store.js';
import { burnKcal, currentWeight, strengthMinutes, strengthMet, guessMovement, CARDIO } from './calc.js';
import { identifyExercise, checkForm, estimateBurn, prepareImage, AIError } from './ai.js';
import { burnPayload } from './refine.js';
import { openSheet, closeSheet, esc, icon, toast, num, clamp, hydratePhotos, $ } from './ui.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

function lastSame(name) {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return [...state.workouts].sort((a, b) => b.ts - a.ts).find((w) => w.name.trim().toLowerCase() === n) || null;
}

export function recentExercises(limit = 8) {
  const seen = new Set();
  const out = [];
  for (const w of [...state.workouts].sort((a, b) => b.ts - a.ts)) {
    const k = w.name.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

export async function openWorkout({ file = null, preset = null, edit = null, kind = 'strength' } = {}) {
  const kg = currentWeight(state);
  const m = edit
    ? clone(edit)
    : {
        kind,
        name: '',
        muscles: [],
        sets: [{ reps: 12, kg: 0 }],
        minutes: null,
        met: 3.5,
        movement: '',
        kcal: null,
        cardioType: 'walk',
        howTo: '',
      };
  if (preset && !edit) {
    m.kind = preset.kind;
    m.name = preset.name;
    m.muscles = preset.muscles || [];
    m.movement = preset.movement || '';
    m.met = preset.kind === 'strength' ? strengthMet(m.movement) : preset.met || m.met;
    m.cardioType = preset.cardioType || m.cardioType;
    m.howTo = preset.howTo || '';
    if (preset.sets?.length) m.sets = clone(preset.sets);
    if (preset.kind === 'cardio') m.minutes = preset.minutes;
  }
  if (m.kind === 'cardio' && !m.cardioType) m.cardioType = 'other';

  let thumb = null; // новое фото (ещё не сохранено)
  let b64 = null; // для запросов к ИИ
  let photoId = m.photoId || null;
  const ui = { busy: false, status: '', statusKind: '', alts: [], seen: '', conf: '', hint: '', form: null, kcalManual: !!edit && edit.kcal != null, steps: '', setsTouched: !!edit, nameFromAI: false, kcalSource: 'formula', aiNote: '', aiSig: '' };
  if (edit) m.kcal = edit.kcal;

  const hasKey = () => !!state.settings.apiKey?.trim();
  const minutes = () => (m.minutes != null && m.minutes !== '' ? Number(m.minutes) : m.kind === 'cardio' ? 30 : strengthMinutes(m.sets));
  const autoKcal = () => burnKcal(m.kind === 'strength' ? strengthMet(m.movement || guessMovement(m.name)) : m.met, minutes(), kg);
  const shownKcal = () => (ui.kcalManual && m.kcal != null ? Number(m.kcal) : autoKcal());
  // время, посчитанное автоматически, при правке подходов должно пересчитываться
  if (edit && edit.kind === 'strength') {
    if (!edit.v) m.minutes = null; // запись по старой модели: пересчитаем по новой
    else if (edit.minutes === strengthMinutes(edit.sets)) m.minutes = null;
    m.met = strengthMet(m.movement);
  }
  // подпись введённых данных: если после расчёта ИИ она изменилась, расчёт устарел
  const sig = () => JSON.stringify([m.kind, m.name.trim().toLowerCase(), m.kind === 'strength' ? m.sets.map((s) => [s.reps || 0, s.kg || 0]) : m.cardioType, minutes()]);
  if (edit) {
    if (edit.src === 'ai' || edit.src === 'user') {
      ui.kcalSource = edit.src;
      ui.kcalManual = edit.kcal != null;
      if (edit.src === 'ai') ui.aiSig = sig();
    } else if (edit.kcal != null && Math.abs(edit.kcal - autoKcal()) > 1) {
      ui.kcalSource = 'user'; // старая запись с числом, которое правили руками
      ui.kcalManual = true;
    } else {
      ui.kcalManual = false;
    }
  }

  const ctl = openSheet({
    title: edit ? 'Упражнение' : m.kind === 'cardio' ? 'Кардио' : 'Новое упражнение',
    tall: true,
    html: '',
    onMount: () => {},
  });

  // ---------- рисуем ----------
  function names() {
    return [...new Set(state.workouts.map((w) => w.name))].map((n) => `<option value="${esc(n)}">`).join('');
  }

  const statusInline = () => (ui.status ? `<div class="ai-status inline ${ui.statusKind}">${ui.busy ? '<span class="spin"></span>' : ''}${esc(ui.status)}</div>` : '');
  const srcLabel = () => (ui.kcalSource === 'ai' ? '(посчитал ИИ)' : ui.kcalSource === 'user' ? '(вручную)' : '(прикидка)');
  const noteText = () =>
    ui.kcalSource === 'ai'
      ? esc(ui.aiNote || 'Посчитано ИИ.')
      : ui.kcalSource === 'user'
        ? 'Число введено вручную.'
        : hasKey()
          ? 'Сейчас грубая прикидка. При сохранении ИИ посчитает, сколько реально уйдёт.'
          : 'Грубая прикидка. Чтобы ИИ считал точнее, добавь ключ в настройках.';

  function photoBlock() {
    if (!thumb && !photoId) return statusInline();
    const src = thumb ? `src="${thumb}"` : `data-photo="${photoId}"`;
    return `<div class="photo-prev"><img ${src} alt="">${ui.status ? `<div class="ai-status ${ui.statusKind}">${ui.busy ? '<span class="spin"></span>' : ''}${esc(ui.status)}</div>` : ''}</div>`;
  }

  function aiBlock() {
    if (!hasKey()) {
      return `<div class="note">${icon('sparkles')}<span>Чтобы ИИ узнавал упражнения по фото, добавь бесплатный ключ в настройках. Пока можно вводить вручную.</span></div>`;
    }
    return `<div class="ai-row">
      <input class="input" data-in="hint" value="${esc(ui.hint)}" placeholder="${b64 ? 'Что написано на табличке? (по желанию)' : 'Уточнить мышцы и калории по названию'}">
      <button class="btn sm" data-s="ai" ${ui.busy ? 'disabled' : ''}>${icon('sparkles')}${b64 ? 'Распознать' : 'Уточнить'}</button>
    </div>`;
  }

  function strengthBlock() {
    const rows = m.sets
      .map(
        (s, i) => `<div class="set-row">
        <span class="set-n">${i + 1}</span>
        <label><input class="input num" inputmode="numeric" data-set="reps" data-i="${i}" value="${s.reps || ''}" placeholder="0"><em>повт.</em></label>
        <span class="times">×</span>
        <label><input class="input num" inputmode="decimal" data-set="kg" data-i="${i}" value="${s.kg || ''}" placeholder="0"><em>кг</em></label>
        <button class="icon-btn sm" data-s="delset" data-i="${i}" aria-label="Удалить подход">${icon('x')}</button>
      </div>`
      )
      .join('');
    return `<div class="block"><div class="block-h">Подходы</div>${rows}<button class="btn ghost full" data-s="addset">${icon('plus')}Подход</button></div>`;
  }

  function cardioBlock() {
    const chips = Object.entries(CARDIO)
      .map(([k, c]) => `<button class="chip-b ${m.cardioType === k ? 'on' : ''}" data-s="ctype" data-v="${k}">${c.t}</button>`)
      .join('');
    return `<div class="block"><div class="block-h">Вид кардио</div><div class="chips">${chips}</div></div>`;
  }

  function timeBlock() {
    const steps =
      m.kind === 'cardio' && m.cardioType === 'walk'
        ? `<label class="field"><span>Или шаги</span><input class="input" inputmode="numeric" data-in="steps" value="${esc(ui.steps)}" placeholder="например 6000"></label>`
        : '';
    return `<div class="two">
      <label class="field"><span>Время, мин</span><input class="input" inputmode="numeric" data-in="minutes" value="${m.minutes ?? ''}" placeholder="${minutes()}"></label>
      ${steps}
    </div>`;
  }

  function formBlock() {
    if (!b64 || !hasKey()) return '';
    const f = ui.form;
    const res = f
      ? `<div class="form-res"><b>${esc(f.verdict)}</b>${f.good?.length ? `<ul class="ok">${f.good.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${f.fix?.length ? `<ul class="fix">${f.fix.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`
      : '';
    return `<div class="block"><button class="btn ghost full" data-s="form" ${ui.busy ? 'disabled' : ''}>${icon('check')}Проверить технику по фото</button>${res}</div>`;
  }

  function draw() {
    const alts = ui.alts.length
      ? `<div class="chips">${ui.alts.map((a) => `<button class="chip-b" data-s="alt" data-v="${esc(a)}">${esc(a)}</button>`).join('')}</div>`
      : '';
    const muscles = m.muscles?.length ? `<div class="chips">${m.muscles.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : '';
    const how = m.howTo ? `<div class="howto">${icon('info')}<span>${esc(m.howTo)}</span></div>` : '';
    const seen = ui.seen ? `<div class="hint">На табличке: «${esc(ui.seen)}»</div>` : '';
    ctl.setBody(`<div class="stack">
      ${photoBlock()}
      <div class="seg">
        <button class="${m.kind === 'strength' ? 'on' : ''}" data-s="kind" data-v="strength">${icon('dumbbell')}Силовое</button>
        <button class="${m.kind === 'cardio' ? 'on' : ''}" data-s="kind" data-v="cardio">${icon('pulse')}Кардио</button>
      </div>
      ${aiBlock()}
      <label class="field"><span>Название</span>
        <input class="input" id="w-name" list="w-names" data-in="name" value="${esc(m.name)}" placeholder="${m.kind === 'cardio' ? 'Например: дорожка' : 'Например: жим ногами'}" autocomplete="off">
        <datalist id="w-names">${names()}</datalist>
      </label>
      ${seen}${alts}${muscles}${how}
      ${m.kind === 'strength' ? strengthBlock() : cardioBlock()}
      ${timeBlock()}
      <div class="kcal-line">
        <div>${icon('flame')}<b id="w-kcal">${shownKcal()}</b> ккал <span class="muted" id="w-src">${srcLabel()}</span></div>
        <input class="input num" inputmode="numeric" data-in="kcal" placeholder="своё" value="${ui.kcalSource === 'user' ? m.kcal : ''}">
      </div>
      ${hasKey() ? `<button class="btn ghost full" data-s="burn" ${ui.busy ? 'disabled' : ''}>${icon('sparkles')}Посчитать калории ИИ</button>` : ''}
      <p class="hint" id="w-note">${noteText()}</p>
      ${formBlock()}
      <div class="sheet-actions">
        ${edit ? `<button class="btn danger" data-s="del">${icon('trash')}</button>` : ''}
        <button class="btn primary grow" data-s="save">${icon('check')}Сохранить</button>
      </div>
    </div>`);
    hydratePhotos(ctl.body);
  }

  function refreshKcal() {
    const el = $('#w-kcal', ctl.body);
    if (el) el.textContent = shownKcal();
    const mi = $('[data-in="minutes"]', ctl.body);
    if (mi) mi.placeholder = minutes();
    const sl = $('#w-src', ctl.body);
    if (sl) sl.textContent = srcLabel();
    const nt = $('#w-note', ctl.body);
    if (nt) nt.innerHTML = noteText();
  }

  // человек поменял подходы, время или название — прежний расчёт ИИ больше не верен
  function invalidateAI() {
    if (ui.kcalSource !== 'ai') return;
    ui.kcalSource = 'formula';
    ui.kcalManual = false;
    ui.aiNote = '';
    m.kcal = null;
    refreshKcal();
  }

  // ИИ считает, сколько калорий реально уходит на это упражнение
  async function askBurn() {
    if (!hasKey() || ui.busy) return false;
    ui.busy = true;
    ui.status = 'ИИ считает калории…';
    ui.statusKind = '';
    draw();
    try {
      const r = await estimateBurn(
        burnPayload({ name: m.name.trim() || 'упражнение', kind: m.kind, cardioType: m.cardioType, sets: m.sets, minutes: m.minutes != null && m.minutes !== '' ? Number(m.minutes) : null })
      );
      m.kcal = Math.round(r.kcal);
      ui.kcalManual = true;
      ui.kcalSource = 'ai';
      ui.aiSig = sig();
      ui.aiNote = `${r.why} Диапазон ${Math.round(r.low)}–${Math.round(r.high)} ккал.`;
      ui.status = '';
      ui.busy = false;
      draw();
      return true;
    } catch (e) {
      ui.status = `${e instanceof AIError ? e.message : 'Не получилось посчитать калории.'} Оставлена прикидка.`;
      ui.statusKind = 'err';
      ui.busy = false;
      draw();
      return false;
    }
  }

  // ---------- ИИ ----------
  async function runAI() {
    if (ui.busy) return;
    if (!b64 && !m.name.trim() && !ui.hint.trim()) {
      toast('Напиши название или сфотографируй');
      return;
    }
    ui.busy = true;
    ui.status = b64 ? 'ИИ смотрит на фото…' : 'ИИ уточняет…';
    ui.statusKind = '';
    draw();
    try {
      const r = await identifyExercise({ b64, hint: ui.hint.trim() || (!b64 ? m.name.trim() : '') });
      // название, которое человек вписал сам, ИИ не затирает: его вариант уходит в подсказки
      const typed = m.name.trim();
      const keepTyped = typed && !ui.hint.trim() && !ui.nameFromAI;
      const aiName = r.name || '';
      if (!keepTyped && aiName) {
        m.name = aiName;
        ui.nameFromAI = true;
      }
      m.kind = r.kind === 'cardio' ? 'cardio' : 'strength';
      m.muscles = r.muscles || [];
      m.movement = r.movement === 'isolation' ? 'isolation' : r.movement === 'compound' ? 'compound' : '';
      m.met = m.kind === 'strength' ? strengthMet(m.movement) : clamp(Number(r.met) || m.met, 2, 9);
      m.howTo = r.how_to || '';
      ui.alts = [aiName, ...(r.alternatives || [])].filter((a, i, arr) => a && a.toLowerCase() !== m.name.toLowerCase() && arr.indexOf(a) === i);
      ui.seen = r.seen_text || '';
      ui.conf = r.confidence;
      if (m.kind === 'cardio') {
        const guess = /ход|дорожк/i.test(m.name) ? 'walk' : /бег/i.test(m.name) ? 'run' : /вело/i.test(m.name) ? 'bike' : /эллип|орбитрек/i.test(m.name) ? 'ell' : 'other';
        m.cardioType = guess;
      }
      const prev = lastSame(m.name);
      if (prev && prev.kind === 'strength' && prev.sets?.length && !ui.setsTouched) m.sets = clone(prev.sets);
      ui.status = r.confidence === 'low' ? 'Не уверен — проверь название ниже' : 'Готово. Проверь название и заполни подходы';
      ui.statusKind = r.confidence === 'low' ? 'warn' : 'ok';
    } catch (e) {
      ui.status = e instanceof AIError ? e.message : 'Не получилось распознать';
      ui.statusKind = 'err';
    }
    ui.busy = false;
    draw();
  }

  async function runForm() {
    if (ui.busy || !b64) return;
    ui.busy = true;
    ui.status = 'ИИ смотрит на технику…';
    ui.statusKind = '';
    draw();
    try {
      ui.form = await checkForm({ b64, name: m.name });
      ui.status = '';
    } catch (e) {
      ui.status = e instanceof AIError ? e.message : 'Не получилось проверить технику';
      ui.statusKind = 'err';
    }
    ui.busy = false;
    draw();
  }

  // ---------- события ----------
  ctl.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const a = b.dataset.s;
    if (a === 'kind') {
      m.kind = b.dataset.v;
      m.met = m.kind === 'cardio' ? CARDIO[m.cardioType || 'walk']?.met || 5 : strengthMet(m.movement);
      if (m.kind === 'cardio' && !m.cardioType) m.cardioType = 'walk';
      invalidateAI();
      draw();
    } else if (a === 'ctype') {
      m.cardioType = b.dataset.v;
      m.met = CARDIO[m.cardioType].met;
      if (!m.name.trim() || Object.values(CARDIO).some((c) => c.t === m.name)) m.name = CARDIO[m.cardioType].t;
      invalidateAI();
      draw();
    } else if (a === 'alt') {
      m.name = b.dataset.v;
      ui.alts = ui.alts.filter((x) => x !== m.name);
      invalidateAI();
      draw();
    } else if (a === 'addset') {
      const last = m.sets[m.sets.length - 1] || { reps: 12, kg: 0 };
      m.sets.push({ reps: last.reps, kg: last.kg });
      invalidateAI();
      draw();
    } else if (a === 'delset') {
      m.sets.splice(Number(b.dataset.i), 1);
      if (!m.sets.length) m.sets.push({ reps: 12, kg: 0 });
      invalidateAI();
      draw();
    } else if (a === 'burn') {
      await askBurn();
    } else if (a === 'ai') {
      runAI();
    } else if (a === 'form') {
      runForm();
    } else if (a === 'save') {
      await save();
    } else if (a === 'del') {
      if (confirm('Удалить это упражнение?')) {
        state.workouts = state.workouts.filter((w) => w.id !== edit.id);
        commit();
        dropPhotoIfUnused(edit.photoId);
        closeSheet();
        toast('Удалено');
      }
    }
  });

  ctl.body.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.set) {
      const s = m.sets[Number(t.dataset.i)];
      s[t.dataset.set] = num(t.value);
      ui.setsTouched = true;
      invalidateAI();
      refreshKcal();
      return;
    }
    const k = t.dataset.in;
    if (!k) return;
    if (k === 'name') {
      m.name = t.value;
      ui.nameFromAI = false;
      invalidateAI();
    } else if (k === 'hint') ui.hint = t.value;
    else if (k === 'minutes') {
      m.minutes = t.value === '' ? null : num(t.value);
      invalidateAI();
      refreshKcal();
    } else if (k === 'steps') {
      ui.steps = t.value;
      const st = num(t.value);
      m.minutes = st > 0 ? Math.round(st / 100) : null;
      const mi = $('[data-in="minutes"]', ctl.body);
      if (mi) mi.value = m.minutes ?? '';
      invalidateAI();
      refreshKcal();
    } else if (k === 'kcal') {
      if (t.value === '') {
        ui.kcalManual = false;
        ui.kcalSource = 'formula';
        m.kcal = null;
      } else {
        ui.kcalManual = true;
        ui.kcalSource = 'user';
        m.kcal = num(t.value);
      }
      refreshKcal();
    }
  });

  // выбрали знакомое упражнение — подставляем прошлые подходы
  ctl.body.addEventListener('change', (e) => {
    if (e.target.dataset.in !== 'name') return;
    const prev = lastSame(m.name);
    if (!prev || edit) return;
    m.kind = prev.kind;
    m.muscles = prev.muscles || [];
    m.movement = prev.movement || '';
    m.met = prev.kind === 'strength' ? strengthMet(m.movement) : prev.met || m.met;
    m.howTo = prev.howTo || '';
    m.cardioType = prev.cardioType || m.cardioType;
    if (prev.sets?.length) m.sets = clone(prev.sets);
    if (prev.kind === 'cardio') m.minutes = prev.minutes;
    draw();
  });

  async function save() {
    const name = m.name.trim();
    if (!name) {
      toast('Напиши название упражнения');
      return;
    }
    const strength = m.kind === 'strength';
    const sets = strength ? m.sets.filter((s) => s.reps > 0).map((s) => ({ reps: Math.round(s.reps), kg: s.kg || 0 })) : [];
    if (strength && !sets.length) {
      toast('Добавь хотя бы один подход');
      return;
    }
    if (ui.busy) return;
    // ИИ считает, сколько реально уйдёт калорий (если число не введено вручную и расчёт не актуален)
    let aiFailed = false;
    if (hasKey() && ui.kcalSource !== 'user' && !(ui.kcalSource === 'ai' && ui.aiSig === sig())) aiFailed = !(await askBurn());
    if (thumb) photoId = await putPhoto(thumb);
    const entry = {
      id: edit?.id || uid(),
      date: edit?.date || view.date,
      ts: edit?.ts || Date.now(),
      kind: m.kind,
      name,
      muscles: m.muscles || [],
      sets,
      minutes: minutes(),
      met: m.met,
      movement: m.movement || guessMovement(name),
      v: 2,
      src: ui.kcalSource,
      kcal: Math.round(shownKcal()),
      photoId,
      howTo: m.howTo || '',
      cardioType: m.kind === 'cardio' ? m.cardioType : undefined,
    };
    if (edit) state.workouts = state.workouts.map((w) => (w.id === edit.id ? entry : w));
    else state.workouts.push(entry);
    commit();
    closeSheet();
    toast(aiFailed ? `Записано ${entry.kcal} ккал (прикидка: ИИ не ответил)` : `Записано: ${entry.kcal} ккал`, aiFailed ? 'err' : '');
  }

  draw();

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
      ui.statusKind = 'err';
      draw();
      return;
    }
    ui.busy = false;
    ui.status = '';
    draw();
    if (hasKey()) runAI();
    else {
      ui.status = 'Фото сохранится. Назови упражнение вручную';
      draw();
    }
  }
}
