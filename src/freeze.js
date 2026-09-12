import { parseManuscript, findTagLiteral } from './grammar.js';
import { pushFrozen, setFrontier } from './state.js';
import { FREEZE_MIN_WORDS, FREEZE_MAX_WORDS, FREEZE_DENSE_RADIUS } from './constants.js';

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

// reserved-blocks: literal at block start only, never the parsed actor → docs/modules/freeze.md#salience-heuristics
function reservedBlocks(text, literal, blocks) {
  const reserved = new Set();
  if (typeof literal !== 'string') return reserved;
  const actor = literal.replace(/:$/, '');
  if (actor === '') return reserved;

  const starts = new Set(
    findTagLiteral(text, actor)
      .filter((hit) => hit.atBlockStart)
      .map((hit) => hit.index),
  );
  blocks.forEach((block, i) => {
    if (starts.has(block.start)) reserved.add(i);
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
function isSceneOpening(block) {
  const first = block.raw.split(/\r?\n/)[0].trim();
  if (SCENE_SEPARATOR.test(first)) return true;
  if (block.kind === 'tag') return false;
  if (countWords(block.raw) > 6) return false;
  return isAllCaps(first) || isTitleCase(first);
}

// soft-preferences: buffer next outranks scene-seam avoidance → docs/modules/freeze.md#salience-heuristics
function preferred(inBudget, blocks, cumWords, target) {
  const bufferNext = (i) => blocks[i + 1].kind === 'buffer';
  const sceneSeam = (i) =>
    SENTENCE_FINAL.test(blocks[i].raw.replace(/\s+$/, '')) && isSceneOpening(blocks[i + 1]);

  const tiers = [
    inBudget.filter((i) => bufferNext(i) && !sceneSeam(i)),
    inBudget.filter((i) => bufferNext(i)),
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
  const reserved = reservedBlocks(frontierText, literal, blocks);

  const safe = [];
  for (let i = 0; i <= blocks.length - 2; i += 1) {
    if (!blocks[i].complete) continue;
    if (cumWords[i] < min) continue;
    if (reserved.has(i) || reserved.has(i + 1)) continue;

    let dense = false;
    for (let j = i - (FREEZE_DENSE_RADIUS - 1); j <= i + FREEZE_DENSE_RADIUS; j += 1) {
      if (reserved.has(j)) dense = true;
    }
    if (dense) continue;

    safe.push(i);
  }
  if (safe.length === 0) return null;

  const seed = Number.isFinite(jitterSeed) ? jitterSeed : countWords(frontierText);
  const target = min + jitterOffset(seed, max - min);

  // overrun: first safe boundary past max, preferences not applied → docs/modules/freeze.md#overrun
  const inBudget = safe.filter((i) => cumWords[i] <= max);
  const chosen = inBudget.length === 0 ? safe[0] : preferred(inBudget, blocks, cumWords, target);

  return {
    blockIndex: chosen,
    frozenEnd: blocks[chosen].end,
    index: blocks[chosen + 1].start,
    words: cumWords[chosen],
    target,
    overrun: cumWords[chosen] > max,
  };
}

// freeze-apply: remainder kept verbatim, the delimiter dropped → docs/modules/freeze.md#candidates
export function maybeFreeze(state, literal, opts = {}) {
  const cut = selectCut(state?.frontier, literal, opts);
  if (cut === null) return null;

  const text = state.frontier.slice(0, cut.frozenEnd);
  const rest = state.frontier.slice(cut.index);

  // push-refusal: a refused span leaves the frontier byte-identical → docs/modules/freeze.md#overrun
  if (!pushFrozen(state, { text, words: cut.words })) return null;
  setFrontier(state, rest);

  return {
    frozenIndex: state.frozen.length - 1,
    words: cut.words,
    index: cut.index,
    target: cut.target,
    overrun: cut.overrun,
    blockIndex: cut.blockIndex,
  };
}
