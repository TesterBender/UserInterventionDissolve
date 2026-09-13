import { BLOCK_DELIMITER, METADATA_KEY } from '../src/constants.js';
import { deriveFrontier } from '../src/derive.js';
import { compileUnit, countWords } from '../src/freeze.js';
import { prefixIdentity } from './identity.js';

// rebuild-bound: hard stop, the state already guarantees termination → docs/modules/janitor-adapter.md#recompile
const MAX_REBUILD_PASSES = 1000;

// recompile-flag: per page, in memory, consumed by the next request → docs/modules/janitor-adapter.md#recompile
let requestedChatId = '';

export function requestRecompile(chatId) {
  requestedChatId = chatId;
}

export function consumeRecompile(chatId) {
  if (requestedChatId === '' || requestedChatId !== chatId) return false;
  requestedChatId = '';
  return true;
}

// watermark-insurance: the post-freeze write both compile paths share → docs/modules/janitor-adapter.md#freeze-at-request-build
export function writeWatermarkInsurance(state, shaped) {
  const message = shaped.find((entry) => entry.extra[METADATA_KEY].id === state.watermark.messageId);
  state.watermark.prefixHash = message === undefined ? '' : prefixIdentity(message.mes, state.watermark.offset);
  state.watermarkText = message === undefined ? '' : String(message.mes);
}

// reset-and-rebuild: the pure loop, never a re-cut of a surviving span → docs/modules/janitor-adapter.md#recompile
export function rebuildState(shaped, literal, state) {
  for (let pass = 0; pass < MAX_REBUILD_PASSES; pass += 1) {
    const derived = deriveFrontier(shaped, state, literal);
    if (derived.segments.length < 2) break;
    // last-message-clamp: the last segment's start, so regenerate stays safe → docs/modules/janitor-adapter.md#recompile
    const maxFrozenEnd = derived.segments[derived.segments.length - 1].start;
    if (compileUnit(state, derived, literal, { maxFrozenEnd }) === null) break;
    writeWatermarkInsurance(state, shaped);
  }

  return {
    spans: state.frozen.length,
    words: countWords(state.frozen.map((span) => span.text).join(BLOCK_DELIMITER)),
    units: state.units.length,
  };
}
