import { BLOCK_DELIMITER } from '../src/constants.js';

// fnv1a32: dependency-free, allocation-free, stable across processes → docs/modules/janitor-adapter.md#prefix-hash-watermark
export function fnv1a32(text) {
  const input = String(text);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// prefix-hash: the compiled part of the watermark message only → docs/modules/janitor-adapter.md#prefix-hash-watermark
export function prefixIdentity(content, offset) {
  return fnv1a32(String(content).slice(0, offset));
}

// watermark-match: envelope id, then prefix hash, then give up → docs/modules/janitor-adapter.md#prefix-hash-watermark
export function matchWatermark(entries, watermark) {
  const target = watermark.messageId;
  if (target) {
    const exact = entries.findIndex((entry) => entry.messageId === target);
    if (exact !== -1) return exact;
  }

  const offset = watermark.offset;
  if (offset > 0 && watermark.prefixHash) {
    for (let index = 0; index < entries.length; index += 1) {
      const content = String(entries[index].content ?? '');
      if (content.length < offset) continue;
      if (prefixIdentity(content, offset) === watermark.prefixHash) return index;
    }
  }
  return -1;
}

// drift-report: indexes only, decides nothing and logs nothing → docs/modules/janitor-adapter.md#drift
export function classifyDrift(entries, state) {
  const frozenIds = new Set(state.frozenIds);
  // compiled-corpus: a consumed message's text sits verbatim in a span → docs/modules/janitor-adapter.md#drift
  const corpus = [...state.frozen, ...state.units].map((span) => span.text).join(BLOCK_DELIMITER);
  const watermark = state.watermark;

  const editedCompiledIndexes = [];
  for (let index = 0; index < entries.length; index += 1) {
    const messageId = entries[index].messageId;
    const content = String(entries[index].content ?? '');
    if (messageId === '') continue;

    if (frozenIds.has(messageId) && content !== '' && !corpus.includes(content)) {
      editedCompiledIndexes.push(index);
      continue;
    }
    if (messageId === watermark.messageId && prefixIdentity(content, watermark.offset) !== watermark.prefixHash) {
      editedCompiledIndexes.push(index);
    }
  }
  return { editedCompiledIndexes };
}
