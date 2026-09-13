import { STATE_VERSION } from '../src/constants.js';
import { createState } from '../src/state.js';
import { STORAGE_KEY_PREFIX, JANITOR_STATE_FORMAT } from './constants.js';

// janitor-fields: v3 state plus the five fields this layer owns → docs/modules/janitor-adapter.md#stored-state
function freshState() {
  return {
    ...createState(),
    janitorFormat: JANITOR_STATE_FORMAT,
    literal: '',
    boundaries: [],
    pendingBoundaryAfter: '',
    watermarkText: '',
  };
}

// per-chat-key: one entry per Janitor chat id, no global entry → docs/modules/janitor-adapter.md#stored-state
export function stateKey(chatId) {
  return STORAGE_KEY_PREFIX + chatId;
}

// no-migration: a foreign or unreadable value is replaced, never guessed → docs/modules/janitor-adapter.md#stored-state
export function loadJanitorState(chatId, storage = localStorage) {
  if (typeof chatId !== 'string' || chatId === '') return freshState();

  const raw = storage.getItem(stateKey(chatId));
  if (raw == null) return freshState();

  let stored = null;
  try {
    stored = JSON.parse(raw);
  } catch {
    stored = null;
  }

  if (typeof stored !== 'object' || stored === null || stored.version !== STATE_VERSION
    || stored.janitorFormat !== JANITOR_STATE_FORMAT) {
    console.warn(`[Manuscript] stored state for ${chatId} is not readable as version ${STATE_VERSION}/${JANITOR_STATE_FORMAT}; starting fresh.`);
    return freshState();
  }

  return stored;
}

// write-never-throws: a failed save must not abort a generation → docs/modules/janitor-adapter.md#stored-state
export function saveJanitorState(chatId, state, storage = localStorage) {
  if (typeof chatId !== 'string' || chatId === '') return;

  try {
    storage.setItem(stateKey(chatId), JSON.stringify(state));
  } catch (error) {
    console.warn(`[Manuscript] could not save state for ${chatId}: ${error.message}`);
  }
}
