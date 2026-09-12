#!/usr/bin/env node
// preset-bundle: downloadable reference preset, not a runtime injection → docs/modules/preset.md#why-a-preset
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPresets } from '../src/preset-template.js';

// shared-template: the writer owns no template, only the write loop → docs/modules/preset.md#shared-template
export { buildPresets };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRESET_DIR = join(ROOT, 'presets');

// generated-never-edited: regenerate with npm run build:preset → docs/modules/preset.md#single-source-of-truth
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(PRESET_DIR, { recursive: true });
  for (const [filename, preset] of Object.entries(buildPresets())) {
    writeFileSync(join(PRESET_DIR, filename), `${JSON.stringify(preset, null, 2)}\n`, 'utf8');
  }
}
