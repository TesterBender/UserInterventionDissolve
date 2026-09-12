import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeContext, uninstall, makeAssistantMessage, makeMessage } from './helpers/fake-context.js';
import { classifyOutcome, onMessageReceived } from '../src/recovery.js';
import { onMessageReceived as boundaryMessageReceived, resetBoundaryState } from '../src/boundary.js';
import { createState } from '../src/state.js';
import { deriveFrontier } from '../src/derive.js';
import { METADATA_KEY } from '../src/constants.js';

const SOURCE = fs.readFileSync(path.join(process.cwd(), 'src/recovery.js'), 'utf8');

function seed(ctx) {
  const state = createState();
  ctx.chatMetadata[METADATA_KEY] = state;
  return state;
}

function frontierOf(ctx, literal = '') {
  return deriveFrontier(ctx.chat, ctx.chatMetadata[METADATA_KEY], literal).text;
}

let warnSpy;

beforeEach(() => {
  resetBoundaryState();
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
    seed(ctx);
    const message = makeAssistantMessage({
      mes: 'She left.\n\nHe turned and',
      extra: { [METADATA_KEY]: { boundary: true } },
    });
    ctx.chat.push(message);

    const outcome = await onMessageReceived(0, 'normal');

    expect(outcome).toBe('boundary');
    expect(message.mes).toBe('She left.\n\nHe turned and');
    expect(frontierOf(ctx)).toBe('She left.\n\nHe turned and');
  });

  it('trims the reserved literal out of the message when boundary did not', async () => {
    const ctx = installFakeContext({ name1: 'Mara' });
    seed(ctx);
    const message = makeAssistantMessage({ mes: 'He waits.\n\nMara:', swipes: ['He waits.\n\nMara:'], swipe_id: 0 });
    ctx.chat.push(message);

    const outcome = await onMessageReceived(0, 'normal');

    expect(outcome).toBe('boundary');
    expect(message.mes).toBe('He waits.');
    expect(message.swipes[0]).toBe('He waits.');
    expect(ctx.updateMessageBlock).toHaveBeenCalledTimes(1);
    expect(frontierOf(ctx, 'Mara:')).toBe('He waits.');
    expect(frontierOf(ctx, 'Mara:')).not.toContain('Mara:');
  });

  it('treats a handoff-only message as the empty outcome', async () => {
    const ctx = installFakeContext({ name1: 'Mara' });
    seed(ctx);
    ctx.chat.push(makeAssistantMessage({ mes: 'Mara:' }));

    const outcome = await onMessageReceived(0, 'normal');

    expect(outcome).toBe('empty');
    expect(ctx.chat[0].mes).toBe('');
    expect(frontierOf(ctx, 'Mara:')).toBe('');
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
  });

  it('truncates to the last complete block and repaints once', async () => {
    const ctx = installFakeContext();
    seed(ctx);
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
    expect(frontierOf(ctx)).toBe('She left.');
  });

  it('keeps a message whose whole text rolls back to nothing', async () => {
    const ctx = installFakeContext();
    seed(ctx);
    const message = makeAssistantMessage({ mes: 'He turned and' });
    ctx.chat.push(message);

    const outcome = await onMessageReceived(0, 'normal');

    expect(outcome).toBe('incomplete');
    expect(message.mes).toBe('');
    expect(ctx.chat).toHaveLength(1);
    expect(frontierOf(ctx)).toBe('');
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });
});

describe('onMessageReceived — receipt', () => {
  it('ids a complete message and saves the chat only', async () => {
    const ctx = installFakeContext();
    seed(ctx);
    const message = makeAssistantMessage({ mes: '  She left.  ' });
    ctx.chat.push(message);

    const outcome = await onMessageReceived(0, 'normal');

    expect(outcome).toBe('complete');
    expect(frontierOf(ctx)).toBe('She left.');
    expect(message.extra[METADATA_KEY].appendedText).toBeUndefined();
    expect(typeof message.extra[METADATA_KEY].id).toBe('string');
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on a repeated receipt for the same index', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx);
    const message = makeAssistantMessage({ mes: 'She left.' });
    ctx.chat.push(message);

    const first = await onMessageReceived(0, 'normal');
    const idAfterFirst = message.extra[METADATA_KEY].id;
    const frontierAfterFirst = frontierOf(ctx);
    const frozenAfterFirst = JSON.parse(JSON.stringify(state.frozen));

    const second = await onMessageReceived(0, 'normal');

    expect(second).toBe(first);
    expect(message.mes).toBe('She left.');
    expect(message.extra[METADATA_KEY].id).toBe(idAfterFirst);
    expect(frontierOf(ctx)).toBe(frontierAfterFirst);
    expect(state.frozen).toEqual(frozenAfterFirst);
    expect(ctx.saveChat).toHaveBeenCalledTimes(2);
  });

  it('writes nothing at all for an empty outcome', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx);
    const message = makeAssistantMessage({ mes: '', extra: { [METADATA_KEY]: { boundary: true } } });
    ctx.chat.push(message);

    const outcome = await onMessageReceived(0, 'normal');

    expect(outcome).toBe('empty');
    expect(state.frozen).toEqual([]);
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });

  it('writes only the id, not a receipt marker', async () => {
    const ctx = installFakeContext();
    seed(ctx);
    const message = makeAssistantMessage({ mes: 'She left.', extra: { [METADATA_KEY]: { boundary: true } } });
    ctx.chat.push(message);

    await onMessageReceived(0, 'normal');

    const mark = message.extra[METADATA_KEY];
    expect(mark.boundary).toBe(true);
    expect(Object.keys(mark).sort()).toEqual(['boundary', 'id']);
  });

  it('ids every other message in the chat on the same save', async () => {
    const ctx = installFakeContext();
    seed(ctx);
    ctx.chat.push(makeMessage({ mes: 'Typed earlier.' }));
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.' }));

    await onMessageReceived(1, 'normal');
    expect(typeof ctx.chat[0].extra[METADATA_KEY].id).toBe('string');
  });
});

describe('onMessageReceived — swipes and regeneration', () => {
  it('derives the new sample with no replacement logic and no warning', async () => {
    const ctx = installFakeContext();
    seed(ctx);
    const message = makeAssistantMessage({ mes: 'A sentence.' });
    ctx.chat.push(message);

    await onMessageReceived(0, 'normal');
    message.mes = 'B sentence.';
    await onMessageReceived(0, 'swipe');

    expect(frontierOf(ctx)).toBe('B sentence.');
    expect(frontierOf(ctx)).not.toContain('A sentence.');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('rolls back an incomplete resample on a message already classified once', async () => {
    const ctx = installFakeContext();
    seed(ctx);
    const message = makeAssistantMessage({ mes: 'A sentence.' });
    ctx.chat.push(message);

    await onMessageReceived(0, 'normal');
    message.mes = 'B sentence.\n\nAnd then he';
    expect(await onMessageReceived(0, 'regenerate')).toBe('incomplete');

    expect(message.mes).toBe('B sentence.');
    expect(frontierOf(ctx)).toBe('B sentence.');
  });

  it('leaves a frozen span untouched when an older message is resampled', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx);
    const message = makeAssistantMessage({ mes: 'A sentence.' });
    ctx.chat.push(message);

    await onMessageReceived(0, 'normal');
    state.frozen.push({ text: 'Earlier text.\n\nA sentence.', words: 4, createdAt: 1 });
    state.frozenIds.push(message.extra[METADATA_KEY].id);
    const frozenBefore = JSON.parse(JSON.stringify(state.frozen));

    message.mes = 'B sentence.';
    await onMessageReceived(0, 'swipe');

    expect(state.frozen).toEqual(frozenBefore);
    expect(frontierOf(ctx)).toBe('');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('onMessageReceived — freeze hook-up', () => {
  function words(n, label) {
    const parts = [];
    for (let i = 0; i < n; i += 1) parts.push(`${label}${i}`);
    return `${parts.join(' ')}.`;
  }

  it('freezes nothing and saves no metadata on a short manuscript', async () => {
    const ctx = installFakeContext({ name1: 'Mara' });
    const state = seed(ctx);
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.' }));

    await onMessageReceived(0, 'normal');

    expect(state.frozen).toEqual([]);
    expect(state.frozenIds).toEqual([]);
    expect(state.watermark).toEqual({ messageId: null, offset: 0 });
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });

  it('freezes once against the derived frontier and saves metadata', async () => {
    const ctx = installFakeContext({ name1: 'Mara' });
    const state = seed(ctx);
    for (let i = 0; i < 60; i += 1) {
      ctx.chat.push(makeAssistantMessage({ mes: words(100, `b${i}w`) }));
    }

    await onMessageReceived(ctx.chat.length - 1, 'normal');

    expect(state.frozen).toHaveLength(1);
    expect(state.frozen[0].words).toBeGreaterThanOrEqual(3000);
    expect(state.frozenIds.length).toBeGreaterThan(0);
    expect(ctx.saveMetadata).toHaveBeenCalledTimes(1);

    const remainder = deriveFrontier(ctx.chat, state, '').text;
    expect(state.frozen[0].text.endsWith(remainder)).toBe(false);
    expect(remainder).not.toContain(state.frozen[0].text);
  });

  it('attempts a freeze once per receipt only', async () => {
    const ctx = installFakeContext({ name1: 'Mara' });
    const state = seed(ctx);
    for (let i = 0; i < 60; i += 1) {
      ctx.chat.push(makeAssistantMessage({ mes: words(100, `b${i}w`) }));
    }

    await onMessageReceived(ctx.chat.length - 1, 'normal');
    await onMessageReceived(ctx.chat.length - 1, 'normal');

    expect(state.frozen).toHaveLength(1);
    expect(ctx.saveMetadata).toHaveBeenCalledTimes(1);
  });
});

describe('onMessageReceived — eligibility', () => {
  it('skips quiet, impersonate and first_message without reading the chat', async () => {
    const ctx = installFakeContext();
    seed(ctx);
    const message = makeAssistantMessage({ mes: 'She left.' });
    ctx.chat.push(message);

    for (const type of ['quiet', 'impersonate', 'first_message']) {
      expect(await onMessageReceived(0, type)).toBe('skipped');
    }
    expect(message.extra[METADATA_KEY]).toBeUndefined();
    expect(ctx.saveChat).not.toHaveBeenCalled();
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
  });

  it('skips user, system, out-of-range and non-object entries', async () => {
    const ctx = installFakeContext();
    seed(ctx);
    ctx.chat.push(makeMessage({ mes: 'She left.' }));
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.', extra: {} }));
    ctx.chat[1].is_system = true;
    ctx.chat.push('not an object');

    expect(await onMessageReceived(0, 'normal')).toBe('skipped');
    expect(await onMessageReceived(1, 'normal')).toBe('skipped');
    expect(await onMessageReceived(2, 'normal')).toBe('skipped');
    expect(await onMessageReceived(9, 'normal')).toBe('skipped');
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });

  it('processes an unknown type string', async () => {
    const ctx = installFakeContext();
    seed(ctx);
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.' }));

    expect(await onMessageReceived(0, 'command')).toBe('complete');
    expect(frontierOf(ctx)).toBe('She left.');
  });
});

describe('ordering with boundary', () => {
  it('classifies what boundary has already trimmed and marked', async () => {
    const ctx = installFakeContext({ name1: 'Mara' });
    seed(ctx);
    ctx.chat.push(makeAssistantMessage({ mes: 'He waits.\n\nMara:' }));

    let outcome;
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, boundaryMessageReceived);
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, async (index, type) => {
      outcome = await onMessageReceived(index, type);
    });
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, 0, 'normal');

    expect(outcome).toBe('boundary');
    expect(frontierOf(ctx, 'Mara:')).toBe('He waits.');
    expect(frontierOf(ctx, 'Mara:')).not.toContain('Mara:');
  });
});

describe('abnormal termination', () => {
  it('changes nothing when a generation ends without a message', async () => {
    const ctx = installFakeContext();
    const state = seed(ctx);
    ctx.chat.push(makeAssistantMessage({ mes: 'She left.' }));
    const chatBefore = JSON.parse(JSON.stringify(ctx.chat));

    await ctx.eventSource.emit(ctx.eventTypes.GENERATION_STOPPED);
    await ctx.eventSource.emit(ctx.eventTypes.GENERATION_ENDED, ctx.chat.length);

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

  it('keeps no session-level record and saves metadata only through state', () => {
    expect(SOURCE).not.toContain('lastAppend');
    expect(SOURCE).not.toContain('appendedText');
    expect(SOURCE).not.toContain('saveMetadata');
    expect(SOURCE.match(/maybeFreeze\(/g)).toHaveLength(1);
  });
});
