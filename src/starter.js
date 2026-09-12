// starter-reformatter: prose starter → manuscript form, output only → docs/modules/starter.md#why
import { reservedLiteral, suspendBoundary } from './boundary.js';
import { LOG_PREFIX } from './constants.js';
import { findTagLiteral, parseManuscript } from './grammar.js';
import { getCtx } from './host.js';
import { MANUSCRIPT_SYSTEM_PROMPT } from './prompt.js';

// frozen-instruction: one constant, reworded only by a new brief → docs/modules/starter.md#rewrite-request
export const REWRITE_INSTRUCTION = 'Rewrite this opening scene in the tagged-block format described above. Keep every event and line of dialogue; change only the presentation.';

// content-wrapper: starter text framed as <content> before the instruction → docs/modules/starter.md#rewrite-request
const CONTENT_OPEN = '<content>\n';
const CONTENT_CLOSE = '\n</content>\n\n';

const OOC_LINE = /^\[OOC:[^\]]*\]$/;
const FENCE_LINE = /^[ \t]*`{3,}[^\s`]*[ \t]*$/;
const CONTENT_OPEN_LINE = /^<content>$/;
const CONTENT_CLOSE_LINE = /^<\/content>$/;

// reserved-drop: request side only, block-initial literal, never a mid-block mention → docs/modules/starter.md#sanitise
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
    prompt: `${CONTENT_OPEN}${body}${CONTENT_CLOSE}${REWRITE_INSTRUCTION}`,
  };
}

// sanitise: OOC echo, content echo, fences; reserved blocks survive → docs/modules/starter.md#sanitise
export function sanitiseRewrite(text) {
  let lines = String(text ?? '').split(/\r?\n/);
  const disposable = (line) => {
    const trimmed = line.trim();
    return trimmed === '' || OOC_LINE.test(trimmed) || FENCE_LINE.test(line) ||
      CONTENT_OPEN_LINE.test(trimmed) || CONTENT_CLOSE_LINE.test(trimmed);
  };
  while (lines.length > 0 && disposable(lines[0])) lines.shift();
  while (lines.length > 0 && disposable(lines[lines.length - 1])) lines.pop();
  lines = lines.filter((line) => !FENCE_LINE.test(line));
  return lines.join('\n').trim();
}

// generate-raw: one options object, context replaced wholesale → docs/modules/starter.md#generate-raw
// off-path: no interceptor, no chat[] write, no canonical state → docs/modules/starter.md#off-path
// boundary-suspended: released in finally, request side only → docs/modules/starter.md#boundary-suspended
export async function restructureStarter(text, ctx = getCtx()) {
  if (typeof ctx.generateRaw !== 'function') {
    console.error(`${LOG_PREFIX} this host exposes no generateRaw, so no starter was restructured`);
    return '';
  }
  const literal = reservedLiteral(ctx);
  const { prompt, systemPrompt } = buildRewriteRequest(text, literal);
  const resume = suspendBoundary();
  try {
    const result = await ctx.generateRaw({ prompt, systemPrompt });
    return sanitiseRewrite(String(result ?? ''));
  } catch (error) {
    console.error(`${LOG_PREFIX} the starter rewrite failed`, error);
    return '';
  } finally {
    resume();
  }
}
