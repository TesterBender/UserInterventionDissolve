import { STATE_VERSION } from '../src/constants.js';
import { JANITOR_STATE_FORMAT } from './constants.js';

// export-kind: the wrapper carries no version of its own → docs/modules/janitor-adapter.md#state-transfer
const EXPORT_KIND = 'uid-janitor-state';

export function exportStateJson(chatId, state) {
  return JSON.stringify({ kind: EXPORT_KIND, chatId, exportedAt: new Date().toISOString(), state }, null, 2);
}

// refuse-whole: no repair, no migration, no merge → docs/modules/janitor-adapter.md#state-transfer
export function importStateJson(text) {
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'unreadable' };

  const state = parsed.state;
  if (parsed.kind !== EXPORT_KIND || typeof state !== 'object' || state === null
    || !Array.isArray(state.frozen) || !Array.isArray(state.units) || !Array.isArray(state.frozenIds)
    || typeof state.watermark !== 'object' || state.watermark === null) {
    return { ok: false, reason: 'not-a-state' };
  }
  if (state.version !== STATE_VERSION || state.janitorFormat !== JANITOR_STATE_FORMAT) {
    return { ok: false, reason: 'wrong-format' };
  }

  // display-only-chat-id: the caller saves under the current chat's key → docs/modules/janitor-adapter.md#state-transfer
  return { ok: true, chatId: parsed.chatId, state };
}
