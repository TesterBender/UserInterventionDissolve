import { getCtx, requireKeys, EVENT } from './src/host.js';
import { LOG_PREFIX, INTERCEPTOR_GLOBAL, REQUIRED_KEYS } from './src/constants.js';
import { getState } from './src/state.js';
import {
  onGenerationStarted,
  onChatCompletionSettings,
  onTextCompletionSettings,
  onStreamToken,
  onMessageReceived,
} from './src/boundary.js';
import { captureMessage } from './src/capture.js';

// interceptor-placeholder: real no-op, body filled by frontier brief → docs/modules/bootstrap.md#interceptor-placeholder
// eslint-disable-next-line no-unused-vars
globalThis[INTERCEPTOR_GLOBAL] = async function (chat, contextSize, abort, type) {
  return;
};

let ready = false;

// load-time-init: called once at module top level, no polling → docs/modules/bootstrap.md#load-time-init
export function init() {
  if (ready) return;

  let ctx;
  try {
    ctx = getCtx();
  } catch {
    ctx = undefined;
  }
  const missing = ctx ? requireKeys(ctx, REQUIRED_KEYS) : REQUIRED_KEYS;
  if (ctx && missing.length === 0 && EVENT(ctx) === undefined) {
    missing.push('eventTypes/event_types');
  }

  if (!ctx || missing.length > 0) {
    console.error(`${LOG_PREFIX} missing required context: ${missing.join(', ') || 'no context'}`);
    return;
  }

  ready = true;
  console.log(`${LOG_PREFIX} ready`);

  // state-materialisation: one CHAT_CHANGED subscription plus one load-time call → docs/modules/bootstrap.md#state-materialisation
  const chatChanged = EVENT(ctx).CHAT_CHANGED;
  if (chatChanged !== undefined) {
    ctx.eventSource.on(chatChanged, (chatId) => {
      if (chatId === null || chatId === undefined) return;
      getState();
    });
  }
  if (Array.isArray(ctx.chat) && ctx.chat.length > 0) getState();

  // boundary-subscriptions: five guarded listeners, wiring only → docs/modules/bootstrap.md#boundary-subscriptions
  const E = EVENT(ctx);
  const boundaryHandlers = {
    GENERATION_STARTED: onGenerationStarted,
    CHAT_COMPLETION_SETTINGS_READY: onChatCompletionSettings,
    TEXT_COMPLETION_SETTINGS_READY: onTextCompletionSettings,
    STREAM_TOKEN_RECEIVED: onStreamToken,
    MESSAGE_RECEIVED: onMessageReceived,
  };
  const absent = [];
  for (const [name, handler] of Object.entries(boundaryHandlers)) {
    if (E[name] === undefined) {
      absent.push(name);
      continue;
    }
    ctx.eventSource.on(E[name], handler);
  }
  if (absent.length > 0) {
    console.warn(`${LOG_PREFIX} absent events: ${absent.join(', ')}`);
  }

  // capture-subscription: one guarded MESSAGE_SENT listener, wiring only → docs/modules/bootstrap.md#capture-subscription
  const messageSent = E.MESSAGE_SENT;
  if (messageSent !== undefined) {
    ctx.eventSource.on(messageSent, (index) => captureMessage(index));
  }
}

export function isReady() {
  return ready;
}

init();
