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
  JANITOR_OVERRIDE_FORMAT,
  JANITOR_LEAD_IN,
  JANITOR_HORIZON_TOKEN_BUDGET,
  JANITOR_HORIZON_HYSTERESIS,
  JANITOR_WORDS_PER_TOKEN,
  JANITOR_STATE_FORMAT,
} from '../../janitor/constants.js';
import { stateKey } from '../../janitor/storage.js';
import { overrideKey, loadOverride, overrideDrift } from '../../janitor/context-override.js';
import { prefixIdentity } from '../../janitor/identity.js';
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
import { transcript, PROSE_DELTAS, BOUNDARY_DELTAS } from './fixtures/sse-transcripts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LITERAL = `${PERSONA}:`;
const BANNED = ['restructure', 'rewrite', 'return the passage', 'keep every', 'change only', 'add nothing', 'original wording', 'retain'];

let calls;
let events;
let shell;
let store;
let nextResponse;
let lastPlan;

function jsonPost(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body };
}

function streamed(frames) {
  const stream = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
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

function seedOverride(text, capturedText = JANITOR_SYSTEM, chatId = CHAT_ID) {
  store.set(overrideKey(chatId), JSON.stringify({
    janitorOverrideFormat: JANITOR_OVERRIDE_FORMAT, text, capturedText, savedAt: 1,
  }));
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
  lastPlan = null;
  nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = async (resource, config) => {
    events.push('fetch');
    calls.push({ resource, config });
    return nextResponse();
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  shell = await import('../../janitor/shell.js');
  const transform = await import('../../janitor/transform.js');
  shell.installTransport((data, context) => {
    lastPlan = transform.transformRequest(data, context);
    return lastPlan;
  });
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

describe('the system message under a saved context override', () => {
  const OVERRIDE = 'Nyx keeps a lighthouse on a cold coast. Write it as prose.';
  const injections = [
    { at: 1, role: 'system', content: 'INJECTION ONE: keep the lamp lit.' },
    { at: 3, role: 'user', content: 'INJECTION TWO: OOC, shorter paragraphs please.' },
  ];

  it('sends the prompt, the override and every injection in order, and nothing of the captured text', async () => {
    seedOverride(OVERRIDE);
    const body = await dispatched(SHORT_TURNS, { injections });

    expect(body.messages[0].content).toBe([
      MANUSCRIPT_SYSTEM_PROMPT,
      OVERRIDE,
      ...injections.map((injection) => injection.content),
    ].join(BLOCK_DELIMITER));
    expect(body.messages[0].content).not.toContain(JANITOR_SYSTEM);
  });

  it('captures the Janitor text alone, without the prompt or any injection', async () => {
    const { getRequestStatus } = await import('../../janitor/status.js');
    seedOverride(OVERRIDE);
    await dispatched(SHORT_TURNS, { injections });

    const { capturedContext } = getRequestStatus();
    expect(capturedContext).toBe(JANITOR_SYSTEM);
    expect(capturedContext).not.toContain(MANUSCRIPT_SYSTEM_PROMPT);
    for (const injection of injections) expect(capturedContext).not.toContain(injection.content);
  });

  it('reports no drift when an injection is added, removed or reworded', async () => {
    const { getRequestStatus } = await import('../../janitor/status.js');
    seedOverride(OVERRIDE);

    const variants = [
      injections,
      [injections[0]],
      [{ at: 1, role: 'system', content: 'INJECTION ONE REWORDED: the lamp stays lit.' }],
    ];
    for (const variant of variants) {
      await dispatched(SHORT_TURNS, { injections: variant });
      expect(overrideDrift(loadOverride(CHAT_ID), getRequestStatus().capturedContext)).toBe(false);
    }
  });

  it('reports drift when the Janitor first system message changes, and still sends the override', async () => {
    const { getRequestStatus } = await import('../../janitor/status.js');
    seedOverride(OVERRIDE);

    await dispatched(SHORT_TURNS);
    expect(overrideDrift(loadOverride(CHAT_ID), getRequestStatus().capturedContext)).toBe(false);

    const moved = `${JANITOR_SYSTEM}

Janitor changed its mind.`;
    const body = await dispatched(SHORT_TURNS, { system: moved });

    expect(overrideDrift(loadOverride(CHAT_ID), getRequestStatus().capturedContext)).toBe(true);
    expect(body.messages[0].content).toBe(`${MANUSCRIPT_SYSTEM_PROMPT}${BLOCK_DELIMITER}${OVERRIDE}`);
  });

  it('is byte-identical across three consecutive requests', async () => {
    seedOverride(OVERRIDE);
    const first = await dispatched(SHORT_TURNS, { injections });
    const second = await dispatched(SHORT_TURNS, { injections });
    const third = await dispatched(SHORT_TURNS, { injections });

    expect(second.messages[0].content).toBe(first.messages[0].content);
    expect(third.messages[0].content).toBe(first.messages[0].content);
  });

  it('suppresses the prepend when the override itself carries the prompt', async () => {
    seedOverride(`${MANUSCRIPT_SYSTEM_PROMPT}

And keep the lamp lit.`);
    const body = await dispatched(SHORT_TURNS);
    expect(body.messages[0].content.split(MANUSCRIPT_SYSTEM_PROMPT)).toHaveLength(2);
  });

  it('restores the captured text byte-identically once the override is cleared', async () => {
    const { clearOverride, saveOverride } = await import('../../janitor/context-override.js');
    const plain = await dispatched(SHORT_TURNS, { injections });

    seedOverride(OVERRIDE);
    const overridden = await dispatched(SHORT_TURNS, { injections });
    expect(overridden.messages[0].content).not.toBe(plain.messages[0].content);

    clearOverride(CHAT_ID);
    expect((await dispatched(SHORT_TURNS, { injections })).messages[0].content).toBe(plain.messages[0].content);

    seedOverride(OVERRIDE);
    saveOverride(CHAT_ID, '   ', JANITOR_SYSTEM);
    expect(loadOverride(CHAT_ID)).toBe(null);
    expect((await dispatched(SHORT_TURNS, { injections })).messages[0].content).toBe(plain.messages[0].content);
  });

  it('leaves the reconstructed history, the stop array and the report untouched', async () => {
    const plain = await dispatched(SHORT_TURNS);
    console.info.mockClear();

    seedOverride(OVERRIDE);
    const overridden = await dispatched(SHORT_TURNS);

    expect(overridden.messages.slice(1)).toEqual(plain.messages.slice(1));
    expect(overridden.stop).toEqual(plain.stop);
    expect(console.info.mock.calls[0][0]).not.toContain(OVERRIDE);
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
    expect(line).toMatch(/boundary \d+/);
    expect(line).toMatch(/rollback \d+/);
  });

  it('counts the messages whose text this request trimmed', async () => {
    await dispatched([
      { role: 'user', content: 'She pushed the door open.', id: 6201 },
      { role: 'assistant', content: 'Keeper:\nThe lamp turned once.\n\nShe reached for the', id: 6202 },
    ]);
    expect(console.info.mock.calls[0][0]).toContain('rollback 1');
    expect(console.info.mock.calls[0][0]).toContain('boundary 0');
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

describe('identity across edits, duplicates and regenerates', () => {
  const OPENING = 'She pushed the door open.';
  const COMPILED = `${LITERAL}\n${OPENING}`;
  const compiledSpan = { text: COMPILED, words: countWords(COMPILED), createdAt: 1 };

  function frontierOf(body) {
    return body.messages.at(-2).content;
  }

  function occurrences(text, needle) {
    return text.split(needle).length - 1;
  }

  it('leaves the second of two byte-identical messages in the frontier when the first is compiled', async () => {
    const turns = [
      { role: 'user', content: OPENING, id: 5001 },
      { role: 'assistant', content: 'The hinge complained.', id: 5002 },
      { role: 'user', content: OPENING, id: 5003 },
    ];
    seed(storedState({ frozen: [compiledSpan], frozenIds: ['5001'] }));
    const body = await dispatched(turns);

    expect(frontierOf(body)).toContain(COMPILED);
    expect(occurrences(frontierOf(body), COMPILED)).toBe(1);
    expect(occurrences(JSON.stringify(body), OPENING)).toBe(2);
    expect(console.info.mock.calls[0][0]).toContain('drift 0');
  });

  it('reports a compiled message edited in place and keeps it out of the frontier', async () => {
    const turns = [
      { role: 'user', content: 'She kicked the door instead.', id: 5001 },
      { role: 'assistant', content: 'The hinge complained.', id: 5002 },
    ];
    seed(storedState({ frozen: [compiledSpan], frozenIds: ['5001'] }));
    const body = await dispatched(turns);

    expect(console.info.mock.calls[0][0]).toContain('drift 1');
    expect(JSON.stringify(body)).not.toContain('She kicked the door instead.');
    expect(frontierOf(body)).toContain('The hinge complained.');
  });

  it('reports no drift for the same compiled message left alone', async () => {
    const turns = [
      { role: 'user', content: OPENING, id: 5001 },
      { role: 'assistant', content: 'The hinge complained.', id: 5002 },
    ];
    seed(storedState({ frozen: [compiledSpan], frozenIds: ['5001'] }));
    await dispatched(turns);
    expect(console.info.mock.calls[0][0]).toContain('drift 0');
  });

  it('re-sends nothing compiled and drops nothing uncompiled across a regenerate', async () => {
    const base = [
      { role: 'user', content: OPENING, id: 5001 },
      { role: 'user', content: 'And after that?', id: 5003 },
    ];
    seed(storedState({ frozen: [compiledSpan], frozenIds: ['5001'] }));
    const first = await dispatched([...base, { role: 'assistant', content: 'Draft one stood in the doorway.', id: 5004 }]);
    expect(frontierOf(first)).toContain('Draft one stood in the doorway.');

    const second = await dispatched([...base, { role: 'assistant', content: 'Draft two stood in the doorway.', id: 5005 }]);
    expect(frontierOf(second)).toContain('Draft two stood in the doorway.');
    expect(JSON.stringify(second)).not.toContain('Draft one');
    expect(frontierOf(second)).toContain(`${LITERAL}\nAnd after that?`);
    expect(occurrences(JSON.stringify(second), 'She pushed the door open.')).toBe(1);
    expect(stateNow().frozenIds).toEqual(['5001']);
    expect(console.info.mock.calls.at(-1)[0]).toContain('drift 0');
  });

  it('stores envelope ids, never a hash identity, in frozenIds and the watermark', async () => {
    const turns = [
      { role: 'user', content: OPENING, id: 5001 },
      { role: 'assistant', content: prose('body', 360), id: 5002 },
      { role: 'user', content: 'And after that?', id: 5003 },
      { role: 'assistant', content: 'The last message stands alone by itself.', id: 5004 },
    ];
    await dispatched(turns);
    const state = stateNow();

    expect(state.frozenIds.length).toBeGreaterThan(0);
    for (const id of state.frozenIds) expect(id).toMatch(/^\d+$/);
    expect([...state.frozenIds, state.watermark.messageId].every((id) => !String(id).includes('#'))).toBe(true);
    expect(state.janitorFormat).toBe(JANITOR_STATE_FORMAT);
  });

  it('compiles nothing when the envelope gives its entries no ids', async () => {
    const turns = [
      { role: 'user', content: OPENING },
      { role: 'assistant', content: prose('body', 360) },
      { role: 'user', content: 'And after that?' },
      { role: 'assistant', content: 'The last message stands alone by itself.' },
    ];
    const envelope = envelopeFor(turns);
    for (const entry of envelope.chatMessages) delete entry.id;
    await window.fetch(ALPHA_URL, jsonPost(JSON.stringify(envelope)));
    calls.length = 0;
    events.length = 0;
    await send(bodyFor(turns));

    expect(events).toEqual(['fetch']);
    expect(store.has(stateKey(CHAT_ID))).toBe(false);
  });
});

describe('the derivation-time rollback', () => {
  const ANSWER = 'Keeper:\nThe lamp turned once.\n\nThe rain kept on.';
  const DEBRIS = 'She reached for the';
  const withDebris = [
    { role: 'user', content: 'She pushed the door open.', id: 6001 },
    { role: 'assistant', content: `${ANSWER}\n\n${DEBRIS}`, id: 6002 },
  ];

  function frontierOf(body) {
    return body.messages.at(-2).content;
  }

  it('cuts an incomplete trailing block back before the derivation sees it', async () => {
    const body = await dispatched(withDebris);
    expect(frontierOf(body)).toContain(ANSWER);
    expect(JSON.stringify(body)).not.toContain(DEBRIS);
  });

  it('leaves a message on record as a boundary stop byte-identical', async () => {
    seed(storedState({ boundaries: ['6002'] }));
    const body = await dispatched(withDebris);
    expect(frontierOf(body)).toContain(`${ANSWER}\n\n${DEBRIS}`);
  });

  it('removes a block-start literal and everything after it', async () => {
    const turns = [
      { role: 'user', content: 'She pushed the door open.', id: 6011 },
      { role: 'assistant', content: `${ANSWER}\n\n${LITERAL}\nShe let the door swing shut.`, id: 6012 },
    ];
    const body = await dispatched(turns);
    expect(frontierOf(body)).toContain(ANSWER);
    expect(JSON.stringify(body)).not.toContain('She let the door swing shut.');
  });

  it('leaves a mid-paragraph occurrence of the literal alone', async () => {
    const line = `Keeper:\nHe read the label aloud: ${LITERAL} two crates, and shrugged.`;
    const turns = [
      { role: 'user', content: 'She pushed the door open.', id: 6021 },
      { role: 'assistant', content: line, id: 6022 },
    ];
    const body = await dispatched(turns);
    expect(frontierOf(body)).toContain(line);
  });

  it('never trims a human turn, mid-sentence or otherwise', async () => {
    const turns = [
      { role: 'user', content: 'She pushed the door open and', id: 6031 },
      { role: 'assistant', content: ANSWER, id: 6032 },
    ];
    const body = await dispatched(turns);
    expect(frontierOf(body)).toContain(`${LITERAL}\nShe pushed the door open and`);
  });
});

describe('the pending boundary marker', () => {
  const pair = [
    { role: 'user', content: 'She pushed the door open.', id: 8001 },
    { role: 'assistant', content: 'The hinge complained.', id: 8002 },
  ];

  it('records the successor of the named id and saves without a freeze', async () => {
    seed(storedState({ pendingBoundaryAfter: '8001' }));
    await dispatched(pair);
    expect(stateNow().boundaries).toEqual(['8002']);
    expect(stateNow().pendingBoundaryAfter).toBe('');
    expect(events).toEqual(['save', 'fetch']);
  });

  it('appends nothing when the named id is the last entry of the request', async () => {
    seed(storedState({ pendingBoundaryAfter: '8002' }));
    await dispatched(pair);
    expect(stateNow().boundaries).toEqual([]);
    expect(stateNow().pendingBoundaryAfter).toBe('');
  });

  it('appends nothing when the successor is a human turn', async () => {
    seed(storedState({ pendingBoundaryAfter: '8002' }));
    await dispatched([...pair, { role: 'user', content: 'And after that?', id: 8003 }]);
    expect(stateNow().boundaries).toEqual([]);
    expect(stateNow().pendingBoundaryAfter).toBe('');
  });

  it('appends nothing when the named id is absent from the request', async () => {
    seed(storedState({ pendingBoundaryAfter: '8001' }));
    await dispatched([{ role: 'assistant', content: 'Draft two stood in the doorway.', id: 8004 }]);
    expect(stateNow().boundaries).toEqual([]);
    expect(stateNow().pendingBoundaryAfter).toBe('');
  });

  it('appends nothing when the successor carries no envelope id', async () => {
    const envelope = envelopeFor(pair);
    delete envelope.chatMessages[1].id;
    seed(storedState({ pendingBoundaryAfter: '8001' }));
    await window.fetch(ALPHA_URL, jsonPost(JSON.stringify(envelope)));
    calls.length = 0;
    events.length = 0;
    await send(bodyFor(pair));

    expect(stateNow().boundaries).toEqual([]);
    expect(stateNow().pendingBoundaryAfter).toBe('');
  });

  it('never records the same id twice', async () => {
    seed(storedState({ boundaries: ['8002'], pendingBoundaryAfter: '8001' }));
    await dispatched(pair);
    expect(stateNow().boundaries).toEqual(['8002']);
  });
});

describe('the watermark over trimmed text', () => {
  const LONG = prose('body', 360);
  const turns = [
    { role: 'user', content: 'She pushed the door open.', id: 6101 },
    { role: 'assistant', content: `${LONG}\n\nShe reached for the`, id: 6102 },
    { role: 'user', content: 'And after that?', id: 6103 },
    { role: 'assistant', content: 'The last message stands alone by itself.', id: 6104 },
  ];

  it('hashes the trimmed content and re-finds the message under a new id', async () => {
    await dispatched(turns);
    const state = stateNow();
    expect(state.watermark.messageId).toBe('6102');
    expect(state.watermark.offset).toBeGreaterThan(0);
    expect(state.watermarkText).toBe(LONG);
    expect(state.watermark.prefixHash).toBe(prefixIdentity(LONG, state.watermark.offset));

    const regenerated = turns.map((turn) => (turn.id === 6102 ? { ...turn, id: 6202 } : turn));
    const body = await dispatched(regenerated);
    expect(JSON.stringify(body).split('body 0 the lamp turned').length - 1).toBe(1);
    expect(JSON.stringify(body)).not.toContain('She reached for the');
  });
});

describe('three consecutive transforms across a recorded boundary', () => {
  const seeded = { text: prose('opening', 40), words: 40 * 12, createdAt: 1 };
  const stopped = `${prose('body', 360)}\n\nShe reached for the`;
  const base = [
    { role: 'user', content: 'She pushed the door open.', id: 7001 },
    { role: 'assistant', content: stopped, id: 7002 },
  ];
  const turnTwo = [...base, { role: 'user', content: 'And after that?', id: 7003 }, { role: 'assistant', content: prose('second', 120), id: 7004 }];
  const turnThree = [...turnTwo, { role: 'user', content: 'And after that again?', id: 7005 }, { role: 'assistant', content: prose('third', 120), id: 7006 }];

  function pairsOf(body) {
    return body.messages.slice(2, -2);
  }

  it('keeps every surviving pair byte-identical', async () => {
    seed(storedState({ frozen: [seeded], boundaries: ['7002'] }));
    const first = await dispatched(base);
    const second = await dispatched(turnTwo);
    const third = await dispatched(turnThree);

    const one = pairsOf(first);
    const two = pairsOf(second);
    expect(one.length).toBeGreaterThanOrEqual(2);
    expect(two.slice(0, one.length)).toEqual(one);
    expect(pairsOf(third).slice(0, two.length)).toEqual(two);
    expect(stateNow().boundaries).toEqual(['7002']);
    expect(JSON.stringify(third)).toContain('She reached for the');
  });
});

describe('the stream boundary and the pending marker', () => {
  const opening = [{ role: 'user', content: 'She pushed the door open.', id: 9001 }];
  const answered = [...opening, { role: 'assistant', content: 'Keeper:\nThe lamp turned once.', id: 9002 }];

  async function sendAndRead(body) {
    const response = await window.fetch(PROXY_URL, jsonPost(JSON.stringify(body)));
    await response.text();
    return calls.at(-1);
  }

  it('writes the last aligned id when the stream was cut, and the next request records the boundary', async () => {
    await bind(opening);
    nextResponse = () => streamed(transcript(BOUNDARY_DELTAS));
    await sendAndRead(bodyFor(opening));

    expect(stateNow().pendingBoundaryAfter).toBe('9001');
    expect(stateNow().boundaries).toEqual([]);

    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await dispatched(answered);
    expect(stateNow().boundaries).toEqual(['9002']);
    expect(stateNow().pendingBoundaryAfter).toBe('');
  });

  it('writes the marker when the provider itself stopped and the completion is empty', async () => {
    await bind(opening);
    nextResponse = () => streamed([...transcript([])]);
    await sendAndRead(bodyFor(opening));
    expect(stateNow().pendingBoundaryAfter).toBe('9001');
  });

  it('writes nothing for an ordinary completion and clears a marker another tab left', async () => {
    await bind(opening);
    nextResponse = () => streamed(transcript(PROSE_DELTAS));
    await sendAndRead(bodyFor(opening));
    expect(store.has(stateKey(CHAT_ID))).toBe(false);

    seed(storedState({ pendingBoundaryAfter: '9001' }));
    lastPlan.onCompletion({ boundaryHit: false, text: 'Keeper:\nThe lamp turned once.' });
    expect(stateNow().pendingBoundaryAfter).toBe('');
  });

  it('reports the completion exactly once per response', async () => {
    await bind(opening);
    nextResponse = () => streamed(transcript(BOUNDARY_DELTAS));
    const response = await window.fetch(PROXY_URL, jsonPost(JSON.stringify(bodyFor(opening))));

    const seen = [];
    lastPlan.onCompletion = (completion) => seen.push(completion);
    await response.text();
    await response.text().catch(() => '');

    expect(seen).toHaveLength(1);
    expect(seen[0].boundaryHit).toBe(true);
  });
});

describe('three turns across a stream-suppressed boundary', () => {
  const seeded = { text: prose('opening', 40), words: 40 * 12, createdAt: 1 };
  const stopped = `${prose('body', 360)}\n\nShe reached for the`;
  const opening = [{ role: 'user', content: 'She pushed the door open.', id: 7001 }];
  const turnTwo = [...opening, { role: 'assistant', content: stopped, id: 7002 }];
  const turnThree = [...turnTwo, { role: 'user', content: 'And after that?', id: 7003 }, { role: 'assistant', content: prose('second', 120), id: 7004 }];

  function pairsOf(body) {
    return body.messages.slice(2, -2);
  }

  it('keeps every surviving pair byte-identical and exempts the stopped message', async () => {
    seed(storedState({ frozen: [seeded] }));
    await bind(opening);
    nextResponse = () => streamed(transcript(BOUNDARY_DELTAS));
    const response = await window.fetch(PROXY_URL, jsonPost(JSON.stringify(bodyFor(opening))));
    await response.text();
    const first = JSON.parse(calls.at(-1).config.body);

    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const second = await dispatched(turnTwo);
    const third = await dispatched(turnThree);

    expect(stateNow().boundaries).toEqual(['7002']);
    expect(JSON.stringify(third)).toContain('She reached for the');
    expect(second.messages[0].content).toBe(first.messages[0].content);
    const one = pairsOf(first);
    const two = pairsOf(second);
    expect(one.length).toBeGreaterThanOrEqual(2);
    expect(two.slice(0, one.length)).toEqual(one);
    expect(pairsOf(third).slice(0, two.length)).toEqual(two);
  });
});

describe('a route that rejects the stop parameter', () => {
  const turns = [
    { role: 'user', content: 'She pushed the door open.', id: 9101 },
    { role: 'assistant', content: 'Keeper:\nThe lamp turned once.', id: 9102 },
  ];

  function refusal(status, message) {
    return () => new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('learns the route from a 4xx naming the parameter and omits stop on the next request', async () => {
    await bind(turns);
    nextResponse = refusal(400, 'Unsupported parameter: stop is not supported with this model.');
    const refused = await send(bodyFor(turns));

    expect(calls).toHaveLength(1);
    expect(JSON.parse(refused.config.body).stop[0]).toBe(LITERAL);
    expect(console.info.mock.calls.at(-1)[0]).toContain('stop sent');

    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const next = JSON.parse((await send(bodyFor(turns))).config.body);
    expect('stop' in next).toBe(false);
    expect(console.info.mock.calls.at(-1)[0]).toContain('stop skipped');
  });

  it('still writes the literal on another model', async () => {
    await bind(turns);
    nextResponse = refusal(400, 'Unsupported parameter: stop');
    await send(bodyFor(turns));

    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const other = { ...bodyFor(turns), model: 'gpt-other' };
    expect(JSON.parse((await send(other)).config.body).stop[0]).toBe(LITERAL);
  });

  it('learns nothing from a 4xx that does not name the parameter, or from a 5xx', async () => {
    await bind(turns);
    nextResponse = refusal(400, 'Your credit balance is too low.');
    await send(bodyFor(turns));
    nextResponse = refusal(500, 'Unsupported parameter: stop');
    await send(bodyFor(turns));

    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    expect(JSON.parse((await send(bodyFor(turns))).config.body).stop[0]).toBe(LITERAL);
    expect(calls).toHaveLength(3);
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

describe('a requested recompile', () => {
  const LONG_TURNS = [
    { role: 'user', content: 'She pushed the door open.' },
    { role: 'assistant', content: prose('first', 360) },
    { role: 'user', content: 'And after that?' },
    { role: 'assistant', content: prose('second', 360) },
    { role: 'user', content: 'And after that again?' },
    { role: 'assistant', content: prose('third', 360) },
    { role: 'user', content: 'And then?' },
    { role: 'assistant', content: prose('fourth', 360) },
  ];

  function spansOf(spans) {
    return spans.map((span) => ({ text: span.text, words: span.words }));
  }

  function compiledPart(state) {
    return {
      frozen: spansOf(state.frozen),
      units: spansOf(state.units),
      frozenIds: state.frozenIds,
      watermark: state.watermark,
      watermarkText: state.watermarkText,
    };
  }

  it('rebuilds exactly what one unit per request compiles over the same messages', async () => {
    for (let pass = 0; pass < 6; pass += 1) await dispatched(LONG_TURNS);
    const incremental = compiledPart(stateNow());
    expect(incremental.frozen.length + incremental.units.length).toBeGreaterThan(1);

    store.clear();
    const { requestRecompile } = await import('../../janitor/recompile.js');
    requestRecompile(CHAT_ID);
    await dispatched(LONG_TURNS);

    expect(compiledPart(stateNow())).toEqual(incremental);
  });

  it('discards every trace of the state it replaces', async () => {
    const stale = { text: prose('stale', 40), words: 480, createdAt: 1 };
    seed(storedState({
      frozen: [stale],
      frozenIds: ['ghost-id'],
      watermark: { messageId: 'ghost-id', offset: 90, prefixHash: 'deadbeef' },
      boundaries: ['103237690003'],
      pendingBoundaryAfter: '103237690002',
      watermarkText: 'stale text',
    }));

    const { requestRecompile } = await import('../../janitor/recompile.js');
    requestRecompile(CHAT_ID);
    await dispatched(LONG_TURNS);

    const saved = stateNow();
    expect(saved.frozen).not.toContainEqual(stale);
    expect(saved.boundaries).toEqual([]);
    expect(saved.pendingBoundaryAfter).toBe('');
    expect(saved.watermarkText).not.toBe('stale text');
    expect(saved.frozenIds).not.toContain('ghost-id');
    expect(saved.watermark.prefixHash).not.toBe('deadbeef');
  });

  it('is consumed by the next request and by nothing after it', async () => {
    const { requestRecompile } = await import('../../janitor/recompile.js');
    const { getRequestStatus } = await import('../../janitor/status.js');

    requestRecompile(CHAT_ID);
    await dispatched(LONG_TURNS);
    expect(getRequestStatus().rebuilt).toBe(true);
    const afterRebuild = stateNow();

    await dispatched(LONG_TURNS);
    expect(getRequestStatus().rebuilt).toBe(false);
    expect(stateNow().frozen.length + stateNow().units.length)
      .toBeGreaterThanOrEqual(afterRebuild.frozen.length + afterRebuild.units.length);
  });

  it('is not consumed by a request for another chat', async () => {
    const { requestRecompile } = await import('../../janitor/recompile.js');
    const { getRequestStatus } = await import('../../janitor/status.js');

    requestRecompile('another-chat');
    await dispatched(SHORT_TURNS);
    expect(getRequestStatus().rebuilt).toBe(false);
  });
});

describe('the request status snapshot', () => {
  it('reports the same facts as the console line for the request just sent', async () => {
    const { getRequestStatus } = await import('../../janitor/status.js');
    seed(storedState({ frozen: [{ text: prose('opening', 40), words: 480, createdAt: 1 }] }));
    await dispatched(SHORT_TURNS);

    const status = getRequestStatus();
    const state = stateNow();
    expect(status).toMatchObject({
      chatId: CHAT_ID,
      literal: LITERAL,
      finals: state.frozen.length,
      units: state.units.length,
      froze: false,
      rebuilt: false,
      stopSent: true,
      routerEnabled: false,
    });
    expect(status.frontierWords).toBeGreaterThan(0);
    expect(status.at).toBeGreaterThan(0);
  });
});
