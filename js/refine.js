// Калории упражнений считает ИИ: здесь сборка запроса и «дотягивание» записей, которые посчитаны только формулой.

import { state, commit, iso } from './store.js';
import { currentWeight, strengthMinutes, CARDIO } from './calc.js';
import { estimateBurn } from './ai.js';
import { toast } from './ui.js';

// Данные для ИИ. minutes — только если время указал человек (иначе ИИ прикинет сам).
export function burnPayload({ name, kind, cardioType, sets, minutes }) {
  const p = state.profile || {};
  return {
    name,
    kind,
    cardio: kind === 'cardio' ? CARDIO[cardioType]?.t || name : '',
    sets: (sets || []).filter((s) => s.reps > 0),
    minutes: minutes || null,
    weight: currentWeight(state),
    age: p.age,
    sex: p.sex,
  };
}

// минуты в старых записях могли быть посчитаны автоматически — их человеком не вводили
function userMinutes(w) {
  if (w.kind !== 'strength') return w.minutes;
  const oldAuto = Math.max(5, Math.round((w.sets?.length || 1) * 2.5));
  return w.minutes === strengthMinutes(w.sets || []) || w.minutes === oldAuto ? null : w.minutes;
}

let running = false;

// Вчерашние и сегодняшние упражнения без расчёта ИИ — пересчитываем в фоне, по одному.
export async function refineRecentWithAI() {
  if (running || !state.profile || !state.settings.apiKey?.trim()) return;
  const since = iso(new Date(Date.now() - 864e5));
  const list = state.workouts.filter((w) => w.date >= since && w.src !== 'ai' && w.src !== 'user');
  if (!list.length) return;
  running = true;
  let n = 0;
  for (const w of list) {
    try {
      const r = await estimateBurn(burnPayload({ ...w, minutes: userMinutes(w) }));
      w.kcal = Math.round(r.kcal);
      w.src = 'ai';
      n++;
      commit();
    } catch {
      break; // лимит или перегрузка — попробуем при следующем открытии
    }
  }
  running = false;
  if (n) toast(`ИИ уточнил калории: ${n}`);
}
