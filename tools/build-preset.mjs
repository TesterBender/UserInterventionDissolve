#!/usr/bin/env node
// preset-bundle: downloadable reference preset, not a runtime injection → docs/modules/preset.md#why-a-preset
// no-continuation-in-preset: the continuation control is a reconstructed user turn → docs/modules/preset.md#not-the-continuation-string
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANUSCRIPT_SYSTEM_PROMPT } from '../src/prompt.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRESET_DIR = join(ROOT, 'presets');
const PRESET_NAME = 'Manuscript Protocol';

// preset-template-fields: only prompts + prompt_order; character_id 100001 → docs/modules/preset.md#template-fields
// stock-order: Default.json order verbatim, markers left to ST auto-fill → docs/modules/preset.md#default-order-and-markers
const TEMPLATE = Object.freeze({
  prompts: [
    { identifier: 'main', name: 'Main Prompt', role: 'system', system_prompt: true, content: MANUSCRIPT_SYSTEM_PROMPT },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'personaDescription', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'charPersonality', enabled: true },
        { identifier: 'scenario', enabled: true },
        { identifier: 'enhanceDefinitions', enabled: false },
        { identifier: 'nsfw', enabled: true },
        { identifier: 'worldInfoAfter', enabled: true },
        { identifier: 'dialogueExamples', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'jailbreak', enabled: true },
      ],
    },
  ],
});

// filename-is-the-name: openai import names the preset from the file → docs/modules/preset.md#filename-is-the-preset-name
export function buildPresets() {
  return {
    [`${PRESET_NAME}.json`]: JSON.parse(JSON.stringify(TEMPLATE)),
    'manuscript-protocol.sysprompt.json': { name: PRESET_NAME, content: MANUSCRIPT_SYSTEM_PROMPT },
  };
}

// generated-never-edited: regenerate with npm run build:preset → docs/modules/preset.md#single-source-of-truth
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(PRESET_DIR, { recursive: true });
  for (const [filename, preset] of Object.entries(buildPresets())) {
    writeFileSync(join(PRESET_DIR, filename), `${JSON.stringify(preset, null, 2)}\n`, 'utf8');
  }
}
