import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MANUSCRIPT_SYSTEM_PROMPT, CONTINUATION_CONTROL } from '../src/prompt.js';

const EXPECTED_PROMPT = `This is a piece of creative writing, shaped entirely by what already stands on the page — the voices, the unfinished gestures. Write into it as prose: particular, sensory, willing to be strange.

A few formatting rules govern the narrative.

Text is set in blocks separated by a blank line. Each block is tagged or it is narration.

A tagged block opens with a tag and a colon. What follows belongs to that figure alone — speech, action, choice, intent, attention, private interpretation. A tag need not be a person's name; it marks one discrete figure, or one group moving as a single body. A figure not yet named is tagged by how the page knows them, and takes a name once the story grants one:

    Idris: sets the cup down. "No."
    The tall one: laughs before she has decided to.
    Guards: lower their spears together.
    The dog: refuses the doorway.

Narration between tags carries the world rather than the will: light, distance, elapsed time, the settling of what was already chosen. It integrates; it does not decide for anyone.

An intention, once tagged, holds until something ends it; later narration may carry it forward.

A group tag stands for those still anonymous within it; once someone is drawn out and tagged alone, their choices are their own. Tags keep who did what legible.

The story closes when the story does.`;

const EXPECTED_CONTROL = 'Continue the manuscript directly from the current endpoint. Preserve established causal, stylistic, perspectival, and formatting continuity. Do not recap, restart, summarize, or force resolution.';

const SOURCE = readFileSync('src/prompt.js', 'utf8');

const LADDER = MANUSCRIPT_SYSTEM_PROMPT.split('\n').filter((line) => /^\s+\S/.test(line));

describe('approved texts', () => {
  it('ships MANUSCRIPT_SYSTEM_PROMPT byte-for-byte', () => {
    expect(MANUSCRIPT_SYSTEM_PROMPT).toBe(EXPECTED_PROMPT);
  });

  it('ships CONTINUATION_CONTROL byte-for-byte', () => {
    expect(CONTINUATION_CONTROL).toBe(EXPECTED_CONTROL);
  });

  it('keeps CONTINUATION_CONTROL a single stable line', async () => {
    const again = await import('../src/prompt.js');
    expect(Object.is(CONTINUATION_CONTROL, again.CONTINUATION_CONTROL)).toBe(true);
    expect(CONTINUATION_CONTROL).not.toMatch(/[\r\n]/);
    expect(CONTINUATION_CONTROL).toBe(CONTINUATION_CONTROL.trim());
  });
});

describe('MANUSCRIPT_SYSTEM_PROMPT says nothing of mechanics', () => {
  const WHOLE_WORDS = [
    'edge',
    'boundary',
    'continue',
    'generation',
    'turn',
    'reply',
    'respond',
    'user',
    'model',
    'reasoning',
    'thinking',
    'privileged',
  ];

  it.each(WHOLE_WORDS)('contains no whole word %s', (word) => {
    expect(MANUSCRIPT_SYSTEM_PROMPT).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
  });

  const SUBSTRINGS = [
    'assistant',
    'chat',
    'message',
    'prompt',
    'token',
    'span',
    'chunk',
    'freeze',
    'summarize',
    'recap',
    'bold',
    'italic',
    'markdown',
  ];

  it.each(SUBSTRINGS)('contains no occurrence of %s', (word) => {
    expect(MANUSCRIPT_SYSTEM_PROMPT.toLowerCase()).not.toContain(word);
  });

  it('names no real character, embeds no macro', () => {
    expect(MANUSCRIPT_SYSTEM_PROMPT).not.toContain('{{');
    expect(MANUSCRIPT_SYSTEM_PROMPT).not.toContain('Mara');
    const capitalised = new Set(MANUSCRIPT_SYSTEM_PROMPT.match(/[A-Z][A-Za-z'’]*/g));
    const notPersonalNames = ['This', 'Write', 'A', 'Text', 'Each', 'What', 'No', 'The', 'Narration', 'It', 'An', 'Tags', 'Guards'];
    for (const word of notPersonalNames) capitalised.delete(word);
    expect([...capitalised]).toEqual(['Idris']);
  });
});

describe('the tag ladder', () => {
  it('is exactly four consecutive indented example lines', () => {
    expect(LADDER).toHaveLength(4);
    const lines = MANUSCRIPT_SYSTEM_PROMPT.split('\n');
    const first = lines.indexOf(LADDER[0]);
    expect(lines.slice(first, first + 4)).toEqual(LADDER);
    for (const line of LADDER) {
      expect(line).toMatch(/^\s+[^\n:]{1,40}: .+$/);
    }
  });

  it('escalates to a collective and a non-personal agent', () => {
    const tags = LADDER.map((line) => line.trim().split(':')[0]);
    expect(tags).toEqual(['Idris', 'The tall one', 'Guards', 'The dog']);
  });

  it('offers no environmental-force tag', () => {
    const tags = LADDER.map((line) => line.trim().split(':')[0]);
    for (const tag of tags) {
      expect(tag).not.toMatch(/fire|flame|smoke|wind|storm|rain|weather|tide|sea|river|night|dark|cold/i);
    }
  });
});

describe('the grammar commitments', () => {
  it('gives a tagged block every kind of interiority', () => {
    const sentence = MANUSCRIPT_SYSTEM_PROMPT.split('\n').find((line) => line.includes('belongs to that figure alone'));
    for (const item of ['speech', 'action', 'choice', 'intent', 'attention', 'private interpretation']) {
      expect(sentence).toContain(item);
    }
  });

  it('names an unnamed figure by how the page knows them', () => {
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('A figure not yet named is tagged by how the page knows them');
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('takes a name once the story grants one');
  });

  it('states blank-line separation, single ownership, integrating narration and anonymous-only groups', () => {
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('Text is set in blocks separated by a blank line.');
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('What follows belongs to that figure alone');
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('It integrates; it does not decide for anyone.');
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('A group tag stands for those still anonymous within it');
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('their choices are their own');
  });

  it('holds a tagged intention until something ends it', () => {
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('An intention, once tagged, holds until something ends it');
  });

  it('stays short', () => {
    expect(MANUSCRIPT_SYSTEM_PROMPT.match(/[A-Za-z'’]+/g)).toHaveLength(229);
  });
});

describe('src/prompt.js', () => {
  it('exports exactly two constants and declares no function', async () => {
    const module = await import('../src/prompt.js');
    expect(Object.keys(module).sort()).toEqual(['CONTINUATION_CONTROL', 'MANUSCRIPT_SYSTEM_PROMPT']);
    for (const value of Object.values(module)) expect(typeof value).toBe('string');
    expect(SOURCE).not.toMatch(/\bfunction\b|=>/);
  });

  it('touches no host', () => {
    for (const forbidden of ['SillyTavern', 'getContext', 'window', 'document', 'import']) {
      expect(SOURCE).not.toContain(forbidden);
    }
  });
});
