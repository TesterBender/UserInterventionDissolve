import { METADATA_KEY, BLOCK_DELIMITER } from './constants.js';
import { CONTINUATION_CONTROL } from './prompt.js';

// five-fields: name/is_user/is_system/mes/extra, nothing time-varying → docs/modules/frontier.md#shape
function reconstructed(name, isUser, mes) {
  return { name, is_user: isUser, is_system: false, mes, extra: { [METADATA_KEY]: { reconstructed: true } } };
}

// total-reconstruction: final spans from state, mutable turn from options → docs/modules/frontier.md#total-reconstruction
// tiered-shape: one canonical control after every final, units carry no turn → docs/modules/frontier.md#shape
// empty-state: blank state yields no array, not a lone continuation turn → docs/modules/frontier.md#empty-state
// solo-variant: options.control replaces the live control text for one request → docs/modules/frontier.md#solo-variant
export function buildHistory(state, { name1, name2 }, options = {}) {
  if (typeof state !== 'object' || state === null) return [];

  const assistantName = String(name2 ?? '');
  const userName = String(name1 ?? '');
  const history = [];

  if (Array.isArray(state.frozen)) {
    for (const span of state.frozen) {
      const text = String(span?.text ?? '');
      if (text === '') continue;
      history.push(reconstructed(assistantName, false, text));
      history.push(reconstructed(userName, true, CONTINUATION_CONTROL));
    }
  }

  const units = Array.isArray(state.units) ? state.units.map((unit) => String(unit?.text ?? '')) : [];
  const frontier = typeof options?.frontier === 'string' ? options.frontier : '';
  const pieces = [...units, frontier].filter((piece) => piece.trim() !== '');
  if (pieces.length === 0) return history;

  history.push(reconstructed(assistantName, false, pieces.join(BLOCK_DELIMITER)));
  const control = typeof options?.control === 'string' && options.control !== '' ? options.control : CONTINUATION_CONTROL;
  history.push(reconstructed(userName, true, control));
  return history;
}

// array-identity: clear and refill in place, loop not spread → docs/modules/frontier.md#interceptor-scope
export function applyToRequestChat(chat, history) {
  if (!Array.isArray(chat) || !Array.isArray(history) || history.length === 0) return false;
  chat.length = 0;
  for (const message of history) chat.push(message);
  return true;
}

// regeneration-scope: only swipe still holds its old message in chat[] → docs/modules/frontier.md#interceptor-body
export function regeneratesLastMessage(type) {
  return type === 'swipe';
}

// skipped-generation-types: quiet and impersonate only; unknown types reconstruct → docs/modules/frontier.md#skipped-generation-types
export function shouldReconstruct(type) {
  return type !== 'quiet' && type !== 'impersonate';
}
