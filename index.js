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
import { interceptGeneration } from './src/frontier.js';
import { renderSettings, refreshReservedLiteral } from './src/ui/settings.js';
import { onMessageReceived as onRecoveryMessageReceived } from './src/recovery.js';

// interceptor-body: one delegating call, every decision lives in frontier → docs/modules/frontier.md#interceptor-body
globalThis[INTERCEPTOR_GLOBAL] = async function (chat, contextSize, abort, type) {
  return interceptGeneration(chat, contextSize, abort, type);
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
      // settings-drawer-wiring: status refresh runs ahead of the nullish guard → docs/modules/bootstrap.md#settings-drawer-wiring
      refreshReservedLiteral(getCtx());
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
    // recovery-subscription: recovery runs after boundary on one event → docs/modules/bootstrap.md#recovery-subscription
    MESSAGE_RECEIVED: async (...args) => {
      await onMessageReceived(...args);
      await onRecoveryMessageReceived(...args);
    },
    // capture-subscription: MESSAGE_SENT joins the same guarded loop → docs/modules/bootstrap.md#capture-subscription
    MESSAGE_SENT: (index) => captureMessage(index),
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

  renderSettings(ctx);
}

export function isReady() {
  return ready;
}

init();
