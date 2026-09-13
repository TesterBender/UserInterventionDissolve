import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildPresets } from '../src/preset-template.js';
import { MANUSCRIPT_SYSTEM_PROMPT, CONTINUATION_CONTROL, TAKE_STOCK_PROMPT } from '../src/prompt.js';

const PRESET_DIR = 'presets';
const OPENAI_FILE = 'Manuscript Protocol.json';
const SYSPROMPT_FILE = 'manuscript-protocol.sysprompt.json';
const PRESET_NAME = 'Manuscript Protocol';

const DEFAULT_ORDER = [
  'main', 'uidTakeStock', 'worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario',
  'enhanceDefinitions', 'nsfw', 'worldInfoAfter', 'dialogueExamples', 'chatHistory', 'jailbreak',
];

const built = buildPresets();
const raw = (name) => readFileSync(join(PRESET_DIR, name), 'utf8');

describe('committed preset files', () => {
  it('are exactly the files the generator produces', () => {
    expect(readdirSync(PRESET_DIR).sort()).toEqual(Object.keys(built).sort());
  });

  it('deep-equal the generator output (fails if src/prompt.js changed without a rebuild)', () => {
    for (const [filename, preset] of Object.entries(built)) {
      expect(JSON.parse(raw(filename))).toEqual(preset);
    }
  });

  it('are 2-space-indented JSON with a single trailing newline', () => {
    for (const filename of Object.keys(built)) {
      const text = raw(filename);
      expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
    }
  });
});

describe('openai preset', () => {
  const preset = built[OPENAI_FILE];

  it('ships only prompts and prompt_order, with no top-level name', () => {
    expect(Object.keys(preset).sort()).toEqual(['prompt_order', 'prompts']);
    expect('name' in preset).toBe(false);
  });

  it('carries the system prompt verbatim in the main entry and the take-stock text in a second entry', () => {
    expect(preset.prompts).toHaveLength(2);
    expect(preset.prompts[0]).toEqual({
      identifier: 'main',
      name: 'Main Prompt',
      role: 'system',
      system_prompt: true,
      content: MANUSCRIPT_SYSTEM_PROMPT,
    });
    expect(preset.prompts[1]).toEqual({
      identifier: 'uidTakeStock',
      name: 'Take stock (thinking models)',
      role: 'system',
      content: TAKE_STOCK_PROMPT,
    });
  });

  it('targets the live openai dummyId 100001 as a number', () => {
    expect(preset.prompt_order).toHaveLength(1);
    expect(preset.prompt_order[0].character_id).toBe(100001);
  });

  it('writes out the stock order with uidTakeStock immediately after main and enhanceDefinitions the only other disabled entry', () => {
    const { order } = preset.prompt_order[0];
    expect(order).toHaveLength(13);
    expect(order.map((entry) => entry.identifier)).toEqual(DEFAULT_ORDER);
    expect(order[1]).toEqual({ identifier: 'uidTakeStock', enabled: false });
    for (const entry of order) {
      const shouldBeEnabled = entry.identifier !== 'enhanceDefinitions' && entry.identifier !== 'uidTakeStock';
      expect(entry.enabled).toBe(shouldBeEnabled);
    }
  });

  it('takes its preset name from the filename, which README.md names', () => {
    expect(OPENAI_FILE.replace(/\.[^/.]+$/, '')).toBe(PRESET_NAME);
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain(`presets/${OPENAI_FILE}`);
    expect(readme).toContain(`presets/${SYSPROMPT_FILE}`);
  });
});

describe('sysprompt template', () => {
  it('is name + content from the same constant', () => {
    expect(built[SYSPROMPT_FILE]).toEqual({ name: PRESET_NAME, content: MANUSCRIPT_SYSTEM_PROMPT });
  });
});

describe('the continuation control is not preset material', () => {
  it('appears in no generated file, in whole or in part', () => {
    const sentences = CONTINUATION_CONTROL.split('. ').filter(Boolean);
    for (const filename of Object.keys(built)) {
      const text = raw(filename);
      expect(text).not.toContain(CONTINUATION_CONTROL);
      for (const sentence of sentences) expect(text).not.toContain(sentence);
    }
  });

  it('is not imported by the generator', () => {
    expect(readFileSync('tools/build-preset.mjs', 'utf8')).not.toContain('CONTINUATION_CONTROL');
    expect(readFileSync('src/preset-template.js', 'utf8')).not.toContain('CONTINUATION_CONTROL');
  });
});

describe('the generator', () => {
  it('writes nothing when imported', () => {
    const mtimes = () => readdirSync(PRESET_DIR).map((name) => statSync(join(PRESET_DIR, name)).mtimeMs);
    const before = mtimes();
    execFileSync(process.execPath, ['--input-type=module', '-e', "await import('./tools/build-preset.mjs');"]);
    expect(mtimes()).toEqual(before);
  });
});

describe('README.md', () => {
  const readme = readFileSync('README.md', 'utf8');

  it('documents the import path with the verified UI labels', () => {
    expect(readme).toContain('## Import the reference preset');
    expect(readme).toContain('AI Response Configuration');
    expect(readme).toContain('Chat Completion Presets');
    expect(readme).toContain('Import preset');
  });
});
