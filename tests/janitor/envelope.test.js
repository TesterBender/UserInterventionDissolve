import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ALPHA_ENVELOPE, PROXY_URL, ALPHA_URL } from './fixtures/alpha-envelope.js';

const OTHER_HOST_URL = 'https://other.example.com/v1/chat/completions';

let envelope;

function go(pathname) {
  window.history.pushState({}, '', pathname);
}

beforeEach(async () => {
  vi.resetModules();
  go('/chats/chat-7f3');
  envelope = await import('../../janitor/envelope.js');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('readEnvelope', () => {
  it('reads the persona from profile.name, never from profile.user_name', () => {
    const read = envelope.readEnvelope(ALPHA_ENVELOPE);
    expect(read.personaName).toBe('Mara');
    expect(ALPHA_ENVELOPE.profile.user_name).toBe('account_holder_92');
    expect(JSON.stringify(read)).not.toContain('account_holder_92');
  });

  it('falls back to the profiles entry whose id matches profile.id', () => {
    const data = { ...ALPHA_ENVELOPE, profile: { id: 'p-1' } };
    expect(envelope.readEnvelope(data).personaName).toBe('Mara');
  });

  it('records chat identity, generate type and prefill settings', () => {
    const read = envelope.readEnvelope(ALPHA_ENVELOPE);
    expect(read.chatId).toBe('chat-7f3');
    expect(read.characterId).toBe('char-22');
    expect(read.generateType).toBe('generate_alternative');
    expect(read.prefill).toEqual({ enabled: true, text: 'Continue:' });
    expect(read.janitorRouterEnabled).toBe(false);
  });

  it('parses the reverse proxy into url, host and path', () => {
    expect(envelope.readEnvelope(ALPHA_ENVELOPE).route).toEqual({
      url: PROXY_URL,
      host: 'relay.example.com',
      path: '/v1/chat/completions',
    });
  });

  it('records no route when no reverse proxy is configured', () => {
    const data = { ...ALPHA_ENVELOPE, userConfig: { ...ALPHA_ENVELOPE.userConfig, open_ai_reverse_proxy: '' } };
    expect(envelope.readEnvelope(data).route).toBe(null);
  });

  it('lists chatMessages by position with isMain and isBot flags', () => {
    expect(envelope.readEnvelope(ALPHA_ENVELOPE).chatMessages).toEqual([
      { position: 0, isMain: true, isBot: false, message: 'First human turn.' },
      { position: 1, isMain: true, isBot: true, message: 'First model turn.' },
      { position: 2, isMain: false, isBot: true, message: 'Discarded alternative.' },
    ]);
  });
});

describe('url gating', () => {
  it('recognises the alpha url and never targets it', () => {
    expect(envelope.isJanitorAlphaUrl(ALPHA_URL)).toBe(true);
    expect(envelope.isTargetedCompletion(ALPHA_URL)).toBe(false);
    envelope.recordEnvelope(ALPHA_ENVELOPE);
    expect(envelope.isTargetedCompletion(ALPHA_URL)).toBe(false);
  });

  it('requires the learned route once an envelope was recorded', () => {
    expect(envelope.isTargetedCompletion(OTHER_HOST_URL)).toBe(true);
    envelope.recordEnvelope(ALPHA_ENVELOPE);
    expect(envelope.isTargetedCompletion(PROXY_URL)).toBe(true);
    expect(envelope.isTargetedCompletion(OTHER_HOST_URL)).toBe(false);
    expect(envelope.isTargetedCompletion('https://relay.example.com/v1/models')).toBe(false);
  });

  it('matches a completion path under the configured base', () => {
    const data = {
      ...ALPHA_ENVELOPE,
      userConfig: { ...ALPHA_ENVELOPE.userConfig, open_ai_reverse_proxy: 'https://relay.example.com/proxy/' },
    };
    envelope.recordEnvelope(data);
    expect(envelope.routeMatches('https://relay.example.com/proxy/v1/chat/completions')).toBe(true);
    expect(envelope.routeMatches('https://relay.example.com/other/v1/chat/completions')).toBe(false);
  });

  it('keeps the record for this conversation once the url carries the chat id', () => {
    go('/chats/new');
    envelope.recordEnvelope(ALPHA_ENVELOPE);
    go('/chats/chat-7f3');
    expect(envelope.currentEnvelope().chatId).toBe('chat-7f3');
  });
});

describe('the 5 s bridge', () => {
  it('bridges a mid-flight url change and expires after ROUTE_BINDING_FALLBACK_MS', () => {
    vi.useFakeTimers();
    go('/chats/new');
    envelope.recordEnvelope(ALPHA_ENVELOPE);
    go('/somewhere-else');
    expect(envelope.currentEnvelope().personaName).toBe('Mara');
    expect(envelope.routeMatches(PROXY_URL)).toBe(true);
    vi.advanceTimersByTime(envelope.ROUTE_BINDING_FALLBACK_MS + 1);
    expect(envelope.currentEnvelope()).toBe(null);
    expect(envelope.routeMatches(PROXY_URL)).toBe(false);
  });

  it('falls back to the url pattern once nothing is bound any more', () => {
    vi.useFakeTimers();
    go('/chats/new');
    envelope.recordEnvelope(ALPHA_ENVELOPE);
    go('/somewhere-else');
    vi.advanceTimersByTime(envelope.ROUTE_BINDING_FALLBACK_MS + 1);
    expect(envelope.isTargetedCompletion(PROXY_URL)).toBe(true);
    expect(envelope.isTargetedCompletion('https://relay.example.com/v1/models')).toBe(false);
  });
});
