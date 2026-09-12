import { METADATA_KEY, BLOCK_DELIMITER } from './constants.js';
import { toManuscriptBlock } from './capture.js';

// message-ids: random and meaningless, spread past sibling markers → docs/modules/derive.md#message-ids
export function ensureMessageId(message) {
  const existing = message.extra?.[METADATA_KEY]?.id;
  if (typeof existing === 'string') return existing;

  const id = Math.random().toString(36).slice(2, 10);
  message.extra = message.extra ?? {};
  message.extra[METADATA_KEY] = { ...(message.extra[METADATA_KEY] ?? {}), id };
  return id;
}

// assign-ids: one pass, called by the handlers that already saveChat → docs/modules/derive.md#message-ids
export function assignIds(chat) {
  if (!Array.isArray(chat)) return false;

  let assigned = false;
  for (const message of chat) {
    if (typeof message !== 'object' || message === null) continue;
    if (typeof message.mes !== 'string' || message.is_system === true) continue;
    if (typeof message.extra?.[METADATA_KEY]?.id === 'string') continue;
    ensureMessageId(message);
    assigned = true;
  }
  return assigned;
}

// derivation-rule: per-message inclusion, watermark slice, user transform → docs/modules/derive.md#derivation-rule
// purity: reads chat and state, mutates neither, assigns no id → docs/modules/derive.md#purity
export function deriveFrontier(chat, state, literal) {
  if (!Array.isArray(chat)) return { text: '', segments: [] };

  const frozenIds = new Set(state?.frozenIds ?? []);
  const watermark = state?.watermark ?? { messageId: null, offset: 0 };

  const blocks = [];
  const segments = [];
  let end = 0;

  for (const message of chat) {
    if (typeof message !== 'object' || message === null) continue;
    if (typeof message.mes !== 'string' || message.is_system === true) continue;

    // per-message: an absent or unknown id is mutable, never frozen → docs/modules/derive.md#per-message
    const id = message.extra?.[METADATA_KEY]?.id ?? null;
    if (id !== null && frozenIds.has(id)) continue;

    const offset = watermark.offset;
    const source = id === watermark.messageId && Number.isFinite(offset) && offset > 0
      ? message.mes.slice(offset)
      : message.mes;

    const block = message.is_user === true ? toManuscriptBlock(source, literal) : source.trim();
    if (block === '') continue;

    const start = blocks.length === 0 ? 0 : end + BLOCK_DELIMITER.length;
    end = start + block.length;
    segments.push({ id, start, end });
    blocks.push(block);
  }

  return { text: blocks.join(BLOCK_DELIMITER), segments };
}
