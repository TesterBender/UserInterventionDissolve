import { getCtx } from './host.js';
import { METADATA_KEY } from './constants.js';
import { CONTINUATION_CONTROL } from './prompt.js';
import { getState } from './state.js';

// five-fields: name/is_user/is_system/mes/extra, nothing time-varying → docs/modules/frontier.md#shape
function reconstructed(name, isUser, mes) {
  return { name, is_user: isUser, is_system: false, mes, extra: { [METADATA_KEY]: { reconstructed: true } } };
}

// total-reconstruction: built from canonical state, never from chat[] → docs/modules/frontier.md#total-reconstruction
// empty-state: blank state yields no array, not a lone continuation turn → docs/modules/frontier.md#empty-state
export function buildHistory(state, { name1, name2 }) {
  if (typeof state !== 'object' || state === null) return [];

  const assistantName = String(name2 ?? '');
  const history = [];

  if (Array.isArray(state.frozen)) {
    for (const span of state.frozen) {
      const text = String(span?.text ?? '');
      if (text === '') continue;
      history.push(reconstructed(assistantName, false, text));
    }
  }

  if (String(state.frontier ?? '').trim() !== '') {
    history.push(reconstructed(assistantName, false, state.frontier));
  }

  if (history.length === 0) return [];

  history.push(reconstructed(String(name1 ?? ''), true, CONTINUATION_CONTROL));
  return history;
}

// array-identity: clear and refill in place, loop not spread → docs/modules/frontier.md#interceptor-scope
export function applyToRequestChat(chat, history) {
  if (!Array.isArray(chat) || !Array.isArray(history) || history.length === 0) return false;
  chat.length = 0;
  for (const message of history) chat.push(message);
  return true;
}

// skipped-generation-types: quiet and impersonate only; unknown types reconstruct → docs/modules/frontier.md#skipped-generation-types
export function shouldReconstruct(type) {
  return type !== 'quiet' && type !== 'impersonate';
}

// interceptor-body: four steps, contextSize ignored, abort never called → docs/modules/frontier.md#interceptor-body
// dryrun-parity: token-count preview stays stale until the parity brief → docs/modules/frontier.md#dryrun-parity
export async function interceptGeneration(chat, contextSize, abort, type, ctx = getCtx()) {
  if (!shouldReconstruct(type)) return false;

  const history = buildHistory(getState(ctx), { name1: ctx.name1, name2: ctx.name2 });
  return applyToRequestChat(chat, history);
}
