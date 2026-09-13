import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { REWRITE_INSTRUCTION, buildRewriteRequest, sanitiseRewrite, restructureStarter } from '../src/starter.js';
import { MANUSCRIPT_SYSTEM_PROMPT } from '../src/prompt.js';
import { reservedLiteral } from '../src/boundary.js';
import { resetBoundaryState, onChatCompletionSettings } from '../src/boundary-host.js';
import { installFakeContext, uninstall } from './helpers/fake-context.js';

const STARTER = 'Mara: She set the lamp down.\n\nAnton: "You came." He did not move from the door.\n\nThe rain went on.';

function ctxWith({ name1 = 'Mara', generateRaw } = {}) {
  const ctx = {
    name1,
    substituteParams: vi.fn((s) => s),
    chat: [],
    chatMetadata: {},
    saveChat: vi.fn(),
    saveMetadata: vi.fn(),
    saveSettingsDebounced: vi.fn(),
    updateMessageBlock: vi.fn(),
    extensionSettings: {},
  };
  if (generateRaw !== null) ctx.generateRaw = generateRaw ?? vi.fn(async () => '');
  return ctx;
}

describe('buildRewriteRequest', () => {
  it('carries MANUSCRIPT_SYSTEM_PROMPT by identity and wraps the starter in <content> before the instruction', () => {
    const { systemPrompt, prompt } = buildRewriteRequest('  a starter.  ', 'Nobody:');
    expect(Object.is(systemPrompt, MANUSCRIPT_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toBe(`<content>\na starter.\n</content>\n\n${REWRITE_INSTRUCTION}`);
    expect(prompt).not.toContain('{{');
  });

  it('assembles <content>, the trimmed starter, </content>, a blank line, then the instruction, and nothing else', () => {
    const { prompt } = buildRewriteRequest('  a starter.  ', 'Nobody:');
    expect(prompt.startsWith('<content>\n')).toBe(true);
    expect(prompt).toContain('\n</content>\n\n');
    expect(prompt.endsWith(REWRITE_INSTRUCTION)).toBe(true);
    expect(prompt.indexOf('a starter.')).toBeLessThan(prompt.indexOf('</content>'));
    expect(prompt.indexOf('</content>')).toBeLessThan(prompt.indexOf(REWRITE_INSTRUCTION));
  });

  it('wraps an empty starter in an empty <content> block', () => {
    expect(buildRewriteRequest('   \n\n ', 'Mara:').prompt).toBe(`<content>\n\n</content>\n\n${REWRITE_INSTRUCTION}`);
    expect(buildRewriteRequest('', 'Mara:').prompt).toBe(`<content>\n\n</content>\n\n${REWRITE_INSTRUCTION}`);
  });

  it('drops a block beginning with the reserved literal but keeps a mid-block mention', () => {
    const { prompt } = buildRewriteRequest(STARTER, 'Mara:');
    expect(prompt).not.toContain('Mara: She set the lamp down.');
    expect(prompt).toContain('Anton: "You came."');

    const mid = buildRewriteRequest('Anton: He said Mara: was late.', 'Mara:').prompt;
    expect(mid).toContain('Anton: He said Mara: was late.');
  });

  it('embeds the starter unchanged when nothing is reserved', () => {
    for (const literal of ['', null, undefined]) {
      expect(buildRewriteRequest(STARTER, literal).prompt).toBe(`<content>\n${STARTER}\n</content>\n\n${REWRITE_INSTRUCTION}`);
    }
  });
});

describe('REWRITE_INSTRUCTION says nothing of mechanics', () => {
  it('equals the shipped replacement string byte-for-byte', () => {
    expect(REWRITE_INSTRUCTION).toBe('Rewrite this opening scene in the tagged-block format described above. Keep every event and line of dialogue; change only the presentation.');
  });

  const WHOLE_WORDS = [
    'edge', 'boundary', 'continue', 'generation', 'turn', 'reply', 'respond',
    'user', 'model', 'reasoning', 'thinking', 'privileged',
  ];

  it.each(WHOLE_WORDS)('contains no whole word %s', (word) => {
    expect(REWRITE_INSTRUCTION).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
  });

  const SUBSTRINGS = [
    'assistant', 'chat', 'message', 'prompt', 'system', 'token', 'span', 'chunk',
    'freeze', 'summarize', 'recap', 'bold', 'italic', 'markdown',
  ];

  it.each(SUBSTRINGS)('contains no occurrence of %s', (word) => {
    expect(REWRITE_INSTRUCTION.toLowerCase()).not.toContain(word);
  });

  it('is one plain-ask line naming no character and embedding no macro', () => {
    expect(REWRITE_INSTRUCTION).not.toMatch(/[\r\n]/);
    expect(REWRITE_INSTRUCTION).not.toContain('{{');
    for (const name of ['Mara', 'Anton', 'SillyTavern']) {
      expect(REWRITE_INSTRUCTION).not.toContain(name);
    }
  });
});

describe('sanitiseRewrite', () => {
  it('removes a leading and a trailing OOC echo', () => {
    const text = `[OOC: The content above is unoptimised for the creative writing task.]\nAnton: "Here."\n[OOC: done]`;
    expect(sanitiseRewrite(text, 'Mara:')).toBe('Anton: "Here."');
  });

  it('removes a leading and a trailing <content> wrapper echo', () => {
    const text = '<content>\nAnton: "Here."\n</content>';
    expect(sanitiseRewrite(text, 'Mara:')).toBe('Anton: "Here."');
  });

  it('removes an enclosing fence with and without a language word', () => {
    expect(sanitiseRewrite('```\nAnton: "Here."\n```', 'Mara:')).toBe('Anton: "Here."');
    expect(sanitiseRewrite('```text\nAnton: "Here."\n```', 'Mara:')).toBe('Anton: "Here."');
    expect(sanitiseRewrite('````md\nAnton: "Here."\n````', 'Mara:')).toBe('Anton: "Here."');
  });

  it('keeps a block headed by the reserved literal', () => {
    const text = 'Mara: She set the lamp down.\n\nAnton: "You came."';
    expect(sanitiseRewrite(text, 'Mara:')).toBe(text);
  });

  it('keeps a mid-block occurrence of the literal', () => {
    expect(sanitiseRewrite('Anton: He said Mara: was late.', 'Mara:')).toBe('Anton: He said Mara: was late.');
  });

  it('keeps an all-reserved answer and never returns undefined', () => {
    expect(sanitiseRewrite('Mara: One.\n\nMara: Two.', 'Mara:')).toBe('Mara: One.\n\nMara: Two.');
    expect(sanitiseRewrite('', 'Mara:')).toBe('');
    expect(sanitiseRewrite(undefined, 'Mara:')).toBe('');
  });
});

describe('restructureStarter', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls generateRaw once with exactly one { prompt, systemPrompt } object', async () => {
    const generateRaw = vi.fn(async () => 'Anton: "Here."');
    const ctx = ctxWith({ generateRaw });
    const result = await restructureStarter(STARTER, ctx);

    expect(generateRaw).toHaveBeenCalledTimes(1);
    expect(generateRaw.mock.calls[0]).toHaveLength(1);
    const options = generateRaw.mock.calls[0][0];
    expect(Object.keys(options).sort()).toEqual(['prompt', 'systemPrompt']);
    const expected = buildRewriteRequest(STARTER, reservedLiteral(ctx));
    expect(options.prompt).toBe(expected.prompt);
    expect(Object.is(options.systemPrompt, MANUSCRIPT_SYSTEM_PROMPT)).toBe(true);
    expect(result).toBe(sanitiseRewrite('Anton: "Here."'));
  });

  it('strips the fence from the raw result and keeps the reserved blocks', async () => {
    const generateRaw = vi.fn(async () => '```\nMara: She set the lamp down.\n\nAnton: "Here."\n```');
    await expect(restructureStarter(STARTER, ctxWith({ generateRaw }))).resolves
      .toBe('Mara: She set the lamp down.\n\nAnton: "Here."');
  });

  it('resolves empty with one console.error when generateRaw rejects', async () => {
    const generateRaw = vi.fn(async () => {
      throw new Error('nope');
    });
    await expect(restructureStarter(STARTER, ctxWith({ generateRaw }))).resolves.toBe('');
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('resolves empty without calling anything when the host has no generateRaw', async () => {
    const ctx = ctxWith({ generateRaw: null });
    await expect(restructureStarter(STARTER, ctx)).resolves.toBe('');
    expect('generateRaw' in ctx).toBe(false);
    expect(ctx.substituteParams).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('touches nothing else on the context', async () => {
    const ctx = ctxWith({ generateRaw: vi.fn(async () => 'Anton: "Here."') });
    await restructureStarter(STARTER, ctx);
    expect(ctx.chat).toEqual([]);
    expect(ctx.chatMetadata).toEqual({});
    expect(ctx.extensionSettings).toEqual({});
    for (const key of ['saveChat', 'saveMetadata', 'saveSettingsDebounced', 'updateMessageBlock']) {
      expect(ctx[key]).not.toHaveBeenCalled();
    }
  });
});

describe('the boundary suspension is released either way', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resetBoundaryState();
    installFakeContext({ name1: 'Mara', substituteParams: vi.fn((t) => (t === '{{user}}' ? 'Mara' : t)) });
  });

  afterEach(() => {
    uninstall();
    resetBoundaryState();
    vi.restoreAllMocks();
  });

  it('suspends the request-side stop string for the duration of the call', async () => {
    let duringCall;
    const generateRaw = vi.fn(async () => {
      duringCall = {};
      onChatCompletionSettings(duringCall);
      return 'Anton: "Here."';
    });
    await restructureStarter(STARTER, ctxWith({ generateRaw }));
    expect(duringCall).toEqual({});
  });

  it('releases when generateRaw resolves', async () => {
    await restructureStarter(STARTER, ctxWith({ generateRaw: vi.fn(async () => 'Anton: "Here."') }));
    const body = {};
    onChatCompletionSettings(body);
    expect(body.stop).toEqual(['Mara:']);
  });

  it('releases when generateRaw rejects', async () => {
    const generateRaw = vi.fn(async () => {
      throw new Error('nope');
    });
    await restructureStarter(STARTER, ctxWith({ generateRaw }));
    const body = {};
    onChatCompletionSettings(body);
    expect(body.stop).toEqual(['Mara:']);
  });

  it('takes no suspension when the host exposes no generateRaw', async () => {
    await restructureStarter(STARTER, ctxWith({ generateRaw: null }));
    const body = {};
    onChatCompletionSettings(body);
    expect(body.stop).toEqual(['Mara:']);
  });
});

describe('module hygiene', () => {
  const source = readFileSync('src/starter.js', 'utf8');

  it('names no host global and reaches nothing over the wire', () => {
    for (const forbidden of ['SillyTavern', 'innerHTML', 'jQuery', '$(', 'fetch', 'merge-attributes', 'generateQuietPrompt', 'eventSource']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('emits no event and writes no chat', () => {
    for (const forbidden of ['saveChat', 'saveMetadata', 'emit(', 'ctx.chat', 'chatMetadata']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
