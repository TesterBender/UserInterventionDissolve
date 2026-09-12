import { vi } from 'vitest';

function makeEventSource() {
  const listeners = new Map();
  return {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    off(name, fn) {
      const fns = listeners.get(name);
      if (!fns) return;
      const idx = fns.indexOf(fn);
      if (idx !== -1) fns.splice(idx, 1);
    },
    async emit(name, ...args) {
      const fns = listeners.get(name) || [];
      for (const fn of fns) {
        try {
          await fn(...args);
        } catch {
          // events: emit swallows listener errors → docs/api/sillytavern.md#events
        }
      }
    },
  };
}

function defaultContext() {
  return {
    chat: [],
    chatMetadata: {},
    eventSource: makeEventSource(),
    eventTypes: {
      APP_READY: 'app_ready',
      CHAT_CHANGED: 'chat_id_changed',
      MESSAGE_SENT: 'message_sent',
      MESSAGE_RECEIVED: 'message_received',
      GENERATION_STARTED: 'generation_started',
      GENERATION_ENDED: 'generation_ended',
      GENERATION_STOPPED: 'generation_stopped',
      CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
      TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready',
      CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
      STREAM_TOKEN_RECEIVED: 'stream_token_received',
    },
    name1: 'User',
    name2: 'Narrator',
    saveChat: vi.fn(),
    saveMetadata: vi.fn(),
    saveSettingsDebounced: vi.fn(),
    extensionSettings: {},
    substituteParams: vi.fn((s) => s),
    stopGeneration: vi.fn(),
    updateMessageBlock: vi.fn(),
  };
}

// message-shape: chat[] entry with ST's own defaults → docs/api/sillytavern.md#message-shape
export function makeMessage(overrides = {}) {
  return { name: 'User', is_user: true, is_system: false, mes: '', extra: {}, ...overrides };
}

// message-shape: assistant chat[] entry with its swipe array → docs/api/sillytavern.md#message-shape
export function makeAssistantMessage({ mes = '', swipes, swipe_id, extra } = {}) {
  const message = { name: 'Anton', is_user: false, is_system: false, mes, extra: extra ?? {} };
  if (swipes !== undefined) message.swipes = swipes;
  if (swipe_id !== undefined) message.swipe_id = swipe_id;
  return message;
}

let previous;

// fake-context-omit: undefined-valued override deletes the key → docs/modules/bootstrap.md#fake-context-omit
export function installFakeContext(overrides = {}) {
  previous = globalThis.SillyTavern;
  const ctx = defaultContext();
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete ctx[key];
    } else {
      ctx[key] = value;
    }
  }
  globalThis.SillyTavern = { getContext: () => ctx };
  return ctx;
}

export function uninstall() {
  globalThis.SillyTavern = previous;
}
