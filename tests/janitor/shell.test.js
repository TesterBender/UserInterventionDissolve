import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ALPHA_ENVELOPE_JSON, ALPHA_URL, PROXY_URL } from './fixtures/alpha-envelope.js';
import { CHAT_COMPLETION_JSON } from './fixtures/chat-completion.js';

const UPSTREAM_URL = 'https://relay.example.com/v1/chat/completions?stream=1';

let calls;
let shell;
let nextResponse;

function streamingResponse(chunks) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  const response = new Response(stream, {
    status: 201,
    statusText: 'Streaming',
    headers: { 'content-type': 'text/event-stream', 'x-trace': 'abc' },
  });
  Object.defineProperty(response, 'url', { value: UPSTREAM_URL, configurable: true });
  return response;
}

function jsonPost(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body };
}

async function bindRoute() {
  await window.fetch(ALPHA_URL, jsonPost(ALPHA_ENVELOPE_JSON));
  calls.length = 0;
}

beforeEach(async () => {
  vi.resetModules();
  window.history.pushState({}, '', '/chats/chat-7f3');
  calls = [];
  nextResponse = () => streamingResponse(['data: one\n\n', 'data: two\n\n']);
  window.fetch = async (resource, config) => {
    calls.push({ resource, config });
    return nextResponse();
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  shell = await import('../../janitor/shell.js');
});

describe('pass-through with a no-op transform', () => {
  beforeEach(() => {
    shell.installTransport(() => false);
  });

  it('forwards the generateAlpha envelope with the caller\'s own arguments', async () => {
    const config = jsonPost(ALPHA_ENVELOPE_JSON);
    await window.fetch(ALPHA_URL, config);
    expect(calls).toHaveLength(1);
    expect(calls[0].resource).toBe(ALPHA_URL);
    expect(calls[0].config).toBe(config);
    expect(calls[0].config.body).toBe(ALPHA_ENVELOPE_JSON);
  });

  it('forwards a completion body on the learned route byte for byte', async () => {
    await bindRoute();
    const config = jsonPost(CHAT_COMPLETION_JSON);
    await window.fetch(PROXY_URL, config);
    expect(calls).toHaveLength(1);
    expect(calls[0].config).toBe(config);
    expect(calls[0].config.body).toBe(CHAT_COMPLETION_JSON);
    expect(calls[0].config.body).not.toBe(JSON.stringify(JSON.parse(CHAT_COMPLETION_JSON)));
  });

  it('forwards a POST to a url that is not the learned route', async () => {
    await bindRoute();
    const config = jsonPost(CHAT_COMPLETION_JSON);
    await window.fetch('https://janitorai.com/api/analytics/collect', config);
    expect(calls[0].config).toBe(config);
    expect(calls[0].config.body).toBe(CHAT_COMPLETION_JSON);
  });

  it('forwards a non-POST request to the learned route', async () => {
    await bindRoute();
    const config = { method: 'GET', headers: { 'content-type': 'application/json' }, body: CHAT_COMPLETION_JSON };
    await window.fetch(PROXY_URL, config);
    expect(calls[0].config).toBe(config);
    expect(calls[0].config.body).toBe(CHAT_COMPLETION_JSON);
  });

  it('forwards a POST whose body is not JSON', async () => {
    await bindRoute();
    const config = { method: 'POST', body: 'model=gpt-test&stream=true' };
    await window.fetch(PROXY_URL, config);
    expect(calls[0].config).toBe(config);
    expect(calls[0].config.body).toBe('model=gpt-test&stream=true');
  });

  it('forwards a body that looks like JSON but does not parse', async () => {
    await bindRoute();
    const config = jsonPost('{"messages": [');
    await window.fetch(PROXY_URL, config);
    expect(calls[0].config).toBe(config);
  });

  it('forwards a JSON body that holds no completion request', async () => {
    await bindRoute();
    const config = jsonPost('{"event":"ping"}');
    await window.fetch(PROXY_URL, config);
    expect(calls[0].config).toBe(config);
  });

  it('reads the body of a Request resource without consuming it', async () => {
    await bindRoute();
    const request = new Request(PROXY_URL, jsonPost(CHAT_COMPLETION_JSON));
    await window.fetch(request);
    expect(calls[0].resource).toBe(request);
    expect(await request.text()).toBe(CHAT_COMPLETION_JSON);
  });
});

describe('re-serialise only when the transform reports a change', () => {
  it('dispatches JSON.stringify(data) when the transform returns truthy', async () => {
    shell.installTransport((data) => {
      data.messages[0].content = 'rewritten';
      return true;
    });
    await bindRoute();
    const config = jsonPost(CHAT_COMPLETION_JSON);
    await window.fetch(PROXY_URL, config);
    const sent = calls[0].config.body;
    expect(sent).not.toBe(CHAT_COMPLETION_JSON);
    expect(JSON.parse(sent).messages[0].content).toBe('rewritten');
    expect(sent).toBe(JSON.stringify(JSON.parse(sent)));
  });

  it('dispatches the original text when the transform mutates but returns falsy', async () => {
    shell.installTransport((data) => {
      data.messages[0].content = 'rewritten';
      return false;
    });
    await bindRoute();
    const config = jsonPost(CHAT_COMPLETION_JSON);
    await window.fetch(PROXY_URL, config);
    expect(calls[0].config).toBe(config);
    expect(calls[0].config.body).toBe(CHAT_COMPLETION_JSON);
  });

  it('preserves the rest of the caller\'s config when it re-serialises', async () => {
    shell.installTransport(() => true);
    await bindRoute();
    const signal = { aborted: false };
    const config = { ...jsonPost(CHAT_COMPLETION_JSON), signal, credentials: 'include' };
    await window.fetch(PROXY_URL, config);
    expect(calls[0].config.signal).toBe(signal);
    expect(calls[0].config.credentials).toBe('include');
    expect(calls[0].config.headers).toBe(config.headers);
  });

  it('hands the transform the recorded envelope plus the url and adapter', async () => {
    const seen = [];
    shell.installTransport((data, context) => {
      seen.push(context);
      return false;
    });
    await bindRoute();
    await window.fetch(PROXY_URL, jsonPost(CHAT_COMPLETION_JSON));
    expect(seen).toHaveLength(1);
    expect(seen[0].personaName).toBe('Mara');
    expect(seen[0].chatId).toBe('chat-7f3');
    expect(seen[0].url).toBe(PROXY_URL);
    expect(seen[0].adapter.kind).toBe('chat');
  });
});

describe('response wrapper', () => {
  beforeEach(async () => {
    shell.installTransport(() => false);
    await bindRoute();
  });

  it('forwards every chunk in order and keeps the response metadata', async () => {
    const response = await window.fetch(PROXY_URL, jsonPost(CHAT_COMPLETION_JSON));
    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Streaming');
    expect(response.headers.get('x-trace')).toBe('abc');
    expect(response.url).toBe(UPSTREAM_URL);
    expect(await response.text()).toBe('data: one\n\ndata: two\n\n');
  });

  it('cancels upstream when the caller cancels the wrapped body', async () => {
    let cancelledWith = null;
    nextResponse = () => new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode('x'));
        },
        cancel(reason) {
          cancelledWith = reason;
        },
      }),
      { status: 200 },
    );
    const response = await window.fetch(PROXY_URL, jsonPost(CHAT_COMPLETION_JSON));
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel('caller stopped');
    expect(cancelledWith).toBe('caller stopped');
  });

  it('returns a bodyless response as it arrived', async () => {
    const bodyless = new Response(null, { status: 204 });
    nextResponse = () => bodyless;
    const response = await window.fetch(PROXY_URL, jsonPost(CHAT_COMPLETION_JSON));
    expect(response).toBe(bodyless);
  });
});

describe('boot capture', () => {
  it('warns exactly once about a non-native fetch and installs anyway', async () => {
    shell.installTransport(() => false);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn.mock.calls[0][0]).toContain('Inject Mode: Instant');
    const config = jsonPost(ALPHA_ENVELOPE_JSON);
    await window.fetch(ALPHA_URL, config);
    expect(calls[0].config).toBe(config);
  });

  it('captures fetch once, so a second install is a no-op', async () => {
    shell.installTransport(() => false);
    const wrapper = window.fetch;
    shell.installTransport(() => true);
    expect(window.fetch).toBe(wrapper);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
