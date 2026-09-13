import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let status;

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  status = await import('../../janitor/status.js');
  status.setStatusListener(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const WRITE = {
  chatId: 'chat-mx1',
  literal: 'Mara:',
  finals: 2,
  units: 1,
  frontierWords: 640,
  froze: true,
  rebuilt: false,
  stopSent: true,
  routerEnabled: false,
};

describe('the request status snapshot', () => {
  it('reports every field of the last transformed request', () => {
    status.setRequestStatus(WRITE);
    expect(status.getRequestStatus()).toMatchObject(WRITE);
    expect(status.getRequestStatus().at).toBeGreaterThan(0);
  });

  it('hands back a copy a renderer cannot write into', () => {
    status.noteDrift('chat-mx1', ['id-1']);
    status.setRequestStatus(WRITE);

    const taken = status.getRequestStatus();
    taken.finals = 99;
    taken.driftNotices.push('id-2');

    expect(status.getRequestStatus().finals).toBe(2);
    expect(status.getRequestStatus().driftNotices).toEqual(['id-1']);
  });

  it('notifies the single listener once per write', () => {
    const seen = [];
    status.setStatusListener((snapshot) => seen.push(snapshot.finals));
    status.setRequestStatus(WRITE);
    status.setRequestStatus({ ...WRITE, finals: 3 });

    expect(seen).toEqual([2, 3]);
  });

  it('replaces the listener on a second call and clears it on null', () => {
    const first = vi.fn();
    const second = vi.fn();
    status.setStatusListener(first);
    status.setStatusListener(second);
    status.setRequestStatus(WRITE);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    status.setStatusListener(null);
    status.setRequestStatus(WRITE);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('warns once about a throwing listener and keeps writing', () => {
    status.setStatusListener(() => {
      throw new Error('render failed');
    });
    status.setRequestStatus(WRITE);
    status.setRequestStatus({ ...WRITE, finals: 4 });

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(status.getRequestStatus().finals).toBe(4);
  });
});

describe('the drift-notice ledger', () => {
  it('notices an id exactly once per occurrence', () => {
    expect(status.noteDrift('chat-a', ['id-1'])).toBe(1);
    expect(status.noteDrift('chat-a', ['id-1'])).toBe(0);
    expect(status.noteDrift('chat-a', ['id-2'])).toBe(1);
    expect(status.getRequestStatus().driftNotices).toEqual(['id-1', 'id-2']);
  });

  it('starts clean when the chat id changes', () => {
    status.noteDrift('chat-a', ['id-1']);
    expect(status.noteDrift('chat-b', ['id-1'])).toBe(1);
    expect(status.getRequestStatus().driftNotices).toEqual(['id-1']);
  });

  it('never grows past the cap and drops the oldest', () => {
    for (let index = 0; index < 25; index += 1) status.noteDrift('chat-a', [`id-${index}`]);

    const notices = status.getRequestStatus().driftNotices;
    expect(notices).toHaveLength(20);
    expect(notices[0]).toBe('id-5');
    expect(notices.at(-1)).toBe('id-24');
  });
});
