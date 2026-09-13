import { describe, it, expect } from 'vitest';
import {
  fnv1a32,
  messageIdentity,
  assignIdentities,
  prefixIdentity,
  matchWatermark,
  classifyDrift,
} from '../../janitor/identity.js';
import { PROVIDER_MESSAGES, HISTORY_ONE, HISTORY_THREE } from './fixtures/provider-chat.js';

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

  it('differs for a and b', () => {
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'));
  });

  it('pads a short hash to eight characters', () => {
    const hashes = Array.from({ length: 400 }, (_, i) => fnv1a32(`message ${i}`));
    for (const hash of hashes) expect(hash).toHaveLength(8);
  });
});

describe('messageIdentity', () => {
  it('hashes role and content together and carries the occurrence index', () => {
    expect(messageIdentity('user', 'hi', 0)).toBe(`${fnv1a32('userhi')}#0`);
    expect(messageIdentity('user', 'hi', 0)).not.toBe(messageIdentity('assistant', 'hi', 0));
  });

  it('uses the raw content, untrimmed and unsubstituted', () => {
    expect(messageIdentity('user', ' hi ', 0)).not.toBe(messageIdentity('user', 'hi', 0));
    expect(messageIdentity('user', '{{user}}: hi', 0)).toBe(`${fnv1a32('user{{user}}: hi')}#0`);
  });
});

describe('assignIdentities', () => {
  it('gives identical messages different occurrence indexes', () => {
    const ids = assignIdentities(PROVIDER_MESSAGES);
    expect(ids).toHaveLength(PROVIDER_MESSAGES.length);
    expect(HISTORY_ONE).toBe(HISTORY_THREE);
    expect(ids[1]).toBe(`${fnv1a32(`user${HISTORY_ONE}`)}#0`);
    expect(ids[3]).toBe(`${fnv1a32(`user${HISTORY_ONE}`)}#1`);
    expect(ids[1]).not.toBe(ids[3]);
  });

  it('reproduces the same ids when the same body is re-sent on a later turn', () => {
    const first = assignIdentities(PROVIDER_MESSAGES);
    const laterTurn = [...PROVIDER_MESSAGES, { role: 'assistant', content: 'A new turn.' }];
    const second = assignIdentities(laterTurn);
    expect(second.slice(0, first.length)).toEqual(first);
  });

  it('mutates nothing', () => {
    const before = JSON.stringify(PROVIDER_MESSAGES);
    assignIdentities(PROVIDER_MESSAGES);
    expect(JSON.stringify(PROVIDER_MESSAGES)).toBe(before);
  });
});

describe('matchWatermark', () => {
  const compiled = 'The compiled prefix of the message.';
  const tail = ' And the uncompiled tail.';
  const messages = [
    { role: 'assistant', content: 'Something earlier.' },
    { role: 'assistant', content: compiled + tail },
  ];
  const ids = assignIdentities(messages);
  const watermark = {
    messageId: ids[1],
    offset: compiled.length,
    prefixHash: prefixIdentity(compiled + tail, compiled.length),
  };

  it('finds the watermark message by exact id', () => {
    expect(matchWatermark(ids, messages, watermark)).toBe(1);
  });

  it('still finds it by prefix hash after a tail edit', () => {
    const edited = [messages[0], { role: 'assistant', content: `${compiled} A rewritten tail entirely.` }];
    const editedIds = assignIdentities(edited);
    expect(editedIds[1]).not.toBe(watermark.messageId);
    expect(matchWatermark(editedIds, edited, watermark)).toBe(1);
  });

  it('returns -1 after a head edit', () => {
    const edited = [messages[0], { role: 'assistant', content: `X${compiled}${tail}` }];
    const editedIds = assignIdentities(edited);
    expect(matchWatermark(editedIds, edited, watermark)).toBe(-1);
  });

  it('returns -1 when the watermark message is shorter than the offset', () => {
    const edited = [messages[0], { role: 'assistant', content: compiled.slice(0, 5) }];
    const editedIds = assignIdentities(edited);
    expect(matchWatermark(editedIds, edited, watermark)).toBe(-1);
  });

  it('returns -1 for a fresh watermark that names no message', () => {
    expect(matchWatermark(ids, messages, { messageId: null, offset: 0 })).toBe(-1);
  });
});

describe('classifyDrift', () => {
  const ids = ['a#0', 'b#0', 'c#0', 'd#0', 'e#0'];

  it('reports unmatched messages that sit before the last matched one', () => {
    expect(classifyDrift(ids, [true, false, true, false, false])).toEqual({ editedBeforeIndexes: [1] });
  });

  it('reports nothing when everything matched', () => {
    expect(classifyDrift(ids, [true, true, true, true, true])).toEqual({ editedBeforeIndexes: [] });
  });

  it('reports nothing when nothing matched', () => {
    expect(classifyDrift(ids, [false, false, false])).toEqual({ editedBeforeIndexes: [] });
  });

  it('ignores unmatched messages after the last match, which are simply new', () => {
    expect(classifyDrift(ids, [true, true, false, false, false])).toEqual({ editedBeforeIndexes: [] });
  });
});
