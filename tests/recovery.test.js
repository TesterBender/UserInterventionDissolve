import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeContext, uninstall, makeAssistantMessage, makeMessage } from './helpers/fake-context.js';
import { classifyOutcome, onMessageReceived, resetRecoveryState } from '../src/recovery.js';
import { onMessageReceived as boundaryMessageReceived, resetBoundaryState } from '../src/boundary.js';
import { createState } from '../src/state.js';
import { METADATA_KEY, LOG_PREFIX } from '../src/constants.js';
import { maybeFreeze } from '../src/freeze.js';

vi.mock('../src/freeze.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, maybeFreeze: vi.fn((...args) => actual.maybeFreeze(...args)) };
});

const SOURCE = fs.readFileSync(path.join(process.cwd(), 'src/recovery.js'), 'utf8');

function seed(ctx, frontier = '') {
  const state = createState();
  state.frontier = frontier;
  ctx.chatMetadata[METADATA_KEY] = state;
  return state;
}

let warnSpy;

beforeEach(() => {
  resetRecoveryState();
  resetBoundaryState();
  maybeFreeze.mockClear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  uninstall();
});

describe('classifyOutcome', () => {
  it('returns empty for nothing, whitespace, undefined and a non-string', () => {
    expect(classifyOutcome('', 'Mara:')).toBe('empty');
    expect(classifyOutcome('   \n ', 'Mara:')).toBe('empty');
    expect(classifyOutcome(undefined, 'Mara:')).toBe('empty');
    expect(classifyOutcome(null, 'Mara:')).toBe('empty');
  });

  it('returns empty even when the boundary marker is set', () => {
    expect(classifyOutcome('', 'Mara:', true)).toBe('empty');
    expect(classifyOutcome('  ', 'Mara:', true)).toBe('empty');
    expect(classifyOutcome(undefined, '', true)).toBe('empty');
  });

  it('returns boundary for any non-empty text when the marker is set', () => {
    expect(classifyOutcome('He waits.', 'Mara:', true)).toBe('boundary');
    expect(classifyOutcome('He turned and', '', true)).toBe('boundary');
  });

  it('returns boundary from the text when the marker is absent', () => {
    expect(classifyOutcome('He waits.\n\nMara:', 'Mara:')).toBe('boundary');
  });

  it('returns complete and incomplete from the trailing block', () => {
    expect(classifyOutcome('He waits.\n\nShe left.', 'Mara:')).toBe('complete');
    expect(classifyOutcome('He waits.\n\nShe turned and', 'Mara:')).toBe('incomplete');
  });

  it('is unchanged when the literal is empty', () => {
    expect(classifyOutcome('He waits.\n\nShe left.', '')).toBe('complete');
    expect(classifyOutcome('He waits.\n\nShe turned and', '')).toBe('incomplete');
  });
});

describe('onMessageReceived — rollback', () => {
  it('never rolls back a boundary outcome', async () => {
    const ctx = installFakeContext();
    seed(ctx, 'Earlier text.');
    const message = makeAssistantMessage({
      mes: 'She left.\n\nHe turned and',
      extra: { [METADATA_KEY]: { boundary: true } },
    });
    ctx.chat.push(message);

    const outcome = await onMessageReceived(0, 'normal');

    expect(outcome).toBe('boundary');
    expect(message.mes).toBe('She left.\n\nHe turned and');
    expect(ctx.updateMessageBlock).not.toHaveBeenCalled();
    expect(ctx.chatMetadata[METADATA_KEY].frontier).toBe('Earlier text.\n\nShe left.\n\nHe turned and');
  });

  it('truncates to the last complete block and repaints once', async () => {
    const ctx = installFakeContext();
    seed(ctx, 'Earlier text.');
    const message = makeAssistantMessage({
      mes: 'She left.\n\nHe turned and',
      swipes: ['She left.\n\nHe turned and'],
      swipe_id: 0,
    });
    ctx.chat.push(message);

    const outcome = await onMessageReceived(0, 'normal');

    expect(outcome).toBe('incomplete');
    expect(message.mes).toBe('She left.');
    expect(message.swipes[0]).toBe('She left.');
    expect(ctx.updateMessageBlock).toHaveBeenCalledTimes(1);
    expect(ctx.updateMessageBlock.mock.calls[0]).toHaveLength(2);
    expect(ctx.updateMessageBlock.mock.calls[0][0]).toBe(0);
    expect(ctx.updateMessageBlock.mock.calls[0][1]).toBe(message);
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
    expect(ctx.chatMetadata[METADATA_KEY].frontier.endsWith('She left.')).toBe(true);
  });

  it('keeps a message whose whole text rolls back to nothing', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    const message = makeAssistantMessage({ mes: 'He turned and' });
    ctx.chat.push(message);

    const outcome = await onMessageReceived(0, 'normal');

    expect(outcome).toBe('incomplete');
    expect(message.mes).toBe('');
    expect(ctx.chat).toHaveLength(1);
    expect(state.frontier).toBe('Earlier text.');
    expect(maybeFreeze).not.toHaveBeenCalled();
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });
});

describe('onMessageReceived — append', () => {
  it('appends a complete message exactly once and marks it', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    const message = makeAssistantMessage({ mes: '  She left.  ' });
    ctx.chat.push(message);

    const outcome = await onMessageReceived(0, 'normal');

    expect(outcome).toBe('complete');
    expect(state.frontier).toBe('Earlier text.\n\nShe left.');
    expect(message.extra[METADATA_KEY].appended).toBe(true);
    expect(message.extra[METADATA_KEY].appendedText).toBe('She left.');
    expect(ctx.saveMetadata).toHaveBeenCalledTimes(1);
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });

  it('does not append twice for a repeated event on the same index', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.' }));

    await onMessageReceived(0, 'normal');
    const second = await onMessageReceived(0, 'normal');

    expect(second).toBe('skipped');
    expect(state.frontier).toBe('Earlier text.\n\nShe left.');
    expect(state.frontier.match(/She left\./g)).toHaveLength(1);
    expect(ctx.saveMetadata).toHaveBeenCalledTimes(1);
  });

  it('writes nothing at all for an empty outcome', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    const message = makeAssistantMessage({ mes: '', extra: { [METADATA_KEY]: { boundary: true } } });
    ctx.chat.push(message);

    const outcome = await onMessageReceived(0, 'normal');

    expect(outcome).toBe('empty');
    expect(state.frontier).toBe('Earlier text.');
    expect(state.frozen).toEqual([]);
    expect(message.extra[METADATA_KEY].appended).toBeUndefined();
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });

  it('merges the marker with flags written by other modules', async () => {
    const ctx = installFakeContext();
    seed(ctx, '');
    const message = makeAssistantMessage({ mes: 'She left.', extra: { [METADATA_KEY]: { boundary: true } } });
    ctx.chat.push(message);

    await onMessageReceived(0, 'normal');

    expect(message.extra[METADATA_KEY]).toEqual({ boundary: true, appended: true, appendedText: 'She left.' });
  });
});

describe('onMessageReceived — swipes and regeneration', () => {
  it('replaces the trailing appended text on a swipe', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    const message = makeAssistantMessage({ mes: 'A sentence.' });
    ctx.chat.push(message);

    await onMessageReceived(0, 'normal');
    message.mes = 'B sentence.';
    await onMessageReceived(0, 'swipe');

    expect(state.frontier).toBe('Earlier text.\n\nB sentence.');
    expect(state.frontier).not.toContain('A sentence.');
    expect(message.extra[METADATA_KEY].appendedText).toBe('B sentence.');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('refuses to edit a frozen span and appends with one warning', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    const message = makeAssistantMessage({ mes: 'A sentence.' });
    ctx.chat.push(message);

    await onMessageReceived(0, 'normal');
    state.frozen.push({ text: 'Earlier text.\n\nA sentence.', words: 4, createdAt: 1 });
    state.frontier = 'Later text.';
    const frozenBefore = JSON.parse(JSON.stringify(state.frozen));

    message.mes = 'B sentence.';
    await onMessageReceived(0, 'swipe');

    expect(state.frozen).toEqual(frozenBefore);
    expect(state.frontier).toBe('Later text.\n\nB sentence.');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(LOG_PREFIX);
  });

  it('falls back to the session record when the marker carries no previous text', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    const message = makeAssistantMessage({ mes: 'A sentence.' });
    ctx.chat.push(message);

    await onMessageReceived(0, 'normal');
    message.extra[METADATA_KEY] = { appended: true };
    message.mes = 'B sentence.';
    await onMessageReceived(0, 'regenerate');

    expect(state.frontier).toBe('Earlier text.\n\nB sentence.');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('appends without warning when no previous append was recorded', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    ctx.chat.push(makeAssistantMessage({ mes: 'B sentence.' }));

    await onMessageReceived(0, 'regenerate');

    expect(state.frontier).toBe('Earlier text.\n\nB sentence.');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('onMessageReceived — freeze hook-up', () => {
  it('calls maybeFreeze once with the live state and the current literal', async () => {
    const ctx = installFakeContext({ name1: 'Mara' });
    const state = seed(ctx, 'Earlier text.');
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.' }));

    await onMessageReceived(0, 'normal');

    expect(maybeFreeze).toHaveBeenCalledTimes(1);
    expect(maybeFreeze.mock.calls[0][0]).toBe(state);
    expect(maybeFreeze.mock.calls[0][1]).toBe('Mara:');
  });

  it('saves metadata after a span was promoted inside maybeFreeze', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.' }));

    maybeFreeze.mockImplementationOnce((s) => {
      s.frozen.push({ text: s.frontier, words: 4, createdAt: 1 });
      s.frontier = '';
      return { frozenIndex: 0 };
    });
    let frozenAtSave = -1;
    ctx.saveMetadata = vi.fn(() => {
      frozenAtSave = state.frozen.length;
    });

    await onMessageReceived(0, 'normal');

    expect(frozenAtSave).toBe(1);
    expect(ctx.saveMetadata).toHaveBeenCalledTimes(1);
  });
});

describe('onMessageReceived — eligibility', () => {
  it('skips quiet, impersonate and first_message without reading the chat', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.' }));

    for (const type of ['quiet', 'impersonate', 'first_message']) {
      expect(await onMessageReceived(0, type)).toBe('skipped');
    }
    expect(state.frontier).toBe('Earlier text.');
    expect(ctx.saveChat).not.toHaveBeenCalled();
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
  });

  it('skips user, system, out-of-range and non-object entries', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    ctx.chat.push(makeMessage({ mes: 'She left.' }));
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.', extra: {} }));
    ctx.chat[1].is_system = true;
    ctx.chat.push('not an object');

    expect(await onMessageReceived(0, 'normal')).toBe('skipped');
    expect(await onMessageReceived(1, 'normal')).toBe('skipped');
    expect(await onMessageReceived(2, 'normal')).toBe('skipped');
    expect(await onMessageReceived(9, 'normal')).toBe('skipped');
    expect(state.frontier).toBe('Earlier text.');
  });

  it('processes an unknown type string', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.' }));

    expect(await onMessageReceived(0, 'command')).toBe('complete');
    expect(state.frontier).toBe('Earlier text.\n\nShe left.');
  });
});

describe('ordering with boundary', () => {
  it('classifies what boundary has already trimmed and marked', async () => {
    const ctx = installFakeContext({ name1: 'Mara' });
    const state = seed(ctx, 'Earlier text.');
    ctx.chat.push(makeAssistantMessage({ mes: 'He waits.\n\nMara:' }));

    let outcome;
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, boundaryMessageReceived);
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, async (index, type) => {
      outcome = await onMessageReceived(index, type);
    });
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, 0, 'normal');

    expect(outcome).toBe('boundary');
    expect(state.frontier).toBe('Earlier text.\n\nHe waits.');
    expect(state.frontier).not.toContain('Mara:');
  });
});

describe('abnormal termination', () => {
  it('changes nothing when a generation ends without a message', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx, 'Earlier text.');
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.' }));
    const chatBefore = JSON.parse(JSON.stringify(ctx.chat));

    await ctx.eventSource.emit(ctx.eventTypes.GENERATION_STOPPED);
    await ctx.eventSource.emit(ctx.eventTypes.GENERATION_ENDED, ctx.chat.length);

    expect(state.frontier).toBe('Earlier text.');
    expect(state.frozen).toEqual([]);
    expect(ctx.chat).toEqual(chatBefore);
    expect(ctx.saveChat).not.toHaveBeenCalled();
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
  });

  it('names no lifecycle event it must not subscribe to', () => {
    for (const name of ['GENERATION_STOPPED', 'GENERATION_ENDED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED']) {
      expect(SOURCE).not.toContain(name);
    }
  });
});

describe('source hygiene', () => {
  it('names neither the ST global nor any character', () => {
    expect(SOURCE).not.toContain('SillyTavern');
    expect(SOURCE).not.toContain('Mara');
    expect(SOURCE).not.toContain('Anton');
  });
});
