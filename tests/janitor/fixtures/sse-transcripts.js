const HEAD = '{"id":"chatcmpl-77","object":"chat.completion.chunk","created":1757808000,"model":"gpt-test"';

export const ROLE_FRAME = `data: ${HEAD},"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n`;
export const STOP_FRAME = `data: ${HEAD},"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`;
export const DONE_FRAME = 'data: [DONE]\n\n';
export const COMMENT_FRAME = ': keep-alive\n\n';

export function deltaFrame(text) {
  return `data: ${HEAD},"choices":[{"index":0,"delta":{"content":${JSON.stringify(text)}},"finish_reason":null}]}\n\n`;
}

export function transcript(texts) {
  return [ROLE_FRAME, ...texts.map(deltaFrame), STOP_FRAME, DONE_FRAME];
}

export const PROSE_DELTAS = [
  'Keeper:\n',
  'The lamp turned once',
  ' more over slow iron rain',
  ' and salt.',
];

export const BOUNDARY_DELTAS = [...PROSE_DELTAS, '\n\n', 'Mara:', '\nShe let the door swing shut.'];

export const SPLIT_BOUNDARY_DELTAS = [...PROSE_DELTAS, '\n\nMa', 'ra', ':\nShe let the door swing shut.'];

export const MID_PARAGRAPH_DELTAS = [
  'Keeper:\n',
  'He read the label aloud: Mara: two crates,',
  ' and shrugged.',
];

export function chunksOfOne(frames) {
  return [frames.join('')];
}

export function chunksPerFrame(frames) {
  return [...frames];
}

export function chunksOfSize(frames, size) {
  const whole = frames.join('');
  const chunks = [];
  for (let index = 0; index < whole.length; index += size) chunks.push(whole.slice(index, index + size));
  return chunks;
}

export function jsonCompletion(content) {
  return JSON.stringify({
    id: 'chatcmpl-78',
    object: 'chat.completion',
    created: 1757808000,
    model: 'gpt-test',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });
}
