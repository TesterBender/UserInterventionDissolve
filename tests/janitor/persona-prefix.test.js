import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { classifyMessages } from '../../janitor/history.js';
import { BLOCK_DELIMITER } from '../../src/constants.js';
import {
  CHAT_ID,
  PERSONA,
  PROXY_URL,
  ALPHA_URL,
  CUSTOM_PROMPT,
  JANITOR_SYSTEM,
  GREETING,
  USER_TURN,
  PREFIXED_USER_TURN,
  CAPTURED_ENVELOPE,
  CAPTURED_BODY,
} from './fixtures/persona-prefix.js';

const LITERAL = `${PERSONA}:`;

const ENVELOPE_MAINS = [
  { position: 0, id: '103237690204', isMain: true, isBot: true, message: GREETING },
  { position: 1, id: '103237690391', isMain: true, isBot: false, message: USER_TURN },
];

describe('classifyMessages with a persona prefix', () => {
  it('matches a prefixed user turn and carries the bare envelope text', () => {
    const { history, injections } = classifyMessages(CAPTURED_BODY.messages, ENVELOPE_MAINS, PERSONA);
    expect(history.map((entry) => entry.content)).toEqual([GREETING, USER_TURN]);
    expect(history.at(-1).content).toBe(USER_TURN);
    expect(history.at(-1).index).toBe(3);
    expect(history.at(-1).role).toBe('user');
    expect(injections.map((entry) => entry.content)).toEqual([CUSTOM_PROMPT]);
  });

  it('still matches an unprefixed user turn', () => {
    const messages = [
      { role: 'system', content: JANITOR_SYSTEM },
      { role: 'assistant', content: GREETING },
      { role: 'user', content: USER_TURN },
    ];
    const { history, injections } = classifyMessages(messages, ENVELOPE_MAINS, PERSONA);
    expect(history.map((entry) => entry.content)).toEqual([GREETING, USER_TURN]);
    expect(injections).toEqual([]);
  });

  it('leaves a turn prefixed with a different name as an injection', () => {
    const messages = [
      { role: 'system', content: JANITOR_SYSTEM },
      { role: 'assistant', content: GREETING },
      { role: 'user', content: `Other: ${USER_TURN}` },
    ];
    const { history, injections } = classifyMessages(messages, ENVELOPE_MAINS, PERSONA);
    expect(history.map((entry) => entry.content)).toEqual([GREETING]);
    expect(injections.map((entry) => entry.content)).toEqual([`Other: ${USER_TURN}`]);
  });

  it('never prefix-matches an assistant message', () => {
    const messages = [
      { role: 'system', content: JANITOR_SYSTEM },
      { role: 'assistant', content: `${PERSONA}: ${GREETING}` },
    ];
    const { history, injections } = classifyMessages(messages, ENVELOPE_MAINS, PERSONA);
    expect(history).toEqual([]);
    expect(injections.map((entry) => entry.content)).toEqual([`${PERSONA}: ${GREETING}`]);
  });

  it('treats the prefixed turn as an injection with an empty persona name', () => {
    const { history, injections } = classifyMessages(CAPTURED_BODY.messages, ENVELOPE_MAINS, '');
    expect(history.map((entry) => entry.content)).toEqual([GREETING]);
    expect(injections.map((entry) => entry.content)).toEqual([CUSTOM_PROMPT, PREFIXED_USER_TURN]);
  });

  it('gives a prefixed turn the envelope id of the entry it consumed', () => {
    const prefixed = classifyMessages(CAPTURED_BODY.messages, ENVELOPE_MAINS, PERSONA).history;
    const bare = classifyMessages(
      [
        { role: 'system', content: JANITOR_SYSTEM },
        { role: 'assistant', content: GREETING },
        { role: 'user', content: USER_TURN },
      ],
      ENVELOPE_MAINS,
      PERSONA,
    ).history;
    expect(prefixed.map((entry) => entry.messageId)).toEqual(['103237690204', '103237690391']);
    expect(prefixed.map((entry) => entry.messageId)).toEqual(bare.map((entry) => entry.messageId));
  });
});

describe('the 2026-09-14 capture through the real transform', () => {
  let calls;
  let store;

  function jsonPost(body) {
    return { method: 'POST', headers: { 'content-type': 'application/json' }, body };
  }

  beforeEach(async () => {
    vi.resetModules();
    calls = [];
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    });
    window.history.pushState({}, '', `/chats/${CHAT_ID}`);
    window.fetch = async (resource, config) => {
      calls.push({ resource, config });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const shell = await import('../../janitor/shell.js');
    const transform = await import('../../janitor/transform.js');
    shell.installTransport(transform.transformRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function dispatched() {
    await window.fetch(ALPHA_URL, jsonPost(JSON.stringify(CAPTURED_ENVELOPE)));
    calls.length = 0;
    await window.fetch(PROXY_URL, jsonPost(JSON.stringify(CAPTURED_BODY)));
    return JSON.parse(calls.at(-1).config.body);
  }

  it('ends the frontier with an own-line persona block holding the bare text', async () => {
    const body = await dispatched();
    const frontier = body.messages.filter((message) => message.role === 'assistant').at(-1);
    expect(frontier.content.endsWith(`\n${LITERAL}\n${USER_TURN}`)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(PREFIXED_USER_TURN);
  });

  it('folds the custom prompt into the system message exactly once', async () => {
    const body = await dispatched();
    const system = body.messages[0];
    expect(system.role).toBe('system');
    expect(system.content.split(`${BLOCK_DELIMITER}${CUSTOM_PROMPT}`)).toHaveLength(2);
    expect(system.content.endsWith(`${BLOCK_DELIMITER}${CUSTOM_PROMPT}`)).toBe(true);
    for (const message of body.messages.slice(1)) expect(message.content).not.toBe(CUSTOM_PROMPT);
  });
});
