import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeContext, uninstall, makeMessage, makeAssistantMessage } from './helpers/fake-context.js';
import { METADATA_KEY, INTERCEPTOR_GLOBAL } from '../src/constants.js';
import {
  reservedLiteral,
  applyStopStrings,
  findBoundary,
  trimAtBoundary,
} from '../src/boundary.js';
import {
  resetBoundaryState,
  suspendBoundary,
  onGenerationStarted,
  onChatCompletionSettings,
  onTextCompletionSettings,
  onStreamToken,
  onMessageReceived,
} from '../src/boundary-host.js';

const LITERAL = 'Mara:';

function installMara(overrides = {}) {
  return installFakeContext({
    name1: 'Mara',
    substituteParams: vi.fn((s) => (s === '{{user}}' ? 'Mara' : s)),
    ...overrides,
  });
}

beforeEach(() => {
  resetBoundaryState();
});

afterEach(() => {
  uninstall();
});

describe('applyStopStrings', () => {
  it('creates the chat stop array and returns the same body object', () => {
    const body = {};
    expect(applyStopStrings(body, LITERAL, 'chat')).toBe(body);
    expect(body.stop).toEqual([LITERAL]);
  });

  it('puts the literal first and keeps existing entries in order', () => {
    expect(applyStopStrings({ stop: ['a', 'b'] }, LITERAL, 'chat').stop).toEqual([LITERAL, 'a', 'b']);
  });

  it('moves an existing copy to index 0 without changing the length', () => {
    const body = { stop: ['x', LITERAL, 'y'] };
    applyStopStrings(body, LITERAL, 'chat');
    expect(body.stop).toEqual([LITERAL, 'x', 'y']);
    expect(body.stop).toHaveLength(3);
  });

  it('is idempotent', () => {
    const body = { stop: ['a'] };
    applyStopStrings(body, LITERAL, 'chat');
    applyStopStrings(body, LITERAL, 'chat');
    expect(body.stop).toEqual([LITERAL, 'a']);
  });

  it('writes both text-completion fields, creating either if absent', () => {
    const body = { stopping_strings: ['Anton:'] };
    applyStopStrings(body, LITERAL, 'text');
    expect(body.stopping_strings).toEqual([LITERAL, 'Anton:']);
    expect(body.stop).toEqual([LITERAL]);
  });

  it('replaces a non-array field with a fresh array', () => {
    const body = { stop: 'nope' };
    applyStopStrings(body, LITERAL, 'chat');
    expect(body.stop).toEqual([LITERAL]);
  });

  it('no-ops for an empty literal or a non-object body', () => {
    const body = {};
    applyStopStrings(body, '', 'chat');
    expect(body).toEqual({});
    expect(applyStopStrings(undefined, LITERAL, 'chat')).toBeUndefined();
    expect(applyStopStrings(null, LITERAL, 'chat')).toBeNull();
  });
});

describe('reservedLiteral', () => {
  it('is recomputed from the live context, never stored', () => {
    const ctx = installMara();
    expect(reservedLiteral(ctx)).toBe('Mara:');

    ctx.name1 = 'Nadia';
    ctx.substituteParams = vi.fn((s) => (s === '{{user}}' ? 'Nadia' : s));
    expect(reservedLiteral(ctx)).toBe('Nadia:');
  });

  it('falls back to name1 when substituteParams leaves the macro unexpanded', () => {
    const ctx = installFakeContext({ name1: 'Mara' });
    expect(reservedLiteral(ctx)).toBe('Mara:');
  });

  it('falls back to name1 when substituteParams throws, is missing or returns a non-string', () => {
    const throwing = installFakeContext({
      name1: 'Mara',
      substituteParams: vi.fn(() => {
        throw new Error('no macros');
      }),
    });
    expect(reservedLiteral(throwing)).toBe('Mara:');
    uninstall();

    const absent = installFakeContext({ name1: 'Mara', substituteParams: undefined });
    expect(reservedLiteral(absent)).toBe('Mara:');
    uninstall();

    const wrongType = installFakeContext({ name1: 'Mara', substituteParams: vi.fn(() => 42) });
    expect(reservedLiteral(wrongType)).toBe('Mara:');
  });

  it('returns an empty string for an empty persona name', () => {
    const ctx = installFakeContext({ name1: '' });
    expect(reservedLiteral(ctx)).toBe('');
  });
});

describe('an empty literal disables every handler', () => {
  it('installs no stop field, stops nothing and saves nothing', async () => {
    const ctx = installFakeContext({ name1: '', chat: [makeAssistantMessage({ mes: 'Mara: she waits.' })] });
    const body = {};

    onGenerationStarted('normal', {}, false);
    onChatCompletionSettings(body);
    onTextCompletionSettings(body);
    onStreamToken('Mara: she waits.');
    await onMessageReceived(0, 'normal');

    expect(body).toEqual({});
    expect(ctx.stopGeneration).not.toHaveBeenCalled();
    expect(ctx.saveChat).not.toHaveBeenCalled();
    expect(ctx.updateMessageBlock).not.toHaveBeenCalled();
    expect(ctx.chat[0].mes).toBe('Mara: she waits.');
  });
});

describe('findBoundary', () => {
  it('ignores an occurrence inside a block or inside dialogue', () => {
    expect(findBoundary('He turned. Mara: left.', LITERAL).index).toBe(-1);
    expect(findBoundary('"Mara: stop," he said.', LITERAL).index).toBe(-1);
  });

  it('returns the index of the block-start occurrence', () => {
    const text = 'He waits.\n\nMara: steps in.';
    expect(findBoundary(text, LITERAL).index).toBe(text.indexOf('Mara:'));
    expect(findBoundary(text, LITERAL).index).toBe(11);
  });

  it('reports endsAtLiteral only when nothing follows the literal', () => {
    expect(findBoundary('He waits.\n\nMara:', LITERAL).endsAtLiteral).toBe(true);
    expect(findBoundary('He waits.\n\nMara: ', LITERAL).endsAtLiteral).toBe(true);
    expect(findBoundary('He waits.\n\nMara: steps in.', LITERAL).endsAtLiteral).toBe(false);
  });

  it('has a no-op shape for a non-string text or an empty literal', () => {
    expect(findBoundary(undefined, LITERAL)).toEqual({ index: -1, endsAtLiteral: false });
    expect(findBoundary('Mara: steps in.', '')).toEqual({ index: -1, endsAtLiteral: false });
  });
});

describe('trimAtBoundary', () => {
  it('keeps everything before the boundary and drops trailing whitespace', () => {
    expect(trimAtBoundary('He waits.\n\nMara: steps in.', LITERAL)).toBe('He waits.');
  });

  it('returns the text unchanged when there is no boundary', () => {
    expect(trimAtBoundary('He turned. Mara: left.', LITERAL)).toBe('He turned. Mara: left.');
  });

  it('may legitimately return an empty string', () => {
    expect(trimAtBoundary('Mara: steps in.', LITERAL)).toBe('');
  });
});

describe('settings handlers', () => {
  it('install the literal on both request paths', () => {
    installMara();
    onGenerationStarted('normal', {}, false);

    const chatBody = { stop: ['Anton:'] };
    onChatCompletionSettings(chatBody);
    expect(chatBody.stop).toEqual([LITERAL, 'Anton:']);

    const textBody = {};
    onTextCompletionSettings(textBody);
    expect(textBody.stopping_strings).toEqual([LITERAL]);
    expect(textBody.stop).toEqual([LITERAL]);
  });

  it('skip quiet and impersonate generations', () => {
    installMara();
    for (const type of ['quiet', 'impersonate']) {
      onGenerationStarted(type, {}, false);
      const body = {};
      onChatCompletionSettings(body);
      onTextCompletionSettings(body);
      expect(body).toEqual({});
    }
  });

  it('act for unknown and unobserved generation types', () => {
    installMara();
    onGenerationStarted('command', {}, false);
    const known = {};
    onChatCompletionSettings(known);
    expect(known.stop).toEqual([LITERAL]);

    resetBoundaryState();
    const unobserved = {};
    onChatCompletionSettings(unobserved);
    expect(unobserved.stop).toEqual([LITERAL]);
  });

  it('skip a dry run', () => {
    installMara();
    onGenerationStarted('normal', {}, true);
    const body = {};
    onChatCompletionSettings(body);
    expect(body).toEqual({});
  });
});

describe('onStreamToken', () => {
  it('stops once per generation however many chunks carry the literal', () => {
    const ctx = installMara();
    onGenerationStarted('normal', {}, false);

    onStreamToken('He waits.\n\nMara');
    expect(ctx.stopGeneration).not.toHaveBeenCalled();

    onStreamToken('He waits.\n\nMara:');
    onStreamToken('He waits.\n\nMara: steps');
    onStreamToken('He waits.\n\nMara: steps in.');
    expect(ctx.stopGeneration).toHaveBeenCalledTimes(1);

    onGenerationStarted('normal', {}, false);
    onStreamToken('He waits.\n\nMara: steps in.');
    expect(ctx.stopGeneration).toHaveBeenCalledTimes(2);
  });

  it('ignores a mid-line occurrence', () => {
    const ctx = installMara();
    onGenerationStarted('normal', {}, false);
    onStreamToken('He turned. Mara: left.');
    expect(ctx.stopGeneration).not.toHaveBeenCalled();
  });

  it('never stops a quiet or impersonate generation', () => {
    const ctx = installMara();
    for (const type of ['quiet', 'impersonate']) {
      onGenerationStarted(type, {}, false);
      onStreamToken('He waits.\n\nMara: steps in.');
    }
    expect(ctx.stopGeneration).not.toHaveBeenCalled();
  });
});

describe('suspendBoundary', () => {
  it('suppresses both settings handlers while outstanding and restores them on resume', () => {
    installMara();
    onGenerationStarted('normal', {}, false);

    const resume = suspendBoundary();
    const chatBody = {};
    const textBody = {};
    onChatCompletionSettings(chatBody);
    onTextCompletionSettings(textBody);
    expect(chatBody).toEqual({});
    expect(textBody).toEqual({});

    resume();
    const afterChat = {};
    const afterText = {};
    onChatCompletionSettings(afterChat);
    onTextCompletionSettings(afterText);
    expect(afterChat.stop[0]).toBe(LITERAL);
    expect(afterText.stopping_strings[0]).toBe(LITERAL);
    expect(afterText.stop[0]).toBe(LITERAL);
  });

  it('counts overlapping suspensions and ignores a repeated resume of one handle', () => {
    installMara();
    onGenerationStarted('normal', {}, false);

    const first = suspendBoundary();
    const second = suspendBoundary();

    first();
    first();
    first();
    const stillSuspended = {};
    onChatCompletionSettings(stillSuspended);
    expect(stillSuspended).toEqual({});

    second();
    const released = {};
    onChatCompletionSettings(released);
    expect(released.stop).toEqual([LITERAL]);
  });

  it('never lets the counter go negative', () => {
    installMara();
    onGenerationStarted('normal', {}, false);

    suspendBoundary()();
    suspendBoundary()();

    const resume = suspendBoundary();
    const body = {};
    onChatCompletionSettings(body);
    expect(body).toEqual({});

    resume();
    const after = {};
    onChatCompletionSettings(after);
    expect(after.stop).toEqual([LITERAL]);
  });

  it('does not gate the stream-side stop', () => {
    const ctx = installMara();
    onGenerationStarted('normal', {}, false);

    suspendBoundary();
    onStreamToken('He waits.\n\nMara: steps in.');
    expect(ctx.stopGeneration).toHaveBeenCalledTimes(1);
  });

  it('does not suspend the receipt-side trim', async () => {
    const message = makeAssistantMessage({ mes: 'He waits.\n\nMara: steps in.' });
    const ctx = installMara({ chat: [message] });

    suspendBoundary();
    await onMessageReceived(0, 'normal');

    expect(message.mes).toBe('He waits.');
    expect(message.extra[METADATA_KEY].boundary).toBe(true);
    expect(ctx.updateMessageBlock).toHaveBeenCalledTimes(1);
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });

  it('is cleared by resetBoundaryState', () => {
    installMara();
    suspendBoundary();
    resetBoundaryState();

    const body = {};
    onChatCompletionSettings(body);
    expect(body.stop).toEqual([LITERAL]);
  });
});

describe('onMessageReceived', () => {
  it('trims the message and the active swipe, marks it, re-renders and saves', async () => {
    const message = makeAssistantMessage({
      mes: 'He waits.\n\nMara: steps in.',
      swipes: ['old swipe', 'He waits.\n\nMara: steps in.'],
      swipe_id: 1,
    });
    const ctx = installMara({ chat: [message] });

    await onMessageReceived(0, 'normal');

    expect(message.mes).toBe('He waits.');
    expect(message.swipes).toEqual(['old swipe', 'He waits.']);
    expect(message.extra[METADATA_KEY].boundary).toBe(true);
    expect(ctx.updateMessageBlock).toHaveBeenCalledTimes(1);
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });

  it('passes (index, message) with no third argument and the very object it mutated', async () => {
    const message = makeAssistantMessage({ mes: 'He waits.\n\nMara:' });
    const ctx = installMara({ chat: [makeMessage({ mes: 'Anton: he looks up.' }), message] });

    await onMessageReceived(1, undefined);

    const call = ctx.updateMessageBlock.mock.calls[0];
    expect(call).toHaveLength(2);
    expect(call[0]).toBe(1);
    expect(call[1]).toBe(message);
  });

  it('preserves other keys already under the extra namespace', async () => {
    const message = makeAssistantMessage({
      mes: 'Mara: steps in.',
      extra: { [METADATA_KEY]: { captured: 'yes' }, api: 'openai' },
    });
    installMara({ chat: [message] });

    await onMessageReceived(0, 'normal');

    expect(message.extra[METADATA_KEY]).toEqual({ captured: 'yes', boundary: true });
    expect(message.extra.api).toBe('openai');
  });

  it('leaves a user message untouched', async () => {
    const message = makeMessage({ mes: 'He waits.\n\nMara: steps in.' });
    const ctx = installMara({ chat: [message] });

    await onMessageReceived(0, 'normal');

    expect(message.mes).toBe('He waits.\n\nMara: steps in.');
    expect(message.extra).toEqual({});
    expect(ctx.saveChat).not.toHaveBeenCalled();
    expect(ctx.updateMessageBlock).not.toHaveBeenCalled();
  });

  it('leaves a message without a block-start literal untouched', async () => {
    const message = makeAssistantMessage({ mes: 'He turned. Mara: left.' });
    const ctx = installMara({ chat: [message] });

    await onMessageReceived(0, 'normal');

    expect(message.mes).toBe('He turned. Mara: left.');
    expect(message.extra).toEqual({});
    expect(ctx.saveChat).not.toHaveBeenCalled();
    expect(ctx.updateMessageBlock).not.toHaveBeenCalled();
  });

  it('skips quiet, impersonate and first_message', async () => {
    const ctx = installMara({
      chat: [
        makeAssistantMessage({ mes: 'Mara: steps in.' }),
        makeAssistantMessage({ mes: 'Mara: steps in.' }),
        makeAssistantMessage({ mes: 'Mara: steps in.' }),
      ],
    });

    await onMessageReceived(0, 'quiet');
    await onMessageReceived(1, 'impersonate');
    await onMessageReceived(2, 'first_message');

    expect(ctx.chat.map((m) => m.mes)).toEqual(['Mara: steps in.', 'Mara: steps in.', 'Mara: steps in.']);
    expect(ctx.saveChat).not.toHaveBeenCalled();
    expect(ctx.updateMessageBlock).not.toHaveBeenCalled();
  });

  it('leaves an empty message in chat[] when the whole output was the literal', async () => {
    const message = makeAssistantMessage({ mes: 'Mara: ', swipes: ['Mara: '], swipe_id: 0 });
    const ctx = installMara({ chat: [message] });

    await onMessageReceived(0, 'normal');

    expect(message.mes).toBe('');
    expect(message.swipes).toEqual(['']);
    expect(message.extra[METADATA_KEY].boundary).toBe(true);
    expect(ctx.chat).toHaveLength(1);
    expect(ctx.chat[0]).toBe(message);
    expect(ctx.updateMessageBlock).toHaveBeenCalledTimes(1);
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });

  it('ignores an index that holds no message object', async () => {
    const ctx = installMara({ chat: [] });
    await onMessageReceived(7, 'normal');
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });
});

describe('src/boundary.js hygiene', () => {
  it('names neither the ST global nor any character', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/boundary.js'), 'utf8');
    expect(source).not.toContain('SillyTavern');
    expect(source).not.toMatch(/Mara|Anton|Nadia/);
  });
});

describe('index.js boundary subscriptions', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
    delete globalThis[INTERCEPTOR_GLOBAL];
  });

  function subscribedNames(ctx) {
    const byId = new Map(Object.entries(ctx.eventTypes).map(([name, id]) => [id, name]));
    return ctx.eventSource.on.mock.calls.map(([id]) => byId.get(id));
  }

  it('registers the five boundary events beside the state subscription', async () => {
    const ctx = installMara();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(ctx.eventSource, 'on');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const module = await import('../index.js');

    expect(subscribedNames(ctx)).toEqual(expect.arrayContaining([
      'CHAT_CHANGED',
      'GENERATION_STARTED',
      'CHAT_COMPLETION_SETTINGS_READY',
      'TEXT_COMPLETION_SETTINGS_READY',
      'STREAM_TOKEN_RECEIVED',
      'MESSAGE_RECEIVED',
    ]));
    expect(warn).not.toHaveBeenCalled();

    expect(module.isReady()).toBe(true);
    module.init();
    expect(ctx.eventSource.on.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it('skips an absent event name and warns once', async () => {
    const eventTypes = { ...installFakeContext().eventTypes };
    uninstall();
    delete eventTypes.STREAM_TOKEN_RECEIVED;
    delete eventTypes.MESSAGE_RECEIVED;

    const ctx = installMara({ eventTypes });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(ctx.eventSource, 'on');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await import('../index.js');

    expect(subscribedNames(ctx)).toEqual(expect.arrayContaining([
      'CHAT_CHANGED',
      'GENERATION_STARTED',
      'CHAT_COMPLETION_SETTINGS_READY',
      'TEXT_COMPLETION_SETTINGS_READY',
    ]));
    expect(subscribedNames(ctx)).not.toContain('STREAM_TOKEN_RECEIVED');
    expect(subscribedNames(ctx)).not.toContain('MESSAGE_RECEIVED');
    expect(ctx.eventSource.on.mock.calls.map(([id]) => id)).not.toContain('stream_token_received');
    expect(ctx.eventSource.on.mock.calls.map(([id]) => id)).not.toContain('message_received');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('STREAM_TOKEN_RECEIVED, MESSAGE_RECEIVED');
  });

  it('drives the handlers end to end through the emitter', async () => {
    const message = makeAssistantMessage({ mes: 'He waits.\n\nMara: steps in.' });
    const ctx = installMara({ chat: [message] });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../index.js');

    await ctx.eventSource.emit(ctx.eventTypes.GENERATION_STARTED, 'normal', {}, false);
    const body = {};
    await ctx.eventSource.emit(ctx.eventTypes.CHAT_COMPLETION_SETTINGS_READY, body);
    expect(body.stop).toEqual([LITERAL]);

    await ctx.eventSource.emit(ctx.eventTypes.STREAM_TOKEN_RECEIVED, 'He waits.\n\nMara: steps in.');
    expect(ctx.stopGeneration).toHaveBeenCalledTimes(1);

    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, 0, 'normal');
    expect(message.mes).toBe('He waits.');
    expect(ctx.saveChat).toHaveBeenCalled();
  });
});
