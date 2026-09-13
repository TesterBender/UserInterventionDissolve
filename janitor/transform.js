import { LOG_PREFIX, BLOCK_DELIMITER } from '../src/constants.js';
import { MANUSCRIPT_SYSTEM_PROMPT } from '../src/prompt.js';
import { deriveFrontier } from '../src/derive.js';
import { buildHistory } from '../src/frontier.js';
import { compileUnit, countWords } from '../src/freeze.js';
import { applyStopStrings } from '../src/boundary.js';
import {
  SENTINEL,
  JANITOR_HORIZON_TOKEN_BUDGET,
  JANITOR_HORIZON_HYSTERESIS,
  JANITOR_WORDS_PER_TOKEN,
  JANITOR_LEAD_IN,
} from './constants.js';
import { loadJanitorState, saveJanitorState } from './storage.js';
import { classifyMessages, toStShape, fromStShape } from './history.js';
import { assignIdentities, matchWatermark, classifyDrift, prefixIdentity } from './identity.js';

// first-sentence-probe: computed from the import, never a copied literal → docs/modules/janitor-adapter.md#system-message
const PROMPT_FIRST_SENTENCE = MANUSCRIPT_SYSTEM_PROMPT.slice(0, MANUSCRIPT_SYSTEM_PROMPT.indexOf('.') + 1);

let warnedWithoutEnvelope = false;
let warnedHorizonFloor = false;

// fold-injections: prompt first, Janitor's text verbatim, injections appended → docs/modules/janitor-adapter.md#system-message
function foldedSystemMessage(janitorText, injections) {
  const head = janitorText.includes(PROMPT_FIRST_SENTENCE)
    ? [janitorText]
    : [MANUSCRIPT_SYSTEM_PROMPT, janitorText];
  const parts = [...head.filter((text) => text !== ''), ...injections.map((injection) => String(injection.content ?? ''))];
  return { role: 'system', content: parts.join(BLOCK_DELIMITER) };
}

function estimatedTokens(messages) {
  let words = 0;
  for (const message of messages) words += countWords(message.content);
  return words * JANITOR_WORDS_PER_TOKEN;
}

// whole-pairs-from-the-front: span 0, the frontier and the edge are pinned → docs/modules/janitor-adapter.md#transport-horizon
function withinHorizon(messages) {
  if (estimatedTokens(messages) <= JANITOR_HORIZON_TOKEN_BUDGET) return messages;

  const kept = [...messages];
  const floor = JANITOR_HORIZON_TOKEN_BUDGET * JANITOR_HORIZON_HYSTERESIS;
  while (estimatedTokens(kept) > floor && kept.length >= 7) kept.splice(3, 2);

  if (estimatedTokens(kept) > JANITOR_HORIZON_TOKEN_BUDGET && !warnedHorizonFloor) {
    warnedHorizonFloor = true;
    console.warn(`${LOG_PREFIX} the request is over the transport budget with nothing left to drop`);
  }
  return kept;
}

// request-pipeline: gate, classify, derive, freeze, reconstruct, trim, stop → docs/modules/janitor-adapter.md#request-pipeline
export function transformRequest(data, context) {
  const adapter = context.adapter;
  if (adapter.kind !== 'chat') return false;
  // anthropic-passthrough: a top-level system string is a later phase → docs/modules/janitor-adapter.md#request-pipeline
  if (typeof adapter.requestContainer.system === 'string') return false;
  if (!context.chatId || !context.personaName) {
    if (!warnedWithoutEnvelope) {
      warnedWithoutEnvelope = true;
      console.warn(`${LOG_PREFIX} no /generateAlpha envelope for this conversation; the request is passed through`);
    }
    return false;
  }

  // reload-per-request: another tab may have compiled since the last one → docs/modules/janitor-adapter.md#request-pipeline
  const state = loadJanitorState(context.chatId);
  const messages = adapter.messagesContainer.messages;
  const { history, injections, systemIndex } = classifyMessages(messages, context.chatMessages);
  // sentinel-drop: exact match, every occurrence, before identities exist → docs/modules/janitor-adapter.md#sentinel
  const kept = history.filter((entry) => !(entry.role === 'user' && entry.content === SENTINEL));

  const ids = assignIdentities(kept);
  const watermarkIndex = matchWatermark(ids, kept, state.watermark);
  if (watermarkIndex !== -1) state.watermark.messageId = ids[watermarkIndex];
  const frozenIds = new Set(state.frozenIds);
  const drift = classifyDrift(ids, ids.map((id, index) => frozenIds.has(id) || index === watermarkIndex));

  const literal = `${context.personaName}:`;
  const shaped = toStShape(kept, ids);
  let derived = deriveFrontier(shaped, state, literal);

  let froze = false;
  if (derived.segments.length >= 2) {
    // last-message-clamp: the last segment's start, so regenerate stays safe → docs/modules/janitor-adapter.md#freeze-at-request-build
    const maxFrozenEnd = derived.segments[derived.segments.length - 1].start;
    if (compileUnit(state, derived, literal, { maxFrozenEnd }) !== null) {
      froze = true;
      const watermarked = kept[ids.indexOf(state.watermark.messageId)];
      state.watermark.prefixHash = watermarked === undefined
        ? ''
        : prefixIdentity(watermarked.content, state.watermark.offset);
      state.watermarkText = watermarked === undefined ? '' : String(watermarked.content);
      derived = deriveFrontier(shaped, state, literal);
      saveJanitorState(context.chatId, state);
    }
  }

  const janitorText = systemIndex === -1 ? '' : String(messages[systemIndex].content ?? '');
  // prefill-drop: the trailing assistant injection is the prefill, never folded → docs/modules/janitor-adapter.md#prefill-strip
  const folded = injections.filter((entry) => !(entry.role === 'assistant' && entry.index === messages.length - 1));
  const reconstruction = fromStShape(
    buildHistory(state, { name1: context.personaName, name2: '' }, { frontier: derived.text }),
  );
  const outgoing = withinHorizon([foldedSystemMessage(janitorText, folded), ...reconstruction]);
  // user-first: some providers refuse a history that opens on an assistant turn → docs/modules/janitor-adapter.md#lead-in
  if (outgoing[1]?.role === 'assistant') outgoing.splice(1, 0, { role: 'user', content: JANITOR_LEAD_IN });
  adapter.messagesContainer.messages = outgoing;

  applyStopStrings(adapter.requestContainer, literal, 'chat');

  // request-report: four facts, one line, the only sign of life until the panel → docs/modules/janitor-adapter.md#request-report
  console.info(
    `${LOG_PREFIX} finals ${state.frozen.length}, units ${state.units.length}, `
      + `frontier ${countWords(derived.text)} words, froze ${froze ? 'yes' : 'no'}, `
      + `drift ${drift.editedBeforeIndexes.length}`,
  );
  return true;
}
