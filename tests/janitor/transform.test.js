import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJanitorBundle } from '../../tools/build-janitor.mjs';
import { CONTINUATION_CONTROL, MANUSCRIPT_SYSTEM_PROMPT } from '../../src/prompt.js';
import { BLOCK_DELIMITER } from '../../src/constants.js';
import { countWords } from '../../src/freeze.js';
import {
  SENTINEL,
  JANITOR_LEAD_IN,
  JANITOR_HORIZON_TOKEN_BUDGET,
  JANITOR_HORIZON_HYSTERESIS,
  JANITOR_WORDS_PER_TOKEN,
} from '../../janitor/constants.js';
import { stateKey } from '../../janitor/storage.js';
import {
  CHAT_ID,
  PERSONA,
  PROXY_URL,
  ALPHA_URL,
  JANITOR_SYSTEM,
  PREFILL_TEXT,
  prose,
  envelopeFor,
  bodyFor,
  storedState,
} from './fixtures/manuscript-turns.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LITERAL = `${PERSONA}:`;
const BANNED = ['restructure', 'rewrite', 'return the passage', 'keep every', 'change only', 'add nothing', 'original wording', 'retain'];

let calls;
let events;
let shell;
let store;

function jsonPost(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body };
}

async function bind(turns, options) {
  await window.fetch(ALPHA_URL, jsonPost(JSON.stringify(envelopeFor(turns, options))));
  calls.length = 0;
  events.length = 0;
}

async function send(body) {
  await window.fetch(PROXY_URL, jsonPost(JSON.stringify(body)));
  return calls.at(-1);
}

async function dispatched(turns, options) {
  await bind(turns, options);
  const call = await send(bodyFor(turns, options));
  return JSON.parse(call.config.body);
}

function stateNow(chatId = CHAT_ID) {
  return JSON.parse(store.get(stateKey(chatId)));
}

function seed(state, chatId = CHAT_ID) {
  store.set(stateKey(chatId), JSON.stringify(state));
}

beforeEach(async () => {
  vi.resetModules();
  calls = [];
  events = [];
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      events.push('save');
      store.set(key, value);
    },
    removeItem: (key) => store.delete(key),
  });
  window.history.pushState({}, '', `/chats/${CHAT_ID}`);
  window.fetch = async (resource, config) => {
    events.push('fetch');
    calls.push({ resource, config });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  shell = await import('../../janitor/shell.js');
  const transform = await import('../../janitor/transform.js');
  shell.installTransport(transform.transformRequest);
  console.warn.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SHORT_TURNS = [
  { role: 'user', content: 'She pushed the door open.' },
  { role: 'assistant', content: 'The hinge complained, and the rain came in with her.' },
  { role: 'user', content: 'What did the keeper say?' },
  { role: 'assistant', content: 'Nothing at first. The lamp turned.' },
];

describe('the model-visible prefix across three consecutive turns', () => {
  const seeded = { text: prose('opening', 40), words: 40 * 12, createdAt: 1 };
  const base = [
    { role: 'user', content: 'She pushed the door open.' },
    { role: 'assistant', content: prose('body', 360) },
  ];
  const turnTwo = [...base, { role: 'user', content: 'And after that?' }, { role: 'assistant', content: prose('second', 120) }];
  const turnThree = [...turnTwo, { role: 'user', content: 'And after that again?' }, { role: 'assistant', content: prose('third', 120) }];

  function pairsOf(body) {
    return body.messages.slice(2, -2);
  }

  it('keeps the system message and every surviving pair byte-identical', async () => {
    seed(storedState({ frozen: [seeded] }));
    const first = await dispatched(base);
    const second = await dispatched(turnTwo);
    const third = await dispatched(turnThree);

    expect(second.messages[0].content).toBe(first.messages[0].content);
    expect(third.messages[0].content).toBe(first.messages[0].content);

    const one = pairsOf(first);
    const two = pairsOf(second);
    const three = pairsOf(third);
    expect(one.length).toBeGreaterThanOrEqual(2);
    expect(two.slice(0, one.length)).toEqual(one);
    expect(three.slice(0, two.length)).toEqual(two);
    expect(one[0].content).toBe(seeded.text);
  });

  it('writes the continuation control byte-identically to the src export', async () => {
    seed(storedState({ frozen: [seeded] }));
    const body = await dispatched(turnTwo);
    const controls = body.messages.filter((message) => message.role === 'user' && message.content !== JANITOR_LEAD_IN);
    expect(controls.length).toBeGreaterThanOrEqual(2);
    for (const control of controls) expect(control.content).toBe(CONTINUATION_CONTROL);
  });
});

describe('the sentinel', () => {
  const turns = [
    { role: 'user', content: SENTINEL },
    { role: 'user', content: 'She pushed the door open.' },
    { role: 'assistant', content: 'The hinge complained.' },
    { role: 'user', content: SENTINEL },
    { role: 'assistant', content: 'The lamp turned.' },
    { role: 'user', content: SENTINEL },
  ];

  it('is dropped at every depth and never becomes a persona block', async () => {
    const body = await dispatched(turns);
    for (const message of body.messages) {
      expect(message.content).not.toBe(SENTINEL);
      expect(message.content).not.toContain(`${LITERAL}\n${SENTINEL}`);
    }
  });

  it('leaves a body that is nothing but sentinels with no manuscript turn', async () => {
    const body = await dispatched([{ role: 'user', content: SENTINEL }]);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('system');
  });
});

describe('the system message', () => {
  const injections = [
    { at: 1, role: 'system', content: 'INJECTION ONE: keep the lamp lit.' },
    { at: 3, role: 'user', content: 'INJECTION TWO: OOC, shorter paragraphs please.' },
    { at: 5, role: 'assistant', content: 'INJECTION THREE: a nudge at depth.' },
  ];

  it('folds every injection in once, in order, and leaves Janitor\'s text alone', async () => {
    const body = await dispatched(SHORT_TURNS, { injections });
    const system = body.messages[0].content;
    const positions = injections.map((injection) => system.indexOf(injection.content));

    expect(system).toContain(JANITOR_SYSTEM);
    for (const injection of injections) {
      expect(system.split(injection.content)).toHaveLength(2);
      for (const message of body.messages.slice(1)) expect(message.content).not.toContain(injection.content);
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('prepends the manuscript prompt once and is byte-identical on a second pass', async () => {
    const first = await dispatched(SHORT_TURNS);
    expect(first.messages[0].content).toBe(`${MANUSCRIPT_SYSTEM_PROMPT}${BLOCK_DELIMITER}${JANITOR_SYSTEM}`);

    const second = await dispatched(SHORT_TURNS, { system: first.messages[0].content });
    expect(second.messages[0].content).toBe(first.messages[0].content);
    expect(second.messages[0].content.split(MANUSCRIPT_SYSTEM_PROMPT)).toHaveLength(2);
  });
});

describe('the reconstructed history', () => {
  it('shows a human turn only as a persona block inside an assistant message', async () => {
    const body = await dispatched(SHORT_TURNS);
    const assistants = body.messages.filter((message) => message.role === 'assistant');
    expect(assistants.some((message) => message.content.includes(`${LITERAL}\nShe pushed the door open.`))).toBe(true);
    for (const message of body.messages.filter((message) => message.role === 'user')) {
      expect([CONTINUATION_CONTROL, JANITOR_LEAD_IN]).toContain(message.content);
    }
  });

  it('ends on a user turn and carries no trace of the prefill', async () => {
    const call = await (async () => {
      await bind(SHORT_TURNS);
      return send(bodyFor(SHORT_TURNS, { prefill: PREFILL_TEXT }));
    })();
    const body = JSON.parse(call.config.body);
    expect(call.config.body).not.toContain(PREFILL_TEXT);
    expect(body.messages.at(-1).role).toBe('user');
    expect(body.messages.at(-1).content).toBe(CONTINUATION_CONTROL);
  });

  it('writes the reserved literal first in the stop array, exactly once', async () => {
    const body = await dispatched(SHORT_TURNS);
    expect(body.stop[0]).toBe(LITERAL);
    expect(body.stop.filter((entry) => entry === LITERAL)).toHaveLength(1);
  });
});

describe('the lead-in turn', () => {
  it('is present exactly once when the history opens on an assistant turn', async () => {
    const body = await dispatched(SHORT_TURNS);
    expect(body.messages[1]).toEqual({ role: 'user', content: JANITOR_LEAD_IN });
    expect(body.messages[2].role).toBe('assistant');
    expect(body.messages.filter((message) => message.content === JANITOR_LEAD_IN)).toHaveLength(1);
  });

  it('is absent when no assistant turn follows the system message', async () => {
    const body = await dispatched([{ role: 'user', content: SENTINEL }]);
    expect(body.messages.some((message) => message.content === JANITOR_LEAD_IN)).toBe(false);
  });

  it('uses none of decision 0003\'s banned words', () => {
    for (const word of BANNED) expect(JANITOR_LEAD_IN.toLowerCase()).not.toContain(word);
  });
});

describe('the freeze at request build', () => {
  const turns = [
    { role: 'user', content: 'She pushed the door open.' },
    { role: 'assistant', content: prose('body', 360) },
    { role: 'user', content: 'And after that?' },
    { role: 'assistant', content: 'The last message stands alone by itself.' },
  ];

  it('compiles a span that stops before the last message and saves before dispatch', async () => {
    const body = await dispatched(turns);
    const state = stateNow();
    const compiled = [...state.frozen, ...state.units].map((span) => span.text).join(BLOCK_DELIMITER);

    expect(state.units.length + state.frozen.length).toBeGreaterThan(0);
    expect(compiled).not.toContain('The last message');
    expect(compiled).toContain(`${LITERAL}\nShe pushed the door open.`);
    expect(events).toEqual(['save', 'fetch']);
    expect(body.messages.at(-2).content).toContain('The last message stands alone by itself.');
  });

  it('attempts no freeze and saves nothing when the frontier is short', async () => {
    await dispatched(SHORT_TURNS);
    expect(events).toEqual(['fetch']);
    expect(store.has(stateKey(CHAT_ID))).toBe(false);
  });
});

describe('the transport horizon', () => {
  const span = (tag) => ({ text: prose(tag, 1700), words: countWords(prose(tag, 1700)), createdAt: 1 });
  const spans = ['one', 'two', 'three', 'four', 'five', 'six'].map(span);

  function estimate(body) {
    return body.messages.reduce((total, message) => total + countWords(message.content), 0) * JANITOR_WORDS_PER_TOKEN;
  }

  it('drops whole front pairs but keeps the first pair, the frontier and the edge', async () => {
    seed(storedState({ frozen: spans }));
    const before = store.get(stateKey(CHAT_ID));
    const body = await dispatched(SHORT_TURNS);
    const texts = body.messages.map((message) => message.content);

    expect(estimate(body)).toBeLessThanOrEqual(JANITOR_HORIZON_TOKEN_BUDGET * JANITOR_HORIZON_HYSTERESIS);
    expect(texts).toContain(spans[0].text);
    expect(texts).toContain(spans[5].text);
    expect(texts).not.toContain(spans[1].text);
    expect(body.messages.at(-2).content).toContain(`${LITERAL}\nShe pushed the door open.`);
    expect(body.messages.at(-1).content).toBe(CONTINUATION_CONTROL);
    expect(store.get(stateKey(CHAT_ID))).toBe(before);
  });

  it('drops nothing from a body under budget', async () => {
    seed(storedState({ frozen: spans.slice(0, 2) }));
    const body = await dispatched(SHORT_TURNS);
    const texts = body.messages.map((message) => message.content);

    expect(estimate(body)).toBeLessThan(JANITOR_HORIZON_TOKEN_BUDGET);
    expect(texts).toContain(spans[0].text);
    expect(texts).toContain(spans[1].text);
  });
});

describe('the request report', () => {
  it('prints exactly one line naming finals, units, frontier words and the freeze', async () => {
    await dispatched(SHORT_TURNS);
    expect(console.info).toHaveBeenCalledTimes(1);
    const line = console.info.mock.calls[0][0];
    expect(line).toMatch(/finals \d+/);
    expect(line).toMatch(/units \d+/);
    expect(line).toMatch(/frontier \d+ words/);
    expect(line).toMatch(/froze (?:yes|no)/);
  });
});

describe('bodies the transform gates out', () => {
  it('passes an Anthropic-shaped body through byte-identically', async () => {
    await bind(SHORT_TURNS);
    const body = bodyFor(SHORT_TURNS);
    body.system = 'You are Nyx.';
    const config = jsonPost(JSON.stringify(body));
    await window.fetch(PROXY_URL, config);

    expect(calls).toHaveLength(1);
    expect(calls[0].config).toBe(config);
    expect(calls[0].config.body).toBe(JSON.stringify(body));
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('passes a completion with no envelope through byte-identically and warns once', async () => {
    const config = jsonPost(JSON.stringify(bodyFor(SHORT_TURNS)));
    await window.fetch(PROXY_URL, config);
    await window.fetch(PROXY_URL, config);

    expect(calls).toHaveLength(2);
    expect(calls[0].config).toBe(config);
    expect(calls[1].config.body).toBe(config.body);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe('the committed bundle', () => {
  it('matches a fresh build and carries the transform module', () => {
    const bundle = buildJanitorBundle();
    expect(readFileSync(join(ROOT, 'dist', 'janitor-manuscript-dissolve.user.js'), 'utf8')).toBe(bundle);
    expect(bundle).toContain('// ---- janitor/transform.js ----');
    expect(() => new Function(bundle)).not.toThrow();
  });
});
