import { getCtx } from './host.js';
import { parseManuscript, findTagLiteral, groupSpans } from './grammar.js';
import { getState, pushFrozen, advanceWatermark } from './state.js';
import { METADATA_KEY, FREEZE_MIN_WORDS, FREEZE_MAX_WORDS } from './constants.js';

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

// reserved-spans: literal at the span's first block start, never a parsed actor → docs/modules/freeze.md#salience-heuristics
function reservedSpans(text, literal, spans) {
  const reserved = new Set();
  if (typeof literal !== 'string') return reserved;
  const actor = literal.replace(/:$/, '');
  if (actor === '') return reserved;

  const starts = new Set(
    findTagLiteral(text, actor)
      .filter((hit) => hit.atBlockStart)
      .map((hit) => hit.index),
  );
  spans.forEach((span, k) => {
    if (starts.has(span.start)) reserved.add(k);
  });
  return reserved;
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
  const { min = FREEZE_MIN_WORDS, max = FREEZE_MAX_WORDS, jitterSeed } = opts;
  if (typeof frontierText !== 'string' || frontierText === '') return null;

  const blocks = parseManuscript(frontierText);
  if (blocks.length < 2) return null;

  const cumWords = blocks.map((block) => countWords(frontierText.slice(0, block.end)));
  const spans = groupSpans(blocks);
  const spanOf = [];
  spans.forEach((span, k) => span.blockIndices.forEach((i) => { spanOf[i] = k; }));
  const reserved = reservedSpans(frontierText, literal, spans);

  const safe = [];
  for (let i = 0; i <= blocks.length - 2; i += 1) {
    if (!blocks[i].complete) continue;
    if (cumWords[i] < min) continue;
    if (reserved.has(spanOf[i]) || reserved.has(spanOf[i + 1])) continue;

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

// freeze-apply: cut offset mapped onto a message, remainder re-derived → docs/modules/freeze.md#watermark-mapping
export function maybeFreeze(state, derived, literal, opts = {}) {
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

  // push-refusal: a refused span leaves the state byte-identical → docs/modules/freeze.md#overrun
  if (!pushFrozen(state, { text: derived.text.slice(0, cut.frozenEnd), words: cut.words })) return null;
  advanceWatermark(state, { messageId, offset, consumedIds });

  return {
    frozenIndex: state.frozen.length - 1,
    words: cut.words,
    target: cut.target,
    overrun: cut.overrun,
    blockIndex: cut.blockIndex,
    watermark: { messageId, offset },
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
