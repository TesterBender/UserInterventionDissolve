import { LOG_PREFIX } from '../src/constants.js';
import { JANITOR_OVERRIDE_KEY_PREFIX, JANITOR_OVERRIDE_FORMAT } from './constants.js';

// override-key: its own entry, never a chat state key → docs/modules/janitor-adapter.md#context-override
export function overrideKey(chatId) {
  return JANITOR_OVERRIDE_KEY_PREFIX + chatId;
}

export function clearOverride(chatId, storage = localStorage) {
  if (typeof chatId !== 'string' || chatId === '') return;
  storage.removeItem(overrideKey(chatId));
}

// no-migration: a foreign or unreadable value is refused, never guessed → docs/modules/janitor-adapter.md#context-override
export function loadOverride(chatId, storage = localStorage) {
  if (typeof chatId !== 'string' || chatId === '') return null;

  const raw = storage.getItem(overrideKey(chatId));
  if (raw == null) return null;

  let stored = null;
  try {
    stored = JSON.parse(raw);
  } catch {
    stored = null;
  }

  if (typeof stored !== 'object' || stored === null
    || stored.janitorOverrideFormat !== JANITOR_OVERRIDE_FORMAT
    || typeof stored.text !== 'string' || stored.text.trim() === '') {
    console.warn(`${LOG_PREFIX} the stored context override for ${chatId} is not readable as format ${JANITOR_OVERRIDE_FORMAT}; it is ignored.`);
    return null;
  }

  return stored;
}

// empty-is-not-an-override: saving nothing is the same act as Clear → docs/modules/janitor-adapter.md#context-override
export function saveOverride(chatId, text, capturedText, storage = localStorage) {
  if (typeof chatId !== 'string' || chatId === '') return;
  if (text.trim() === '') {
    clearOverride(chatId, storage);
    return;
  }

  const stored = {
    janitorOverrideFormat: JANITOR_OVERRIDE_FORMAT,
    text,
    capturedText,
    savedAt: Date.now(),
  };
  // write-never-throws: a failed save must not abort a generation → docs/modules/janitor-adapter.md#stored-state
  try {
    storage.setItem(overrideKey(chatId), JSON.stringify(stored));
  } catch (error) {
    console.warn(`${LOG_PREFIX} could not save the context override for ${chatId}: ${error.message}`);
  }
}

// drift-is-informational: exact inequality, reported and never acted on → docs/modules/janitor-adapter.md#context-override
export function overrideDrift(override, capturedText) {
  return override !== null && override.capturedText !== capturedText;
}
