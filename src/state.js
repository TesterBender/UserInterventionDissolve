import { getCtx } from './host.js';
import { METADATA_KEY, STATE_VERSION, BLOCK_DELIMITER, LOG_PREFIX } from './constants.js';
import { isTrailingBlockComplete } from './grammar.js';

// unknown-version: warn once per stored object, never migrate → docs/modules/state.md#unknown-version
const warned = new WeakSet();

// state-shape: JSON-plain, stored inline in chatMetadata → docs/modules/state.md#shape
export function createState() {
  return { version: STATE_VERSION, frozen: [], frontier: '' };
}

// initialise-from-chat: non-system messages verbatim, blank-line joined → docs/modules/state.md#initialise-from-chat
export function initialiseFromChat(chat) {
  const state = createState();
  if (!Array.isArray(chat)) return state;

  const blocks = [];
  for (const message of chat) {
    if (message.is_system === true) continue;
    const text = message.mes.trim();
    if (text === '') continue;
    blocks.push(text);
  }
  state.frontier = blocks.join(BLOCK_DELIMITER);
  return state;
}

// lazy-init: materialised on first read, assigned but not saved → docs/modules/state.md#lazy-init
export function getState(ctx = getCtx()) {
  const stored = ctx.chatMetadata?.[METADATA_KEY];
  if (stored === undefined) {
    const state = initialiseFromChat(ctx.chat);
    ctx.chatMetadata[METADATA_KEY] = state;
    return state;
  }

  if (stored.version !== STATE_VERSION && !warned.has(stored)) {
    warned.add(stored);
    console.warn(`${LOG_PREFIX} unknown state version: ${stored.version}`);
  }
  return stored;
}

// mutation-is-storage: helpers mutate the stored object in place → docs/modules/state.md#mutation-is-storage
export function setFrontier(state, text) {
  state.frontier = String(text);
}

export function appendToFrontier(state, block) {
  const text = block?.trim() ?? '';
  if (text === '') return;
  const existing = state.frontier.replace(/\s+$/, '');
  state.frontier = existing === '' ? text : existing + BLOCK_DELIMITER + text;
}

// append-only: refuse a mid-block span, no removal or replacement path → docs/modules/state.md#append-only
export function pushFrozen(state, span) {
  const text = span.text;
  if (typeof text !== 'string' || text.trim() === '') return false;
  if (!isTrailingBlockComplete(text)) return false;

  const words = Number.isFinite(span.words) ? span.words : (text.match(/\S+/g) ?? []).length;
  const createdAt = Number.isFinite(span.createdAt) ? span.createdAt : Date.now();
  state.frozen.push({ text, words, createdAt });
  return true;
}

// save-metadata-only: saveChat leg belongs to the recovery brief → docs/modules/state.md#save
export async function save(ctx = getCtx()) {
  await ctx.saveMetadata();
}
