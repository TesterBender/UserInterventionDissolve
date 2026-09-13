import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { stateKey, loadJanitorState, saveJanitorState } from '../../janitor/storage.js';
import { STORAGE_KEY_PREFIX } from '../../janitor/constants.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

let warn;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('stateKey', () => {
  it('namespaces the chat id', () => {
    expect(stateKey('chat-7f3')).toBe(`${STORAGE_KEY_PREFIX}chat-7f3`);
  });
});

describe('loadJanitorState', () => {
  it('returns a fresh v3 state with the three Janitor fields when nothing is stored', () => {
    const state = loadJanitorState('chat-7f3', fakeStorage());
    expect(state).toEqual({
      version: 3,
      frozen: [],
      units: [],
      frozenIds: [],
      watermark: { messageId: null, offset: 0 },
      literal: '',
      boundaries: [],
      watermarkText: '',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('round-trips every stored field, including prefixHash on the watermark', () => {
    const storage = fakeStorage();
    const stored = {
      version: 3,
      frozen: [{ text: 'A final span.', words: 3, createdAt: 11 }],
      units: [{ text: 'An unsealed unit.', words: 3, createdAt: 12 }],
      frozenIds: ['a1b2c3d4#0'],
      watermark: { messageId: 'e5f6a7b8#1', offset: 17, prefixHash: '1a47e90b' },
      literal: 'Mara:',
      boundaries: ['a1b2c3d4#0'],
      watermarkText: 'The whole text of the watermark message.',
    };
    saveJanitorState('chat-7f3', stored, storage);
    expect(loadJanitorState('chat-7f3', storage)).toEqual(stored);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['a version 2 blob', JSON.stringify({ version: 2, frozen: [], frozenIds: [] })],
    ['a foreign JSON object', JSON.stringify({ notOurs: true })],
    ['an unparseable string', '{not json at all'],
  ])('replaces %s with a fresh state and warns exactly once', (_label, raw) => {
    const storage = fakeStorage({ [`${STORAGE_KEY_PREFIX}chat-7f3`]: raw });
    const state = loadJanitorState('chat-7f3', storage);
    expect(state.version).toBe(3);
    expect(state.frozen).toEqual([]);
    expect(state.watermarkText).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never migrates: the foreign value is not merged into the fresh state', () => {
    const storage = fakeStorage({
      [`${STORAGE_KEY_PREFIX}chat-7f3`]: JSON.stringify({ version: 2, frozen: [{ text: 'old' }] }),
    });
    expect(loadJanitorState('chat-7f3', storage).frozen).toEqual([]);
  });

  it.each([['', 'empty'], [undefined, 'missing']])('returns a fresh in-memory state for an %s chat id', (chatId) => {
    const storage = fakeStorage();
    expect(loadJanitorState(chatId, storage).version).toBe(3);
    expect(storage.map.size).toBe(0);
  });

  it('keys each chat separately', () => {
    const storage = fakeStorage();
    saveJanitorState('chat-a', { version: 3, literal: 'Mara:' }, storage);
    saveJanitorState('chat-b', { version: 3, literal: 'Ilse:' }, storage);
    expect(loadJanitorState('chat-a', storage).literal).toBe('Mara:');
    expect(loadJanitorState('chat-b', storage).literal).toBe('Ilse:');
  });
});

describe('saveJanitorState', () => {
  it('writes JSON under the namespaced key', () => {
    const storage = fakeStorage();
    saveJanitorState('chat-7f3', { version: 3, literal: 'Mara:' }, storage);
    expect(JSON.parse(storage.map.get(`${STORAGE_KEY_PREFIX}chat-7f3`))).toEqual({ version: 3, literal: 'Mara:' });
  });

  it('writes nothing for a missing chat id', () => {
    const storage = fakeStorage();
    saveJanitorState('', { version: 3 }, storage);
    expect(storage.map.size).toBe(0);
  });

  it('warns and does not throw when setItem throws', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    expect(() => saveJanitorState('chat-7f3', { version: 3 }, storage)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
