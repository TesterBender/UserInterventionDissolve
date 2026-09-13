import { getCtx } from './host.js';
import { METADATA_KEY } from './constants.js';
import { reservedLiteral } from './boundary.js';
import { assignIds, deriveFrontier } from './derive.js';
import { createState } from './state.js';
import { save } from './state-host.js';
import { compileUnit } from './freeze.js';

// loop-bound: hard stop, the state already guarantees termination → docs/modules/recompile.md#loop
const MAX_PASSES = 1000;

// reset-and-rebuild: never a re-cut, the whole compiled region is discarded → docs/modules/recompile.md#what-it-is
export async function recompile(ctx = getCtx()) {
  // reset: a fresh createState replaces frozen, frozenIds and watermark → docs/modules/recompile.md#reset
  // ids-survive: existing message ids are left in place and re-consumed → docs/modules/recompile.md#ids-survive
  const state = createState();
  ctx.chatMetadata[METADATA_KEY] = state;

  // missing-ids: an id-less message can never be recorded as consumed → docs/modules/recompile.md#missing-ids
  if (assignIds(ctx.chat)) await ctx.saveChat();

  const literal = reservedLiteral(ctx);
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    // live-rules: empty options, so the current target and salience rules apply → docs/modules/recompile.md#loop
    if (compileUnit(state, deriveFrontier(ctx.chat, state, literal), literal, {}) === null) break;
  }

  // save-once: the reset itself is persisted even when nothing froze → docs/modules/recompile.md#save
  await save(ctx);

  return {
    spans: state.frozen.length,
    words: state.frozen.reduce((total, span) => total + span.words, 0),
  };
}

// grouping: locale-independent thousands separator → docs/modules/recompile.md#summary
function group(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// pinned-string: the one line both callers report → docs/modules/recompile.md#summary
export function formatRecompileSummary({ spans, words }) {
  return `Recompiled: ${group(spans)} ${spans === 1 ? 'span' : 'spans'}, ${group(words)} ${words === 1 ? 'word' : 'words'} frozen`;
}
