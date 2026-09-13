import { findBoundary } from '../src/boundary.js';

// sse-record-separator: a blank line ends a record; nothing shorter → docs/modules/janitor-transport.md#response-wrapper
const SSE_RECORD_SEPARATOR = /\r?\n\r?\n/;

// data-payload: a record with no data line is not ours to read → docs/modules/janitor-transport.md#response-wrapper
function dataPayload(raw) {
  const values = [];
  for (const line of raw.split('\n')) {
    const text = line.replace(/\r$/, '');
    if (text.startsWith('data:')) values.push(text.slice(5).replace(/^ /, ''));
  }
  return values.length === 0 ? null : values.join('\n');
}

// delta-text: one string field contributes; anything else contributes nothing → docs/modules/janitor-transport.md#response-wrapper
function deltaText(frame) {
  const content = frame?.choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
}

// partial-literal: the longest proper prefix of the literal the text ends on → docs/modules/janitor-transport.md#response-wrapper
function partialLiteralLength(text, literal) {
  const longest = Math.min(literal.length - 1, text.length);
  for (let length = longest; length > 0; length -= 1) {
    if (text.endsWith(literal.slice(0, length))) return length;
  }
  return 0;
}

// boundary-filter: forwards upstream bytes until the reserved literal, then cuts → docs/modules/janitor-transport.md#response-wrapper
export function createBoundaryFilter(literal) {
  const reserved = typeof literal === 'string' ? literal : '';
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let accumulated = '';
  let held = [];
  let lastFrame = null;
  let boundaryHit = false;
  let finished = false;

  function synthesised(choice) {
    const frame = {};
    for (const field of ['id', 'object', 'created', 'model']) {
      if (lastFrame?.[field] !== undefined) frame[field] = lastFrame[field];
    }
    frame.choices = [choice];
    return encoder.encode(`data: ${JSON.stringify(frame)}\n\n`);
  }

  function release(threshold) {
    const out = [];
    while (held.length > 0 && held[0].end <= threshold) out.push(encoder.encode(held.shift().raw));
    return out;
  }

  // cancel-and-synthesise: held records up to the cut, then the terminal frames → docs/modules/janitor-transport.md#response-wrapper
  function cut(index) {
    const out = [];
    for (const record of held) {
      if (record.end <= index) {
        out.push(encoder.encode(record.raw));
        continue;
      }
      const text = accumulated.slice(record.start, Math.max(record.start, index));
      if (text !== '') out.push(synthesised({ index: 0, delta: { content: text } }));
      break;
    }
    out.push(synthesised({ index: 0, delta: {}, finish_reason: 'stop' }));
    out.push(encoder.encode('data: [DONE]\n\n'));
    accumulated = accumulated.slice(0, index);
    held = [];
    buffer = '';
    boundaryHit = true;
    finished = true;
    return out;
  }

  function consume(raw) {
    const payload = dataPayload(raw);
    let contribution = '';
    if (payload !== null && payload !== '[DONE]') {
      let frame = null;
      try {
        frame = JSON.parse(payload);
      } catch {
        frame = null;
      }
      if (frame !== null) {
        lastFrame = frame;
        contribution = deltaText(frame);
      }
    }
    const start = accumulated.length;
    accumulated += contribution;
    held.push({ raw, start, end: accumulated.length });

    const found = findBoundary(accumulated, reserved);
    if (found.index !== -1) return cut(found.index);
    // deferred-release: hold only what a partial literal could still complete → docs/modules/janitor-transport.md#response-wrapper
    return release(accumulated.length - partialLiteralLength(accumulated, reserved));
  }

  return {
    push(chunk) {
      if (finished) return [];
      if (reserved === '') return [chunk];
      buffer += decoder.decode(chunk, { stream: true });
      const out = [];
      for (;;) {
        const match = SSE_RECORD_SEPARATOR.exec(buffer);
        if (match === null) return out;
        const end = match.index + match[0].length;
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end);
        out.push(...consume(raw));
        if (finished) return out;
      }
    },
    // flush-incomplete: a trailing partial record is upstream's, forwarded whole → docs/modules/janitor-transport.md#response-wrapper
    flush() {
      if (finished || reserved === '') return [];
      buffer += decoder.decode();
      const out = release(accumulated.length);
      if (buffer !== '') out.push(encoder.encode(buffer));
      buffer = '';
      return out;
    },
    completionText() {
      return accumulated;
    },
    get done() {
      return finished;
    },
    get boundaryHit() {
      return boundaryHit;
    },
  };
}
