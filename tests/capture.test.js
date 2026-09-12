import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeContext, uninstall, makeMessage, makeAssistantMessage } from './helpers/fake-context.js';
import { METADATA_KEY } from '../src/constants.js';
import { getState } from '../src/state.js';
import { deriveFrontier } from '../src/derive.js';
import { toManuscriptBlock, captureMessage } from '../src/capture.js';

const LITERAL = 'Mara:';

function installMara(overrides = {}) {
  return installFakeContext({
    name1: 'Mara',
    substituteParams: vi.fn((s) => (s === '{{user}}' ? 'Mara' : s)),
    ...overrides,
  });
}

function installWithUser(mes, extra) {
  const ctx = installMara();
  getState(ctx);
  ctx.chat.push(makeMessage({ name: 'Mara', mes, ...(extra === undefined ? {} : { extra }) }));
  return ctx;
}

function frontierOf(ctx) {
  return deriveFrontier(ctx.chat, getState(ctx), LITERAL).text;
}

afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

describe('toManuscriptBlock', () => {
  it('prefixes the reserved literal with a single space', () => {
    expect(toManuscriptBlock('sets the cup down. "No."', LITERAL)).toBe('Mara: sets the cup down. "No."');
  });

  it('leaves an already-tagged block byte-identical', () => {
    const text = 'Mara: sets the cup down.';
    expect(toManuscriptBlock(text, LITERAL)).toBe(text);
  });

  it('recognises the tag in case and space variants', () => {
    expect(toManuscriptBlock('mara: sets the cup down.', LITERAL)).toBe('mara: sets the cup down.');
    expect(toManuscriptBlock('Mara : sets the cup down.', LITERAL)).toBe('Mara : sets the cup down.');
  });

  it('leaves a tagged two-block input untouched, second block included', () => {
    const text = 'Mara: she stands.\n\nThe room settles.';
    expect(toManuscriptBlock(text, LITERAL)).toBe(text);
  });

  it('prefixes an untagged two-block input on the first block only', () => {
    expect(toManuscriptBlock('she stands.\n\nThe room settles.', LITERAL))
      .toBe('Mara: she stands.\n\nThe room settles.');
  });

  it('prefixes a block tagged with a different actor', () => {
    expect(toManuscriptBlock('Anton: he looks up.', LITERAL)).toBe('Mara: Anton: he looks up.');
  });

  it('returns the empty string for empty, blank, undefined and non-string input', () => {
    expect(toManuscriptBlock('', LITERAL)).toBe('');
    expect(toManuscriptBlock('   \n ', LITERAL)).toBe('');
    expect(toManuscriptBlock(undefined, LITERAL)).toBe('');
    expect(toManuscriptBlock(42, LITERAL)).toBe('');
  });

  it('returns trimmed text untagged when the literal is empty', () => {
    expect(toManuscriptBlock('  she stands.  ', '')).toBe('she stands.');
    expect(toManuscriptBlock('  she stands.  ', undefined)).toBe('she stands.');
  });
});

describe('captureMessage', () => {
  it('marks and ids the message, saves the chat once and metadata never', async () => {
    const ctx = installWithUser('sets the cup down.');
    const canonicalBefore = JSON.parse(JSON.stringify(ctx.chatMetadata[METADATA_KEY]));

    await expect(captureMessage(0, ctx)).resolves.toBe(true);

    expect(ctx.chat[0].extra[METADATA_KEY].captured).toBe(true);
    expect(typeof ctx.chat[0].extra[METADATA_KEY].id).toBe('string');
    expect(ctx.chatMetadata[METADATA_KEY]).toEqual(canonicalBefore);
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });

  it('leaves the visible message and the chat array untouched, and derives the block', async () => {
    const ctx = installWithUser('sets the cup down.  ');
    const before = ctx.chat[0].mes;

    await captureMessage(0, ctx);
    expect(ctx.chat[0].mes).toBe(before);
    expect(ctx.chat).toHaveLength(1);
    expect(frontierOf(ctx)).toBe('Mara: sets the cup down.');
  });

  it('ids every other message in the chat on the same save', async () => {
    const ctx = installWithUser('sets the cup down.');
    ctx.chat.unshift(makeAssistantMessage({ mes: 'he looks up.' }));

    await captureMessage(1, ctx);
    expect(typeof ctx.chat[0].extra[METADATA_KEY].id).toBe('string');
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });

  it('takes a fresh context when none is passed', async () => {
    const ctx = installWithUser('sets the cup down.');
    await expect(captureMessage(0)).resolves.toBe(true);
    expect(ctx.chat[0].extra[METADATA_KEY].captured).toBe(true);
  });

  it('ignores assistant, system, out-of-range and non-object entries', async () => {
    const ctx = installMara();
    ctx.chat.push(makeAssistantMessage({ mes: 'he looks up.' }));
    ctx.chat.push(makeMessage({ mes: 'the scene changes.', is_system: true }));
    ctx.chat.push(null);

    for (const index of [0, 1, 2, 9]) {
      await expect(captureMessage(index, ctx)).resolves.toBe(false);
    }
    expect(ctx.chat[0].extra[METADATA_KEY]).toBeUndefined();
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });

  it('refuses a message already marked captured', async () => {
    const ctx = installWithUser('sets the cup down.', { [METADATA_KEY]: { captured: true } });

    await expect(captureMessage(0, ctx)).resolves.toBe(false);
    expect(ctx.saveChat).not.toHaveBeenCalled();
  });

  it('marks and saves exactly once when called twice on the same message', async () => {
    const ctx = installWithUser('sets the cup down.');

    await captureMessage(0, ctx);
    await captureMessage(0, ctx);
    expect(frontierOf(ctx)).toBe('Mara: sets the cup down.');
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });

  it('accepts a blank message: it is marked and simply derives to nothing', async () => {
    for (const mes of ['', '   \n ']) {
      const ctx = installWithUser(mes);

      await expect(captureMessage(0, ctx)).resolves.toBe(true);
      expect(ctx.chat[0].extra[METADATA_KEY].captured).toBe(true);
      expect(frontierOf(ctx)).toBe('');
      uninstall();
    }
  });

  it('preserves a sibling flag in the same metadata namespace', async () => {
    const ctx = installWithUser('sets the cup down.', { [METADATA_KEY]: { boundary: true } });

    await captureMessage(0, ctx);
    const mark = ctx.chat[0].extra[METADATA_KEY];
    expect(mark.boundary).toBe(true);
    expect(mark.captured).toBe(true);
    expect(Object.keys(mark).sort()).toEqual(['boundary', 'captured', 'id']);
  });

  it('derives untagged when the persona name is empty', async () => {
    const ctx = installFakeContext({ name1: '', substituteParams: vi.fn((s) => s) });
    getState(ctx);
    ctx.chat.push(makeMessage({ mes: 'she stands.' }));

    await expect(captureMessage(0, ctx)).resolves.toBe(true);
    expect(deriveFrontier(ctx.chat, getState(ctx), '').text).toBe('she stands.');
  });

  it('re-tags from the current text when the message is edited afterwards', async () => {
    const ctx = installWithUser('sets the cup down.');
    await captureMessage(0, ctx);

    ctx.chat[0].mes = 'lifts the cup instead.';
    expect(frontierOf(ctx)).toBe('Mara: lifts the cup instead.');
  });
});

describe('MESSAGE_SENT subscription', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('produces the same effects as a direct call', async () => {
    const ctx = installMara();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();
    await import('../index.js');
    await ctx.eventSource.emit(ctx.eventTypes.CHAT_CHANGED, 'chat-1');

    ctx.chat.push(makeMessage({ name: 'Mara', mes: 'sets the cup down.' }));
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_SENT, 0);

    expect(frontierOf(ctx)).toBe('Mara: sets the cup down.');
    expect(ctx.chat[0].extra[METADATA_KEY].captured).toBe(true);
    expect(ctx.chat[0].mes).toBe('sets the cup down.');
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
    expect(ctx.saveChat).toHaveBeenCalledTimes(1);
  });

  it('subscribes only when MESSAGE_SENT is present on the event map', async () => {
    const eventTypes = { ...installMara().eventTypes };
    delete eventTypes.MESSAGE_SENT;
    uninstall();
    installMara({ eventTypes });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();
    await expect(import('../index.js')).resolves.toBeDefined();
  });
});

describe('src/capture.js', () => {
  it('names neither the ST global nor any character', () => {
    const text = fs.readFileSync(path.resolve('src', 'capture.js'), 'utf8');
    expect(text.includes('SillyTavern')).toBe(false);
    for (const name of ['Mara', 'Anton']) {
      expect(text.includes(name)).toBe(false);
    }
  });

  it('reads and writes no canonical state', () => {
    const text = fs.readFileSync(path.resolve('src', 'capture.js'), 'utf8');
    expect(text).not.toContain('state.js');
    expect(text).not.toContain('saveMetadata');
  });
});
