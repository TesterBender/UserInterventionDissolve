import { describe, it, expect } from 'vitest';
import {
  isCompletionMessageArray,
  isJanitorAlphaRequestShape,
  locateCompletionRequest,
} from '../../janitor/shape.js';
import { ALPHA_ENVELOPE } from './fixtures/alpha-envelope.js';
import { CHAT_COMPLETION } from './fixtures/chat-completion.js';

describe('isCompletionMessageArray', () => {
  it('accepts an array of role + own content objects', () => {
    expect(isCompletionMessageArray(CHAT_COMPLETION.messages)).toBe(true);
  });

  it('rejects an empty array, a non-array, and entries missing role or content', () => {
    expect(isCompletionMessageArray([])).toBe(false);
    expect(isCompletionMessageArray('messages')).toBe(false);
    expect(isCompletionMessageArray([{ content: 'no role' }])).toBe(false);
    expect(isCompletionMessageArray([{ role: 'user' }])).toBe(false);
  });

  it('accepts an Anthropic-shaped body, which is why it classifies as chat', () => {
    const anthropic = { model: 'claude-test', system: 'top level system', messages: [{ role: 'user', content: 'hi' }] };
    expect(isCompletionMessageArray(anthropic.messages)).toBe(true);
    expect(locateCompletionRequest(anthropic).kind).toBe('chat');
  });
});

describe('isJanitorAlphaRequestShape', () => {
  it('accepts the envelope and rejects a body missing any of the four fields', () => {
    expect(isJanitorAlphaRequestShape(ALPHA_ENVELOPE)).toBe(true);
    expect(isJanitorAlphaRequestShape({ ...ALPHA_ENVELOPE, generateType: 7 })).toBe(false);
    expect(isJanitorAlphaRequestShape({ ...ALPHA_ENVELOPE, chatMessages: {} })).toBe(false);
    expect(isJanitorAlphaRequestShape(CHAT_COMPLETION)).toBe(false);
  });
});

describe('locateCompletionRequest', () => {
  it('reports the envelope with its userConfig as the request container', () => {
    const found = locateCompletionRequest(ALPHA_ENVELOPE);
    expect(found.kind).toBe('janitor-alpha');
    expect(found.requestContainer).toBe(ALPHA_ENVELOPE.userConfig);
    expect(found.janitorRoot).toBe(ALPHA_ENVELOPE);
  });

  it('takes the model sibling of the messages array (score 2)', () => {
    const found = locateCompletionRequest(CHAT_COMPLETION);
    expect(found).toEqual({
      kind: 'chat',
      messagesContainer: CHAT_COMPLETION,
      requestContainer: CHAT_COMPLETION,
      modelName: 'gpt-test',
    });
  });

  it('falls back to a model on an ancestor (score 1)', () => {
    const root = { model: 'gpt-test', payload: { messages: CHAT_COMPLETION.messages } };
    const found = locateCompletionRequest(root);
    expect(found.kind).toBe('chat');
    expect(found.messagesContainer).toBe(root.payload);
    expect(found.requestContainer).toBe(root);
  });

  it('returns null when no model names the request, and for a non-object', () => {
    expect(locateCompletionRequest({ messages: CHAT_COMPLETION.messages })).toBe(null);
    expect(locateCompletionRequest('{}')).toBe(null);
  });

  it('does not report a responses-shaped body', () => {
    expect(locateCompletionRequest({ model: 'gpt-test', input: 'write a scene' })).toBe(null);
  });
});
