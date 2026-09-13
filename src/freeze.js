import { getCtx } from './host.js';
import { parseManuscript, groupSpans } from './grammar.js';
import { getState, canPushSpan, pushUnit, sealUnits, advanceWatermark } from './state.js';
import {
  METADATA_KEY,
  LOG_PREFIX,
  FREEZE_MIN_WORDS,
  FREEZE_MAX_WORDS,
  FINAL_MIN_WORDS,
  FINAL_MAX_WORDS,
} from './constants.js';

// sentence-final: copy of grammar's private TERMINAL → docs/modules/freeze.md#salience-heuristics
const SENTENCE_FINAL = /[.!?…]["”'’)\]*]*$/;

// scene-separator: a line of three or more * or - → docs/modules/freeze.md#salience-heuristics
const SCENE_SEPARATOR = /^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;

// word-count: /\S+/g once, matching pushFrozen's fill rule → docs/modules/freeze.md#word-counting
export function countWords(text) {
  return (String(text ?? '').match(/\S+/g) ?? []).length;
}

// jitter-offset: drawn once per call, seed derived from the text → docs/modules/freeze.md#target-jitter
function jitterOffset(seed, span) {
  if (!(span > 0)) return 0;
  let x = (Number.isFinite(seed) ? Math.trunc(seed) : 0) >>> 0;
  x = (x + 0x9e3779b9) >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return x % (span + 1);
}

// reserved-actor: the literal minus its colon, handed to grammar → docs/modules/freeze.md#salience-heuristics
function reservedActor(literal) {
  return typeof literal === 'string' ? literal.replace(/:$/, '') : '';
}

function isAllCaps(line) {
  const letters = line.match(/\p{L}/gu) ?? [];
  return letters.length >= 2 && line === line.toUpperCase();
}

function isTitleCase(line) {
  const words = line.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return false;
  return words.every((word) => {
    const first = word[0];
    if (!/\p{L}/u.test(first)) return true;
    return first === first.toUpperCase();
  });
}

// scene-opening: mechanical marker test, never a semantic judgement → docs/modules/freeze.md#salience-heuristics
function isSceneOpening(block, opensSpan) {
  const first = block.raw.split(/\r?\n/)[0].trim();
  if (SCENE_SEPARATOR.test(first)) return true;
  if (opensSpan) return false;
  if (countWords(block.raw) > 6) return false;
  return isAllCaps(first) || isTitleCase(first);
}

// soft-preferences: neutral span start, then any span start, then scene-seam avoidance → docs/modules/freeze.md#salience-heuristics
function preferred(inBudget, blocks, spans, spanOf, cumWords, target) {
  const spanStart = (i) => spans[spanOf[i + 1]].blockIndices[0] === i + 1;
  const neutralStart = (i) => spanStart(i) && spans[spanOf[i + 1]].neutral;
  const sceneSeam = (i) =>
    SENTENCE_FINAL.test(blocks[i].raw.replace(/\s+$/, '')) && isSceneOpening(blocks[i + 1], spanStart(i));

  const tiers = [
    inBudget.filter((i) => neutralStart(i) && !sceneSeam(i)),
    inBudget.filter((i) => neutralStart(i)),
    inBudget.filter((i) => spanStart(i) && !sceneSeam(i)),
    inBudget.filter((i) => spanStart(i)),
    inBudget.filter((i) => !sceneSeam(i)),
    inBudget,
  ];
  const pool = tiers.find((tier) => tier.length > 0);

  let best = pool[0];
  for (const i of pool) {
    const distance = Math.abs(cumWords[i] - target);
    const bestDistance = Math.abs(cumWords[best] - target);
    if (distance < bestDistance || (distance === bestDistance && cumWords[i] < cumWords[best])) {
      best = i;
    }
  }
  return best;
}

// cut-selection: hard rules, then preferences, over a jittered target → docs/modules/freeze.md#candidates
export function selectCut(frontierText, literal, opts = {}) {
  const { min = FREEZE_MIN_WORDS, max = FREEZE_MAX_WORDS, jitterSeed, maxFrozenEnd } = opts;
  if (typeof frontierText !== 'string' || frontierText === '') return null;

  const blocks = parseManuscript(frontierText);
  if (blocks.length < 2) return null;

  const cumWords = blocks.map((block) => countWords(frontierText.slice(0, block.end)));
  const spans = groupSpans(blocks, { reservedActor: reservedActor(literal) });
  const spanOf = [];
  spans.forEach((span, k) => span.blockIndices.forEach((i) => { spanOf[i] = k; }));

  const safe = [];
  for (let i = 0; i <= blocks.length - 2; i += 1) {
    if (!blocks[i].complete) continue;
    if (cumWords[i] < min) continue;
    if (spans[spanOf[i]].reserved || spans[spanOf[i + 1]].reserved) continue;
    // last-message-clamp: hard rule, a capped boundary is withheld → docs/modules/freeze.md#last-message-clamp
    if (Number.isFinite(maxFrozenEnd) && blocks[i].end > maxFrozenEnd) continue;

    safe.push(i);
  }
  if (safe.length === 0) return null;

  const seed = Number.isFinite(jitterSeed) ? jitterSeed : countWords(frontierText);
  const target = min + jitterOffset(seed, max - min);

  // overrun: first safe boundary past max, preferences not applied → docs/modules/freeze.md#overrun
  const inBudget = safe.filter((i) => cumWords[i] <= max);
  const chosen = inBudget.length === 0 ? safe[0] : preferred(inBudget, blocks, spans, spanOf, cumWords, target);

  return {
    blockIndex: chosen,
    frozenEnd: blocks[chosen].end,
    index: blocks[chosen + 1].start,
    words: cumWords[chosen],
    target,
    overrun: cumWords[chosen] > max,
  };
}

// units-words: the unsealed tier's running total, the only seal input → docs/modules/freeze.md#seal-policy
function unitsWords(state) {
  return state.units.reduce((total, unit) => total + unit.words, 0);
}

// stall-warning: one warn per state whose units cannot be sealed → docs/modules/freeze.md#seal-policy
const stalled = new WeakSet();

function warnStalled(state) {
  if (stalled.has(state)) return;
  stalled.add(state);
  console.warn(`${LOG_PREFIX} compilation stalled: the compiled units cannot be sealed`);
}

// seal-record: one entry per seal, none when the push was refused → docs/modules/freeze.md#seal-policy
function seal(state, seals) {
  const frozenIndex = sealUnits(state);
  if (typeof frozenIndex !== 'number') return;

  seals.push({ frozenIndex, words: state.frozen[frozenIndex].words });
}

// compile-unit: cut offset mapped onto a message → docs/modules/freeze.md#watermark-mapping
// seal-policy: the unit is sealed into a final span around the push → docs/modules/freeze.md#seal-policy
export function compileUnit(state, derived, literal, opts = {}) {
  const cut = selectCut(derived.text, literal, opts);
  if (cut === null) return null;

  const segments = derived.segments;
  const segment = segments.find((s) => s.start <= cut.frozenEnd && cut.frozenEnd <= s.end);
  if (segment === undefined) return null;

  let messageId = null;
  let offset = 0;
  let consumedIds;

  if (cut.frozenEnd === segment.end) {
    consumedIds = segments.filter((s) => s.end <= cut.frozenEnd).map((s) => s.id);
  } else {
    // partial-refusal: no honest offset into mes, so no freeze this time → docs/modules/freeze.md#watermark-mapping
    if (segment.sourceStart === null || segment.id === null) return null;
    consumedIds = segments.filter((s) => s.end <= segment.start).map((s) => s.id);
    messageId = segment.id;
    offset = segment.sourceStart + (cut.frozenEnd - segment.start);
  }

  // push-refusal: a span canPushSpan rejects leaves the state byte-identical → docs/modules/freeze.md#overrun
  const text = derived.text.slice(0, cut.frozenEnd);
  if (!canPushSpan(text)) return null;

  const seals = [];
  // ceiling-guard: a combination above the ceiling is never created → docs/modules/freeze.md#seal-policy
  if (state.units.length > 0 && unitsWords(state) + cut.words > FINAL_MAX_WORDS) {
    seal(state, seals);
    // ceiling-stall: a refused seal stops the push, state byte-identical → docs/modules/freeze.md#seal-policy
    if (seals.length === 0) {
      warnStalled(state);
      return null;
    }
  }

  pushUnit(state, { text, words: cut.words });
  advanceWatermark(state, { messageId, offset, consumedIds });
  const unitIndex = state.units.length - 1;

  // seal-policy: seal once one more unit could no longer fit under the ceiling → docs/modules/freeze.md#seal-policy
  if (unitsWords(state) >= FINAL_MIN_WORDS && unitsWords(state) + FREEZE_MAX_WORDS > FINAL_MAX_WORDS) seal(state, seals);

  return {
    unitIndex,
    words: cut.words,
    target: cut.target,
    overrun: cut.overrun,
    blockIndex: cut.blockIndex,
    watermark: { messageId, offset },
    seals,
  };
}

// pinned-string: the only user-visible text in the freeze path → docs/modules/freeze.md#frozen-edit-notice
export const FROZEN_EDIT_NOTICE = 'That part of the manuscript is already frozen; this edit stays in the log only.';

// frozen-edit-notice: one toast, consumed messages only, writes nothing → docs/modules/freeze.md#frozen-edit-notice
export function noticeFrozenEdit(index, ctx = getCtx()) {
  const id = ctx.chat?.[index]?.extra?.[METADATA_KEY]?.id;
  if (typeof id !== 'string') return false;
  if (!getState(ctx).frozenIds.includes(id)) return false;

  globalThis.toastr?.info(FROZEN_EDIT_NOTICE);
  return true;
}
