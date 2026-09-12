// starter-reformatter: prose starter → manuscript form, output only → docs/modules/starter.md#why
import { reservedLiteral } from './boundary.js';
import { LOG_PREFIX } from './constants.js';
import { findTagLiteral, parseManuscript } from './grammar.js';
import { getCtx } from './host.js';
import { MANUSCRIPT_SYSTEM_PROMPT } from './prompt.js';

// frozen-instruction: one constant, reworded only by a new brief → docs/modules/starter.md#rewrite-request
export const REWRITE_INSTRUCTION = '[OOC: Below are notes for an opening scene. Write that scene as it would stand on the page: a tagged block wherever a figure speaks, acts or intends, narration carrying the world between them. Stay inside what the notes establish, and let the scene end where the notes end.]';

const OOC_LINE = /^\[OOC:[^\]]*\]$/;
const FENCE_LINE = /^[ \t]*`{3,}[^\s`]*[ \t]*$/;

// reserved-drop: block-initial literal only, never a mid-block mention → docs/modules/starter.md#sanitise
function dropReservedBlocks(text, literal) {
  if (typeof literal !== 'string' || literal === '') return text;
  const actor = literal.replace(/:$/, '');
  return parseManuscript(text)
    .filter((block) => block.actor === null || !findTagLiteral(block.raw, actor).some((hit) => hit.index === 0))
    .map((block) => block.raw)
    .join('\n\n')
    .trim();
}

// rewrite-request: MANUSCRIPT_SYSTEM_PROMPT by identity, instruction then body → docs/modules/starter.md#rewrite-request
export function buildRewriteRequest(starterText, literal) {
  const body = dropReservedBlocks(String(starterText ?? '').trim(), literal);
  return {
    systemPrompt: MANUSCRIPT_SYSTEM_PROMPT,
    prompt: body === '' ? REWRITE_INSTRUCTION : `${REWRITE_INSTRUCTION}\n\n${body}`,
  };
}

// sanitise: OOC echo, fences, reserved blocks; grammar does the parsing → docs/modules/starter.md#sanitise
export function sanitiseRewrite(text, literal) {
  let lines = String(text ?? '').split(/\r?\n/);
  const disposable = (line) => line.trim() === '' || OOC_LINE.test(line.trim()) || FENCE_LINE.test(line);
  while (lines.length > 0 && disposable(lines[0])) lines.shift();
  while (lines.length > 0 && disposable(lines[lines.length - 1])) lines.pop();
  lines = lines.filter((line) => !FENCE_LINE.test(line));
  return dropReservedBlocks(lines.join('\n'), literal).trim();
}

// generate-raw: one options object, context replaced wholesale → docs/modules/starter.md#generate-raw
// off-path: no interceptor, no chat[] write, no canonical state → docs/modules/starter.md#off-path
export async function restructureStarter(text, ctx = getCtx()) {
  if (typeof ctx.generateRaw !== 'function') {
    console.error(`${LOG_PREFIX} this host exposes no generateRaw, so no starter was restructured`);
    return '';
  }
  const literal = reservedLiteral(ctx);
  const { prompt, systemPrompt } = buildRewriteRequest(text, literal);
  try {
    const result = await ctx.generateRaw({ prompt, systemPrompt });
    return sanitiseRewrite(String(result ?? ''), literal);
  } catch (error) {
    console.error(`${LOG_PREFIX} the starter rewrite failed`, error);
    return '';
  }
}
