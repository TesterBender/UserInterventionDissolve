import { SOLO_CONTINUATION_CONTROL } from './prompt.js';

// solo-flag: module-level boolean, one arm equals one request → docs/modules/frontier.md#solo-variant
let armed = false;

export function armSolo() {
  armed = true;
}

export function consumeSoloFlag() {
  const wasArmed = armed;
  armed = false;
  return wasArmed;
}

// solo-control-resolution: substituteParams first, name1 fallback, never cached → docs/modules/frontier.md#solo-variant
export function resolveSoloControl(ctx) {
  let expanded;
  try {
    expanded = ctx.substituteParams(SOLO_CONTINUATION_CONTROL);
  } catch {
    expanded = undefined;
  }
  if (typeof expanded === 'string' && !expanded.includes('{{user}}')) return expanded;
  return SOLO_CONTINUATION_CONTROL.replace('{{user}}', String(ctx.name1 ?? '').trim());
}
