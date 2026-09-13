import { describe, it, expect } from 'vitest';
import { classifyMessages, toStShape, fromStShape } from '../../janitor/history.js';
import { deriveFrontier } from '../../src/derive.js';
import { buildHistory } from '../../src/frontier.js';
import { createState } from '../../src/state.js';
import {
  PROVIDER_MESSAGES,
  ENVELOPE_CHAT_MESSAGES,
  SYSTEM_CONTEXT,
  HISTORY_ONE,
  HISTORY_TWO,
  HISTORY_THREE,
  HISTORY_FOUR,
  INJECTED_SYSTEM,
  INJECTED_USER,
  INJECTED_ASSISTANT,
} from './fixtures/provider-chat.js';

const LITERAL = 'Mara:';
const NAMES = { name1: 'Mara', name2: 'Narrator' };

describe('classifyMessages', () => {
  const { history, injections, systemIndex } = classifyMessages(PROVIDER_MESSAGES, ENVELOPE_CHAT_MESSAGES);

  it('takes the first system message as the assembled context', () => {
    expect(systemIndex).toBe(0);
    expect(PROVIDER_MESSAGES[systemIndex].content).toBe(SYSTEM_CONTEXT);
    expect(history.map((entry) => entry.content)).not.toContain(SYSTEM_CONTEXT);
    expect(injections.map((entry) => entry.content)).not.toContain(SYSTEM_CONTEXT);
  });

  it('keeps the envelope entries as history, in input order', () => {
    expect(history.map((entry) => entry.content)).toEqual([HISTORY_ONE, HISTORY_TWO, HISTORY_THREE, HISTORY_FOUR]);
    expect(history.map((entry) => entry.index)).toEqual([1, 2, 3, 5]);
  });

  it('carries the aligned envelope entry id on every history entry, as a string', () => {
    expect(history.map((entry) => entry.messageId)).toEqual([
      '103237690201', '103237690202', '103237690204', '103237690205',
    ]);
    expect(history.map((entry) => entry.messageId)).not.toContain('103237690203');
  });

  it('gives two byte-identical messages two different identities', () => {
    expect(history[0].content).toBe(history[2].content);
    expect(history[0].messageId).not.toBe(history[2].messageId);
  });

  it('gives history entries no identity at all on the no-envelope fallback path', () => {
    const result = classifyMessages(PROVIDER_MESSAGES, null);
    expect(result.history.every((entry) => entry.messageId === '')).toBe(true);
  });

  it('gives an entry whose envelope record carries no usable id an empty identity', () => {
    const messages = [{ role: 'user', content: 'Only turn.' }];
    const envelope = [{ position: 0, isMain: true, isBot: false, message: 'Only turn.' }];
    expect(classifyMessages(messages, envelope).history[0].messageId).toBe('');
  });

  it('gives injections no identity', () => {
    for (const injection of injections) expect('messageId' in injection).toBe(false);
  });

  it('puts the injected system, user and assistant messages in injections, in input order', () => {
    expect(injections.map((entry) => entry.content)).toEqual([INJECTED_SYSTEM, INJECTED_USER, INJECTED_ASSISTANT]);
    expect(injections.map((entry) => entry.role)).toEqual(['system', 'user', 'assistant']);
  });

  it('never lets the non-main envelope alternative consume a provider message', () => {
    expect(history.map((entry) => entry.content)).not.toContain('An alternative nobody selected.');
    expect(injections).toHaveLength(3);
  });

  it.each([[null], [undefined], [[]]])(
    'treats every non-system message as history with no envelope (%s)',
    (envelope) => {
      const result = classifyMessages(PROVIDER_MESSAGES, envelope);
      expect(result.injections).toEqual([]);
      expect(result.history).toHaveLength(PROVIDER_MESSAGES.length - 1);
      expect(result.systemIndex).toBe(0);
    },
  );

  it('duplicated history text consumes one envelope entry each', () => {
    const messages = [
      { role: 'user', content: 'Twice.' },
      { role: 'user', content: 'Twice.' },
      { role: 'user', content: 'Twice.' },
    ];
    const envelope = [
      { position: 0, isMain: true, isBot: false, message: 'Twice.' },
      { position: 1, isMain: true, isBot: false, message: 'Twice.' },
    ];
    const { history, injections } = classifyMessages(messages, envelope);
    expect(history.map((entry) => entry.index)).toEqual([0, 1]);
    expect(injections.map((entry) => entry.index)).toEqual([2]);
  });
});

describe('toStShape', () => {
  const { history } = classifyMessages(PROVIDER_MESSAGES, ENVELOPE_CHAT_MESSAGES);
  const shaped = toStShape(history);

  it('produces the fields deriveFrontier reads and no invented name', () => {
    expect(Object.keys(shaped[0]).sort()).toEqual(['extra', 'is_system', 'is_user', 'mes']);
    expect(shaped[0]).toMatchObject({ mes: HISTORY_ONE, is_user: true, is_system: false });
    expect(shaped[1]).toMatchObject({ mes: HISTORY_TWO, is_user: false });
    expect(shaped.map((message) => message.extra.userInterventionDissolve.id)).toEqual(
      history.map((entry) => entry.messageId),
    );
    expect(shaped[0].extra.userInterventionDissolve.id).toBe('103237690201');
  });

  it('mutates no input message', () => {
    const before = JSON.stringify(history);
    toStShape(history);
    expect(JSON.stringify(history)).toBe(before);
  });
});

describe('fromStShape', () => {
  it('is the inverse of what buildHistory emits', () => {
    const state = createState();
    state.frozen.push({ text: 'A compiled span.', words: 3, createdAt: 1 });
    const history = buildHistory(state, NAMES, { frontier: 'The frontier.' });
    const messages = fromStShape(history);

    expect(messages.every((message) => Object.keys(message).sort().join() === 'content,role')).toBe(true);
    expect(messages.map((message) => message.role)).toEqual(['assistant', 'user', 'assistant', 'user']);
    expect(messages[0].content).toBe('A compiled span.');
    expect(messages[2].content).toBe('The frontier.');
  });
});

describe('the shim against unmodified src/', () => {
  const { history } = classifyMessages(PROVIDER_MESSAGES, ENVELOPE_CHAT_MESSAGES);
  const ids = history.map((entry) => entry.messageId);

  it('routes a user message through toManuscriptBlock by virtue of the shim alone', () => {
    const state = createState();
    const { text } = deriveFrontier(toStShape(history), state, LITERAL);
    expect(text.startsWith(`${LITERAL}\n`)).toBe(true);
    expect(text).toContain(`${LITERAL}\n${HISTORY_ONE}`);
    expect(text).toContain(HISTORY_TWO);
  });

  it('drops a message whose id is in frozenIds, with no special-casing in janitor/', () => {
    const occurrences = (text, needle) => text.split(needle).length - 1;
    const shaped = toStShape(history);
    const before = deriveFrontier(shaped, createState(), LITERAL).text;
    expect(occurrences(before, HISTORY_ONE)).toBe(2);

    const state = createState();
    state.frozenIds.push(ids[0]);
    const { text } = deriveFrontier(shaped, state, LITERAL);
    expect(occurrences(text, HISTORY_ONE)).toBe(1);
    expect(text).toContain(HISTORY_TWO);
  });

  it('slices the watermark message at its offset', () => {
    const state = createState();
    state.watermark = { messageId: ids[1], offset: 'She counted '.length };
    const { text } = deriveFrontier(toStShape(history), state, LITERAL);
    expect(text).toContain('the buckets in the hall.');
    expect(text).not.toContain('She counted the buckets');
  });

  it('round-trips to {role, content} pairs alternating assistant/user', () => {
    const state = createState();
    state.frozen.push({ text: 'A first final span.', words: 4, createdAt: 1 });
    state.frozen.push({ text: 'A second final span.', words: 4, createdAt: 2 });

    const frontier = deriveFrontier(toStShape(history), state, LITERAL).text;
    const messages = fromStShape(buildHistory(state, NAMES, { frontier }));

    expect(messages).toHaveLength(6);
    expect(messages.map((message) => message.role)).toEqual([
      'assistant', 'user', 'assistant', 'user', 'assistant', 'user',
    ]);
    for (const message of messages) {
      expect(Object.keys(message).sort()).toEqual(['content', 'role']);
      expect(typeof message.content).toBe('string');
      expect(message.content).not.toBe('');
    }
    expect(messages[4].content).toBe(frontier);
  });

  it('carries no id, hash or offset into the provider messages (INV-10)', () => {
    const state = createState();
    state.frozenIds.push(ids[0]);
    state.watermark = { messageId: ids[1], offset: 4, prefixHash: 'deadbeef' };
    const frontier = deriveFrontier(toStShape(history), state, LITERAL).text;
    const serialised = JSON.stringify(fromStShape(buildHistory(state, NAMES, { frontier })));

    for (const id of ids) expect(serialised).not.toContain(id);
    expect(serialised).not.toContain('deadbeef');
    expect(serialised).not.toContain('userInterventionDissolve');
  });
});
