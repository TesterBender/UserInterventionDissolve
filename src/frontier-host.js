import { getCtx } from './host.js';
import { getState } from './state-host.js';
import { deriveFrontier } from './derive.js';
import { reservedLiteral } from './boundary.js';
import { consumeSoloFlag, resolveSoloControl } from './solo.js';
import { buildHistory, applyToRequestChat, regeneratesLastMessage, shouldReconstruct } from './frontier.js';

// interceptor-body: four steps, contextSize ignored, abort never called → docs/modules/frontier.md#interceptor-body
// dryrun-parity: token-count preview stays stale until the parity brief → docs/modules/frontier.md#dryrun-parity
export async function interceptGeneration(chat, contextSize, abort, type, ctx = getCtx()) {
  // solo-variant: skipped types clear the flag, armed ones resolve it once → docs/modules/frontier.md#solo-variant
  if (!shouldReconstruct(type)) {
    consumeSoloFlag();
    return false;
  }

  const solo = consumeSoloFlag();
  const state = getState(ctx);
  // derived-frontier: rebuilt from chat[] per request, never persisted → docs/modules/derive.md#derivation-rule
  const { text } = deriveFrontier(ctx.chat, state, reservedLiteral(ctx), {
    excludeLastAssistant: regeneratesLastMessage(type),
  });
  const options = { frontier: text };
  if (solo) options.control = resolveSoloControl(ctx);

  const history = buildHistory(state, { name1: ctx.name1, name2: ctx.name2 }, options);
  return applyToRequestChat(chat, history);
}
