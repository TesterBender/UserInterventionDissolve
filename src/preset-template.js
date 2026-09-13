// shared-template: one browser-safe source for generator, test and button → docs/modules/preset.md#shared-template
// no-continuation-in-preset: the continuation control is a reconstructed user turn → docs/modules/preset.md#not-the-continuation-string
import { MANUSCRIPT_SYSTEM_PROMPT, TAKE_STOCK_PROMPT } from './prompt.js';

// filename-is-the-name: openai import names the preset from the file → docs/modules/preset.md#filename-is-the-preset-name
export const PRESET_NAME = 'Manuscript Protocol';
export const OPENAI_PRESET_FILE = `${PRESET_NAME}.json`;

// preset-template-fields: only prompts + prompt_order; character_id 100001 → docs/modules/preset.md#template-fields
// stock-order: Default.json order verbatim, markers left to ST auto-fill → docs/modules/preset.md#default-order-and-markers
// take-stock-placement: ranked after main, before chatHistory; never past it → docs/modules/preset.md#template-fields
const TEMPLATE = Object.freeze({
  prompts: [
    { identifier: 'main', name: 'Main Prompt', role: 'system', system_prompt: true, content: MANUSCRIPT_SYSTEM_PROMPT },
    { identifier: 'uidTakeStock', name: 'Take stock (thinking models)', role: 'system', content: TAKE_STOCK_PROMPT },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'uidTakeStock', enabled: false },
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

export function buildPresets() {
  return {
    [OPENAI_PRESET_FILE]: JSON.parse(JSON.stringify(TEMPLATE)),
    'manuscript-protocol.sysprompt.json': { name: PRESET_NAME, content: MANUSCRIPT_SYSTEM_PROMPT },
  };
}
