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
import { matchWatermark, classifyDrift, prefixIdentity } from './identity.js';
import { rollbackHistory } from './rollback.js';

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

// pending-marker: the successor of the named id, or nothing, then cleared → docs/modules/janitor-adapter.md#boundary-records
function resolvePendingBoundary(state, entries) {
  const pending = typeof state.pendingBoundaryAfter === 'string' ? state.pendingBoundaryAfter : '';
  if (pending === '') return false;

  state.pendingBoundaryAfter = '';
  const named = entries.findIndex((entry) => entry.messageId === pending);
  const successor = named === -1 ? undefined : entries[named + 1];
  if (successor !== undefined && successor.role === 'assistant' && successor.messageId !== ''
    && !state.boundaries.includes(successor.messageId)) {
    state.boundaries.push(successor.messageId);
  }
  return true;
}

// request-pipeline: gate, classify, resolve, roll back, derive, freeze, reconstruct, stop → docs/modules/janitor-adapter.md#request-pipeline
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
  const { history, injections, systemIndex } = classifyMessages(messages, context.chatMessages, context.personaName);
  // sentinel-drop: exact match, every occurrence, before identities exist → docs/modules/janitor-adapter.md#sentinel
  const aligned = history.filter((entry) => !(entry.role === 'user' && entry.content === SENTINEL));

  const resolved = resolvePendingBoundary(state, aligned);
  const literal = `${context.personaName}:`;
  // derivation-rollback: the trimmed entries are all the rest of the pipeline sees → docs/modules/janitor-adapter.md#derivation-rollback
  const { entries: kept, rollbacks } = rollbackHistory(aligned, literal, new Set(state.boundaries));

  const watermarkIndex = matchWatermark(kept, state.watermark);
  // watermark-rekey: a prefix-hash match moves the watermark onto the new id → docs/modules/janitor-adapter.md#prefix-hash-watermark
  if (watermarkIndex !== -1 && kept[watermarkIndex].messageId !== '') {
    state.watermark.messageId = kept[watermarkIndex].messageId;
  }
  const drift = classifyDrift(kept, state);

  const shaped = toStShape(kept);
  let derived = deriveFrontier(shaped, state, literal);

  let froze = false;
  // identified-gate: compile nothing rather than store an empty id → docs/modules/janitor-adapter.md#envelope-id-identity
  if (derived.segments.length >= 2 && kept.every((entry) => entry.messageId !== '')) {
    // last-message-clamp: the last segment's start, so regenerate stays safe → docs/modules/janitor-adapter.md#freeze-at-request-build
    const maxFrozenEnd = derived.segments[derived.segments.length - 1].start;
    if (compileUnit(state, derived, literal, { maxFrozenEnd }) !== null) {
      froze = true;
      const watermarked = kept.find((entry) => entry.messageId === state.watermark.messageId);
      state.watermark.prefixHash = watermarked === undefined
        ? ''
        : prefixIdentity(watermarked.content, state.watermark.offset);
      state.watermarkText = watermarked === undefined ? '' : String(watermarked.content);
      derived = deriveFrontier(shaped, state, literal);
      saveJanitorState(context.chatId, state);
    }
  }
  // resolution-save: a cleared marker is a state change with no freeze → docs/modules/janitor-adapter.md#stored-state
  if (!froze && resolved) saveJanitorState(context.chatId, state);

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

  // request-report: one line, the only sign of life until the panel → docs/modules/janitor-adapter.md#request-report
  console.info(
    `${LOG_PREFIX} finals ${state.frozen.length}, units ${state.units.length}, `
      + `frontier ${countWords(derived.text)} words, froze ${froze ? 'yes' : 'no'}, `
      + `drift ${drift.editedCompiledIndexes.length}, boundary ${state.boundaries.length}, `
      + `rollback ${rollbacks}`,
  );
  return true;
}
