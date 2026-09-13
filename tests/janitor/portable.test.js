import { describe, it, expect } from 'vitest';
import { STATE_VERSION } from '../../src/constants.js';
import { exportStateJson, importStateJson } from '../../janitor/portable.js';
import { storedState, CHAT_ID, prose } from './fixtures/manuscript-turns.js';

const FULL = storedState({
  frozen: [{ text: prose('opening', 40), words: 480, createdAt: 11 }],
  units: [{ text: prose('unit', 20), words: 240, createdAt: 12 }],
  frozenIds: ['m0', 'm1'],
  watermark: { messageId: 'm2', offset: 240, prefixHash: 'deadbeef' },
  literal: 'Mara:',
  boundaries: ['m3'],
  pendingBoundaryAfter: 'm4',
  watermarkText: prose('watermark', 10),
});

describe('exporting a state', () => {
  it('wraps it with the kind, the chat id and a timestamp, and nothing else', () => {
    const parsed = JSON.parse(exportStateJson(CHAT_ID, FULL));

    expect(Object.keys(parsed).sort()).toEqual(['chatId', 'exportedAt', 'kind', 'state']);
    expect(parsed.kind).toBe('uid-janitor-state');
    expect(parsed.chatId).toBe(CHAT_ID);
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false);
  });
});

describe('importing a state', () => {
  it('round-trips a state deep-equal to the exported one', () => {
    const result = importStateJson(exportStateJson(CHAT_ID, FULL));

    expect(result.ok).toBe(true);
    expect(result.chatId).toBe(CHAT_ID);
    expect(result.state).toEqual(FULL);
  });

  it('returns the exported chat id for display without enforcing it', () => {
    const result = importStateJson(exportStateJson('some-other-chat', FULL));
    expect(result).toMatchObject({ ok: true, chatId: 'some-other-chat' });
  });

  it.each([
    ['unreadable', exportStateJson(CHAT_ID, FULL).slice(0, 40)],
    ['unreadable', '"a string"'],
    ['not-a-state', '{}'],
    ['not-a-state', JSON.stringify({ kind: 'uid-janitor-state', state: { ...FULL, frozenIds: 'm0' } })],
    ['not-a-state', JSON.stringify({ kind: 'uid-janitor-state', state: { ...FULL, watermark: null } })],
    ['wrong-format', JSON.stringify({ kind: 'uid-janitor-state', state: { ...FULL, janitorFormat: 99 } })],
    ['wrong-format', JSON.stringify({ kind: 'uid-janitor-state', state: { ...FULL, version: STATE_VERSION + 1 } })],
  ])('refuses whole with reason %s', (reason, text) => {
    expect(importStateJson(text)).toEqual({ ok: false, reason });
  });
});
