import { getCtx } from './host.js';
import { METADATA_KEY, STATE_VERSION, LOG_PREFIX } from './constants.js';
import { isTrailingBlockComplete } from './grammar.js';

// unknown-version: warn once per stored object, never migrate → docs/modules/state.md#unknown-version
const warned = new WeakSet();

function warnOnce(stored) {
  if (warned.has(stored)) return;
  warned.add(stored);
  console.warn(`${LOG_PREFIX} unknown state version: ${stored.version}`);
}

// state-shape: frozen spans, consumed ids, one watermark; no frontier → docs/modules/state.md#shape
export function createState() {
  return { version: STATE_VERSION, frozen: [], frozenIds: [], watermark: { messageId: null, offset: 0 } };
}

// lazy-init: materialised on first read, assigned but not saved → docs/modules/state.md#lazy-init
export function getState(ctx = getCtx()) {
  const stored = ctx.chatMetadata?.[METADATA_KEY];
  if (stored === undefined || stored.version !== STATE_VERSION) {
    if (stored !== undefined) warnOnce(stored);
    const state = createState();
    ctx.chatMetadata[METADATA_KEY] = state;
    return state;
  }

  return stored;
}

// append-only: refuse a mid-block span, no removal or replacement path → docs/modules/state.md#append-only
// mutation-is-storage: the stored object is mutated in place → docs/modules/state.md#mutation-is-storage
export function pushFrozen(state, span) {
  const text = span.text;
  if (typeof text !== 'string' || text.trim() === '') return false;
  if (!isTrailingBlockComplete(text)) return false;

  const words = Number.isFinite(span.words) ? span.words : (text.match(/\S+/g) ?? []).length;
  const createdAt = Number.isFinite(span.createdAt) ? span.createdAt : Date.now();
  state.frozen.push({ text, words, createdAt });
  return true;
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
