import { describe, it, expect } from 'vitest';
import { fnv1a32, prefixIdentity, matchWatermark, classifyDrift } from '../../janitor/identity.js';
import { classifyMessages } from '../../janitor/history.js';
import { BLOCK_DELIMITER } from '../../src/constants.js';
import { PROVIDER_MESSAGES, ENVELOPE_CHAT_MESSAGES, HISTORY_ONE, HISTORY_TWO } from './fixtures/provider-chat.js';

function entriesOf(messages = PROVIDER_MESSAGES, envelope = ENVELOPE_CHAT_MESSAGES) {
  return classifyMessages(messages, envelope).history;
}

function stateOf(overrides = {}) {
  return {
    frozen: [],
    units: [],
    frozenIds: [],
    watermark: { messageId: null, offset: 0 },
    ...overrides,
  };
}

describe('fnv1a32', () => {
  it('is stable for the same input and fixed-width lowercase hex', () => {
    expect(fnv1a32('abc')).toBe(fnv1a32('abc'));
    expect(fnv1a32('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a32('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('reproduces the published FNV-1a/32 values, so it is stable across processes', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('abc')).toBe('1a47e90b');
  });

  it('pads a short hash to eight characters', () => {
    const hashes = Array.from({ length: 400 }, (_, i) => fnv1a32(`message ${i}`));
    for (const hash of hashes) expect(hash).toHaveLength(8);
  });

  it('has exactly one caller in the module, prefixIdentity', () => {
    expect(prefixIdentity('abcdef', 3)).toBe(fnv1a32('abc'));
    expect(prefixIdentity('abc', 99)).toBe(fnv1a32('abc'));
  });
});

describe('the module no longer exports the content-hash scheme', () => {
  it('has no messageIdentity and no assignIdentities', async () => {
    const module = await import('../../janitor/identity.js');
    expect(Object.keys(module).sort()).toEqual(['classifyDrift', 'fnv1a32', 'matchWatermark', 'prefixIdentity']);
  });
});

describe('matchWatermark', () => {
  const compiled = 'The compiled prefix of the message.';
  const tail = ' And the uncompiled tail.';
  const entries = [
    { role: 'assistant', content: 'Something earlier.', messageId: '103237690201' },
    { role: 'assistant', content: compiled + tail, messageId: '103237690202' },
  ];
  const watermark = {
    messageId: '103237690202',
    offset: compiled.length,
    prefixHash: prefixIdentity(compiled + tail, compiled.length),
  };

  it('finds the watermark message by its envelope id', () => {
    expect(matchWatermark(entries, watermark)).toBe(1);
  });

  it('still finds it by id after a tail edit, which does not change the id', () => {
    const edited = [entries[0], { ...entries[1], content: `${compiled} A rewritten tail entirely.` }];
    expect(matchWatermark(edited, watermark)).toBe(1);
  });

  it('falls back to the prefix hash when the id is not in the request', () => {
    const rekeyed = [entries[0], { ...entries[1], messageId: '103237690999' }];
    expect(matchWatermark(rekeyed, watermark)).toBe(1);
    expect(matchWatermark([entries[0], { ...rekeyed[1], content: `${compiled} A new tail.` }], watermark)).toBe(1);
  });

  it('returns -1 after a head edit', () => {
    const edited = [entries[0], { ...entries[1], messageId: '', content: `X${compiled}${tail}` }];
    expect(matchWatermark(edited, watermark)).toBe(-1);
  });

  it('returns -1 when the watermark message is shorter than the offset', () => {
    const edited = [entries[0], { ...entries[1], messageId: '', content: compiled.slice(0, 5) }];
    expect(matchWatermark(edited, watermark)).toBe(-1);
  });

  it('never matches an empty messageId by rule 1', () => {
    const blank = entries.map((entry) => ({ ...entry, messageId: '' }));
    expect(matchWatermark(blank, { messageId: '', offset: 0, prefixHash: '' })).toBe(-1);
  });

  it('returns -1 for a fresh watermark that names no message', () => {
    expect(matchWatermark(entries, { messageId: null, offset: 0 })).toBe(-1);
  });
});

describe('classifyDrift', () => {
  const entries = entriesOf();
  const firstId = entries[0].messageId;
  const compiledCorpus = [{ text: `Mara:\n${HISTORY_ONE}`, words: 7, createdAt: 1 }];

  it('reports nothing when the compiled text is still what state compiled', () => {
    const state = stateOf({ frozen: compiledCorpus, frozenIds: [firstId] });
    expect(classifyDrift(entries, state)).toEqual({ editedCompiledIndexes: [] });
  });

  it('reports a compiled message whose text was edited in place', () => {
    const edited = entries.map((entry, index) => (index === 0 ? { ...entry, content: 'Rewritten entirely.' } : entry));
    const state = stateOf({ frozen: compiledCorpus, frozenIds: [firstId] });
    expect(classifyDrift(edited, state)).toEqual({ editedCompiledIndexes: [0] });
  });

  it('looks across finals and units alike', () => {
    const state = stateOf({
      units: [{ text: `A final span.${BLOCK_DELIMITER}${HISTORY_TWO}`, words: 9, createdAt: 1 }],
      frozenIds: [entries[1].messageId],
    });
    expect(classifyDrift(entries, state).editedCompiledIndexes).toEqual([]);
  });

  it('ignores messages that are not in frozenIds, however new or edited', () => {
    const state = stateOf({ frozen: compiledCorpus, frozenIds: [] });
    expect(classifyDrift(entries, state)).toEqual({ editedCompiledIndexes: [] });
  });

  it('ignores an entry with no envelope id', () => {
    const blank = entries.map((entry) => ({ ...entry, messageId: '', content: 'Rewritten entirely.' }));
    const state = stateOf({ frozen: compiledCorpus, frozenIds: [firstId, ''] });
    expect(classifyDrift(blank, state)).toEqual({ editedCompiledIndexes: [] });
  });

  it('reports the watermark message when its compiled head changed', () => {
    const head = 'She counted ';
    const state = stateOf({
      watermark: { messageId: entries[1].messageId, offset: head.length, prefixHash: prefixIdentity(HISTORY_TWO, head.length) },
    });
    expect(classifyDrift(entries, state)).toEqual({ editedCompiledIndexes: [] });

    const edited = entries.map((entry, index) => (index === 1 ? { ...entry, content: `X${HISTORY_TWO}` } : entry));
    expect(classifyDrift(edited, state)).toEqual({ editedCompiledIndexes: [1] });
  });
});
