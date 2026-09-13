import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeContext, uninstall, makeMessage } from './helpers/fake-context.js';
import { METADATA_KEY, STATE_VERSION, INTERCEPTOR_GLOBAL, BLOCK_DELIMITER } from '../src/constants.js';
import { createState, pushFrozen, pushUnit, sealUnits, canPushSpan, advanceWatermark } from '../src/state.js';
import { getState, save } from '../src/state-host.js';
import { deriveFrontier } from '../src/derive.js';
import * as stateModule from '../src/state.js';
import * as stateHostModule from '../src/state-host.js';

const COMPLETE = 'Anton: he reaches for the lamp.';
const INCOMPLETE = 'Anton: he reaches for the';
const EMPTY_STATE = { version: 3, frozen: [], units: [], frozenIds: [], watermark: { messageId: null, offset: 0 } };

describe('createState', () => {
  it('returns the documented v3 shape and survives a JSON round trip', () => {
    const state = createState();
    expect(state).toEqual(EMPTY_STATE);
    expect(STATE_VERSION).toBe(3);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('returns a fresh object every call', () => {
    expect(createState()).not.toBe(createState());
  });

  it('has no frontier key, and no src/ file writes one', () => {
    expect('frontier' in createState()).toBe(false);

    const files = fs.readdirSync(path.resolve('src'), { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
      .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
    const hits = [];
    for (const file of files) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (/\.frontier\b/.test(line)) hits.push(`${path.basename(file)}: ${line.trim()}`);
      }
    }
    expect(hits.sort()).toEqual([
      'frontier.js: const frontier = typeof options?.frontier === \'string\' ? options.frontier : \'\';',
    ]);
  });
});

describe('getState', () => {
  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
  });

  it('materialises an empty state without reading the chat and without saving', () => {
    const ctx = installFakeContext({ chat: [makeMessage({ mes: 'Mara: she waits.' })] });
    const state = getState(ctx);

    expect(ctx.chatMetadata[METADATA_KEY]).toBe(state);
    expect(state).toEqual(EMPTY_STATE);
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
  });

  it('is idempotent: same reference, no recompute', () => {
    const ctx = installFakeContext({ chat: [makeMessage({ mes: 'Mara: she waits.' })] });
    const first = getState(ctx);
    pushFrozen(first, { text: COMPLETE });
    ctx.chat.push(makeMessage({ mes: 'Mara: she leaves.' }));

    const second = getState(ctx);
    expect(second).toBe(first);
    expect(second.frozen).toHaveLength(1);
  });

  it('returns the stored object, so mutations are storage', () => {
    const ctx = installFakeContext();
    const state = getState(ctx);

    pushFrozen(state, { text: COMPLETE });
    state.frozenIds.push('abc');

    const stored = ctx.chatMetadata[METADATA_KEY];
    expect(stored.frozen).toHaveLength(1);
    expect(stored.frozenIds).toEqual(['abc']);
  });

  it('defaults ctx to the live host context', () => {
    const ctx = installFakeContext({ chat: [makeMessage({ mes: 'Mara: she waits.' })] });
    expect(getState()).toBe(ctx.chatMetadata[METADATA_KEY]);
  });

  it('upgrades a stored v2 object in place, keeping its identity and its final spans', () => {
    const span = { text: 'Anton: he reaches for the lamp.', words: 6, createdAt: 1234 };
    const stored = { version: 2, frozen: [span], frozenIds: ['a'], watermark: { messageId: 'a', offset: 7 } };
    const ctx = installFakeContext({ chatMetadata: { [METADATA_KEY]: stored } });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const state = getState(ctx);

    expect(state).toBe(stored);
    expect(ctx.chatMetadata[METADATA_KEY]).toBe(stored);
    expect(state.version).toBe(3);
    expect(state.units).toEqual([]);
    expect(state.frozen).toEqual([span]);
    expect(state.frozen[0]).toBe(span);
    expect(state.frozenIds).toEqual(['a']);
    expect(state.watermark).toEqual({ messageId: 'a', offset: 7 });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(ctx.saveMetadata).not.toHaveBeenCalled();

    expect(getState(ctx)).toBe(stored);
    expect(state.units).toEqual([]);
  });

  it('discards an unknown version and replaces it with a fresh v3 state, warning exactly once', () => {
    const foreign = { version: 99, spans: ['keep me'] };
    const ctx = installFakeContext({ chatMetadata: { [METADATA_KEY]: foreign } });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const state = getState(ctx);
    expect(state).not.toBe(foreign);
    expect(state).toEqual(EMPTY_STATE);
    expect(ctx.chatMetadata[METADATA_KEY]).toBe(state);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('99');
    expect(ctx.saveMetadata).not.toHaveBeenCalled();

    expect(getState(ctx)).toBe(state);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('discards a missing version too, warning once, and calls no save', () => {
    const foreign = { frozen: [] };
    const ctx = installFakeContext({ chatMetadata: { [METADATA_KEY]: foreign } });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const state = getState(ctx);
    expect(state).not.toBe(foreign);
    expect(state).toEqual(EMPTY_STATE);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
  });

  it('discards a version: 1 structure too, starting that chat\'s protocol state over', () => {
    const stored = { version: 1, frozen: [{ text: 'old span.' }], frontier: 'stale text' };
    const ctx = installFakeContext({
      chat: [makeMessage({ name: 'Mara', mes: 'Mara: the second greeting.' })],
      chatMetadata: { [METADATA_KEY]: stored },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const state = getState(ctx);

    expect(state).not.toBe(stored);
    expect(state).toEqual(EMPTY_STATE);
    expect(deriveFrontier(ctx.chat, state, 'Mara:').text).toBe('Mara: the second greeting.');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).not.toHaveBeenCalled();
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

  it('exports no removal, replacement or frontier path', () => {
    expect(Object.keys(stateModule).sort()).toEqual([
      'advanceWatermark',
      'canPushSpan',
      'createState',
      'pushFrozen',
      'pushUnit',
      'sealUnits',
    ]);
  });

  it('keeps the host-bound pair in src/state-host.js', () => {
    expect(Object.keys(stateHostModule).sort()).toEqual(['getState', 'save']);
  });
});

describe('canPushSpan', () => {
  it('accepts a complete trailing block and refuses everything pushFrozen refuses', () => {
    expect(canPushSpan(COMPLETE)).toBe(true);
    for (const text of [undefined, null, 42, '', '  ', INCOMPLETE]) {
      expect(canPushSpan(text)).toBe(false);
      expect(pushFrozen(createState(), { text })).toBe(false);
    }
  });
});

describe('pushUnit', () => {
  it('appends to units, never to frozen, and fills words and createdAt', () => {
    const state = createState();
    const before = Date.now();
    expect(pushUnit(state, { text: COMPLETE })).toBe(true);

    expect(state.frozen).toEqual([]);
    expect(state.units).toHaveLength(1);
    expect(state.units[0].text).toBe(COMPLETE);
    expect(state.units[0].words).toBe(6);
    expect(state.units[0].createdAt).toBeGreaterThanOrEqual(before);
    expect(Object.keys(state.units[0]).sort()).toEqual(['createdAt', 'text', 'words']);
  });

  it('refuses blank and mid-block text exactly as pushFrozen does', () => {
    const state = createState();
    for (const unit of [{}, { text: 42 }, { text: '' }, { text: '   ' }, { text: INCOMPLETE }]) {
      expect(pushUnit(state, unit)).toBe(false);
      expect(state.units).toHaveLength(0);
    }
  });
});

describe('sealUnits', () => {
  it('returns null and changes nothing when there are no units', () => {
    const state = createState();
    expect(sealUnits(state)).toBeNull();
    expect(state).toEqual(createState());
  });

  it('keeps the units and returns false when the joined span is refused', () => {
    const state = createState();
    state.units.push({ text: INCOMPLETE, words: 5, createdAt: 1 });
    const before = JSON.parse(JSON.stringify(state));

    expect(sealUnits(state)).toBe(false);
    expect(state.units).toEqual(before.units);
    expect(state.frozen).toEqual([]);
  });

  it('joins the units into one final span, clears them and returns the new index', () => {
    const state = createState();
    pushUnit(state, { text: 'One.', words: 1 });
    pushUnit(state, { text: 'Two.', words: 1 });

    expect(sealUnits(state)).toBe(0);
    expect(state.units).toEqual([]);
    expect(state.frozen).toHaveLength(1);
    expect(state.frozen[0].text).toBe(`One.${BLOCK_DELIMITER}Two.`);
    expect(state.frozen[0].words).toBe(2);

    pushUnit(state, { text: 'Three.', words: 1 });
    expect(sealUnits(state)).toBe(1);
    expect(state.frozen[0].text).toBe(`One.${BLOCK_DELIMITER}Two.`);
    expect(state.frozen[1].text).toBe('Three.');
  });
});

describe('advanceWatermark', () => {
  it('appends consumed ids and replaces the watermark, returning nothing', () => {
    const state = createState();
    expect(advanceWatermark(state, { messageId: 'm1', offset: 12, consumedIds: ['a', 'b'] })).toBeUndefined();
    expect(state.frozenIds).toEqual(['a', 'b']);
    expect(state.watermark).toEqual({ messageId: 'm1', offset: 12 });

    advanceWatermark(state, { messageId: null, offset: 0, consumedIds: ['c'] });
    expect(state.frozenIds).toEqual(['a', 'b', 'c']);
    expect(state.watermark).toEqual({ messageId: null, offset: 0 });
  });

  it('never adds a duplicate, a null, an empty string or a non-string, and never removes one', () => {
    const state = createState();
    advanceWatermark(state, { messageId: 'm1', offset: 3, consumedIds: ['a', 'b'] });
    advanceWatermark(state, { messageId: 'm2', offset: 4, consumedIds: ['a', null, '', 7, undefined, 'b', 'c'] });

    expect(state.frozenIds).toEqual(['a', 'b', 'c']);
    expect(state.watermark).toEqual({ messageId: 'm2', offset: 4 });
  });

  it('normalises a missing id to null and a non-finite offset to zero', () => {
    const state = createState();
    advanceWatermark(state, { messageId: undefined, offset: undefined, consumedIds: [] });
    expect(state.watermark).toEqual({ messageId: null, offset: 0 });
    expect(state.frozenIds).toEqual([]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
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

    expect(ctx.chatMetadata[METADATA_KEY]).toEqual(EMPTY_STATE);
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
    expect(ctx.chatMetadata[METADATA_KEY]).toEqual(EMPTY_STATE);
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
  });

  it('discards a stored v1 structure when the chat is opened', async () => {
    const ctx = installFakeContext({
      chat: [makeMessage({ mes: 'Mara: she waits.' })],
      chatMetadata: { [METADATA_KEY]: { version: 1, frozen: [], frontier: 'stale text' } },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../index.js');

    expect(ctx.chatMetadata[METADATA_KEY]).toEqual(EMPTY_STATE);
  });
});

describe('index.js edit and swipe subscriptions', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
    delete globalThis[INTERCEPTOR_GLOBAL];
  });

  it('changes nothing and saves nothing on MESSAGE_EDITED, SWIPED and DELETED', async () => {
    const ctx = installFakeContext({ chat: [makeMessage({ mes: 'Mara: first.' })] });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../index.js');

    const before = JSON.stringify(ctx.chatMetadata);
    ctx.chat[0].mes = 'Mara: edited.';
    for (const name of [
      ctx.eventTypes.MESSAGE_SWIPED,
      ctx.eventTypes.MESSAGE_EDITED,
      ctx.eventTypes.MESSAGE_DELETED,
    ]) {
      await ctx.eventSource.emit(name, 0);
    }

    expect(JSON.stringify(ctx.chatMetadata)).toBe(before);
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });

  it('stays ready when the two events are absent, and never names MESSAGE_DELETED', async () => {
    const ctx = installFakeContext();
    delete ctx.eventTypes.MESSAGE_SWIPED;
    delete ctx.eventTypes.MESSAGE_EDITED;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('../index.js');

    expect(mod.isReady()).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('MESSAGE_EDITED, MESSAGE_SWIPED');

    expect(fs.readFileSync(path.resolve('index.js'), 'utf8')).not.toContain('MESSAGE_DELETED');
  });
});
