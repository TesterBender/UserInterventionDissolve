import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { countWords, selectCut } from '../src/freeze.js';
import { createState, pushFrozen } from '../src/state.js';
import { deriveFrontier } from '../src/derive.js';
import { isTrailingBlockComplete, parseManuscript } from '../src/grammar.js';
import { FREEZE_MIN_WORDS, FREEZE_MAX_WORDS, FREEZE_DENSE_RADIUS } from '../src/constants.js';

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

  it('returns null when every boundary is adjacent to or dense with reserved blocks', () => {
    const text = manuscript([
      buf(100), buf(100), tag('Mara', 100), buf(100), buf(100), tag('Mara', 100),
    ]);

    expect(selectCut(text, LITERAL, { min: 100, max: 600 })).toBeNull();
  });
});

describe('hard rules', () => {
  const text = manuscript([
    buf(100), buf(100), buf(100), tag('Mara', 100), buf(100),
    buf(100), buf(100), buf(100), buf(100), buf(100),
  ]);

  it('never cuts immediately before or immediately after a reserved block', () => {
    const blocks = parseManuscript(text);
    for (let seed = 0; seed < 50; seed += 1) {
      const cut = selectCut(text, LITERAL, { min: 250, max: 650, jitterSeed: seed });
      expect(cut).not.toBeNull();
      expect(cut.blockIndex).not.toBe(2);
      expect(cut.blockIndex).not.toBe(3);
      expect(blocks[cut.blockIndex].raw.startsWith(LITERAL)).toBe(false);
      expect(blocks[cut.blockIndex + 1].raw.startsWith(LITERAL)).toBe(false);
    }
  });

  it('rejects an otherwise perfect boundary with a reserved block inside the dense radius', () => {
    const dense = manuscript([
      buf(100), buf(100), buf(100), buf(100), buf(100),
      tag('Mara', 100), buf(100), buf(100), buf(100), buf(100),
    ]);
    const opts = { min: 350, max: 900 };
    const seed = seedWhere(dense, ABSENT, opts, (cut) => cut.target === 400);
    expect(seed).not.toBeNull();

    expect(selectCut(dense, ABSENT, { ...opts, jitterSeed: seed }).blockIndex).toBe(3);

    const cut = selectCut(dense, LITERAL, { ...opts, jitterSeed: seed });
    expect(cut.blockIndex).toBe(7);
    expect(FREEZE_DENSE_RADIUS).toBe(2);
    for (let j = cut.blockIndex - (FREEZE_DENSE_RADIUS - 1); j <= cut.blockIndex + FREEZE_DENSE_RADIUS; j += 1) {
      expect(j).not.toBe(5);
    }
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
  it('prefers a buffer as the next block over avoiding a scene seam', () => {
    const text = manuscript([
      buf(100), buf(100), buf(100), tag('Anton', 100), 'THE NEXT MORNING', buf(100),
    ]);
    const opts = { min: 250, max: 401 };
    const seed = seedWhere(text, LITERAL, opts, (cut) => cut.target <= 349);
    expect(seed).not.toBeNull();

    const cut = selectCut(text, LITERAL, { ...opts, jitterSeed: seed });
    expect(Math.abs(300 - cut.target)).toBeLessThan(Math.abs(400 - cut.target));
    expect(cut.blockIndex).toBe(3);
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
    const text = manuscript([buf(200), probe, tag('Anton', 60), buf(60), buf(60)]);
    const opts = { min: 150, max: 300 };
    const seed = seedWhere(text, LITERAL, opts, (cut) => cut.target <= 229);
    expect(seed).not.toBeNull();

    const cut = selectCut(text, LITERAL, { ...opts, jitterSeed: seed });
    expect(cut.blockIndex).toBe(isSeam ? 2 : 0);
  });

  it('never treats a tag block as a scene opening', () => {
    const text = manuscript([
      buf(200), 'Anton: he waits.', tag('Bela', 60), buf(60), buf(60),
    ]);
    const opts = { min: 150, max: 250 };
    const seed = seedWhere(text, LITERAL, opts, (cut) => cut.target <= 201);
    expect(seed).not.toBeNull();

    const cut = selectCut(text, LITERAL, { ...opts, jitterSeed: seed });
    expect(cut.blockIndex).toBe(0);
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

describe('no apply step between briefs 0020a and 0020b', () => {
  it('exports selectCut and countWords only, and touches no state', () => {
    expect(SOURCE).not.toContain('maybeFreeze');
    expect(SOURCE).not.toContain('state.js');
    expect(SOURCE.match(/^export function \w+/gm)).toEqual([
      'export function countWords',
      'export function selectCut',
    ]);
  });

  it('still refuses a cut whose span would end mid-block', () => {
    const text = manuscript(['w0 w1 w2 no terminal punctuation here', buf(100), buf(100)]);
    const cut = selectCut(text, LITERAL, { min: 6, max: 6 });

    expect(cut.blockIndex).toBe(0);
    expect(pushFrozen(createState(), { text: text.slice(0, cut.frozenEnd) })).toBe(false);
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

  it('names no clock, no randomness and no host', () => {
    expect(SOURCE).not.toMatch(/SillyTavern/);
    expect(SOURCE).not.toMatch(/Date\.now/);
    expect(SOURCE).not.toMatch(/Math\.random/);
    expect(SOURCE).not.toMatch(/performance/);
    expect(SOURCE).not.toMatch(/host\.js/);
    expect(SOURCE).not.toMatch(/\b(getState|save|saveMetadata|getCtx)\b/);
  });
});

describe('defaults', () => {
  it('freezes inside the 3,000–4,200 word window on a real-sized manuscript', () => {
    const blocks = [];
    for (let i = 0; i < 60; i += 1) {
      blocks.push(i === 2 || i === 55 ? tag('Mara', 100) : buf(100, `b${i}w`));
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
    expect(FREEZE_DENSE_RADIUS).toBe(2);
  });
});
