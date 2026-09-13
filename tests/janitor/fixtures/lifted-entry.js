import { MANUSCRIPT_SYSTEM_PROMPT, CONTINUATION_CONTROL } from '../../../src/prompt.js';
import { METADATA_KEY, STATE_VERSION, BLOCK_DELIMITER, LOG_PREFIX } from '../../../src/constants.js';
import { deriveFrontier } from '../../../src/derive.js';
import { createState } from '../../../src/state.js';
import { compileUnit, countWords } from '../../../src/freeze.js';
import { buildHistory } from '../../../src/frontier.js';
import { applyStopStrings } from '../../../src/boundary.js';

export const LIFTED_CONSTANTS = [
  MANUSCRIPT_SYSTEM_PROMPT,
  CONTINUATION_CONTROL,
  METADATA_KEY,
  STATE_VERSION,
  BLOCK_DELIMITER,
  LOG_PREFIX,
];

export function liftedFunctions() {
  return [deriveFrontier, createState, compileUnit, countWords, buildHistory, applyStopStrings];
}
