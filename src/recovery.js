import { getCtx } from './host.js';
import { METADATA_KEY, LOG_PREFIX } from './constants.js';
import { isTrailingBlockComplete, truncateToLastCompleteBlock } from './grammar.js';
import { getState, appendToFrontier, setFrontier, save } from './state.js';
import { reservedLiteral, findBoundary, trimAtBoundary } from './boundary.js';
import { maybeFreeze } from './freeze.js';

// duplicated-eligibility: same list as boundary, wired independently → docs/modules/recovery.md#ordering
const SKIPPED_RECEIPT_TYPES = ['quiet', 'impersonate', 'first_message'];

// resample-fallback: last append of this session, when the marker is gone → docs/modules/recovery.md#swipes
let lastAppend = null;

export function resetRecoveryState() {
  lastAppend = null;
}

// classification-order: empty before boundary, the text is the only signal → docs/modules/recovery.md#classification
export function classifyOutcome(text, literal, boundaryMarked = false) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return 'empty';
  if (boundaryMarked === true) return 'boundary';
  if (typeof literal === 'string' && literal !== '' && findBoundary(text, literal).endsAtLiteral) return 'boundary';
  if (isTrailingBlockComplete(text)) return 'complete';
  return 'incomplete';
}

// single-entry-point: model text joins canonical state here and nowhere else → docs/modules/recovery.md#append
export async function onMessageReceived(index, type, ctx = getCtx()) {
  if (SKIPPED_RECEIPT_TYPES.includes(type)) return 'skipped';

  const message = ctx.chat?.[index];
  if (typeof message !== 'object' || message === null) return 'skipped';
  if (typeof message.mes !== 'string') return 'skipped';
  if (message.is_user === true || message.is_system === true) return 'skipped';

  const mark = message.extra?.[METADATA_KEY] ?? {};
  const isResample = type === 'swipe' || type === 'regenerate';

  // append-once: message-local flag, the only replay path this module sees → docs/modules/recovery.md#append
  if (mark.appended === true && !isResample) return 'skipped';

  const literal = reservedLiteral(ctx);
  const outcome = classifyOutcome(message.mes, literal, mark.boundary === true);

  let text = message.mes;
  let chatDirty = false;

  // rollback: incomplete trailing block is transport debris, never history → docs/modules/recovery.md#rollback
  if (outcome === 'incomplete') {
    text = truncateToLastCompleteBlock(message.mes);
    message.mes = text;
    if (Array.isArray(message.swipes) && message.swipes[message.swipe_id] !== undefined) {
      message.swipes[message.swipe_id] = text;
    }
    ctx.updateMessageBlock(index, message);
    chatDirty = true;
  }

  // boundary-kept: handed-over block appended, literal trimmed as a safety net → docs/modules/recovery.md#boundary-not-rolled-back
  if (outcome === 'boundary') text = trimAtBoundary(text, literal);

  // floor-stays: nothing is appended and no text is forced → docs/modules/recovery.md#rollback
  if (text.trim() === '') {
    if (chatDirty) await ctx.saveChat();
    return outcome === 'incomplete' ? outcome : 'empty';
  }

  const state = getState(ctx);
  const appendedText = text.trim();

  // swipe-replacement: only the trailing occurrence, never a frozen span → docs/modules/recovery.md#swipes
  if (isResample) {
    const previous = typeof mark.appendedText === 'string' && mark.appendedText !== ''
      ? mark.appendedText
      : (lastAppend?.text ?? '');
    if (previous !== '') {
      const settled = state.frontier.replace(/\s+$/, '');
      if (settled.endsWith(previous)) {
        setFrontier(state, settled.slice(0, -previous.length).replace(/\s+$/, ''));
      } else {
        console.warn(`${LOG_PREFIX} previous generation is no longer at the frontier edge; appending without replacing it`);
      }
    }
  }

  appendToFrontier(state, text);
  lastAppend = { index, text: appendedText };

  message.extra = message.extra ?? {};
  message.extra[METADATA_KEY] = { ...(message.extra[METADATA_KEY] ?? {}), appended: true, appendedText };
  chatDirty = true;

  // freeze-after-append: word count decides, never one generation one chunk → docs/modules/recovery.md#freeze-hookup
  maybeFreeze(state, literal, {});

  await save(ctx);
  if (chatDirty) await ctx.saveChat();
  return outcome;
}
