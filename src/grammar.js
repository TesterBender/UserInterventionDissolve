// block-delimiter: blank line is the only block separator, CRLF included → docs/modules/grammar.md#block-delimiter
const DELIMITER = /\r?\n(?:[ \t]*\r?\n)+/g;

// tag-header: any name-then-colon at block start is a tag → docs/modules/grammar.md#tag-header
const TAG_HEADER = /^(?!["“”'‘’«»])([\p{L}\p{N}][\p{L}\p{N} '’\-.]{0,39}):(?=\s|$)/u;

// neutral-header: U+2205 is outside TAG_HEADER's first-character class → docs/modules/grammar.md#spans
const NEUTRAL_HEADER = /^∅:(?=\s|$)/u;

// block-completeness: terminal punctuation plus balanced double quotes → docs/modules/grammar.md#block-completeness
const TERMINAL = /[.!?…]["”'’)\]*]*$/;

function normalise(name) {
  return name.trim().toLowerCase();
}

function trimRange(text, start, end) {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s])) s += 1;
  while (e > s && /\s/.test(text[e - 1])) e -= 1;
  return { start: s, end: e };
}

function isBlockComplete(blockText) {
  const trimmed = blockText.replace(/\s+$/, '');
  if (!trimmed) return false;
  if (!TERMINAL.test(trimmed)) return false;
  return (trimmed.match(/"/g) || []).length % 2 === 0;
}

export function parseTagHeader(blockText) {
  const match = TAG_HEADER.exec(blockText);
  if (!match) return null;
  const body = blockText.slice(match[0].length).replace(/^[ \t]*\r?\n?/, '');
  return { actor: match[1].trim(), body };
}

export function parseManuscript(text) {
  const segments = [];
  let cursor = 0;
  let match;
  DELIMITER.lastIndex = 0;
  while ((match = DELIMITER.exec(text)) !== null) {
    segments.push({ start: cursor, end: match.index, delimited: true });
    cursor = match.index + match[0].length;
  }
  segments.push({ start: cursor, end: text.length, delimited: false });

  const blocks = [];
  for (const segment of segments) {
    const { start, end } = trimRange(text, segment.start, segment.end);
    if (start === end) continue;
    const raw = text.slice(start, end);
    const header = parseTagHeader(raw);
    blocks.push({
      kind: header ? 'tag' : 'buffer',
      actor: header ? header.actor : null,
      body: header ? header.body : raw,
      raw,
      start,
      end,
      complete: segment.delimited ? true : isBlockComplete(raw),
    });
  }
  return blocks;
}

// agency-spans: a header opens a span; every other block joins it → docs/modules/grammar.md#spans
export function groupSpans(blocks) {
  const spans = [];
  blocks.forEach((block, index) => {
    const neutral = NEUTRAL_HEADER.test(block.raw);
    const opens = neutral || block.kind === 'tag';
    if (!opens && spans.length > 0) {
      const current = spans[spans.length - 1];
      current.end = block.end;
      current.blockIndices.push(index);
      return;
    }
    spans.push({
      header: neutral ? '∅' : block.actor,
      neutral,
      start: block.start,
      end: block.end,
      blockIndices: [index],
    });
  });
  return spans;
}

// actor-classification: individual vs aggregate against a caller-supplied set → docs/modules/grammar.md#actor-classification
export function classifyActor(actor, individuatedActors) {
  const key = normalise(actor);
  for (const member of individuatedActors) {
    if (normalise(member) === key) return 'individual';
  }
  return 'aggregate';
}

// tag-literal-lookup: caller names the actor; grammar knows no character → docs/modules/grammar.md#tag-literal-lookup
export function findTagLiteral(text, actor) {
  const literal = `${actor}:`;
  const blockStarts = new Set(parseManuscript(text).map((block) => block.start));
  const found = [];
  let index = text.indexOf(literal);
  while (index !== -1) {
    found.push({ index, atBlockStart: blockStarts.has(index) });
    index = text.indexOf(literal, index + 1);
  }
  return found;
}

export function isTrailingBlockComplete(text) {
  const blocks = parseManuscript(text);
  if (blocks.length === 0) return false;
  return blocks[blocks.length - 1].complete;
}

export function lastCompleteBoundary(text) {
  const blocks = parseManuscript(text);
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i].complete) return blocks[i].end;
  }
  return 0;
}

export function truncateToLastCompleteBlock(text) {
  return text.slice(0, lastCompleteBoundary(text)).replace(/\s+$/, '');
}
