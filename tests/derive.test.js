import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeMessage, makeAssistantMessage } from './helpers/fake-context.js';
import { METADATA_KEY, BLOCK_DELIMITER } from '../src/constants.js';
import { ensureMessageId, assignIds, deriveFrontier } from '../src/derive.js';

const LITERAL = 'Mara:';

function withId(message, id) {
  message.extra = message.extra ?? {};
  message.extra[METADATA_KEY] = { ...(message.extra[METADATA_KEY] ?? {}), id };
  return message;
}

function emptyState(overrides = {}) {
  return { version: 2, frozen: [], frozenIds: [], watermark: { messageId: null, offset: 0 }, ...overrides };
}

describe('ensureMessageId', () => {
  it('assigns a string id once and returns the same one afterwards', () => {
    const message = makeMessage({ mes: 'she waits.' });
    const id = ensureMessageId(message);

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(message.extra[METADATA_KEY].id).toBe(id);
    expect(ensureMessageId(message)).toBe(id);
  });

  it('preserves sibling markers in the same namespace', () => {
    const message = makeMessage({ mes: 'she waits.', extra: { [METADATA_KEY]: { captured: true }, other: 1 } });
    ensureMessageId(message);

    expect(message.extra[METADATA_KEY].captured).toBe(true);
    expect(message.extra.other).toBe(1);
  });

  it('encodes neither position nor time', () => {
    const first = ensureMessageId(makeMessage({ mes: 'a.' }));
    const second = ensureMessageId(makeMessage({ mes: 'a.' }));

    expect(first).not.toBe(second);
    for (const id of [first, second]) {
      expect(id).toMatch(/^[a-z0-9]+$/);
      expect(Number(id)).not.toBe(Date.now());
      expect(id).not.toContain(String(Date.now()).slice(0, 6));
    }
  });
});

describe('assignIds', () => {
  it('ids every eligible entry in one pass and reports whether anything was new', () => {
    const chat = [
      makeMessage({ mes: 'one.' }),
      makeAssistantMessage({ mes: 'two.' }),
      makeMessage({ mes: 'system.', is_system: true }),
      null,
      'not an object',
      makeMessage({ mes: 42 }),
    ];

    expect(assignIds(chat)).toBe(true);
    expect(typeof chat[0].extra[METADATA_KEY].id).toBe('string');
    expect(typeof chat[1].extra[METADATA_KEY].id).toBe('string');
    expect(chat[2].extra[METADATA_KEY]).toBeUndefined();
    expect(chat[5].extra[METADATA_KEY]).toBeUndefined();

    expect(assignIds(chat)).toBe(false);
  });

  it('returns false for a non-array chat', () => {
    expect(assignIds(undefined)).toBe(false);
    expect(assignIds(null)).toBe(false);
  });
});

describe('deriveFrontier', () => {
  it('transforms user turns, keeps model turns verbatim and drops system messages', () => {
    const chat = [
      makeMessage({ mes: 'SYSTEM: character loaded', is_system: true }),
      makeMessage({ name: 'Mara', mes: 'Mara opens the door.' }),
      makeAssistantMessage({ mes: '  The hall is cold.  ' }),
    ];

    const { text, segments } = deriveFrontier(chat, emptyState(), LITERAL);

    expect(text).toBe(`Mara: Mara opens the door.${BLOCK_DELIMITER}The hall is cold.`);
    expect(text).not.toContain('SYSTEM');
    expect(segments).toHaveLength(2);
    expect(text.slice(segments[0].start, segments[0].end)).toBe('Mara: Mara opens the door.');
    expect(text.slice(segments[1].start, segments[1].end)).toBe('The hall is cold.');
    expect(segments.map((segment) => segment.id)).toEqual([null, null]);
  });

  it('carries the message id into its segment', () => {
    const chat = [withId(makeAssistantMessage({ mes: 'He waits.' }), 'abc123')];
    const { segments } = deriveFrontier(chat, emptyState(), LITERAL);
    expect(segments).toEqual([{ id: 'abc123', start: 0, end: 'He waits.'.length }]);
  });

  it('skips every message whose id is in frozenIds', () => {
    const chat = [
      withId(makeAssistantMessage({ mes: 'Frozen one.' }), 'a'),
      withId(makeAssistantMessage({ mes: 'Frozen two.' }), 'b'),
      withId(makeAssistantMessage({ mes: 'Still mutable.' }), 'c'),
      makeAssistantMessage({ mes: 'Brand new.' }),
    ];

    const { text, segments } = deriveFrontier(chat, emptyState({ frozenIds: ['a', 'b'] }), LITERAL);

    expect(text).toBe(`Still mutable.${BLOCK_DELIMITER}Brand new.`);
    expect(segments.map((segment) => segment.id)).toEqual(['c', null]);
  });

  it('slices only the watermark message, at its offset', () => {
    const chat = [
      withId(makeAssistantMessage({ mes: 'Frozen half. Mutable half.' }), 'w'),
      withId(makeAssistantMessage({ mes: 'A later block.' }), 'z'),
    ];
    const state = emptyState({ watermark: { messageId: 'w', offset: 'Frozen half. '.length } });

    const { text } = deriveFrontier(chat, state, LITERAL);
    expect(text).toBe(`Mutable half.${BLOCK_DELIMITER}A later block.`);
  });

  it('ignores an offset that is zero, negative or not finite', () => {
    const chat = [withId(makeAssistantMessage({ mes: 'Whole message.' }), 'w')];
    for (const offset of [0, -3, Number.NaN, undefined, 'five']) {
      const state = emptyState({ watermark: { messageId: 'w', offset } });
      expect(deriveFrontier(chat, state, LITERAL).text).toBe('Whole message.');
    }
  });

  it('derives the remaining messages when the watermark message is gone from the chat', () => {
    const chat = [
      withId(makeAssistantMessage({ mes: 'One.' }), 'p'),
      withId(makeAssistantMessage({ mes: 'Two.' }), 'q'),
    ];
    const state = emptyState({ frozenIds: ['gone-frozen'], watermark: { messageId: 'gone', offset: 40 } });

    const { text, segments } = deriveFrontier(chat, state, LITERAL);
    expect(text).toBe(`One.${BLOCK_DELIMITER}Two.`);
    expect(segments.map((segment) => segment.id)).toEqual(['p', 'q']);
  });

  it('contributes no block and no segment for text that transforms to nothing', () => {
    const chat = [
      makeAssistantMessage({ mes: '   \n ' }),
      makeMessage({ mes: '' }),
      makeAssistantMessage({ mes: 'He waits.' }),
    ];

    const { text, segments } = deriveFrontier(chat, emptyState(), LITERAL);
    expect(text).toBe('He waits.');
    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBe(0);
  });

  it('returns the empty result for an empty, fully skipped and non-array chat', () => {
    const empty = { text: '', segments: [] };
    expect(deriveFrontier([], emptyState(), LITERAL)).toEqual(empty);
    expect(deriveFrontier(undefined, emptyState(), LITERAL)).toEqual(empty);
    expect(deriveFrontier('nonsense', emptyState(), LITERAL)).toEqual(empty);
    expect(deriveFrontier([makeMessage({ mes: 'x.', is_system: true })], emptyState(), LITERAL)).toEqual(empty);
    expect(deriveFrontier([withId(makeAssistantMessage({ mes: 'x.' }), 'a')], emptyState({ frozenIds: ['a'] }), LITERAL))
      .toEqual(empty);
  });

  it('reads a missing frozenIds and watermark defensively', () => {
    const chat = [makeAssistantMessage({ mes: 'He waits.' })];
    expect(deriveFrontier(chat, { version: 2, frozen: [] }, LITERAL).text).toBe('He waits.');
    expect(deriveFrontier(chat, undefined, LITERAL).text).toBe('He waits.');
  });

  // purity: same inputs, same output, no id assignment → docs/modules/derive.md#purity
  it('mutates neither argument and assigns no id', () => {
    const chat = [
      makeMessage({ name: 'Mara', mes: 'she waits.' }),
      withId(makeAssistantMessage({ mes: 'He answers.' }), 'k'),
    ];
    const state = emptyState({ frozenIds: ['old'], watermark: { messageId: 'k', offset: 0 } });
    const chatBefore = JSON.parse(JSON.stringify(chat));
    const stateBefore = JSON.parse(JSON.stringify(state));

    const first = deriveFrontier(chat, state, LITERAL);
    const second = deriveFrontier(chat, state, LITERAL);

    expect(JSON.parse(JSON.stringify(chat))).toEqual(chatBefore);
    expect(JSON.parse(JSON.stringify(state))).toEqual(stateBefore);
    expect(chat[0].extra[METADATA_KEY]).toBeUndefined();
    expect(first.text).toBe(second.text);
    expect(first.segments).toEqual(second.segments);
  });

  it('is unaffected by how the same visible chat came about', () => {
    const build = () => [
      makeMessage({ name: 'Mara', mes: 'she opens the door.' }),
      makeAssistantMessage({ mes: 'The hall is cold.' }),
    ];

    const calm = build();
    const stormy = build();
    stormy[1].swipes = ['An earlier attempt.', 'The hall is cold.'];
    stormy[1].swipe_id = 1;
    stormy[1].send_date = 12345;
    stormy[0].extra = { [METADATA_KEY]: { captured: true } };

    expect(deriveFrontier(stormy, emptyState(), LITERAL).text)
      .toBe(deriveFrontier(calm, emptyState(), LITERAL).text);
  });
});

describe('src/derive.js source', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/derive.js'), 'utf8');

  it('names neither the ST global nor any character', () => {
    expect(source).not.toContain('SillyTavern');
    expect(source).not.toMatch(/Mara|Anton|Narrator/);
  });

  it('derives no id from an index, a counter or a clock', () => {
    expect(source).not.toContain('Date.now');
    expect(source).not.toContain('performance');
    expect(source).not.toMatch(/indexOf\(message\)|id\s*=\s*index/);
  });
});
