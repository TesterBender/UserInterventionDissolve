import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeContext, uninstall, makeMessage, makeAssistantMessage } from './helpers/fake-context.js';
import { METADATA_KEY, INTERCEPTOR_GLOBAL } from '../src/constants.js';
import { CONTINUATION_CONTROL } from '../src/prompt.js';
import { buildHistory, applyToRequestChat, shouldReconstruct, interceptGeneration } from '../src/frontier.js';
import { armSolo, consumeSoloFlag, resolveSoloControl } from '../src/solo.js';

const NAMES = { name1: 'Mara', name2: 'Narrator' };
const MESSAGE_FIELDS = ['name', 'is_user', 'is_system', 'mes', 'extra'];

function makeState({ frozen = [], frontier = '' } = {}) {
  return { version: 1, frozen, frontier };
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
      frontier: 'C',
    });
    const history = buildHistory(state, NAMES);

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

  it('omits the frontier message when the frontier is blank, keeping the control turn last', () => {
    for (const frontier of ['', '   \n  ']) {
      const history = buildHistory(makeState({ frozen: [{ text: 'A' }], frontier }), NAMES);
      expect(history.map((m) => m.mes)).toEqual(['A', CONTINUATION_CONTROL]);
      expect(history[history.length - 1].is_user).toBe(true);
    }
  });

  it('passes the frontier through verbatim, without trimming or re-joining', () => {
    const frontier = 'Mara: one.\n\nNarration.\n';
    const history = buildHistory(makeState({ frontier }), NAMES);
    expect(history[0].mes).toBe(frontier);
  });

  it('never reads words or createdAt off a frozen span', () => {
    const history = buildHistory(makeState({ frozen: [{ text: 'A', words: 99, createdAt: 5 }] }), NAMES);
    expect(Object.keys(history[0]).sort()).toEqual([...MESSAGE_FIELDS].sort());
    expect(JSON.stringify(history)).not.toContain('99');
  });

  it('accepts an empty persona name without substituting a placeholder', () => {
    const history = buildHistory(makeState({ frontier: 'C' }), { name1: '', name2: '' });
    expect(history[0].name).toBe('');
    expect(history[1].name).toBe('');
  });

  it('returns [] for a blank state, a non-object state and a state without usable spans', () => {
    expect(buildHistory(makeState({ frozen: [], frontier: '   ' }), NAMES)).toEqual([]);
    expect(buildHistory(undefined, NAMES)).toEqual([]);
    expect(buildHistory('nonsense', NAMES)).toEqual([]);
    expect(buildHistory(makeState({ frozen: [{ text: '' }, {}] }), NAMES)).toEqual([]);
  });
});

describe('applyToRequestChat', () => {
  it('keeps array identity and pushes the very objects from the history', () => {
    const chat = [makeMessage({ mes: 'live' })];
    const history = buildHistory(makeState({ frontier: 'C' }), NAMES);
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
    const ctx = installWithState(makeState({ frontier: 'C' }));
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
    const ctx = installWithState(makeState({ frozen: [{ text: 'A' }], frontier: 'C' }));
    for (const type of ['normal', 'continue', 'regenerate', 'swipe', undefined, 'something_new']) {
      const chat = [makeMessage({ mes: 'live' })];
      expect(await interceptGeneration(chat, 4096, vi.fn(), type, ctx)).toBe(true);
      expect(chat.map((m) => m.mes)).toEqual(['A', 'C', CONTINUATION_CONTROL]);
    }
  });

  it('never calls abort and never persists, including for empty and malformed state', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const stored of [makeState(), { version: 1, frozen: 'nope' }, { version: 7, frozen: [], frontier: '' }]) {
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
    const visible = makeMessage({ name: 'Mara', mes: 'typed', extra: { [METADATA_KEY]: { captured: true } } });
    const ctx = installWithState(makeState({ frontier: 'C' }), [visible, makeAssistantMessage({ mes: 'reply' })]);
    const before = JSON.stringify(ctx.chat);

    await interceptGeneration([makeMessage({ mes: 'request' })], 4096, vi.fn(), 'normal', ctx);

    expect(JSON.stringify(ctx.chat)).toBe(before);
    expect(Object.is(ctx.chat[0], visible)).toBe(true);
  });

  // inv-10: many live histories, one output; byte comparison → docs/modules/frontier.md#inv-10
  it('produces byte-identical arrays from identical state over completely different live histories', async () => {
    const state = () => makeState({ frozen: [{ text: 'A', words: 1, createdAt: 1 }], frontier: 'C' });

    const longLog = [];
    for (let i = 0; i < 6; i += 1) {
      longLog.push(makeMessage({ name: 'Mara', mes: `typed ${i}`, extra: { [METADATA_KEY]: { captured: true } } }));
      longLog.push(makeAssistantMessage({ mes: `continued ${i}`, swipes: ['x'], swipe_id: 0 }));
    }

    const ctxA = installWithState(state(), longLog);
    const chatA = [makeMessage({ mes: 'request a' })];
    await interceptGeneration(chatA, 4096, vi.fn(), 'normal', ctxA);
    uninstall();

    const ctxB = installWithState(state(), [makeAssistantMessage({ mes: 'only one' })]);
    const chatB = [makeMessage({ mes: 'request b' })];
    await interceptGeneration(chatB, 128, vi.fn(), 'continue', ctxB);

    expect(JSON.stringify(chatA)).toBe(JSON.stringify(chatB));
    for (const message of chatA) {
      expect(Object.keys(message).sort()).toEqual([...MESSAGE_FIELDS].sort());
    }
  });

  it('emits exactly one user turn, last, whose mes is the continuation constant', async () => {
    const ctx = installWithState(makeState({ frozen: [{ text: 'A' }, { text: 'B' }], frontier: 'C' }));
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

describe('the interceptor global', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete globalThis[INTERCEPTOR_GLOBAL];
  });

  it('delegates to interceptGeneration', async () => {
    const ctx = installWithState(makeState({ frozen: [{ text: 'A' }], frontier: 'C' }));
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
  const soloState = () => makeState({ frozen: [{ text: 'A', words: 1, createdAt: 1 }], frontier: 'B' });

  it('uses options.control for the continuation turn and nothing else', () => {
    const history = buildHistory(soloState(), NAMES, { control: 'X' });
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
    for (const options of [undefined, {}, { control: '' }, { control: 42 }]) {
      const history = buildHistory(soloState(), NAMES, options);
      expect(history[history.length - 1].mes).toBe(CONTINUATION_CONTROL);
    }
  });

  it('applies the resolved solo text once and reverts on the next request', async () => {
    const ctx = installWithState(soloState());
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
    const ctx = installWithState(soloState());
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
    const ctx = installWithState(soloState());
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

  it('subscribes to no prompt-assembly event', () => {
    for (const name of [
      'CHAT_COMPLETION_PROMPT_READY',
      'GENERATE_AFTER_COMBINE_PROMPTS',
      'GENERATE_BEFORE_COMBINE_PROMPTS',
    ]) {
      expect(source).not.toContain(name);
    }
  });
});
