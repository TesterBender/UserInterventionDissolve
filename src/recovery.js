import { getCtx } from './host.js';
import { METADATA_KEY } from './constants.js';
import { isTrailingBlockComplete, truncateToLastCompleteBlock } from './grammar.js';
import { reservedLiteral, findBoundary, trimAtBoundary } from './boundary.js';
import { ensureMessageId, assignIds } from './derive.js';

// duplicated-eligibility: same list as boundary, wired independently → docs/modules/recovery.md#ordering
const SKIPPED_RECEIPT_TYPES = ['quiet', 'impersonate', 'first_message'];

// classification-order: empty before boundary, the text is the only signal → docs/modules/recovery.md#classification
export function classifyOutcome(text, literal, boundaryMarked = false) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return 'empty';
  if (boundaryMarked === true) return 'boundary';
  if (typeof literal === 'string' && literal !== '' && findBoundary(text, literal).endsAtLiteral) return 'boundary';
  if (isTrailingBlockComplete(text)) return 'complete';
  return 'incomplete';
}

// in-message-edit: the message text is the frontier, so the message is edited → docs/modules/recovery.md#rollback
function writeBack(message, text, index, ctx) {
  message.mes = text;
  if (Array.isArray(message.swipes) && message.swipes[message.swipe_id] !== undefined) {
    message.swipes[message.swipe_id] = text;
  }
  ctx.updateMessageBlock(index, message);
}

// single-entry-point: model text is classified here and nowhere else → docs/modules/recovery.md#append
export async function onMessageReceived(index, type, ctx = getCtx()) {
  if (SKIPPED_RECEIPT_TYPES.includes(type)) return 'skipped';

  const message = ctx.chat?.[index];
  if (typeof message !== 'object' || message === null) return 'skipped';
  if (typeof message.mes !== 'string') return 'skipped';
  if (message.is_user === true || message.is_system === true) return 'skipped';

  const mark = message.extra?.[METADATA_KEY] ?? {};
  // resample-passes-the-guard: a new sample must be classified again → docs/modules/recovery.md#swipes
  const isResample = type === 'swipe' || type === 'regenerate';

  // receive-once: message-local flag, the only replay path this module sees → docs/modules/recovery.md#append
  if (mark.received === true && !isResample) return 'skipped';

  const literal = reservedLiteral(ctx);
  const outcome = classifyOutcome(message.mes, literal, mark.boundary === true);
  let chatDirty = false;

  // rollback: incomplete trailing block is transport debris, never history → docs/modules/recovery.md#rollback
  if (outcome === 'incomplete') {
    writeBack(message, truncateToLastCompleteBlock(message.mes), index, ctx);
    chatDirty = true;
  }

  // boundary-kept: handed-over block kept, literal trimmed as a safety net → docs/modules/recovery.md#boundary-not-rolled-back
  if (outcome === 'boundary') {
    writeBack(message, trimAtBoundary(message.mes, literal), index, ctx);
    chatDirty = true;
  }

  // floor-stays: nothing is recorded and no text is forced → docs/modules/recovery.md#rollback
  if (message.mes.trim() === '') {
    if (chatDirty) await ctx.saveChat();
    return outcome === 'incomplete' ? outcome : 'empty';
  }

  ensureMessageId(message);
  message.extra[METADATA_KEY] = { ...message.extra[METADATA_KEY], received: true };
  // freeze-disabled: re-enabled with the watermark mapping → docs/modules/recovery.md#freeze-hookup

  // assign-ids: once per batch, on the save this handler already makes → docs/modules/derive.md#message-ids
  assignIds(ctx.chat);
  await ctx.saveChat();
  return outcome;
}
