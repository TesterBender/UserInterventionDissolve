import { describe, it, expect } from 'vitest';
import {
  parseManuscript,
  parseTagHeader,
  classifyActor,
  groupSpans,
  findTagLiteral,
  isTrailingBlockComplete,
  lastCompleteBoundary,
  truncateToLastCompleteBlock,
} from '../src/grammar.js';

describe('parseManuscript', () => {
  it('splits on the blank-line delimiter and round-trips offsets', () => {
    const text = 'Anton: sets the cup down.\n\nThe room is quiet.';
    const blocks = parseManuscript(text);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(text.slice(block.start, block.end)).toBe(block.raw);
    }
  });

  it('treats a run of blank lines as one delimiter and keeps single newlines inside a block', () => {
    const text = 'Anton: one.\nStill one.\n\n   \n\nA second block.';
    const blocks = parseManuscript(text);
    expect(blocks.map((b) => b.raw)).toEqual(['Anton: one.\nStill one.', 'A second block.']);
  });

  it('parses CRLF input the same way', () => {
    const text = 'Anton: one.\r\n\r\nA second block.';
    const blocks = parseManuscript(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].actor).toBe('Anton');
    expect(blocks[1].raw).toBe('A second block.');
  });

  it('ignores leading and trailing blank lines', () => {
    const text = '\n\n  Anton: one.\n\n\n';
    const blocks = parseManuscript(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].raw).toBe('Anton: one.');
    expect(text.slice(blocks[0].start, blocks[0].end)).toBe('Anton: one.');
  });

  it('returns no blocks for empty or whitespace-only input', () => {
    expect(parseManuscript('')).toEqual([]);
    expect(parseManuscript('   \n \n\t')).toEqual([]);
    expect(lastCompleteBoundary('')).toBe(0);
    expect(isTrailingBlockComplete('')).toBe(false);
  });

  it('classifies tag blocks with actor and header-stripped body, buffers with actor null', () => {
    const blocks = parseManuscript('Anton: sets the cup down.\n\nThe room is quiet.');
    expect(blocks[0]).toMatchObject({ kind: 'tag', actor: 'Anton', body: 'sets the cup down.' });
    expect(blocks[1]).toMatchObject({ kind: 'buffer', actor: null, body: 'The room is quiet.' });
  });

  it('marks every block but the trailing one complete', () => {
    const blocks = parseManuscript('Anton: one.\n\nan unfinished trail');
    expect(blocks[0].complete).toBe(true);
    expect(blocks[1].complete).toBe(false);
  });
});

describe('parseTagHeader', () => {
  it('accepts actor names with spaces, hyphens and apostrophes', () => {
    expect(parseTagHeader('The Innkeeper: pours.').actor).toBe('The Innkeeper');
    expect(parseTagHeader('Jean-Luc: nods.').actor).toBe('Jean-Luc');
    expect(parseTagHeader("D'Vora: waits.").actor).toBe("D'Vora");
  });

  it('accepts a header that is the whole block', () => {
    expect(parseTagHeader('Anton:')).toEqual({ actor: 'Anton', body: '' });
  });

  it('rejects non-tags', () => {
    expect(parseTagHeader('12:30 by the clock.')).toBeNull();
    // tag-header: lowercase attribution now parses as a tag → docs/modules/grammar.md#tag-header
    expect(parseTagHeader('she said: "no"')).toEqual({ actor: 'she said', body: '"no"' });
    expect(parseTagHeader('The cup: it was empty.')).not.toBeNull();
    // tag-header: period+space in a leading sentence is itself a matched tag → docs/modules/grammar.md#tag-header
    expect(parseTagHeader('He turned. Anton: sets the cup down.')).toEqual({
      actor: 'He turned. Anton',
      body: 'sets the cup down.',
    });
    expect(parseTagHeader('  Anton: sets the cup down.')).toBeNull();
  });

  it('parses a lowercase single-word tag with the actor preserved verbatim', () => {
    expect(parseTagHeader('anton: waits.')).toEqual({ actor: 'anton', body: 'waits.' });
  });

  it('accepts long multi-word tags with an article', () => {
    expect(parseTagHeader('The tall woman in the doorway: steps back.').actor).toBe(
      'The tall woman in the doorway',
    );
  });

  it('accepts digits, periods and unicode letters inside a tag', () => {
    expect(parseTagHeader('Guard 2: nods.').actor).toBe('Guard 2');
    expect(parseTagHeader('Dr. Weiss: frowns.').actor).toBe('Dr. Weiss');
    expect(parseTagHeader('Élodie: waits.').actor).toBe('Élodie');
    expect(parseTagHeader('Zoë: waits.').actor).toBe('Zoë');
  });

  it('rejects a block that opens with a quote mark', () => {
    expect(parseTagHeader('"No," she said.')).toBeNull();
  });

  it('rejects an empty tag part', () => {
    expect(parseTagHeader(': nothing.')).toBeNull();
  });

  it('rejects a tag part longer than 40 characters', () => {
    const longTag = 'A'.repeat(41);
    expect(parseTagHeader(`${longTag}: waits.`)).toBeNull();
  });

  it('rejects a colon that appears only on the block\'s second line', () => {
    expect(parseTagHeader('He turned.\nAnton: waits.')).toBeNull();
  });

  it('parses the previously-rejected shapes as tag or buffer blocks', () => {
    const blocks = parseManuscript('12:30 by the clock.\n\nshe said: "no"\n\nHe turned. Anton: left.');
    expect(blocks.map((b) => b.kind)).toEqual(['buffer', 'tag', 'tag']);
    expect(blocks.map((b) => b.actor)).toEqual([null, 'she said', 'He turned. Anton']);
  });
});

describe('groupSpans', () => {
  function spansOf(text) {
    return groupSpans(parseManuscript(text));
  }

  it('opens a span on an own-line header and carries it across paragraphs', () => {
    const text = 'Anton:\nHe set the folder down.\n\nFor several seconds he said nothing.\n\nHe waited.';
    const spans = spansOf(text);

    expect(spans).toHaveLength(1);
    expect(spans[0].header).toBe('Anton');
    expect(spans[0].neutral).toBe(false);
    expect(spans[0].blockIndices).toEqual([0, 1, 2]);
    expect(text.slice(spans[0].start, spans[0].end)).toBe(text);
  });

  it('opens a span on the legacy inline header too', () => {
    const spans = spansOf('Anton: he set the folder down.\n\nHe waited.');

    expect(spans).toHaveLength(1);
    expect(spans[0].header).toBe('Anton');
    expect(spans[0].blockIndices).toEqual([0, 1]);
  });

  it('opens a neutral span on the reserved neutral header only', () => {
    const text = 'Anton:\nHe waited.\n\n∅:\nRain worked against the windows.\n\nSomewhere a door shut.';
    const spans = spansOf(text);

    expect(spans.map((span) => span.header)).toEqual(['Anton', '∅']);
    expect(spans.map((span) => span.neutral)).toEqual([false, true]);
    expect(spans[1].blockIndices).toEqual([1, 2]);
    expect(spansOf('∅ the empty set.\n\nRain fell.').map((span) => span.neutral)).toEqual([false]);
  });

  it('gives a leading header-less run its own span with a null header', () => {
    const text = 'Rain fell.\n\nThe street emptied.\n\nAnton:\nHe waited.';
    const spans = spansOf(text);

    expect(spans).toHaveLength(2);
    expect(spans[0].header).toBeNull();
    expect(spans[0].neutral).toBe(false);
    expect(spans[0].blockIndices).toEqual([0, 1]);
    expect(spans[1].header).toBe('Anton');
  });

  it('makes two consecutive header blocks two one-block spans', () => {
    const spans = spansOf('Anton:\n\nBela: she nods.\n\n∅: rain.');

    expect(spans.map((span) => span.blockIndices)).toEqual([[0], [1], [2]]);
    expect(spans.map((span) => span.header)).toEqual(['Anton', 'Bela', '∅']);
  });

  it('covers exactly its own blocks with start and end, and returns [] for []', () => {
    const text = 'Rain fell.\n\nAnton:\nHe waited.\n\nStill nothing.\n\n∅:\nThe storm moved east.';
    const blocks = parseManuscript(text);
    const spans = groupSpans(blocks);

    for (const span of spans) {
      const first = blocks[span.blockIndices[0]];
      const last = blocks[span.blockIndices[span.blockIndices.length - 1]];
      expect(span.start).toBe(first.start);
      expect(span.end).toBe(last.end);
      expect(text.slice(span.start, span.end).startsWith(first.raw)).toBe(true);
      expect(text.slice(span.start, span.end).endsWith(last.raw)).toBe(true);
    }
    expect(spans.flatMap((span) => span.blockIndices)).toEqual(blocks.map((_, i) => i));
    expect(groupSpans([])).toEqual([]);
  });
});

describe('classifyActor', () => {
  it('reports individual and aggregate', () => {
    expect(classifyActor('anton', ['Anton'])).toBe('individual');
    expect(classifyActor('Anton', new Set(['Anton']))).toBe('individual');
    expect(classifyActor('The guards', ['Anton'])).toBe('aggregate');
    expect(classifyActor('Everyone', ['Anton'])).toBe('aggregate');
  });
});

describe('findTagLiteral', () => {
  it('finds a bare literal at offset 0 with no preceding newline', () => {
    expect(findTagLiteral('Mara: steps in.', 'Mara')).toEqual([{ index: 0, atBlockStart: true }]);
  });

  it('distinguishes block-start occurrences from occurrences inside prose', () => {
    const text = 'Anton: he read "Mara: steps in." aloud.\n\nMara: steps in.';
    const found = findTagLiteral(text, 'Mara');
    expect(found).toHaveLength(2);
    expect(found[0].atBlockStart).toBe(false);
    expect(found[1].atBlockStart).toBe(true);
    expect(text.slice(found[1].index, found[1].index + 5)).toBe('Mara:');
  });

  it('returns nothing when the literal is absent', () => {
    expect(findTagLiteral('Anton: waits.', 'Mara')).toEqual([]);
  });
});

describe('completeness', () => {
  it('is false for a manuscript ending mid-sentence', () => {
    expect(isTrailingBlockComplete('Anton: one.\n\nHe reached for the')).toBe(false);
  });

  it('is false for an odd number of double quotes', () => {
    expect(isTrailingBlockComplete('Anton: he said, "no.')).toBe(false);
  });

  it('is true for terminal punctuation, with or without a closing quote', () => {
    expect(isTrailingBlockComplete('Anton: sets the cup down.')).toBe(true);
    expect(isTrailingBlockComplete('Anton: he said, "no."')).toBe(true);
    expect(isTrailingBlockComplete('Anton: waits…')).toBe(true);
    expect(isTrailingBlockComplete('Anton: really?)')).toBe(true);
    expect(isTrailingBlockComplete('Anton: sets the cup down.  \n')).toBe(true);
  });

  it('is true when the trailing block is followed by a delimiter', () => {
    expect(isTrailingBlockComplete('Anton: no closing punctuation\n\n')).toBe(true);
  });
});

describe('lastCompleteBoundary and truncateToLastCompleteBlock', () => {
  it('drops an incomplete trailing block with no partial text and no trailing delimiter', () => {
    const text = 'Anton: one.\n\nThe room is quiet.\n\nHe reached for the';
    const boundary = lastCompleteBoundary(text);
    expect(text.slice(0, boundary)).toBe('Anton: one.\n\nThe room is quiet.');
    expect(truncateToLastCompleteBlock(text)).toBe('Anton: one.\n\nThe room is quiet.');
  });

  it('returns the whole trimmed text for a fully complete manuscript', () => {
    const text = 'Anton: one.\n\nThe room is quiet.\n\n';
    expect(truncateToLastCompleteBlock(text)).toBe('Anton: one.\n\nThe room is quiet.');
  });

  it('returns 0 and an empty string when no block is complete', () => {
    expect(lastCompleteBoundary('He reached for the')).toBe(0);
    expect(truncateToLastCompleteBlock('He reached for the')).toBe('');
  });
});

describe('module purity', () => {
  it('references no host API and no character name', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(`${process.cwd()}/src/grammar.js`, 'utf8');
    for (const forbidden of ['SillyTavern', 'getContext', 'window', 'document', 'Mara', 'Anton']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
