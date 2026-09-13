import { JANITOR_STOP_ROUTES_KEY } from './constants.js';

let warnedStopRouteWrite = false;

// route-key: the refusal belongs to a provider endpoint and model, not a chat → docs/modules/janitor-transport.md#stop-rejection-learning
export function stopRouteKey(url, model) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    return '';
  }
  return `${parsed.host}${parsed.pathname}|${String(model ?? '')}`;
}

// nothing-learned: an unreadable entry is no entry, never a guess → docs/modules/janitor-transport.md#stop-rejection-learning
function learnedRoutes(storage) {
  let raw = null;
  try {
    raw = storage.getItem(JANITOR_STOP_ROUTES_KEY);
  } catch {
    return [];
  }
  if (raw == null) return [];

  let stored = null;
  try {
    stored = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(stored) ? stored.filter((key) => typeof key === 'string') : [];
}

export function isStopRejected(key, storage = localStorage) {
  if (key === '') return false;
  return learnedRoutes(storage).includes(key);
}

// one-way-ttl-free: a learned route stays learned for this browser profile → docs/modules/janitor-transport.md#stop-rejection-learning
export function recordStopRejected(key, storage = localStorage) {
  if (key === '') return;
  const routes = learnedRoutes(storage);
  if (routes.includes(key)) return;

  try {
    storage.setItem(JANITOR_STOP_ROUTES_KEY, JSON.stringify([...routes, key]));
  } catch (error) {
    if (warnedStopRouteWrite) return;
    warnedStopRouteWrite = true;
    console.warn(`[Manuscript] could not record the stop-rejecting route ${key}: ${error.message}`);
  }
}
