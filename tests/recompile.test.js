import { describe, it, expect, vi, afterEach } from 'vitest';
import { recompile, formatRecompileSummary } from '../src/recompile.js';
import { createState } from '../src/state.js';
import { installFakeContext, uninstall, makeAssistantMessage, makeMessage } from './helpers/fake-context.js';
import { METADATA_KEY, FREEZE_MIN_WORDS } from '../src/constants.js';

function buf(n, label = 'w') {
  const parts = [];
  for (let i = 0; i < n; i += 1) parts.push(`${label}${i}`);
  return `${parts.join(' ')}.`;
}

function block(actor, words, label) {
  return `${actor}: ${buf(words - 1, label)}`;
}

function longChat() {
  const chat = [];
  for (let i = 0; i < 20; i += 1) {
    chat.push(makeAssistantMessage({ mes: block('Anton', 400, `m${i}w`) }));
  }
  return chat;
}

function snapshot(chat) {
  return chat.map((m) => ({ mes: m.mes, is_user: m.is_user, swipes: m.swipes, name: m.name }));
}

afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

describe('recompile resets canonical state', () => {
  it('leaves an empty chat with exactly a fresh state and saves once', async () => {
    const ctx = installFakeContext({
      chatMetadata: {
        [METADATA_KEY]: {
          version: 2,
          frozen: [{ text: 'Anton: old.', words: 2, createdAt: 1 }],
          frozenIds: ['abcd1234'],
          watermark: { messageId: 'abcd1234', offset: 11 },
        },
      },
    });

    await expect(recompile(ctx)).resolves.toEqual({ spans: 0, words: 0 });
    expect(ctx.chatMetadata[METADATA_KEY]).toEqual(createState());
    expect(ctx.saveMetadata).toHaveBeenCalledTimes(1);
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });

  it('discards pre-existing spans before rebuilding', async () => {
    const ctx = installFakeContext({ chat: longChat() });
    ctx.chatMetadata[METADATA_KEY] = {
      version: 2,
      frozen: [{ text: 'Anton: stale span.', words: 3, createdAt: 1 }],
      frozenIds: [],
      watermark: { messageId: null, offset: 0 },
    };

    await recompile(ctx);
    const state = ctx.chatMetadata[METADATA_KEY];
    expect(state.version).toBe(createState().version);
    expect(state.frozen.some((span) => span.text.includes('stale span'))).toBe(false);
  });
});

describe('recompile rebuilds spans from the chat as it stands', () => {
  it('freezes an 8,000-word chat into at least two spans and terminates', async () => {
    const ctx = installFakeContext({ chat: longChat() });

    const result = await recompile(ctx);
    const state = ctx.chatMetadata[METADATA_KEY];
    expect(result.spans).toBeGreaterThanOrEqual(2);
    expect(state.frozen).toHaveLength(result.spans);
    expect(result.words).toBe(state.frozen.reduce((t, s) => t + s.words, 0));
    for (const span of state.frozen) expect(span.words).toBeGreaterThanOrEqual(FREEZE_MIN_WORDS);
  });

  it('is idempotent: a second run on an unchanged chat gives the same spans', async () => {
    const ctx = installFakeContext({ chat: longChat() });

    const first = await recompile(ctx);
    const firstTexts = ctx.chatMetadata[METADATA_KEY].frozen.map((s) => s.text);
    const second = await recompile(ctx);
    const secondTexts = ctx.chatMetadata[METADATA_KEY].frozen.map((s) => s.text);

    expect(second).toEqual(first);
    expect(secondTexts).toEqual(firstTexts);
  });

  it('freezes nothing and still saves when every candidate is too short', async () => {
    const ctx = installFakeContext({
      chat: [makeAssistantMessage({ mes: block('Anton', 12) }), makeMessage({ mes: 'A short reply.' })],
    });

    await expect(recompile(ctx)).resolves.toEqual({ spans: 0, words: 0 });
    expect(ctx.chatMetadata[METADATA_KEY].frozen).toHaveLength(0);
    expect(ctx.saveMetadata).toHaveBeenCalledTimes(1);
  });

  it('saves metadata exactly once per call on a chat that does freeze', async () => {
    const ctx = installFakeContext({ chat: longChat() });
    await recompile(ctx);
    expect(ctx.saveMetadata).toHaveBeenCalledTimes(1);
  });

  it('reads the context through getContext when called with no argument', async () => {
    const ctx = installFakeContext({ chat: longChat() });
    const result = await recompile();
    expect(result.spans).toBeGreaterThanOrEqual(2);
    expect(ctx.saveMetadata).toHaveBeenCalledTimes(1);
  });

  it('raises no toast and logs nothing', async () => {
    const ctx = installFakeContext({ chat: longChat() });
    const toastr = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
    globalThis.toastr = toastr;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await recompile(ctx);

    expect(toastr.success).not.toHaveBeenCalled();
    expect(toastr.info).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    delete globalThis.toastr;
  });
});

describe('recompile leaves the visible chat alone', () => {
  it('changes no message text, flag, swipe or order, and keeps existing ids', async () => {
    const chat = longChat();
    for (let i = 0; i < chat.length; i += 1) {
      chat[i].extra[METADATA_KEY] = { id: `id${i}` };
    }
    chat[3].swipes = [chat[3].mes, 'another'];
    chat[3].swipe_id = 0;
    const ctx = installFakeContext({ chat });
    const before = snapshot(chat);

    await recompile(ctx);

    expect(snapshot(ctx.chat)).toEqual(before);
    expect(ctx.chat[3].swipes).toEqual([before[3].mes, 'another']);
    expect(ctx.chat.map((m) => m.extra[METADATA_KEY].id)).toEqual(chat.map((_, i) => `id${i}`));
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });

  it('fills missing ids once and saves the chat exactly in that case', async () => {
    const chat = longChat();
    chat[0].extra[METADATA_KEY] = { id: 'keepme' };
    const ctx = installFakeContext({ chat });

    await recompile(ctx);

    expect(ctx.chat[0].extra[METADATA_KEY].id).toBe('keepme');
    for (const message of ctx.chat) expect(typeof message.extra[METADATA_KEY].id).toBe('string');
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);

    ctx.saveChat.mockClear();
    await recompile(ctx);
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });
});

describe('formatRecompileSummary', () => {
  it('produces the pinned line with grouped thousands', () => {
    expect(formatRecompileSummary({ spans: 2, words: 7940 })).toBe('Recompiled: 2 spans, 7,940 words frozen');
  });

  it('uses the singular for a count of one', () => {
    expect(formatRecompileSummary({ spans: 1, words: 1 })).toBe('Recompiled: 1 span, 1 word frozen');
  });

  it('reports zero plainly', () => {
    expect(formatRecompileSummary({ spans: 0, words: 0 })).toBe('Recompiled: 0 spans, 0 words frozen');
  });

  it('groups every thousands boundary and is independent of host locale', () => {
    expect(formatRecompileSummary({ spans: 1000, words: 1234567 })).toBe(
      'Recompiled: 1,000 spans, 1,234,567 words frozen',
    );
  });
});
