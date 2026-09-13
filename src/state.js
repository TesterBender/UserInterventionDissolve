import { getCtx } from './host.js';
import { METADATA_KEY, STATE_VERSION, LOG_PREFIX, BLOCK_DELIMITER } from './constants.js';
import { isTrailingBlockComplete } from './grammar.js';

// unknown-version: warn once per stored object, never migrate → docs/modules/state.md#unknown-version
const warned = new WeakSet();

function warnOnce(stored) {
  if (warned.has(stored)) return;
  warned.add(stored);
  console.warn(`${LOG_PREFIX} unknown state version: ${stored.version}`);
}

// state-shape: final spans, unsealed units, consumed ids, one watermark → docs/modules/state.md#shape
export function createState() {
  return { version: STATE_VERSION, frozen: [], units: [], frozenIds: [], watermark: { messageId: null, offset: 0 } };
}

// lazy-init: materialised on first read, assigned but not saved → docs/modules/state.md#lazy-init
export function getState(ctx = getCtx()) {
  const stored = ctx.chatMetadata?.[METADATA_KEY];
  // v2-upgrade: units added in place, existing spans stay final → docs/modules/state.md#unknown-version
  if (stored !== undefined && stored.version === 2) {
    stored.units = [];
    stored.version = STATE_VERSION;
    return stored;
  }

  if (stored === undefined || stored.version !== STATE_VERSION) {
    if (stored !== undefined) warnOnce(stored);
    const state = createState();
    ctx.chatMetadata[METADATA_KEY] = state;
    return state;
  }

  return stored;
}

// can-push-span: the accept test both push paths and freeze's pre-check share → docs/modules/state.md#can-push-span
export function canPushSpan(text) {
  return typeof text === 'string' && text.trim() !== '' && isTrailingBlockComplete(text);
}

function append(list, span) {
  const text = span.text;
  if (!canPushSpan(text)) return false;

  const words = Number.isFinite(span.words) ? span.words : (text.match(/\S+/g) ?? []).length;
  const createdAt = Number.isFinite(span.createdAt) ? span.createdAt : Date.now();
  list.push({ text, words, createdAt });
  return true;
}

// append-only: refuse a mid-block span, no removal or replacement path → docs/modules/state.md#append-only
// mutation-is-storage: the stored object is mutated in place → docs/modules/state.md#mutation-is-storage
export function pushFrozen(state, span) {
  return append(state.frozen, span);
}

// push-unit: same contract as pushFrozen, onto the unsealed tier → docs/modules/state.md#push-unit
export function pushUnit(state, unit) {
  return append(state.units, unit);
}

// seal-units: joins the unsealed units into one final span, decides no policy → docs/modules/state.md#seal-units
export function sealUnits(state) {
  if (state.units.length === 0) return null;

  const text = state.units.map((unit) => unit.text).join(BLOCK_DELIMITER);
  const words = state.units.reduce((total, unit) => total + unit.words, 0);
  pushFrozen(state, { text, words });
  state.units.length = 0;
  return state.frozen.length - 1;
}

// advance-watermark: the only writer of frozenIds and watermark → docs/modules/state.md#advance-watermark
export function advanceWatermark(state, { messageId, offset, consumedIds }) {
  for (const id of consumedIds) {
    if (typeof id !== 'string' || id === '') continue;
    if (state.frozenIds.includes(id)) continue;
    state.frozenIds.push(id);
  }
  state.watermark = { messageId: messageId ?? null, offset: Number.isFinite(offset) ? offset : 0 };
}

// save-metadata-only: message markers are saved by their own handlers → docs/modules/state.md#save
export async function save(ctx = getCtx()) {
  await ctx.saveMetadata();
}
