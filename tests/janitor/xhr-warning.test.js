import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const NATIVE_OPEN = XMLHttpRequest.prototype.open;

let installXhrWarning;
let opened;

beforeEach(async () => {
  vi.resetModules();
  opened = [];
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    opened.push({ method, url, self: this });
    return NATIVE_OPEN.call(this, method, url, ...rest);
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  ({ installXhrWarning } = await import('../../janitor/xhr-warning.js'));
  installXhrWarning();
});

afterEach(() => {
  XMLHttpRequest.prototype.open = NATIVE_OPEN;
});

describe('installXhrWarning', () => {
  it('warns once on a completion-shaped url and always calls through', () => {
    const first = new XMLHttpRequest();
    first.open('POST', 'https://relay.example.com/v1/chat/completions');
    const second = new XMLHttpRequest();
    second.open('POST', 'https://relay.example.com/v1/chat/completions');
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn.mock.calls[0][0]).toContain('degraded tier');
    expect(opened.map((call) => call.method)).toEqual(['POST', 'POST']);
  });

  it('stays silent on an ordinary request and calls through', () => {
    const request = new XMLHttpRequest();
    request.open('GET', 'https://janitorai.com/api/chats/chat-7f3');
    expect(console.warn).not.toHaveBeenCalled();
    expect(opened).toHaveLength(1);
    expect(opened[0].url).toBe('https://janitorai.com/api/chats/chat-7f3');
  });
});
