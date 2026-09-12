import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeContext, uninstall, makeMessage } from './helpers/fake-context.js';
import { METADATA_KEY, STATE_VERSION, INTERCEPTOR_GLOBAL } from '../src/constants.js';
import {
  createState,
  initialiseFromChat,
  getState,
  setFrontier,
  appendToFrontier,
  pushFrozen,
  save,
} from '../src/state.js';
import * as stateModule from '../src/state.js';

const COMPLETE = 'Anton: he reaches for the lamp.';
const INCOMPLETE = 'Anton: he reaches for the';

describe('createState', () => {
  it('returns the documented shape and survives a JSON round trip', () => {
    const state = createState();
    expect(state).toEqual({ version: STATE_VERSION, frozen: [], frontier: '' });
    expect(STATE_VERSION).toBe(1);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('returns a fresh object every call', () => {
    expect(createState()).not.toBe(createState());
  });
});

describe('initialiseFromChat', () => {
  it('yields createState() for empty, missing and non-array input', () => {
    expect(initialiseFromChat([])).toEqual(createState());
    expect(initialiseFromChat(undefined)).toEqual(createState());
    expect(initialiseFromChat(null)).toEqual(createState());
  });

  it('joins every non-system non-blank message verbatim with one blank line', () => {
    const chat = [
      makeMessage({ mes: 'Mara: she opens the door.' }),
      makeMessage({ is_user: false, name: 'Anton', mes: '  Anton: he looks up.  ' }),
      makeMessage({ is_system: true, mes: 'SYSTEM: character loaded' }),
      makeMessage({ mes: '   ' }),
      makeMessage({ mes: '' }),
      makeMessage({ is_user: false, name: 'Anton', mes: 'The lamp is still burning.' }),
    ];
    const state = initialiseFromChat(chat);

    expect(state.frozen).toEqual([]);
    expect(state.version).toBe(STATE_VERSION);
    expect(state.frontier).toBe(
      'Mara: she opens the door.\n\nAnton: he looks up.\n\nThe lamp is still burning.',
    );
    expect(state.frontier).not.toContain('SYSTEM');
    expect(state.frontier).toBe(state.frontier.trim());
    expect(state.frontier).not.toMatch(/\n{3}/);
  });
});

describe('getState', () => {
  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
  });

  it('materialises the initialised state without saving', () => {
    const ctx = installFakeContext({ chat: [makeMessage({ mes: 'Mara: she waits.' })] });
    const state = getState(ctx);

    expect(ctx.chatMetadata[METADATA_KEY]).toBe(state);
    expect(state.frontier).toBe('Mara: she waits.');
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
  });

  it('is idempotent: same reference, no recompute from chat', () => {
    const ctx = installFakeContext({ chat: [makeMessage({ mes: 'Mara: she waits.' })] });
    const first = getState(ctx);
    setFrontier(first, 'edited frontier');
    ctx.chat.push(makeMessage({ mes: 'Mara: she leaves.' }));

    const second = getState(ctx);
    expect(second).toBe(first);
    expect(second.frontier).toBe('edited frontier');
  });

  it('returns the stored object, so mutations are storage', () => {
    const ctx = installFakeContext();
    const state = getState(ctx);

    setFrontier(state, 'one');
    appendToFrontier(state, 'two');
    pushFrozen(state, { text: COMPLETE });

    const stored = ctx.chatMetadata[METADATA_KEY];
    expect(stored.frontier).toBe('one\n\ntwo');
    expect(stored.frozen).toHaveLength(1);
  });

  it('defaults ctx to the live host context', () => {
    const ctx = installFakeContext({ chat: [makeMessage({ mes: 'Mara: she waits.' })] });
    expect(getState()).toBe(ctx.chatMetadata[METADATA_KEY]);
  });

  it('leaves an unknown version untouched and warns exactly once', () => {
    const foreign = { version: 99, spans: ['keep me'] };
    const ctx = installFakeContext({ chatMetadata: { [METADATA_KEY]: foreign } });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const state = getState(ctx);
    expect(state).toBe(foreign);
    expect(state).toEqual({ version: 99, spans: ['keep me'] });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('99');

    expect(getState(ctx)).toBe(foreign);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('warns for a missing version too, and never repairs it', () => {
    const foreign = { frontier: 'kept' };
    const ctx = installFakeContext({ chatMetadata: { [METADATA_KEY]: foreign } });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(getState(ctx)).toBe(foreign);
    expect(foreign).toEqual({ frontier: 'kept' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('setFrontier / appendToFrontier', () => {
  it('setFrontier replaces the frontier as a string', () => {
    const state = createState();
    setFrontier(state, 'Mara: she waits.');
    expect(state.frontier).toBe('Mara: she waits.');
    setFrontier(state, '');
    expect(state.frontier).toBe('');
  });

  it('appends with exactly one blank line, and nothing on an empty frontier', () => {
    const state = createState();
    appendToFrontier(state, 'Mara: she waits.');
    expect(state.frontier).toBe('Mara: she waits.');

    appendToFrontier(state, '  Anton: he answers.  ');
    expect(state.frontier).toBe('Mara: she waits.\n\nAnton: he answers.');

    setFrontier(state, 'Mara: she waits.\n\n\n  ');
    appendToFrontier(state, 'Anton: he answers.');
    expect(state.frontier).toBe('Mara: she waits.\n\nAnton: he answers.');
  });

  it('is a byte-identical no-op for blank, whitespace-only and nullish blocks', () => {
    const state = createState();
    setFrontier(state, 'Mara: she waits.');
    for (const block of ['', '   \n\t ', null, undefined]) {
      appendToFrontier(state, block);
      expect(state.frontier).toBe('Mara: she waits.');
    }
  });
});

describe('pushFrozen', () => {
  it('refuses missing, non-string, empty, whitespace-only and mid-block text', () => {
    const state = createState();
    for (const span of [
      {},
      { text: 42 },
      { text: null },
      { text: '' },
      { text: '   \n  ' },
      { text: INCOMPLETE },
    ]) {
      expect(pushFrozen(state, span)).toBe(false);
      expect(state.frozen).toHaveLength(0);
    }
  });

  it('accepts a complete trailing block and fills words and createdAt', () => {
    const state = createState();
    const before = Date.now();
    expect(pushFrozen(state, { text: COMPLETE })).toBe(true);

    expect(state.frozen).toHaveLength(1);
    const span = state.frozen[0];
    expect(span.text).toBe(COMPLETE);
    expect(span.words).toBe(6);
    expect(typeof span.createdAt).toBe('number');
    expect(span.createdAt).toBeGreaterThanOrEqual(before);
    expect(Object.keys(span).sort()).toEqual(['createdAt', 'text', 'words']);
  });

  it('preserves caller-supplied finite words and createdAt', () => {
    const state = createState();
    pushFrozen(state, { text: COMPLETE, words: 3000, createdAt: 1234 });
    expect(state.frozen[0]).toEqual({ text: COMPLETE, words: 3000, createdAt: 1234 });

    pushFrozen(state, { text: COMPLETE, words: Number.NaN, createdAt: Number.POSITIVE_INFINITY });
    expect(state.frozen[1].words).toBe(6);
    expect(Number.isFinite(state.frozen[1].createdAt)).toBe(true);
  });

  it('appends in call order and never removes', () => {
    const state = createState();
    pushFrozen(state, { text: 'one.' });
    pushFrozen(state, { text: 'two.' });
    pushFrozen(state, { text: 'three.' });
    expect(state.frozen.map((span) => span.text)).toEqual(['one.', 'two.', 'three.']);
  });

  it('exports no removal or replacement path', () => {
    expect(Object.keys(stateModule).sort()).toEqual([
      'appendToFrontier',
      'createState',
      'getState',
      'initialiseFromChat',
      'pushFrozen',
      'save',
      'setFrontier',
    ]);
  });
});

describe('save', () => {
  afterEach(() => uninstall());

  it('calls saveMetadata once and saveChat never', async () => {
    const ctx = installFakeContext();
    await save(ctx);
    expect(ctx.saveMetadata).toHaveBeenCalledTimes(1);
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });
});

describe('src/state.js host discipline', () => {
  it('never names the ST global', () => {
    const text = fs.readFileSync(path.resolve('src', 'state.js'), 'utf8');
    expect(text.includes('SillyTavern')).toBe(false);
  });
});

describe('index.js state materialisation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
    delete globalThis[INTERCEPTOR_GLOBAL];
  });

  it('materialises state once at load when a chat is already open', async () => {
    const ctx = installFakeContext({ chat: [makeMessage({ mes: 'Mara: she waits.' })] });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../index.js');

    const stored = ctx.chatMetadata[METADATA_KEY];
    expect(stored).toBeDefined();
    expect(stored.frontier).toBe('Mara: she waits.');
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
  });

  it('does not materialise state at load when no chat is open', async () => {
    const ctx = installFakeContext();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../index.js');
    expect(ctx.chatMetadata[METADATA_KEY]).toBeUndefined();
  });

  it('materialises state on CHAT_CHANGED with a chat id, and not with a nullish payload', async () => {
    const ctx = installFakeContext();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../index.js');

    await ctx.eventSource.emit(ctx.eventTypes.CHAT_CHANGED, null);
    expect(ctx.chatMetadata[METADATA_KEY]).toBeUndefined();
    await ctx.eventSource.emit(ctx.eventTypes.CHAT_CHANGED, undefined);
    expect(ctx.chatMetadata[METADATA_KEY]).toBeUndefined();

    ctx.chat.push(makeMessage({ mes: 'Mara: she waits.' }));
    await ctx.eventSource.emit(ctx.eventTypes.CHAT_CHANGED, 'chat-1');
    expect(ctx.chatMetadata[METADATA_KEY].frontier).toBe('Mara: she waits.');
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
  });
});
