import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { countWords, selectCut, compileUnit, noticeFrozenEdit, FROZEN_EDIT_NOTICE } from '../src/freeze.js';
import { createState, pushFrozen } from '../src/state.js';
import { deriveFrontier } from '../src/derive.js';
import { isTrailingBlockComplete, parseManuscript, groupSpans } from '../src/grammar.js';
import { installFakeContext, uninstall } from './helpers/fake-context.js';
import {
  METADATA_KEY,
  FREEZE_MIN_WORDS,
  FREEZE_MAX_WORDS,
  FINAL_MIN_WORDS,
  FINAL_MAX_WORDS,
  BLOCK_DELIMITER,
} from '../src/constants.js';

const LITERAL = 'Mara:';
const ABSENT = 'Zed:';
const SOURCE = fs.readFileSync(path.join(process.cwd(), 'src/freeze.js'), 'utf8');

function buf(n, label = 'w') {
  const parts = [];
  for (let i = 0; i < n; i += 1) parts.push(`${label}${i}`);
  return `${parts.join(' ')}.`;
}

function tag(actor, n) {
  return `${actor}: ${buf(n - 1)}`;
}

function manuscript(blocks) {
  return blocks.join('\n\n');
}

function seedWhere(text, literal, opts, predicate) {
  for (let seed = 0; seed < 4000; seed += 1) {
    const cut = selectCut(text, literal, { ...opts, jitterSeed: seed });
    if (cut && predicate(cut)) return seed;
  }
  return null;
}

describe('countWords', () => {
  it('counts non-space runs and tolerates nullish input', () => {
    expect(countWords('  one\ttwo\nthree  ')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
    expect(countWords('3 déjà-vu «mots»')).toBe(3);
  });

  it('is defined once from /\\S+/g', () => {
    const code = SOURCE.split(/\r?\n/).filter((line) => !line.trim().startsWith('//')).join('\n');
    expect(code.match(/\\S\+/g) ?? []).toHaveLength(1);
  });

  it('gives a cut the count pushFrozen would have filled in', () => {
    const text = manuscript([buf(100), buf(100), buf(100), buf(100)]);
    const cut = selectCut(text, LITERAL, { min: 150, max: 350 });

    expect(cut).not.toBeNull();
    const state = createState();
    expect(pushFrozen(state, { text: text.slice(0, cut.frozenEnd) })).toBe(true);
    expect(state.frozen[0].words).toBe(cut.words);
  });
});

describe('selectCut refusals', () => {
  it('returns null below min', () => {
    const text = manuscript([buf(50), buf(50), buf(50)]);
    expect(selectCut(text, LITERAL, { min: 1000, max: 2000 })).toBeNull();
  });

  it('returns null for non-string, empty and single-block frontiers', () => {
    expect(selectCut(undefined, LITERAL)).toBeNull();
    expect(selectCut(42, LITERAL)).toBeNull();
    expect(selectCut('', LITERAL)).toBeNull();
    expect(selectCut(buf(5000), LITERAL, { min: 10, max: 20 })).toBeNull();
  });

  it('returns null when every boundary is inside or adjacent to a reserved span', () => {
    const opts = { min: 100, max: 600 };
    expect(selectCut(manuscript([tag('Mara', 100), buf(100), buf(100)]), LITERAL, opts)).toBeNull();
    expect(selectCut(manuscript([buf(100), tag('Mara', 100), buf(100)]), LITERAL, opts)).toBeNull();
  });
});

describe('hard rules', () => {
  const text = manuscript([
    buf(100), buf(100), buf(100), tag('Mara', 100), buf(100),
    tag('Anton', 100), buf(100), tag('Bela', 100), buf(100), buf(100),
  ]);

  it('never cuts inside, immediately before or immediately after a reserved span', () => {
    const blocks = parseManuscript(text);
    const forbidden = [2, 3, 4];
    for (let seed = 0; seed < 50; seed += 1) {
      const cut = selectCut(text, LITERAL, { min: 250, max: 950, jitterSeed: seed });
      expect(cut).not.toBeNull();
      for (const i of forbidden) expect(cut.blockIndex).not.toBe(i);
      expect(blocks[cut.blockIndex].raw.startsWith(LITERAL)).toBe(false);
      expect(blocks[cut.blockIndex + 1].raw.startsWith(LITERAL)).toBe(false);
    }
  });

  it('never cuts inside a long multi-block external span, at any seed', () => {
    const long = manuscript([
      buf(100), buf(100), tag('Anton', 100), buf(100), buf(100),
      tag('Mara', 100), buf(100), buf(100), buf(100), buf(100),
      buf(100), tag('Bela', 100), buf(100), tag('Cyn', 100), buf(100),
      tag('Dov', 100), buf(100), buf(100), buf(100), buf(100),
    ]);
    const forbidden = [4, 5, 6, 7, 8, 9, 10];

    for (let seed = 0; seed < 200; seed += 1) {
      const cut = selectCut(long, LITERAL, { min: 150, max: 2000, jitterSeed: seed });
      expect(cut).not.toBeNull();
      for (const i of forbidden) expect(cut.blockIndex).not.toBe(i);
    }
  });

  // no-dense-run: rule (b) is deleted; (a) alone carries INV-7 → docs/modules/freeze.md#no-dense-run
  it('still finds a cut in budget when the reserved header appears every third block', () => {
    const parts = [];
    for (let i = 0; i < 140; i += 1) {
      if (i % 3 === 0) parts.push(tag('Mara', 60));
      else if (i % 3 === 1) parts.push(tag('Anton', 60));
      else parts.push(buf(60, `p${i}w`));
    }
    const text = manuscript(parts);
    const blocks = parseManuscript(text);

    for (let seed = 0; seed < 25; seed += 1) {
      const cut = selectCut(text, LITERAL, { jitterSeed: seed });
      expect(cut).not.toBeNull();
      expect(cut.overrun).toBe(false);
      expect(cut.words).toBeGreaterThanOrEqual(FREEZE_MIN_WORDS);
      expect(cut.words).toBeLessThanOrEqual(FREEZE_MAX_WORDS);
      expect(blocks[cut.blockIndex].raw.startsWith(LITERAL)).toBe(false);
      expect(blocks[cut.blockIndex + 1].raw.startsWith(LITERAL)).toBe(false);
    }
  });

  // reserved-opener: protection cannot depend on TAG_HEADER parsing the name → docs/modules/grammar.md#reserved-spans
  it('protects a reserved literal that TAG_HEADER cannot parse', () => {
    const long = `${'N'.repeat(48)}`;
    for (const actor of ['Anton_S', long, '"Quoted']) {
      const parts = [];
      for (let i = 0; i < 60; i += 1) parts.push(i % 7 === 0 ? `${actor}: ${buf(99)}` : buf(100, `b${i}w`));
      const text = manuscript(parts);
      const blocks = parseManuscript(text);
      const literal = `${actor}:`;

      expect(blocks.filter((block) => block.kind === 'tag')).toHaveLength(0);
      for (let seed = 0; seed < 30; seed += 1) {
        const cut = selectCut(text, literal, { min: 150, max: 6000, jitterSeed: seed });
        if (cut === null) continue;
        expect(blocks[cut.blockIndex].raw.startsWith(literal)).toBe(false);
        expect(blocks[cut.blockIndex + 1].raw.startsWith(literal)).toBe(false);
      }
    }
  });

  it('reproduces the audit probe: every seventh block, parseable and unparseable name alike', () => {
    for (const actor of ['Anton', 'Anton_S']) {
      const parts = [];
      for (let i = 0; i < 60; i += 1) parts.push(i % 7 === 0 ? `${actor}: ${buf(99)}` : buf(100, `b${i}w`));

      expect(selectCut(manuscript(parts), `${actor}:`, { jitterSeed: 5 })).toBeNull();
    }
  });

  it('names no dense-run radius at all', () => {
    expect(SOURCE).not.toMatch(/DENSE|dense/);
  });

  it('treats only a block that starts with the literal as reserved', () => {
    const midBlock = 'He turned. Mara: left.';
    const quoted = '"Mara: stop," he said.';
    const text2 = manuscript([
      buf(50), buf(50), buf(50), midBlock, quoted, buf(50), buf(50), buf(50),
    ]);
    const opts = { min: 150, max: 210, jitterSeed: 3 };

    const cut = selectCut(text2, LITERAL, opts);
    expect(cut).not.toBeNull();
    expect(cut.overrun).toBe(false);
    expect(cut.blockIndex).toBeGreaterThanOrEqual(2);
    expect(cut.blockIndex).toBeLessThanOrEqual(5);
    expect(cut).toEqual(selectCut(text2, ABSENT, opts));
  });

  it('reserves nothing for an absent, empty or bare-colon literal', () => {
    const opts = { min: 150, max: 400, jitterSeed: 1 };
    const reference = selectCut(text, ABSENT, opts);
    expect(selectCut(text, '', opts)).toEqual(reference);
    expect(selectCut(text, ':', opts)).toEqual(reference);
    expect(selectCut(text, undefined, opts)).toEqual(reference);
  });
});

describe('soft preferences', () => {
  function neutral(n) {
    return `∅: ${buf(n - 1)}`;
  }

  it('prefers a neutral span start over a character span start and over a mid-span gap', () => {
    const text = manuscript([
      buf(100), buf(100), tag('Anton', 100), buf(100), neutral(100), buf(100),
    ]);
    const opts = { min: 150, max: 500 };
    const seed = seedWhere(text, LITERAL, opts, (cut) => cut.target <= 250);
    expect(seed).not.toBeNull();

    const cut = selectCut(text, LITERAL, { ...opts, jitterSeed: seed });
    expect(Math.abs(200 - cut.target)).toBeLessThan(Math.abs(400 - cut.target));
    expect(cut.blockIndex).toBe(3);
  });

  it('prefers a character span start over a mid-span gap when no neutral start is in budget', () => {
    const text = manuscript([
      buf(100), buf(100), tag('Anton', 100), buf(100), buf(100), buf(100),
    ]);
    const opts = { min: 150, max: 500 };
    const seed = seedWhere(text, LITERAL, opts, (cut) => cut.target >= 420);
    expect(seed).not.toBeNull();

    const cut = selectCut(text, LITERAL, { ...opts, jitterSeed: seed });
    expect(Math.abs(200 - cut.target)).toBeGreaterThan(Math.abs(400 - cut.target));
    expect(cut.blockIndex).toBe(1);
  });

  it('still returns a mid-span paragraph gap when no span start is in budget', () => {
    const text = manuscript([buf(100), buf(100), buf(100), buf(100), buf(100), buf(100)]);
    const spans = groupSpans(parseManuscript(text));
    expect(spans).toHaveLength(1);

    for (let seed = 0; seed < 40; seed += 1) {
      const cut = selectCut(text, LITERAL, { min: 150, max: 500, jitterSeed: seed });
      expect(cut).not.toBeNull();
      expect(spans[0].blockIndices[0]).not.toBe(cut.blockIndex + 1);
      expect(Math.abs(cut.words - cut.target)).toBeLessThanOrEqual(50);
    }
  });

  const probes = [
    ['* * *', true],
    ['***', true],
    ['---', true],
    ['THE NEXT MORNING', true],
    ['Later That Evening', true],
    ['The Cold Rain Fell On Quiet Streets.', false],
    ['he waited.', false],
  ];

  it.each(probes)('scene-opening heuristic: %s', (probe, isSeam) => {
    const text = manuscript([buf(200), probe, buf(60), buf(60)]);
    const opts = { min: 150, max: 300 };
    const seed = seedWhere(text, LITERAL, opts, (cut) => cut.target <= 199);
    expect(seed).not.toBeNull();

    const cut = selectCut(text, LITERAL, { ...opts, jitterSeed: seed });
    expect(cut.blockIndex).toBe(isSeam ? 1 : 0);
  });

  it('never treats a span-opening tag block as a scene opening', () => {
    const text = manuscript([
      buf(100), 'Anton: He Waits.', buf(100).replace(/\.$/, ''), 'Bela: She Nods.', buf(100),
    ]);
    const opts = { min: 100, max: 250 };
    const seed = seedWhere(text, LITERAL, opts, (cut) => cut.target <= 150);
    expect(seed).not.toBeNull();

    expect(selectCut(text, LITERAL, { ...opts, jitterSeed: seed }).blockIndex).toBe(0);
  });

  it('never treats a span-opening neutral block as a scene opening', () => {
    const text = manuscript([
      buf(100), '∅: Rain Falls.', buf(100).replace(/\.$/, ''), '∅: Wind Rises.', buf(100),
    ]);
    const opts = { min: 100, max: 250 };
    const seed = seedWhere(text, LITERAL, opts, (cut) => cut.target <= 150);
    expect(seed).not.toBeNull();

    expect(selectCut(text, LITERAL, { ...opts, jitterSeed: seed }).blockIndex).toBe(0);
  });
});

describe('target and jitter', () => {
  const text = manuscript([
    buf(100), buf(100), buf(100), buf(100), buf(100),
    buf(100), buf(100), buf(100), buf(100), buf(100),
  ]);

  it('chooses the equally preferred candidate closest to the target', () => {
    const opts = { min: 250, max: 950 };
    for (let seed = 0; seed < 40; seed += 1) {
      const cut = selectCut(text, LITERAL, { ...opts, jitterSeed: seed });
      const distances = [];
      for (let i = 2; i <= 8; i += 1) distances.push(Math.abs(100 * (i + 1) - cut.target));
      expect(Math.abs(cut.words - cut.target)).toBe(Math.min(...distances));
    }
  });

  it('breaks an exact distance tie towards the lower word count', () => {
    const opts = { min: 250, max: 950 };
    const seed = seedWhere(text, LITERAL, opts, (cut) => cut.target === 350);
    expect(seed).not.toBeNull();

    const cut = selectCut(text, LITERAL, { ...opts, jitterSeed: seed });
    expect(Math.abs(300 - cut.target)).toBe(Math.abs(400 - cut.target));
    expect(cut.words).toBe(300);
  });

  it('moves the selection when only jitterSeed changes', () => {
    const chosen = new Set();
    for (let seed = 0; seed < 200; seed += 1) {
      chosen.add(selectCut(text, LITERAL, { min: 250, max: 950, jitterSeed: seed }).blockIndex);
    }
    expect(chosen.size).toBeGreaterThan(1);
  });
});

describe('overrun', () => {
  const text = manuscript([
    buf(100), buf(100), tag('Mara', 100), buf(100), tag('Anton', 100),
    buf(100), buf(100), buf(100), buf(100), buf(100),
  ]);

  it('takes the first safe boundary past max, preferences not applied', () => {
    const cut = selectCut(text, LITERAL, { min: 150, max: 450, jitterSeed: 11 });

    expect(cut.overrun).toBe(true);
    expect(cut.words).toBe(500);
    expect(cut.words).toBeGreaterThan(450);
    expect(cut.blockIndex).toBe(4);
  });
});

describe('INV-6: complete blocks only', () => {
  it('never cuts at an incomplete trailing block and always leaves one block behind', () => {
    const text = manuscript([buf(100), buf(100), buf(100), buf(100), 'w0 w1 w2 and then']);
    const blocks = parseManuscript(text);
    expect(blocks.at(-1).complete).toBe(false);

    for (let seed = 0; seed < 40; seed += 1) {
      const cut = selectCut(text, LITERAL, { min: 150, max: 450, jitterSeed: seed });
      expect(cut).not.toBeNull();
      expect(cut.blockIndex).toBeLessThanOrEqual(blocks.length - 2);
      expect(blocks[cut.blockIndex].complete).toBe(true);
      expect(cut.frozenEnd).toBe(blocks[cut.blockIndex].end);
      expect(isTrailingBlockComplete(text.slice(0, cut.frozenEnd))).toBe(true);
      expect(parseManuscript(text.slice(cut.index)).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('module surface', () => {
  it('exports the selection pair, the apply step and the notice', () => {
    expect(SOURCE.match(/^export function \w+/gm)).toEqual([
      'export function countWords',
      'export function selectCut',
      'export function compileUnit',
      'export function noticeFrozenEdit',
    ]);
  });

  it('still refuses a cut whose span would end mid-block', () => {
    const text = manuscript(['w0 w1 w2 no terminal punctuation here', buf(100), buf(100)]);
    const cut = selectCut(text, LITERAL, { min: 6, max: 6 });

    expect(cut.blockIndex).toBe(0);
    expect(pushFrozen(createState(), { text: text.slice(0, cut.frozenEnd) })).toBe(false);
  });
});

describe('compileUnit', () => {
  const OPTS = { min: 150, max: 350 };

  function assistant(mes, id) {
    return { name: 'Anton', is_user: false, is_system: false, mes, extra: { [METADATA_KEY]: { id } } };
  }

  function user(mes, id) {
    return { name: 'Mara', is_user: true, is_system: false, mes, extra: { [METADATA_KEY]: { id } } };
  }

  it('freezes the prefix, consumes whole messages and leaves the remainder derivable', () => {
    const chat = [assistant(buf(100), 'a'), assistant(buf(100), 'b'), assistant(buf(100), 'c'), assistant(buf(100), 'd')];
    const state = createState();
    const derived = deriveFrontier(chat, state, LITERAL);
    const cut = selectCut(derived.text, LITERAL, OPTS);

    const result = compileUnit(state, derived, LITERAL, OPTS);

    expect(result.unitIndex).toBe(0);
    expect(result.seals).toEqual([]);
    expect(result.words).toBe(cut.words);
    expect(result.blockIndex).toBe(cut.blockIndex);
    expect(result.watermark).toEqual({ messageId: null, offset: 0 });
    expect(state.frozen).toEqual([]);
    expect(state.units).toHaveLength(1);
    expect(state.units[0].text).toBe(derived.text.slice(0, cut.frozenEnd));
    expect(state.watermark).toEqual({ messageId: null, offset: 0 });
    expect(state.frozenIds).toEqual(
      derived.segments.filter((segment) => segment.end <= cut.frozenEnd).map((segment) => segment.id),
    );

    expect(deriveFrontier(chat, state, LITERAL).text).toBe(derived.text.slice(cut.index));
  });

  it('records a cut inside an assistant message as the watermark', () => {
    const chat = [
      assistant(manuscript([buf(100), buf(100), buf(100)]), 'a'),
      assistant(buf(100), 'b'),
    ];
    const state = createState();
    const derived = deriveFrontier(chat, state, LITERAL);
    const cut = selectCut(derived.text, LITERAL, OPTS);

    const result = compileUnit(state, derived, LITERAL, OPTS);

    expect(result.watermark.messageId).toBe('a');
    expect(state.watermark).toEqual(result.watermark);
    expect(state.frozenIds).toEqual([]);
    expect(chat[0].mes.slice(state.watermark.offset)).toBe(
      derived.text.slice(cut.frozenEnd, derived.segments[0].end),
    );
    expect(chat[0].mes.slice(state.watermark.offset).trim()).toBe(
      derived.text.slice(cut.index, derived.segments[0].end),
    );
    expect(deriveFrontier(chat, state, LITERAL).text).toBe(derived.text.slice(cut.index));
  });

  it('refuses a cut that falls inside a transformed user block and moves nothing', () => {
    const chat = [
      assistant(manuscript([buf(100), buf(100)]), 'a'),
      user(manuscript([buf(100), buf(100), tag('Anton', 100), buf(100), buf(100), buf(100)]), 'b'),
    ];
    const state = createState();
    const derived = deriveFrontier(chat, state, LITERAL);
    const cut = selectCut(derived.text, LITERAL, { min: 450, max: 550 });

    expect(derived.segments[1].sourceStart).toBeNull();
    expect(cut.frozenEnd).toBeGreaterThan(derived.segments[1].start);
    expect(cut.frozenEnd).toBeLessThan(derived.segments[1].end);

    const before = JSON.parse(JSON.stringify(state));
    expect(compileUnit(state, derived, LITERAL, { min: 450, max: 550 })).toBeNull();
    expect(state).toEqual(before);
  });

  it('leaves frozenIds and the watermark untouched when pushFrozen refuses', () => {
    const chat = [
      assistant('w0 w1 w2 no terminal punctuation here', 'a'),
      assistant(buf(100), 'b'),
      assistant(buf(100), 'c'),
    ];
    const state = createState();
    const derived = deriveFrontier(chat, state, LITERAL);
    const before = JSON.parse(JSON.stringify(state));

    expect(compileUnit(state, derived, LITERAL, { min: 6, max: 6 })).toBeNull();
    expect(state).toEqual(before);
  });

  it('returns null when no cut is available at all', () => {
    const state = createState();
    expect(compileUnit(state, deriveFrontier([assistant(buf(10), 'a')], state, LITERAL), LITERAL, OPTS)).toBeNull();
    expect(state).toEqual(createState());
  });

  it('freezes once: a second attempt on the newly derived frontier declines', () => {
    const chat = [assistant(buf(100), 'a'), assistant(buf(100), 'b'), assistant(buf(100), 'c'), assistant(buf(100), 'd')];
    const state = createState();

    expect(compileUnit(state, deriveFrontier(chat, state, LITERAL), LITERAL, OPTS)).not.toBeNull();
    expect(compileUnit(state, deriveFrontier(chat, state, LITERAL), LITERAL, OPTS)).toBeNull();
    expect(state.units).toHaveLength(1);
    expect(state.frozen).toEqual([]);
  });

  it('INV-10: two live histories with the same derived text freeze identically', () => {
    const blocks = [buf(100), buf(100), buf(100), buf(100)];
    const chatA = [
      assistant(blocks[0], 'a'),
      assistant(blocks[1], 'b'),
      assistant(blocks[2], 'c'),
      assistant(blocks[3], 'd'),
    ];
    const chatB = [
      { mes: 'housekeeping', is_system: true, extra: {} },
      assistant(blocks[0], 'a'),
      assistant(blocks[1], 'b'),
      { mes: 'more housekeeping', is_system: true, extra: {} },
      assistant(blocks[2], 'c'),
      assistant(blocks[3], 'd'),
    ];

    const stateA = createState();
    const stateB = createState();
    const derivedA = deriveFrontier(chatA, stateA, LITERAL);
    const derivedB = deriveFrontier(chatB, stateB, LITERAL);
    expect(derivedA.text).toBe(derivedB.text);

    compileUnit(stateA, derivedA, LITERAL, OPTS);
    compileUnit(stateB, derivedB, LITERAL, OPTS);

    expect(stateA.units.map((unit) => unit.text)).toEqual(stateB.units.map((unit) => unit.text));
    expect(stateA.frozenIds).toEqual(stateB.frozenIds);
    expect(stateA.watermark).toEqual(stateB.watermark);
  });
});

describe('seal policy', () => {
  function chatOf(count, words, label = 'w') {
    const chat = [];
    for (let i = 0; i < count; i += 1) {
      chat.push({
        name: 'Anton',
        is_user: false,
        is_system: false,
        mes: buf(words, `m${i}${label}`),
        extra: { [METADATA_KEY]: { id: `id${i}` } },
      });
    }
    return chat;
  }

  function compileExactly(state, chat, words) {
    const derived = deriveFrontier(chat, state, LITERAL);
    const cut = selectCut(derived.text, LITERAL, { min: words, max: words });
    const text = derived.text.slice(0, cut.frozenEnd);
    const result = compileUnit(state, derived, LITERAL, { min: words, max: words });
    return { result, text };
  }

  it('holds one 3.5k unit unsealed', () => {
    const state = createState();
    const chat = chatOf(150, 100);

    const { result } = compileExactly(state, chat, 3500);

    expect(result.words).toBe(3500);
    expect(result.seals).toEqual([]);
    expect(result.unitIndex).toBe(0);
    expect(state.frozen).toEqual([]);
    expect(state.units.map((unit) => unit.words)).toEqual([3500]);
  });

  it('seals 3.5k + 3.8k into one 7.3k final, then starts a fresh unit set with 3.4k', () => {
    const state = createState();
    const chat = chatOf(150, 100);

    const first = compileExactly(state, chat, 3500);
    const second = compileExactly(state, chat, 3800);

    expect(second.result.seals).toEqual([{ frozenIndex: 0, words: 7300 }]);
    expect(state.units).toEqual([]);
    expect(state.frozen).toHaveLength(1);
    expect(state.frozen[0].text).toBe(`${first.text}${BLOCK_DELIMITER}${second.text}`);
    expect(state.frozen[0].words).toBe(7300);
    expect(countWords(state.frozen[0].text)).toBe(7300);

    const third = compileExactly(state, chat, 3400);
    expect(third.result.seals).toEqual([]);
    expect(state.frozen).toHaveLength(1);
    expect(state.units.map((unit) => unit.words)).toEqual([3400]);
  });

  it('ceiling guard: a 5.9k unit seals alone rather than combining past the ceiling', () => {
    const state = createState();
    const chat = chatOf(150, 100);

    const first = compileExactly(state, chat, 5900);
    expect(first.result.seals).toEqual([]);
    expect(state.units.map((unit) => unit.words)).toEqual([5900]);

    const second = compileExactly(state, chat, 4200);

    expect(second.result.seals).toEqual([{ frozenIndex: 0, words: 5900 }]);
    expect(state.frozen.map((span) => span.words)).toEqual([5900]);
    expect(state.frozen[0].text).toBe(first.text);
    expect(state.units.map((unit) => unit.words)).toEqual([4200]);
    for (const span of state.frozen) expect(span.words).toBeLessThanOrEqual(FINAL_MAX_WORDS);
  });

  it('stalls instead of pushing when the ceiling guard cannot seal', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = createState();
    const chat = chatOf(150, 100);
    state.units.push({ text: 'w0 w1 no terminal punctuation', words: 9000, createdAt: 1 });
    const before = JSON.parse(JSON.stringify(state));

    const { result } = compileExactly(state, chat, 3500);

    expect(result).toBeNull();
    expect(state).toEqual(before);
    expect(state.units).toHaveLength(1);
    expect(state.frozen).toEqual([]);
    expect(state.watermark).toEqual({ messageId: null, offset: 0 });
    expect(state.frozenIds).toEqual([]);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('stalled');

    compileExactly(state, chat, 3500);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(state).toEqual(before);
  });

  it('seals a lone overrun unit at or above the floor', () => {
    const state = createState();
    const chat = chatOf(150, 100);

    const { result } = compileExactly(state, chat, 6100);

    expect(result.seals).toEqual([{ frozenIndex: 0, words: 6100 }]);
    expect(state.units).toEqual([]);
    expect(state.frozen.map((span) => span.words)).toEqual([6100]);
  });

  it('keeps every final between the floor and the ceiling over a long run, append-only', () => {
    const state = createState();
    const chat = chatOf(120, 400);
    const snapshots = [];

    for (let pass = 0; pass < 1000; pass += 1) {
      const before = JSON.stringify(state.frozen);
      const result = compileUnit(state, deriveFrontier(chat, state, LITERAL), LITERAL, {});
      if (result === null) break;

      expect(state.frozen.length).toBeGreaterThanOrEqual(JSON.parse(before).length);
      snapshots.push(JSON.parse(before));
    }

    expect(state.frozen.length).toBeGreaterThanOrEqual(4);
    for (const span of state.frozen) {
      expect(span.words).toBeLessThanOrEqual(FINAL_MAX_WORDS);
      expect(span.words).toBeGreaterThanOrEqual(FINAL_MIN_WORDS);
    }
    for (const snapshot of snapshots) {
      snapshot.forEach((span, i) => expect(state.frozen[i]).toEqual(span));
    }
  });
});

describe('noticeFrozenEdit', () => {
  let info;

  beforeEach(() => {
    info = vi.fn();
    globalThis.toastr = { info };
  });

  afterEach(() => {
    delete globalThis.toastr;
    uninstall();
  });

  function seed(ctx, overrides = {}) {
    ctx.chatMetadata[METADATA_KEY] = { ...createState(), ...overrides };
  }

  function message(id) {
    return { name: 'Anton', is_user: false, is_system: false, mes: 'He waits.', extra: { [METADATA_KEY]: { id } } };
  }

  it('shows one toast with the pinned text for a consumed message', () => {
    const ctx = installFakeContext({ chat: [message('a')] });
    seed(ctx, { frozenIds: ['a'] });

    expect(noticeFrozenEdit(0, ctx)).toBe(true);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(FROZEN_EDIT_NOTICE);
    expect(FROZEN_EDIT_NOTICE).toBe(
      'That part of the manuscript is already frozen; this edit stays in the log only.',
    );
  });

  it('says nothing for an unfrozen message, the watermark message, a message with no id or a bad index', () => {
    const ctx = installFakeContext({
      chat: [message('a'), message('w'), { mes: 'no id', is_system: false, extra: {} }],
    });
    seed(ctx, { frozenIds: ['z'], watermark: { messageId: 'w', offset: 4 } });

    for (const index of [0, 1, 2, 9, -1, undefined]) {
      expect(noticeFrozenEdit(index, ctx)).toBe(false);
    }
    expect(info).not.toHaveBeenCalled();
  });

  it('writes nothing, saves nothing and does not throw without the toastr global', () => {
    delete globalThis.toastr;
    const ctx = installFakeContext({ chat: [message('a')] });
    seed(ctx, { frozenIds: ['a'] });
    const before = JSON.stringify(ctx.chat);

    expect(noticeFrozenEdit(0, ctx)).toBe(true);
    expect(JSON.stringify(ctx.chat)).toBe(before);
    expect(ctx.saveChat).not.toHaveBeenCalled();
    expect(ctx.saveMetadata).not.toHaveBeenCalled();
  });

  it('defaults ctx to the live host context', () => {
    const ctx = installFakeContext({ chat: [message('a')] });
    seed(ctx, { frozenIds: ['a'] });

    expect(noticeFrozenEdit(0)).toBe(true);
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe('purity and INV-10', () => {
  const text = manuscript([buf(100), buf(100), buf(100), buf(100), buf(100)]);

  it('is deterministic with and without an explicit seed', () => {
    const seeded = [];
    const unseeded = [];
    for (let i = 0; i < 10; i += 1) {
      seeded.push(selectCut(text, LITERAL, { min: 150, max: 450, jitterSeed: 7 }));
      unseeded.push(selectCut(text, LITERAL, { min: 150, max: 450 }));
    }
    for (const cut of seeded) expect(cut).toEqual(seeded[0]);
    for (const cut of unseeded) expect(cut).toEqual(unseeded[0]);
    expect(SOURCE).toMatch(/export function selectCut\(frontierText, literal, opts = \{\}\)/);
  });

  it('collapses two live histories with the same frontier to the same cut', () => {
    const blocks = [buf(100), buf(100), buf(100), buf(100)];
    const chatA = blocks.map((mes) => ({ mes, is_system: false, extra: {} }));
    const chatB = [
      { mes: `${blocks[0]}\n\n${blocks[1]}`, is_system: false, extra: {} },
      { mes: 'housekeeping', is_system: true, extra: {} },
      { mes: `${blocks[2]}\n\n${blocks[3]}`, is_system: false, extra: {} },
    ];

    const textA = deriveFrontier(chatA, createState(), LITERAL).text;
    const textB = deriveFrontier(chatB, createState(), LITERAL).text;
    expect(textA).toBe(textB);

    expect(selectCut(textA, LITERAL, { min: 150, max: 350 }))
      .toEqual(selectCut(textB, LITERAL, { min: 150, max: 350 }));
  });

  it('names no clock and no randomness, and touches the host in one place only', () => {
    expect(SOURCE).not.toMatch(/SillyTavern/);
    expect(SOURCE).not.toMatch(/Date\.now/);
    expect(SOURCE).not.toMatch(/Math\.random/);
    expect(SOURCE).not.toMatch(/performance/);
    expect(SOURCE).not.toMatch(/\b(save|saveMetadata|saveChat)\b/);
    expect(SOURCE.match(/getCtx\(\)/g)).toHaveLength(1);
  });
});

describe('defaults', () => {
  it('freezes inside the 3,000–4,200 word window on a real-sized manuscript', () => {
    const blocks = [];
    for (let i = 0; i < 60; i += 1) {
      if (i === 2 || i === 55) blocks.push(tag('Mara', 100));
      else if (i % 6 === 0) blocks.push(tag('Anton', 100));
      else blocks.push(buf(100, `b${i}w`));
    }
    const text = manuscript(blocks);

    expect(countWords(text)).toBe(6000);
    const result = selectCut(text, LITERAL);

    expect(result).not.toBeNull();
    expect(result.overrun).toBe(false);
    expect(result.words).toBeGreaterThanOrEqual(FREEZE_MIN_WORDS);
    expect(result.words).toBeLessThanOrEqual(FREEZE_MAX_WORDS);
    expect(result.target).toBeGreaterThanOrEqual(FREEZE_MIN_WORDS);
    expect(result.target).toBeLessThanOrEqual(FREEZE_MAX_WORDS);
    expect(isTrailingBlockComplete(text.slice(0, result.frozenEnd))).toBe(true);
  });

  it('exposes the three freeze constants', () => {
    expect(FREEZE_MIN_WORDS).toBe(3000);
    expect(FREEZE_MAX_WORDS).toBe(4200);
  });
});
