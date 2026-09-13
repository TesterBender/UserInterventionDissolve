import { findTagLiteral } from './grammar.js';

// stop-fields: stop for chat completion, stopping_strings and stop for text → docs/modules/boundary.md#stop-fields
const STOP_FIELDS = { chat: ['stop'], text: ['stopping_strings', 'stop'] };

// reserved-literal: `${persona}:` bare, recomputed per use, never stored → docs/modules/boundary.md#reserved-literal
export function reservedLiteral(ctx) {
  let name = '';
  try {
    const expanded = ctx.substituteParams('{{user}}');
    if (typeof expanded === 'string' && expanded !== '{{user}}') name = expanded.trim();
  } catch {
    name = '';
  }
  if (name === '') name = String(ctx.name1 ?? '').trim();
  return name === '' ? '' : `${name}:`;
}

// why-first-in-stop-array: index 0 survives a provider-side cap → docs/modules/boundary.md#why-first-in-stop-array
export function applyStopStrings(body, literal, api) {
  if (literal === '' || typeof body !== 'object' || body === null) return body;
  for (const field of STOP_FIELDS[api]) {
    if (!Array.isArray(body[field])) body[field] = [];
    const strings = body[field];
    for (let i = strings.length - 1; i >= 0; i -= 1) {
      if (strings[i] === literal) strings.splice(i, 1);
    }
    strings.unshift(literal);
  }
  return body;
}

// block-start-only: position decides, never the parsed actor → docs/modules/boundary.md#block-start-only
export function findBoundary(text, literal) {
  if (typeof text !== 'string' || literal === '') return { index: -1, endsAtLiteral: false };
  const occurrence = findTagLiteral(text, literal.replace(/:$/, '')).find((found) => found.atBlockStart);
  if (occurrence === undefined) return { index: -1, endsAtLiteral: false };
  return {
    index: occurrence.index,
    endsAtLiteral: text.slice(occurrence.index + literal.length).trim() === '',
  };
}

// receipt-trim: cut back to the character before the literal → docs/modules/boundary.md#receipt-trim
export function trimAtBoundary(text, literal) {
  const { index } = findBoundary(text, literal);
  if (index === -1) return text;
  return text.slice(0, index).replace(/\s+$/, '');
}
