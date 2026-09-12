import { getCtx } from './host.js';
import { METADATA_KEY } from './constants.js';
import { findTagLiteral } from './grammar.js';

// stop-fields: stop for chat completion, stopping_strings and stop for text → docs/modules/boundary.md#stop-fields
const STOP_FIELDS = { chat: ['stop'], text: ['stopping_strings', 'stop'] };

// skipped-generation-types: quiet and impersonate only, unknown fails closed → docs/modules/boundary.md#skipped-generation-types
const SKIPPED_TYPES = ['quiet', 'impersonate'];
const SKIPPED_RECEIPT_TYPES = ['quiet', 'impersonate', 'first_message'];

// reserved-literal: `${persona}:` bare, recomputed per use, never stored → docs/modules/boundary.md#reserved-literal
export function reservedLiteral(ctx) {
  let name = '';
  try {
    const expanded = ctx.substituteParams('{{user}}');
    if (typeof expanded === 'string' && expanded !== '{{user}}') name = expanded.trim();
  } catch {
    name = '';
  }
  if (name === '') name = String(ctx.name1 ?? '').trim();
  return name === '' ? '' : `${name}:`;
}

// why-first-in-stop-array: index 0 survives a provider-side cap → docs/modules/boundary.md#why-first-in-stop-array
export function applyStopStrings(body, literal, api) {
  if (literal === '' || typeof body !== 'object' || body === null) return body;
  for (const field of STOP_FIELDS[api]) {
    if (!Array.isArray(body[field])) body[field] = [];
    const strings = body[field];
    for (let i = strings.length - 1; i >= 0; i -= 1) {
      if (strings[i] === literal) strings.splice(i, 1);
    }
    strings.unshift(literal);
  }
  return body;
}

// block-start-only: position decides, never the parsed actor → docs/modules/boundary.md#block-start-only
export function findBoundary(text, literal) {
  if (typeof text !== 'string' || literal === '') return { index: -1, endsAtLiteral: false };
  const occurrence = findTagLiteral(text, literal.replace(/:$/, '')).find((found) => found.atBlockStart);
  if (occurrence === undefined) return { index: -1, endsAtLiteral: false };
  return {
    index: occurrence.index,
    endsAtLiteral: text.slice(occurrence.index + literal.length).trim() === '',
  };
}

// receipt-trim: cut back to the character before the literal → docs/modules/boundary.md#receipt-trim
export function trimAtBoundary(text, literal) {
  const { index } = findBoundary(text, literal);
  if (index === -1) return text;
  return text.slice(0, index).replace(/\s+$/, '');
}

let currentType;
let currentDryRun = false;
let stoppedThisGeneration = false;

export function resetBoundaryState() {
  currentType = undefined;
  currentDryRun = false;
  stoppedThisGeneration = false;
}

export function onGenerationStarted(type, _options, dryRun) {
  currentType = type;
  currentDryRun = Boolean(dryRun);
  stoppedThisGeneration = false;
}

export function onChatCompletionSettings(body) {
  if (SKIPPED_TYPES.includes(currentType) || currentDryRun) return;
  applyStopStrings(body, reservedLiteral(getCtx()), 'chat');
}

export function onTextCompletionSettings(body) {
  if (SKIPPED_TYPES.includes(currentType) || currentDryRun) return;
  applyStopStrings(body, reservedLiteral(getCtx()), 'text');
}

// stream-fallback: for backends that ignore stop strings, once per generation → docs/modules/boundary.md#stream-fallback
// barge-in: the stop is a trigger for external authorship, never a gate → docs/modules/boundary.md#barge-in
export function onStreamToken(text) {
  if (SKIPPED_TYPES.includes(currentType) || stoppedThisGeneration) return;
  const ctx = getCtx();
  const literal = reservedLiteral(ctx);
  if (literal === '') return;
  if (findBoundary(text, literal).index === -1) return;
  stoppedThisGeneration = true;
  ctx.stopGeneration();
}

export async function onMessageReceived(index, type) {
  if (SKIPPED_RECEIPT_TYPES.includes(type)) return;
  const ctx = getCtx();
  const message = ctx.chat?.[index];
  if (typeof message !== 'object' || message === null) return;
  if (message.is_user) return;
  if (typeof message.mes !== 'string') return;

  const literal = reservedLiteral(ctx);
  if (findBoundary(message.mes, literal).index === -1) return;

  // empty-at-boundary: a wholly empty model turn is the correct record → docs/modules/boundary.md#empty-at-boundary
  message.mes = trimAtBoundary(message.mes, literal);
  if (Array.isArray(message.swipes) && message.swipes[message.swipe_id] !== undefined) {
    message.swipes[message.swipe_id] = message.mes;
  }

  // boundary-marker: message-local floor signal, not canonical state → docs/modules/boundary.md#boundary-marker
  message.extra = message.extra ?? {};
  message.extra[METADATA_KEY] = { ...(message.extra[METADATA_KEY] ?? {}), boundary: true };

  ctx.updateMessageBlock(index, message);
  await ctx.saveChat();
}
