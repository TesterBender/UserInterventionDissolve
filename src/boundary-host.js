import { getCtx } from './host.js';
import { METADATA_KEY } from './constants.js';
import { reservedLiteral, applyStopStrings, findBoundary, trimAtBoundary } from './boundary.js';

// skipped-generation-types: quiet and impersonate only, unknown fails closed → docs/modules/boundary.md#skipped-generation-types
const SKIPPED_TYPES = ['quiet', 'impersonate'];
const SKIPPED_RECEIPT_TYPES = ['quiet', 'impersonate', 'first_message'];

let currentType;
let currentDryRun = false;
let stoppedThisGeneration = false;
let suspendDepth = 0;

export function resetBoundaryState() {
  currentType = undefined;
  currentDryRun = false;
  stoppedThisGeneration = false;
  suspendDepth = 0;
}

// suspension: counted, per-handle idempotent resume, request side only → docs/modules/boundary.md#suspension
export function suspendBoundary() {
  suspendDepth += 1;
  let released = false;
  return function resume() {
    if (released) return;
    released = true;
    if (suspendDepth > 0) suspendDepth -= 1;
  };
}

export function onGenerationStarted(type, _options, dryRun) {
  currentType = type;
  currentDryRun = Boolean(dryRun);
  stoppedThisGeneration = false;
}

export function onChatCompletionSettings(body) {
  if (suspendDepth > 0) return;
  if (SKIPPED_TYPES.includes(currentType) || currentDryRun) return;
  applyStopStrings(body, reservedLiteral(getCtx()), 'chat');
}

export function onTextCompletionSettings(body) {
  if (suspendDepth > 0) return;
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
