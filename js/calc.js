// Расчёты: норма калорий, БЖУ, сожжённое на тренировках, «сколько двигаться».

export const ACT = {
  low: { k: 1.2, t: 'Сидячий день', d: 'офис, мало ходьбы' },
  mid: { k: 1.375, t: 'Умеренно активный', d: '6–9 тыс. шагов в день' },
  high: { k: 1.55, t: 'Очень активный', d: 'много на ногах весь день' },
};

export const MODES = {
  cut: { t: 'Худею', d: 'дефицит ~20% от нормы', delta: -0.2, prot: 1.8 },
  keep: { t: 'Держу вес', d: 'ем столько, сколько трачу', delta: 0, prot: 1.4 },
  bulk: { t: 'Набираю', d: 'небольшой профицит ~10%', delta: 0.1, prot: 2.0 },
};

// MET — сколько раз активность «тяжелее» покоя
export const CARDIO = {
  walk: { t: 'Ходьба', met: 3.5 },
  run: { t: 'Бег', met: 9.8 },
  bike: { t: 'Велосипед', met: 7.5 },
  ell: { t: 'Эллипс', met: 5 },
  swim: { t: 'Плавание', met: 7 },
  other: { t: 'Другое', met: 5 },
};

// Формула Миффлина — Сан-Жеора
export function bmr(p, kg = p.weight) {
  return 10 * kg + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
}

export function goals(profile, kg) {
  const w = kg || profile.weight;
  const b = bmr(profile, w);
  const tdee = b * ACT[profile.activity].k;
  const mode = MODES[profile.mode];
  let target = tdee * (1 + mode.delta);
  const floor = profile.sex === 'm' ? 1500 : 1200;
  if (profile.mode === 'cut') target = Math.max(target, floor);
  target = Math.round(target / 10) * 10;
  const prot = Math.round(mode.prot * w);
  const fat = Math.round((target * 0.27) / 9);
  const carb = Math.max(0, Math.round((target - prot * 4 - fat * 9) / 4));
  return { bmr: b, tdee, target, prot, fat, carb };
}

// чистый расход сверх покоя (покой уже учтён в норме дня)
export const burnPerMin = (met, kg) => (Math.max(0, met - 1) * 3.5 * kg) / 200;
export const burnKcal = (met, minutes, kg) => Math.round(burnPerMin(met, kg) * minutes);

export const strengthMinutes = (sets) => Math.max(5, Math.round(sets * 2.5));

export function equivalents(kcal, kg) {
  return [
    ['ходьбы', 3.5],
    ['бега', 9.8],
    ['велосипеда', 7.5],
  ].map(([n, met]) => ({ n, min: Math.max(1, Math.ceil(kcal / burnPerMin(met, kg))) }));
}

export function dayStats(state, date) {
  const meals = state.meals.filter((m) => m.date === date);
  const works = state.workouts.filter((w) => w.date === date);
  const sum = (arr, k) => arr.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  return {
    meals,
    works,
    eaten: sum(meals, 'kcal'),
    p: sum(meals, 'p'),
    f: sum(meals, 'f'),
    c: sum(meals, 'c'),
    burned: sum(works, 'kcal'),
  };
}

export function currentWeight(state) {
  const last = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).pop();
  return last ? last.kg : state.profile?.weight || 70;
}

export function setsSummary(sets) {
  if (!sets?.length) return '';
  const same = sets.every((s) => s.reps === sets[0].reps && s.kg === sets[0].kg);
  const one = (s) => `${s.reps}${s.kg ? '×' + s.kg : ''}`;
  if (same) return `${sets.length}×${sets[0].reps}${sets[0].kg ? ' · ' + sets[0].kg + ' кг' : ''}`;
  const head = sets.slice(0, 4).map(one).join(', ');
  return sets.length > 4 ? head + '…' : head;
}
