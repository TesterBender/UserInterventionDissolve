import { trimAtBoundary } from '../src/boundary.js';
import { isTrailingBlockComplete, truncateToLastCompleteBlock } from '../src/grammar.js';

// derivation-rollback: literal first, then the incomplete trailing block → docs/modules/janitor-adapter.md#derivation-rollback
export function rollbackHistory(entries, literal, boundaryIds) {
  let rollbacks = 0;
  const rolled = entries.map((entry) => {
    if (entry.role !== 'assistant') return entry;
    // boundary-not-rolled-back: a deliberate stop keeps every byte → docs/modules/recovery.md#boundary-not-rolled-back
    if (entry.messageId !== '' && boundaryIds.has(entry.messageId)) return entry;

    const cut = literal === '' ? entry.content : trimAtBoundary(entry.content, literal);
    const text = isTrailingBlockComplete(cut) ? cut : truncateToLastCompleteBlock(cut);
    if (text === entry.content) return entry;

    rollbacks += 1;
    return { ...entry, content: text };
  });
  return { entries: rolled, rollbacks };
}
