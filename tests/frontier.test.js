import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeContext, uninstall, makeMessage, makeAssistantMessage } from './helpers/fake-context.js';
import { METADATA_KEY, INTERCEPTOR_GLOBAL } from '../src/constants.js';
import { CONTINUATION_CONTROL } from '../src/prompt.js';
import { buildHistory, applyToRequestChat, shouldReconstruct, regeneratesLastMessage, interceptGeneration } from '../src/frontier.js';
import { armSolo, consumeSoloFlag, resolveSoloControl } from '../src/solo.js';

const NAMES = { name1: 'Mara', name2: 'Narrator' };
const MESSAGE_FIELDS = ['name', 'is_user', 'is_system', 'mes', 'extra'];

function makeState({ frozen = [], frozenIds = [], watermark = { messageId: null, offset: 0 } } = {}) {
  return { version: 2, frozen, frozenIds, watermark };
}

function installWithState(state, chat = []) {
  return installFakeContext({ name1: 'Mara', name2: 'Narrator', chat, chatMetadata: { [METADATA_KEY]: state } });
}

afterEach(() => {
  consumeSoloFlag();
  uninstall();
  vi.restoreAllMocks();
});

describe('buildHistory', () => {
  it('returns frozen spans, the frontier and one continuation turn, in order', () => {
    const state = makeState({
      frozen: [{ text: 'A', words: 1, createdAt: 1 }, { text: 'B', words: 1, createdAt: 2 }],
    });
    const history = buildHistory(state, NAMES, { frontier: 'C' });

    expect(history.map((m) => m.mes)).toEqual(['A', 'B', 'C', CONTINUATION_CONTROL]);
    for (const message of history.slice(0, 3)) {
      expect(message.name).toBe('Narrator');
      expect(message.is_user).toBe(false);
      expect(message.is_system).toBe(false);
    }
    expect(history[3].name).toBe('Mara');
    expect(history[3].is_user).toBe(true);
    expect(history[3].is_system).toBe(false);
    for (const message of history) {
      expect(message.extra[METADATA_KEY].reconstructed).toBe(true);
    }
  });

  it('omits the frontier message when it is blank, absent or not a string', () => {
    for (const options of [{ frontier: '' }, { frontier: '   \n  ' }, {}, undefined, { frontier: 42 }]) {
      const history = buildHistory(makeState({ frozen: [{ text: 'A' }] }), NAMES, options);
      expect(history.map((m) => m.mes)).toEqual(['A', CONTINUATION_CONTROL]);
      expect(history[history.length - 1].is_user).toBe(true);
    }
  });

  it('passes the frontier through verbatim, without trimming or re-joining', () => {
    const frontier = 'Mara: one.\n\nNarration.\n';
    const history = buildHistory(makeState(), NAMES, { frontier });
    expect(history[0].mes).toBe(frontier);
  });

  it('never reads the state for the mutable turn', () => {
    const state = makeState();
    state.frontier = 'a stale v1 field';
    const history = buildHistory(state, NAMES, { frontier: 'C' });
    expect(history.map((m) => m.mes)).toEqual(['C', CONTINUATION_CONTROL]);
  });

  it('never reads words or createdAt off a frozen span', () => {
    const history = buildHistory(makeState({ frozen: [{ text: 'A', words: 99, createdAt: 5 }] }), NAMES);
    expect(Object.keys(history[0]).sort()).toEqual([...MESSAGE_FIELDS].sort());
    expect(JSON.stringify(history)).not.toContain('99');
  });

  it('accepts an empty persona name without substituting a placeholder', () => {
    const history = buildHistory(makeState(), { name1: '', name2: '' }, { frontier: 'C' });
    expect(history[0].name).toBe('');
    expect(history[1].name).toBe('');
  });

  it('returns [] for a blank state, a non-object state and a state without usable spans', () => {
    expect(buildHistory(makeState(), NAMES, { frontier: '   ' })).toEqual([]);
    expect(buildHistory(undefined, NAMES)).toEqual([]);
    expect(buildHistory('nonsense', NAMES)).toEqual([]);
    expect(buildHistory(makeState({ frozen: [{ text: '' }, {}] }), NAMES)).toEqual([]);
  });
});

describe('applyToRequestChat', () => {
  it('keeps array identity and pushes the very objects from the history', () => {
    const chat = [makeMessage({ mes: 'live' })];
    const history = buildHistory(makeState(), NAMES, { frontier: 'C' });
    const result = applyToRequestChat(chat, history);

    expect(result).toBe(true);
    expect(chat.length).toBe(history.length);
    history.forEach((message, i) => expect(Object.is(chat[i], message)).toBe(true));
  });

  it('refuses an empty history and leaves the array byte-identical', () => {
    const chat = [makeMessage({ mes: 'live' })];
    const before = JSON.stringify(chat);
    expect(applyToRequestChat(chat, [])).toBe(false);
    expect(applyToRequestChat(chat, undefined)).toBe(false);
    expect(applyToRequestChat(undefined, [makeMessage()])).toBe(false);
    expect(JSON.stringify(chat)).toBe(before);
  });
});

describe('shouldReconstruct', () => {
  it('skips quiet and impersonate only', () => {
    expect(shouldReconstruct('quiet')).toBe(false);
    expect(shouldReconstruct('impersonate')).toBe(false);
    for (const type of ['normal', 'continue', 'regenerate', 'swipe', undefined, 'something_new']) {
      expect(shouldReconstruct(type)).toBe(true);
    }
  });
});

describe('interceptGeneration', () => {
  it('leaves the request array alone for quiet and impersonate', async () => {
    const ctx = installWithState(makeState(), [makeAssistantMessage({ mes: 'C' })]);
    for (const type of ['quiet', 'impersonate']) {
      const chat = [makeMessage({ mes: 'live' })];
      const before = JSON.stringify(chat);
      const abort = vi.fn();
      expect(await interceptGeneration(chat, 4096, abort, type, ctx)).toBe(false);
      expect(JSON.stringify(chat)).toBe(before);
      expect(abort).not.toHaveBeenCalled();
    }
  });

  it('reconstructs for every other type, including undefined and unknown strings', async () => {
    const ctx = installWithState(makeState({ frozen: [{ text: 'A' }] }), [makeAssistantMessage({ mes: 'C' })]);
    for (const type of ['normal', 'continue', 'regenerate', undefined, 'something_new']) {
      const chat = [makeMessage({ mes: 'live' })];
      expect(await interceptGeneration(chat, 4096, vi.fn(), type, ctx)).toBe(true);
      expect(chat.map((m) => m.mes)).toEqual(['A', 'C', CONTINUATION_CONTROL]);
    }

    const swiped = [makeMessage({ mes: 'live' })];
    expect(await interceptGeneration(swiped, 4096, vi.fn(), 'swipe', ctx)).toBe(true);
    expect(swiped.map((m) => m.mes)).toEqual(['A', CONTINUATION_CONTROL]);
  });

  it('derives the mutable turn from the visible chat, tagging the collaborator', async () => {
    const ctx = installWithState(makeState(), [
      makeMessage({ name: 'Mara', mes: 'she opens the door.' }),
      makeAssistantMessage({ mes: 'The hall is cold.' }),
      makeMessage({ mes: 'SYSTEM', is_system: true }),
    ]);
    ctx.substituteParams = (s) => (s === '{{user}}' ? 'Mara' : s);

    const chat = [];
    await interceptGeneration(chat, 4096, vi.fn(), 'normal', ctx);

    expect(chat.map((m) => m.mes)).toEqual([
      'Mara: she opens the door.\n\nThe hall is cold.',
      CONTINUATION_CONTROL,
    ]);
  });

  it('skips messages a frozen span has consumed', async () => {
    const consumed = makeAssistantMessage({ mes: 'Already frozen.', extra: { [METADATA_KEY]: { id: 'a' } } });
    const ctx = installWithState(
      makeState({ frozen: [{ text: 'Already frozen.' }], frozenIds: ['a'] }),
      [consumed, makeAssistantMessage({ mes: 'Still mutable.' })],
    );

    const chat = [];
    await interceptGeneration(chat, 4096, vi.fn(), 'normal', ctx);
    expect(chat.map((m) => m.mes)).toEqual(['Already frozen.', 'Still mutable.', CONTINUATION_CONTROL]);
  });

  // derived-frontier: an edit, a swipe or a delete lands on the next request → docs/modules/derive.md#derivation-rule
  it('follows an edit, a swipe and a delete with no listener and no state write', async () => {
    const ctx = installWithState(makeState(), [
      makeAssistantMessage({ mes: 'First.' }),
      makeAssistantMessage({ mes: 'Second.' }),
    ]);
    const canonicalBefore = JSON.stringify(ctx.chatMetadata[METADATA_KEY]);

    const edited = [];
    ctx.chat[0].mes = 'First, rewritten.';
    await interceptGeneration(edited, 4096, vi.fn(), 'normal', ctx);
    expect(edited[0].mes).toBe('First, rewritten.\n\nSecond.');

    const swiped = [];
    ctx.chat[1].mes = 'An alternate second.';
    await interceptGeneration(swiped, 4096, vi.fn(), 'normal', ctx);
    expect(swiped[0].mes).toBe('First, rewritten.\n\nAn alternate second.');

    const deleted = [];
    ctx.chat.splice(0, 1);
    await interceptGeneration(deleted, 4096, vi.fn(), 'normal', ctx);
    expect(deleted[0].mes).toBe('An alternate second.');

    expect(JSON.stringify(ctx.chatMetadata[METADATA_KEY])).toBe(canonicalBefore);
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });

  it('assigns no message id', async () => {
    const ctx = installWithState(makeState(), [makeAssistantMessage({ mes: 'C' })]);
    await interceptGeneration([], 4096, vi.fn(), 'normal', ctx);
    expect(ctx.chat[0].extra[METADATA_KEY]).toBeUndefined();
  });

  it('never calls abort and never persists, including for empty and malformed state', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const stored of [makeState(), { version: 2, frozen: 'nope' }, { version: 7, frozen: [] }]) {
      const ctx = installWithState(stored);
      const abort = vi.fn();
      const chat = [makeMessage({ mes: 'live' })];
      const before = JSON.stringify(chat);
      expect(await interceptGeneration(chat, 4096, abort, 'normal', ctx)).toBe(false);
      expect(JSON.stringify(chat)).toBe(before);
      expect(abort).not.toHaveBeenCalled();
      expect(ctx.saveMetadata).not.toHaveBeenCalled();
      expect(ctx.saveChat).not.toHaveBeenCalled();
      uninstall();
    }
  });

  it('leaves the visible chat log untouched, captured marks included', async () => {
    const visible = makeMessage({ name: 'Mara', mes: 'typed', extra: { [METADATA_KEY]: { captured: true, id: 'x' } } });
    const ctx = installWithState(makeState(), [visible, makeAssistantMessage({ mes: 'reply' })]);
    const before = JSON.stringify(ctx.chat);

    await interceptGeneration([makeMessage({ mes: 'request' })], 4096, vi.fn(), 'normal', ctx);

    expect(JSON.stringify(ctx.chat)).toBe(before);
    expect(Object.is(ctx.chat[0], visible)).toBe(true);
  });

  // inv-10: many live histories, one output; byte comparison → docs/modules/frontier.md#inv-10
  it('produces byte-identical arrays from live histories that end in the same visible chat', async () => {
    const state = () => makeState({ frozen: [{ text: 'A', words: 1, createdAt: 1 }] });

    const calm = [
      makeMessage({ name: 'Mara', mes: 'she opens the door.' }),
      makeAssistantMessage({ mes: 'The hall is cold.' }),
    ];
    const stormy = [
      makeMessage({
        name: 'Mara',
        mes: 'she opens the door.',
        extra: { [METADATA_KEY]: { captured: true, id: 'm1' } },
      }),
      makeAssistantMessage({
        mes: 'The hall is cold.',
        swipes: ['A discarded attempt.', 'The hall is cold.'],
        swipe_id: 1,
        extra: { [METADATA_KEY]: { received: true, boundary: true, id: 'm2' } },
      }),
    ];
    stormy[1].send_date = 99999;

    const ctxA = installWithState(state(), calm);
    ctxA.substituteParams = (s) => (s === '{{user}}' ? 'Mara' : s);
    const chatA = [makeMessage({ mes: 'request a' })];
    await interceptGeneration(chatA, 4096, vi.fn(), 'normal', ctxA);
    uninstall();

    const ctxB = installWithState(state(), stormy);
    ctxB.substituteParams = (s) => (s === '{{user}}' ? 'Mara' : s);
    const chatB = [makeMessage({ mes: 'request b' })];
    await interceptGeneration(chatB, 128, vi.fn(), 'continue', ctxB);

    expect(JSON.stringify(chatA)).toBe(JSON.stringify(chatB));
    for (const message of chatA) {
      expect(Object.keys(message).sort()).toEqual([...MESSAGE_FIELDS].sort());
    }
  });

  it('emits exactly one user turn, last, whose mes is the continuation constant', async () => {
    const ctx = installWithState(
      makeState({ frozen: [{ text: 'A' }, { text: 'B' }] }),
      [makeAssistantMessage({ mes: 'C' })],
    );
    const first = [];
    const second = [];
    await interceptGeneration(first, 4096, vi.fn(), 'normal', ctx);
    await interceptGeneration(second, 4096, vi.fn(), 'normal', ctx);

    const userTurns = first.filter((m) => m.is_user === true);
    expect(userTurns).toHaveLength(1);
    expect(first[first.length - 1].is_user).toBe(true);
    expect(first[first.length - 1].mes).toBe(CONTINUATION_CONTROL);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('regeneratesLastMessage', () => {
  it('is true for swipe only', () => {
    expect(regeneratesLastMessage('swipe')).toBe(true);
    for (const type of ['regenerate', 'normal', 'continue', 'quiet', 'impersonate', undefined, 'something_new']) {
      expect(regeneratesLastMessage(type)).toBe(false);
    }
  });
});

describe('derivation scope per generation type', () => {
  const visible = () => [
    makeMessage({ name: 'Mara', mes: 'she opens the door.' }),
    makeAssistantMessage({ mes: 'The hall is cold.' }),
    makeAssistantMessage({ mes: 'A draft moves the curtain.' }),
  ];

  async function frontierFor(type) {
    const ctx = installWithState(makeState(), visible());
    ctx.substituteParams = (s) => (s === '{{user}}' ? 'Mara' : s);
    const chat = [makeMessage({ mes: 'request' })];
    await interceptGeneration(chat, 4096, vi.fn(), type, ctx);
    const turn = chat[chat.length - 2];
    uninstall();
    return turn.mes;
  }

  it('omits the last assistant message on swipe', async () => {
    const text = await frontierFor('swipe');
    expect(text).toContain('The hall is cold.');
    expect(text).not.toContain('A draft moves the curtain.');
  });

  it('keeps it for regenerate, continue, normal and an absent type', async () => {
    for (const type of ['regenerate', 'continue', 'normal', undefined]) {
      expect(await frontierFor(type)).toContain('A draft moves the curtain.');
    }
  });

  // inv-10: same visible chat, same reconstruction, swipe scope → docs/modules/frontier.md#inv-10
  it('collapses two live histories to the same reconstruction under swipe', async () => {
    const state = () => makeState({ frozen: [{ text: 'A', words: 1, createdAt: 1 }] });

    const calm = visible();
    const stormy = visible();
    stormy[0].extra = { [METADATA_KEY]: { id: 'm1' } };
    stormy[1].swipes = ['A discarded attempt.', 'The hall is cold.'];
    stormy[1].swipe_id = 1;
    stormy[2].send_date = 99999;

    const ctxA = installWithState(state(), calm);
    ctxA.substituteParams = (s) => (s === '{{user}}' ? 'Mara' : s);
    const chatA = [makeMessage({ mes: 'request a' })];
    await interceptGeneration(chatA, 4096, vi.fn(), 'swipe', ctxA);
    uninstall();

    const ctxB = installWithState(state(), stormy);
    ctxB.substituteParams = (s) => (s === '{{user}}' ? 'Mara' : s);
    const chatB = [makeMessage({ mes: 'request b' })];
    await interceptGeneration(chatB, 128, vi.fn(), 'swipe', ctxB);

    expect(JSON.stringify(chatA)).toBe(JSON.stringify(chatB));
    expect(JSON.stringify(chatA)).not.toContain('A draft moves the curtain.');
  });
});

describe('the interceptor global', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete globalThis[INTERCEPTOR_GLOBAL];
  });

  it('delegates to interceptGeneration', async () => {
    const ctx = installWithState(makeState({ frozen: [{ text: 'A' }] }), [makeAssistantMessage({ mes: 'C' })]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../index.js');

    const viaGlobal = [];
    const abort = vi.fn();
    const result = await globalThis[INTERCEPTOR_GLOBAL](viaGlobal, 4096, abort, 'normal');
    const direct = [];
    await interceptGeneration(direct, 4096, abort, 'normal', ctx);

    expect(result).toBe(true);
    expect(JSON.stringify(viaGlobal)).toBe(JSON.stringify(direct));
    expect(abort).not.toHaveBeenCalled();
  });

  it('is a single delegating call in index.js', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'index.js'), 'utf8');
    const body = source.slice(source.indexOf('globalThis[INTERCEPTOR_GLOBAL]'), source.indexOf('let ready'));
    expect(body).toContain('return interceptGeneration(chat, contextSize, abort, type);');
    expect(body.split('\n').filter((line) => line.trim() !== '')).toHaveLength(3);
  });
});

describe('the one-shot solo variant', () => {
  const soloState = () => makeState({ frozen: [{ text: 'A', words: 1, createdAt: 1 }] });

  it('uses options.control for the continuation turn and nothing else', () => {
    const history = buildHistory(soloState(), NAMES, { frontier: 'B', control: 'X' });
    const last = history[history.length - 1];
    expect(last.mes).toBe('X');
    expect(last.is_user).toBe(true);
    for (const message of history.slice(0, -1)) {
      expect(message.is_user).toBe(false);
      expect(message.mes).not.toBe('X');
    }
    expect(history.slice(0, -1).map((m) => m.mes)).toEqual(['A', 'B']);
  });

  it('falls back to the canonical string for absent, empty and non-string controls', () => {
    for (const options of [{}, { control: '' }, { control: 42 }]) {
      const history = buildHistory(soloState(), NAMES, { frontier: 'B', ...options });
      expect(history[history.length - 1].mes).toBe(CONTINUATION_CONTROL);
    }
  });

  it('applies the resolved solo text once and reverts on the next request', async () => {
    const ctx = installWithState(soloState(), [makeAssistantMessage({ mes: 'B' })]);
    ctx.substituteParams = (s) => s.replace('{{user}}', 'Mara');
    armSolo();

    const first = [];
    await interceptGeneration(first, 4096, vi.fn(), 'normal', ctx);
    expect(first[first.length - 1].mes).toBe(resolveSoloControl(ctx));
    expect(first[first.length - 1].mes).toContain('Mara is in the scene');

    const second = [];
    await interceptGeneration(second, 4096, vi.fn(), 'normal', ctx);
    expect(second[second.length - 1].mes).toBe(CONTINUATION_CONTROL);
  });

  it('is cleared by a skipped generation type, which touches nothing', async () => {
    const ctx = installWithState(soloState(), [makeAssistantMessage({ mes: 'B' })]);
    armSolo();

    const skipped = [makeMessage({ mes: 'live' })];
    const before = JSON.parse(JSON.stringify(skipped));
    expect(await interceptGeneration(skipped, 4096, vi.fn(), 'quiet', ctx)).toBe(false);
    expect(skipped).toEqual(before);

    const next = [];
    await interceptGeneration(next, 4096, vi.fn(), 'normal', ctx);
    expect(next[next.length - 1].mes).toBe(CONTINUATION_CONTROL);
  });

  it('leaves canonical state deep-equal and free of the solo sentence (INV-5, INV-10)', async () => {
    const ctx = installWithState(soloState(), [makeAssistantMessage({ mes: 'B' })]);
    ctx.substituteParams = (s) => s.replace('{{user}}', 'Mara');
    const canonicalBefore = JSON.parse(JSON.stringify(ctx.chatMetadata[METADATA_KEY]));
    armSolo();

    const chat = [];
    await interceptGeneration(chat, 4096, vi.fn(), 'normal', ctx);

    const canonicalAfter = ctx.chatMetadata[METADATA_KEY];
    expect(canonicalAfter).toEqual(canonicalBefore);
    expect(JSON.stringify(ctx.chatMetadata)).not.toContain('stays out of the writing');
    for (const span of canonicalAfter.frozen) expect(span.text).not.toContain('stays out of the writing');
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });
});

describe('src/frontier.js source', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/frontier.js'), 'utf8');

  it('names neither the ST global nor any character or persona', () => {
    expect(source).not.toContain('SillyTavern');
    expect(source).not.toMatch(/Narrator|Mara|Anton/);
  });

  it('leaves the bootstrap anchor src/constants.js points at intact', () => {
    const doc = fs.readFileSync(path.join(process.cwd(), 'docs/modules/bootstrap.md'), 'utf8');
    expect(doc).toMatch(/^#+ .*\{#interceptor-placeholder\}\s*$/m);
  });

  it('subscribes to no prompt-assembly event and writes nothing', () => {
    for (const name of [
      'CHAT_COMPLETION_PROMPT_READY',
      'GENERATE_AFTER_COMBINE_PROMPTS',
      'GENERATE_BEFORE_COMBINE_PROMPTS',
    ]) {
      expect(source).not.toContain(name);
    }
    expect(source).not.toContain('saveChat');
    expect(source).not.toContain('saveMetadata');
    expect(source).not.toContain('assignIds');
  });
});
