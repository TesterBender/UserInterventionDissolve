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
import { interceptGeneration } from './src/frontier.js';
import { armSolo, consumeSoloFlag } from './src/solo.js';
import { renderSettings, refreshReservedLiteral } from './src/ui/settings.js';
import { onMessageReceived as onRecoveryMessageReceived } from './src/recovery.js';
import { noticeFrozenEdit } from './src/freeze.js';

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
    // frozen-edit-notice: edit and swipe carry the notice and nothing else → docs/modules/bootstrap.md#no-edit-subscriptions
    MESSAGE_EDITED: (id) => noticeFrozenEdit(id),
    MESSAGE_SWIPED: (id) => noticeFrozenEdit(id),
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

  // slash-commands: one guarded registration, warn and skip when absent → docs/modules/bootstrap.md#slash-commands
  const { SlashCommandParser, SlashCommand } = ctx;
  if (SlashCommandParser === undefined || SlashCommand === undefined || ctx.generate === undefined) {
    console.warn(`${LOG_PREFIX} slash commands unavailable: /uidsolo not registered`);
  } else {
    SlashCommandParser.addCommandObject(
      SlashCommand.fromProps({
        name: 'uidsolo',
        callback: soloCallback,
        helpString: 'Continue once with your figure present in the scene but not written.',
        returns: 'nothing',
      }),
    );
  }

  renderSettings(ctx);
}

// solo-callback: arm, generate, clear the flag if the run never starts → docs/modules/bootstrap.md#slash-commands
async function soloCallback() {
  armSolo();
  try {
    await getCtx().generate('normal');
  } catch (error) {
    consumeSoloFlag();
    console.error(`${LOG_PREFIX} solo continuation failed to start`, error);
  }
  return '';
}

export function isReady() {
  return ready;
}

init();
