// Всё хранится на телефоне: состояние в IndexedDB (запасной вариант — localStorage), фото отдельно.

const DB_NAME = 'forma';
const KV = 'kv';
const PH = 'photos';

export const state = {
  profile: null, // { sex, age, height, weight, goalWeight, activity, mode }
  settings: { apiKey: '', model: 'gemini-2.5-flash' },
  weights: [], // { date, kg }
  workouts: [],
  meals: [],
  favorites: [],
};

const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const view = { tab: 'workouts', date: todayIso() };
export const today = todayIso;
export const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

// ---------- IndexedDB ----------
let db = null;
const mem = { photos: {} }; // если IndexedDB недоступна

function openDb() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => {
      rq.result.createObjectStore(KV);
      rq.result.createObjectStore(PH);
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
const idb = (store, mode, fn) =>
  new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => res(out?.result);
    tx.onerror = () => rej(tx.error);
  });

export async function load() {
  let saved = null;
  try {
    db = await openDb();
    saved = await idb(KV, 'readonly', (s) => s.get('state'));
    navigator.storage?.persist?.();
  } catch {
    db = null;
    try {
      saved = JSON.parse(localStorage.getItem('forma-state') || 'null');
    } catch {}
  }
  if (saved) {
    Object.assign(state, saved, { settings: { ...state.settings, ...(saved.settings || {}) } });
  }
}

const listeners = new Set();
export const subscribe = (fn) => listeners.add(fn);

let timer;
export function commit() {
  clearTimeout(timer);
  timer = setTimeout(persist, 120);
  listeners.forEach((fn) => fn());
}

async function persist() {
  const snapshot = JSON.parse(JSON.stringify(state));
  try {
    if (db) await idb(KV, 'readwrite', (s) => s.put(snapshot, 'state'));
    else localStorage.setItem('forma-state', JSON.stringify(snapshot));
  } catch (e) {
    console.warn('Не удалось сохранить', e);
  }
}

// ---------- Фото ----------
const cache = new Map();

export async function putPhoto(dataUrl) {
  const id = uid();
  cache.set(id, dataUrl);
  try {
    if (db) await idb(PH, 'readwrite', (s) => s.put(dataUrl, id));
    else mem.photos[id] = dataUrl;
  } catch {
    mem.photos[id] = dataUrl;
  }
  return id;
}

export async function getPhoto(id) {
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);
  let v = mem.photos[id] || null;
  try {
    if (db) v = (await idb(PH, 'readonly', (s) => s.get(id))) || v;
  } catch {}
  if (v) cache.set(id, v);
  return v;
}

export async function dropPhotoIfUnused(id) {
  if (!id) return;
  const used = [...state.workouts, ...state.meals].some((e) => e.photoId === id);
  if (used) return;
  cache.delete(id);
  delete mem.photos[id];
  try {
    if (db) await idb(PH, 'readwrite', (s) => s.delete(id));
  } catch {}
}

// ---------- Экспорт / импорт ----------
export async function exportAll() {
  const ids = new Set([...state.workouts, ...state.meals].map((e) => e.photoId).filter(Boolean));
  const photos = {};
  for (const id of ids) photos[id] = await getPhoto(id);
  const data = JSON.parse(JSON.stringify(state));
  data.settings.apiKey = ''; // ключ в файл не кладём
  return JSON.stringify({ app: 'forma', v: 1, state: data, photos });
}

export async function importAll(text) {
  const j = JSON.parse(text);
  if (j.app !== 'forma' || !j.state) throw new Error('Это не файл из приложения «Форма»');
  const keep = state.settings.apiKey;
  Object.assign(state, j.state);
  state.settings = { ...state.settings, ...(j.state.settings || {}), apiKey: keep };
  for (const [id, data] of Object.entries(j.photos || {})) {
    cache.set(id, data);
    try {
      if (db) await idb(PH, 'readwrite', (s) => s.put(data, id));
      else mem.photos[id] = data;
    } catch {
      mem.photos[id] = data;
    }
  }
  commit();
}

export async function wipeAll() {
  state.profile = null;
  state.weights = [];
  state.workouts = [];
  state.meals = [];
  state.favorites = [];
  cache.clear();
  try {
    if (db) await idb(PH, 'readwrite', (s) => s.clear());
  } catch {}
  commit();
}
