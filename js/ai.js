// Бесплатный ИИ: Google Gemini (ключ из Google AI Studio лежит только на телефоне).
// Плюс Open Food Facts для штрихкодов.

import { state } from './store.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-2.5-flash';
// если выбранная модель перегружена — пробуем соседние, потом всё, что отдаёт сам Google для этого ключа
const FALLBACKS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'];

export class AIError extends Error {
  constructor(msg, code) {
    super(msg);
    this.code = code;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// одна модель: до 2 попыток при перегрузке (503/500), с паузой
async function tryModel(model, key, parts, schema) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 },
        }),
      });
    } catch {
      const e = new AIError('Нет связи с ИИ. Проверь интернет.', 'net');
      e.fatal = true;
      throw e;
    }

    if (res.ok) {
      const j = await res.json();
      const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
      if (!text) {
        const e = new AIError('ИИ не ответил (фото могло попасть под фильтр). Попробуй другое фото.', 'empty');
        e.fatal = true;
        throw e;
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new AIError('ИИ ответил не по формату.', 'parse');
      }
    }

    const body = await res.json().catch(() => ({}));
    const msg = body.error?.message || '';
    const fatal = (m, c) => Object.assign(new AIError(m, c), { fatal: true });
    if (res.status === 400 && /api key|API_KEY/i.test(msg)) throw fatal('Ключ не подходит. Проверь его в настройках.', 'key');
    if (res.status === 401 || res.status === 403) throw fatal('У ключа нет доступа к ИИ. Проверь ключ в настройках.', 'key');
    if (res.status === 404) throw new AIError(`Модель «${model}» недоступна.`, 'model');
    if (res.status === 429) throw new AIError('Бесплатный лимит ИИ на сейчас исчерпан.', 'quota');
    if (res.status >= 500) {
      last = new AIError('Сервер ИИ перегружен.', 'down');
      if (attempt < 1) await sleep(1200);
      continue;
    }
    throw new AIError(msg || `Ошибка ИИ (${res.status})`, 'http');
  }
  throw last;
}

let discovered = null;

async function call(parts, schema) {
  const key = state.settings.apiKey?.trim();
  if (!key) throw new AIError('Сначала добавь ключ ИИ в настройках.', 'nokey');
  const tried = new Set();
  const errors = [];

  const run = async (list) => {
    for (const model of list) {
      if (tried.has(model)) continue;
      tried.add(model);
      try {
        return { ok: await tryModel(model, key, parts, schema) };
      } catch (e) {
        if (e.fatal) throw e;
        errors.push(e);
      }
    }
    return null;
  };

  const first = state.settings.model || DEFAULT_MODEL;
  let r = await run([first, ...FALLBACKS]);
  if (!r) {
    // свои варианты не помогли: спрашиваем у Google, какие модели доступны этому ключу
    if (!discovered) discovered = await listFlashModels(key, true).catch(() => []);
    r = await run(discovered);
  }
  if (r) return r.ok;

  const quota = errors.some((e) => e.code === 'quota');
  const down = errors.some((e) => e.code === 'down');
  if (down) throw new AIError('ИИ Google сейчас перегружен (это бывает на бесплатном уровне). Подожди минуту и нажми кнопку ещё раз или введи вручную.', 'down');
  if (quota) throw new AIError('Бесплатный лимит ИИ на сейчас исчерпан. Подожди минуту (дневной лимит обновится ночью) или введи вручную.', 'quota');
  throw errors[errors.length - 1] || new AIError('ИИ сейчас недоступен.', 'down');
}

const img = (b64) => ({ inline_data: { mime_type: 'image/jpeg', data: b64 } });

// ---------- Упражнение по фото ----------
const EX_SCHEMA = {
  type: 'OBJECT',
  properties: {
    seen_text: { type: 'STRING' },
    name: { type: 'STRING' },
    kind: { type: 'STRING', enum: ['strength', 'cardio'] },
    muscles: { type: 'ARRAY', items: { type: 'STRING' } },
    met: { type: 'NUMBER' },
    how_to: { type: 'STRING' },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    alternatives: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['name', 'kind', 'muscles', 'met', 'confidence'],
};

export function identifyExercise({ b64, hint }) {
  const parts = [];
  if (b64) parts.push(img(b64));
  parts.push({
    text:
      `Ты тренер в тренажёрном зале. ${b64 ? 'На фото тренажёр, его табличка с названием, рукоятка или деталь, либо положение тела при выполнении упражнения.' : 'Пользователь назвал упражнение текстом.'} ` +
      `Определи, какое упражнение выполняется. Если на табличке есть текст — прочитай его (seen_text) и опирайся на него. ` +
      (hint ? `Подсказка от пользователя (название с таблички): «${hint}». ` : '') +
      `Отвечай по-русски. name — короткое привычное название (например «Жим ногами лёжа»). kind: strength для силовых, cardio для кардио. ` +
      `muscles — 2–4 основные группы мышц. met — оценка MET от 2 до 9 (силовые обычно 4–6). ` +
      `how_to — 1–2 предложения про правильную технику. alternatives — до 3 других вариантов, если не уверен. confidence — твоя уверенность.`,
  });
  return call(parts, EX_SCHEMA);
}

// ---------- Проверка техники ----------
const FORM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING' },
    good: { type: 'ARRAY', items: { type: 'STRING' } },
    fix: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['verdict', 'good', 'fix'],
};

export function checkForm({ b64, name }) {
  return call(
    [
      img(b64),
      {
        text:
          `Ты тренер. По фото оцени технику упражнения «${name || 'неизвестное упражнение'}»: положение спины, суставов, хват, амплитуда. ` +
          `Отвечай по-русски, доброжелательно и кратко. verdict — одна строка итога. good — что сделано правильно (до 3 пунктов). ` +
          `fix — что поправить (до 3 пунктов). Если по одному фото судить нельзя, честно скажи об этом в verdict. Ты не врач.`,
      },
    ],
    FORM_SCHEMA
  );
}

// ---------- Еда по фото или тексту ----------
const FOOD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          grams: { type: 'NUMBER' },
          kcal: { type: 'NUMBER' },
          protein: { type: 'NUMBER' },
          fat: { type: 'NUMBER' },
          carbs: { type: 'NUMBER' },
        },
        required: ['name', 'grams', 'kcal', 'protein', 'fat', 'carbs'],
      },
    },
    note: { type: 'STRING' },
  },
  required: ['items'],
};

export function analyzeFood({ b64, text }) {
  const parts = [];
  if (b64) parts.push(img(b64));
  parts.push({
    text:
      `Ты диетолог. ${b64 ? 'На фото еда.' : ''} ${text ? `Описание от пользователя: «${text}».` : ''} ` +
      `Раздели на отдельные продукты или блюда (не больше 8). Для каждого оцени вес порции в граммах и значения ДЛЯ ВСЕЙ ПОРЦИИ (не на 100 г): ` +
      `kcal, protein, fat, carbs в граммах. Названия по-русски. Вес считай по готовому блюду и размеру тарелки/упаковки. ` +
      `Если пользователь указал количество («2 яйца», «200 г гречки») — используй его. note — короткое замечание, если оценка неточная.`,
  });
  return call(parts, FOOD_SCHEMA);
}

// ---------- Проверка ключа и список моделей ----------
export async function listFlashModels(key, withPreview = false) {
  let res;
  try {
    res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  } catch {
    throw new AIError('Нет связи. Проверь интернет.', 'net');
  }
  if (!res.ok) throw new AIError(res.status === 400 || res.status === 403 ? 'Ключ не подходит.' : `Ошибка ${res.status}`, 'key');
  const j = await res.json();
  return (j.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace('models/', ''))
    .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n) || /^gemini-flash(-lite)?-latest$/.test(n) || (withPreview && /^gemini-[\d.]+-flash(-lite)?-preview[\w-]*$/.test(n)))
    .sort()
    .reverse();
}

// ---------- Фото: уменьшение ----------
async function loadBitmap(file) {
  if (self.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {}
  }
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
}
function scaled(src, max, q) {
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
export async function prepareImage(file) {
  const bmp = await loadBitmap(file);
  const full = scaled(bmp, 1024, 0.82);
  return { thumb: scaled(bmp, 420, 0.72), b64: full.split(',')[1] };
}

// ---------- Штрихкод: Open Food Facts ----------
export async function lookupBarcode(code) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_ru,brands,nutriments,serving_quantity`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new AIError('Нет связи с базой продуктов.', 'net');
  }
  const j = await res.json().catch(() => ({}));
  if (j.status !== 1 || !j.product) return null;
  const p = j.product;
  const n = p.nutriments || {};
  const kcal100 = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : null);
  if (kcal100 == null) return null;
  const name = [p.product_name_ru || p.product_name, p.brands].filter(Boolean).join(' · ') || `Товар ${code}`;
  const grams = Number(p.serving_quantity) > 0 ? Number(p.serving_quantity) : 100;
  const k = grams / 100;
  return {
    name,
    grams,
    kcal: (kcal100 || 0) * k,
    p: (n.proteins_100g || 0) * k,
    f: (n.fat_100g || 0) * k,
    c: (n.carbohydrates_100g || 0) * k,
  };
}
