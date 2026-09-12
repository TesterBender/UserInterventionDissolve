import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MANUSCRIPT_SYSTEM_PROMPT, CONTINUATION_CONTROL } from '../src/prompt.js';

const EXPECTED_PROMPT = `This is a piece of creative writing shaped by what is already on the page: the voices, the unfinished gestures, the things characters have begun but not yet completed. Write it as prose that feels particular and sensory, and let it be strange when the story wants to be strange.

The narrative follows a simple format.

The text is written in blocks, with a blank line between each one. A block is either tagged to a figure or left as narration.

A tagged block begins with a tag followed by a colon. Everything inside that block belongs to that figure: what they say, what they do, what they choose, what they notice, what they intend, and how they understand what is happening.

The tag does not have to be a person's name. It can simply be whatever the story currently knows them as. If the story later gives them a name, the tag can change with it.

\`\`\`
Idris: sets the cup down. "No."

The tall one: laughs before she has decided to.

Guards: lower their spears together.

The dog: refuses the doorway.
\`\`\`

Narration sits between these tagged blocks and carries the parts of the scene that do not belong to anyone's individual choice: light, weather, distance, passing time, sound, atmosphere, or the physical consequences of something already set in motion.

It can carry an action forward, but it should not quietly make a new decision on someone's behalf.

Noticing is not the same as making something happen. A figure can watch another, guess at them, expect something from them, or misunderstand what they mean, but another figure's speech, action, choice, or acceptance belongs in that figure's own block. If the page has not yet given them that moment, leave it open. A plate set down can be an offer; it does not become a meal until someone actually takes it.

When what comes next belongs to another figure, the page is allowed to wait for them. Everyone else can keep speaking, moving, noticing, or doing whatever is theirs to do around that gap without filling it in on their behalf.

If a tagged figure begins something or holds an intention, that can continue across later narration until the story gives it a reason to stop, change, or be interrupted.

A group tag can stand for several figures while they are still moving together or remain individually indistinct. Once one of them becomes distinct enough to receive their own tag, their actions and choices belong to them separately.

The purpose of the tags is simply to keep the page clear about who is speaking, acting, noticing, or choosing, without forcing the prose into a conventional script.

Beyond that, follow the story where it leads.

The story ends when it has reached its ending.`;

const EXPECTED_CONTROL = 'Continue the manuscript directly from the current endpoint. Preserve established causal, stylistic, perspectival, and formatting continuity. Do not recap, restart, summarize, or force resolution.';

const SOURCE = readFileSync('src/prompt.js', 'utf8');

const FENCE_LINES = MANUSCRIPT_SYSTEM_PROMPT.split('\n');
const FENCE_START = FENCE_LINES.indexOf('```');
const FENCE_END = FENCE_LINES.indexOf('```', FENCE_START + 1);
const LADDER = FENCE_LINES.slice(FENCE_START + 1, FENCE_END).filter((line) => line.length > 0);

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

  // continue-exemption: fictional persistence phrase, not transport → docs/modules/prompt.md#says-nothing-of-mechanics
  const CONTINUE_EXEMPT_PHRASE = 'that can continue across later narration';

  it.each(WHOLE_WORDS)('contains no whole word %s outside the documented exemption', (word) => {
    const withoutExemption = MANUSCRIPT_SYSTEM_PROMPT.replace(CONTINUE_EXEMPT_PHRASE, '');
    expect(withoutExemption).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
  });

  it('confines the sole "continue" occurrence to the documented exemption', () => {
    const matches = MANUSCRIPT_SYSTEM_PROMPT.match(/\bcontinue\b/gi) ?? [];
    expect(matches).toHaveLength(1);
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain(CONTINUE_EXEMPT_PHRASE);
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
    const notPersonalNames = ['This', 'Write', 'The', 'A', 'Everything', 'It', 'If', 'No', 'Guards', 'Narration', 'Once', 'Beyond', 'Noticing', 'When', 'Everyone'];
    for (const word of notPersonalNames) capitalised.delete(word);
    expect([...capitalised]).toEqual(['Idris']);
  });
});

describe('the tag ladder', () => {
  it('is exactly four fenced example lines', () => {
    expect(LADDER).toHaveLength(4);
    for (const line of LADDER) {
      expect(line).toMatch(/^[^\n:]{1,40}: .+$/);
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
    const sentence = MANUSCRIPT_SYSTEM_PROMPT.split('\n').find((line) => line.includes('belongs to that figure:'));
    for (const item of ['what they say', 'what they do', 'what they choose', 'what they notice', 'what they intend', 'how they understand what is happening']) {
      expect(sentence).toContain(item);
    }
  });

  it('names an unnamed figure by how the page currently knows them', () => {
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('It can simply be whatever the story currently knows them as.');
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('If the story later gives them a name, the tag can change with it.');
  });

  it('states blank-line separation, single ownership, integrating narration and anonymous-only groups', () => {
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('The text is written in blocks, with a blank line between each one.');
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('Everything inside that block belongs to that figure');
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('it should not quietly make a new decision on someone\'s behalf.');
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('A group tag can stand for several figures while they are still moving together');
    expect(MANUSCRIPT_SYSTEM_PROMPT).toContain('their actions and choices belong to them separately');
  });

  it('stays short', () => {
    expect(MANUSCRIPT_SYSTEM_PROMPT.match(/[A-Za-z'’]+/g)).toHaveLength(462);
  });
});

describe('src/prompt.js', () => {
  it('exports exactly three constants and declares no function', async () => {
    const module = await import('../src/prompt.js');
    expect(Object.keys(module).sort()).toEqual([
      'CONTINUATION_CONTROL',
      'MANUSCRIPT_SYSTEM_PROMPT',
      'SOLO_CONTINUATION_CONTROL',
    ]);
    for (const value of Object.values(module)) expect(typeof value).toBe('string');
    expect(SOURCE).not.toMatch(/\bfunction\b|=>/);
  });

  it('touches no host', () => {
    for (const forbidden of ['SillyTavern', 'getContext', 'window', 'document', 'import']) {
      expect(SOURCE).not.toContain(forbidden);
    }
  });
});
