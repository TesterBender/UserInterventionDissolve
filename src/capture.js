import { getCtx } from './host.js';
import { METADATA_KEY } from './constants.js';
import { parseTagHeader } from './grammar.js';
import { reservedLiteral } from './boundary.js';
import { getState, appendToFrontier, save } from './state.js';

// transformation-rule: tag the first block only, rest byte-identical → docs/modules/capture.md#transformation-rule
// reserved-literal: borrowed from boundary, empty name writes no tag → docs/modules/capture.md#reserved-literal
export function toManuscriptBlock(text, literal) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed === '') return '';
  if (typeof literal !== 'string' || literal === '') return trimmed;

  const actor = literal.replace(/:$/, '').trim();
  const header = parseTagHeader(trimmed);
  if (header !== null && header.actor.trim().toLowerCase() === actor.trim().toLowerCase()) return trimmed;

  return `${literal} ${trimmed}`;
}

// composer-path: runs after the push, the visible message is left verbatim → docs/modules/capture.md#composer-path
// barge-in: every send is a capture, no stop required, nothing recorded → docs/modules/capture.md#barge-in
export async function captureMessage(index, ctx = getCtx()) {
  const message = ctx.chat?.[index];
  if (typeof message !== 'object' || message === null) return false;
  if (message.is_user !== true || message.is_system === true) return false;
  if (message.extra?.[METADATA_KEY]?.captured === true) return false;

  const block = toManuscriptBlock(message.mes, reservedLiteral(ctx));
  if (block === '') return false;

  appendToFrontier(getState(ctx), block);

  // capture-marker: message-local idempotence flag, spread past boundary's → docs/modules/capture.md#capture-marker
  message.extra = message.extra ?? {};
  message.extra[METADATA_KEY] = { ...(message.extra[METADATA_KEY] ?? {}), captured: true };

  await save(ctx);
  await ctx.saveChat();
  return true;
}
