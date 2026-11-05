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

// Силовое: средняя нагрузка за всё время упражнения (с отдыхом), MET по справочнику Compendium.
// Многосуставные (жим, тяга, присед) тяжелее, изолирующие (махи, сведения, сгибания) легче.
export const STRENGTH_MET = { compound: 3.8, isolation: 3.0, default: 3.5 };
export const strengthMet = (movement) => STRENGTH_MET[movement] || STRENGTH_MET.default;

// Тип движения по названию — для прикидки, когда ИИ ещё не определил его
export function guessMovement(name = '') {
  const n = name.toLowerCase();
  if (/мах|сведен|разведен|сгибан|разгибан|бицепс|трицепс|кроссовер|пек-?дек|бабочк|икр|пуловер|шраг/.test(n)) return 'isolation';
  if (/жим|тяг|присед|выпад|подтяг|отжим|становая|гребл|тяга|трастер|швунг|отжиман/.test(n)) return 'compound';
  return '';
}

// Время упражнения: работа (~3,5 с на повтор) + отдых между подходами (~75 с).
export function strengthMinutes(sets) {
  const list = Array.isArray(sets) ? sets : Array.from({ length: Number(sets) || 1 }, () => ({ reps: 10 }));
  const min = list.reduce((a, s) => a + ((Number(s.reps) || 0) * 3.5) / 60 + 1.25, 0);
  return Math.max(3, Math.round(min));
}

// Старые записи (до версии расчёта 2) пересчитываем по новой модели
export function migrateWorkouts(state) {
  const kg = currentWeight(state);
  let changed = false;
  for (const w of state.workouts) {
    if (w.kind !== 'strength' || w.v >= 2) continue;
    const oldAuto = Math.max(5, Math.round((w.sets?.length || 1) * 2.5));
    if (w.minutes === oldAuto || !w.minutes) w.minutes = strengthMinutes(w.sets || []);
    w.met = strengthMet(w.movement);
    w.kcal = burnKcal(w.met, w.minutes, kg);
    w.v = 2;
    changed = true;
  }
  return changed;
}

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
