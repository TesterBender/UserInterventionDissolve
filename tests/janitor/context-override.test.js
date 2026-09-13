import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  overrideKey,
  loadOverride,
  saveOverride,
  clearOverride,
  overrideDrift,
} from '../../janitor/context-override.js';
import {
  JANITOR_OVERRIDE_KEY_PREFIX,
  JANITOR_OVERRIDE_FORMAT,
  STORAGE_KEY_PREFIX,
} from '../../janitor/constants.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHAT = 'chat-mx1';
const CAPTURED = 'Nyx is a lighthouse keeper.';
const TEXT = 'Nyx keeps a lighthouse on a cold coast.';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

let warn;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('overrideKey', () => {
  it('namespaces the chat id under its own prefix', () => {
    expect(overrideKey(CHAT)).toBe(`${JANITOR_OVERRIDE_KEY_PREFIX}${CHAT}`);
  });

  it('cannot be mistaken for a stored-state key by a prefix scan', () => {
    expect(overrideKey(CHAT).startsWith(STORAGE_KEY_PREFIX)).toBe(false);
  });
});

describe('saving and loading an override', () => {
  it('round-trips the text, the capture it was saved against and a timestamp', () => {
    const storage = fakeStorage();
    saveOverride(CHAT, TEXT, CAPTURED, storage);

    const loaded = loadOverride(CHAT, storage);
    expect(loaded).toMatchObject({
      janitorOverrideFormat: JANITOR_OVERRIDE_FORMAT,
      text: TEXT,
      capturedText: CAPTURED,
    });
    expect(loaded.savedAt).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('writes one entry and touches no other key', () => {
    const storage = fakeStorage();
    saveOverride(CHAT, TEXT, CAPTURED, storage);
    expect([...storage.map.keys()]).toEqual([overrideKey(CHAT)]);
  });

  it('keeps one entry per chat', () => {
    const storage = fakeStorage();
    saveOverride(CHAT, TEXT, CAPTURED, storage);
    saveOverride('chat-other', 'Another context.', CAPTURED, storage);

    expect(loadOverride(CHAT, storage).text).toBe(TEXT);
    expect(loadOverride('chat-other', storage).text).toBe('Another context.');
  });
});

describe('an empty override is not an override', () => {
  it.each(['', '   ', '\n', ' \t\n '])('removes the entry when the text is %j', (empty) => {
    const storage = fakeStorage();
    saveOverride(CHAT, TEXT, CAPTURED, storage);
    saveOverride(CHAT, empty, CAPTURED, storage);

    expect(storage.map.has(overrideKey(CHAT))).toBe(false);
    expect(loadOverride(CHAT, storage)).toBe(null);
  });
});

describe('clearing an override', () => {
  it('removes the entry and is not an error when none is there', () => {
    const storage = fakeStorage();
    saveOverride(CHAT, TEXT, CAPTURED, storage);
    clearOverride(CHAT, storage);
    expect(() => clearOverride(CHAT, storage)).not.toThrow();
    expect(loadOverride(CHAT, storage)).toBe(null);
  });
});

describe('storage refusals', () => {
  it('returns null without a warning when nothing is stored', () => {
    expect(loadOverride(CHAT, fakeStorage())).toBe(null);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['a value that is not JSON', 'not json at all'],
    ['a value that is not an object', '"a string"'],
    ['a null value', 'null'],
    ['another format', JSON.stringify({ janitorOverrideFormat: 99, text: TEXT, capturedText: CAPTURED })],
    ['a missing format', JSON.stringify({ text: TEXT, capturedText: CAPTURED })],
    ['a non-string text', JSON.stringify({ janitorOverrideFormat: JANITOR_OVERRIDE_FORMAT, text: 7 })],
    ['an empty text', JSON.stringify({ janitorOverrideFormat: JANITOR_OVERRIDE_FORMAT, text: '   ' })],
  ])('refuses %s whole, with one warning', (_label, raw) => {
    const storage = fakeStorage({ [overrideKey(CHAT)]: raw });
    expect(loadOverride(CHAT, storage)).toBe(null);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each(['', null, undefined, 7])('returns null for the chat id %j and writes nothing', (chatId) => {
    const storage = fakeStorage();
    expect(loadOverride(chatId, storage)).toBe(null);
    saveOverride(chatId, TEXT, CAPTURED, storage);
    expect(storage.map.size).toBe(0);
  });

  it('warns about a throwing write and never raises it at the caller', () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error('quota exceeded');
    };

    expect(() => saveOverride(CHAT, TEXT, CAPTURED, storage)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('drift against the captured unit', () => {
  it('is false without an override, whatever the capture is', () => {
    expect(overrideDrift(null, CAPTURED)).toBe(false);
    expect(overrideDrift(null, '')).toBe(false);
  });

  it('is false while Janitor\'s own text is byte-identical', () => {
    const storage = fakeStorage();
    saveOverride(CHAT, TEXT, CAPTURED, storage);
    expect(overrideDrift(loadOverride(CHAT, storage), CAPTURED)).toBe(false);
  });

  it.each([
    ['a changed sentence', `${CAPTURED} The lamp turned.`],
    ['a trailing space', `${CAPTURED} `],
    ['a trailing newline', `${CAPTURED}\n`],
    ['an empty capture', ''],
  ])('is true on %s — exact inequality, no folding', (_label, capture) => {
    const storage = fakeStorage();
    saveOverride(CHAT, TEXT, CAPTURED, storage);
    expect(overrideDrift(loadOverride(CHAT, storage), capture)).toBe(true);
  });

  it('changes nothing about the stored override', () => {
    const storage = fakeStorage();
    saveOverride(CHAT, TEXT, CAPTURED, storage);
    const before = storage.map.get(overrideKey(CHAT));

    overrideDrift(loadOverride(CHAT, storage), 'something else entirely');

    expect(storage.map.get(overrideKey(CHAT))).toBe(before);
    expect(loadOverride(CHAT, storage).text).toBe(TEXT);
  });
});

describe('the override module stays out of the DOM and off the other host', () => {
  it.each([
    'janitor/context-override.js',
    'janitor/constants.js',
    'janitor/status.js',
    'janitor/portable.js',
    'janitor/transform.js',
    'tests/janitor/context-override.test.js',
  ])('%s names no browser page global and not the extension host global', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const name of [['docu', 'ment'], ['win', 'dow'], ['Silly', 'Tavern']]) {
      expect(text).not.toMatch(new RegExp(`\\b${name.join('')}\\b`));
    }
  });
});
