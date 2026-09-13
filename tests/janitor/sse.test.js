import { describe, it, expect } from 'vitest';
import { createBoundaryFilter } from '../../janitor/sse.js';
import {
  transcript,
  deltaFrame,
  DONE_FRAME,
  COMMENT_FRAME,
  PROSE_DELTAS,
  BOUNDARY_DELTAS,
  SPLIT_BOUNDARY_DELTAS,
  MID_PARAGRAPH_DELTAS,
  chunksOfOne,
  chunksPerFrame,
  chunksOfSize,
} from './fixtures/sse-transcripts.js';

const LITERAL = 'Mara:';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function run(filter, chunks) {
  const out = [];
  for (const chunk of chunks) out.push(...filter.push(encoder.encode(chunk)));
  out.push(...filter.flush());
  return out.map((bytes) => decoder.decode(bytes)).join('');
}

function forwardedText(delivered) {
  let text = '';
  for (const record of delivered.split('\n\n')) {
    if (!record.startsWith('data: ') || record === 'data: [DONE]') continue;
    const content = JSON.parse(record.slice(6))?.choices?.[0]?.delta?.content;
    if (typeof content === 'string') text += content;
  }
  return text;
}

describe('pass-through is byte-identical', () => {
  const frames = transcript(PROSE_DELTAS);
  const upstream = frames.join('');

  for (const [name, chunks] of [
    ['one chunk', chunksOfOne(frames)],
    ['one chunk per frame', chunksPerFrame(frames)],
    ['chunks split mid-frame', chunksOfSize(frames, 13)],
  ]) {
    it(`forwards the same bytes for ${name}`, () => {
      const filter = createBoundaryFilter(LITERAL);
      expect(run(filter, chunks)).toBe(upstream);
      expect(filter.boundaryHit).toBe(false);
      expect(filter.done).toBe(false);
    });
  }

  it('forwards a record it cannot parse and a comment record verbatim', () => {
    const frames = ['data: not json\n\n', COMMENT_FRAME, deltaFrame('Keeper:\nThe lamp turned.'), DONE_FRAME];
    const filter = createBoundaryFilter(LITERAL);
    expect(run(filter, chunksOfOne(frames))).toBe(frames.join(''));
    expect(filter.completionText()).toBe('Keeper:\nThe lamp turned.');
  });

  it('forwards an incomplete trailing record when the stream ends', () => {
    const filter = createBoundaryFilter(LITERAL);
    const tail = 'data: {"choices":[{"index":0,"del';
    expect(run(filter, [deltaFrame('Keeper:\nThe lamp turned.'), tail])).toBe(
      deltaFrame('Keeper:\nThe lamp turned.') + tail,
    );
  });
});

describe('suppression at a block-start literal', () => {
  it('cuts at the literal and synthesises the terminal frames', () => {
    const filter = createBoundaryFilter(LITERAL);
    const delivered = run(filter, chunksOfOne(transcript(BOUNDARY_DELTAS)));
    const records = delivered.split('\n\n').filter((record) => record !== '');

    expect(delivered).not.toContain(LITERAL);
    expect(delivered).not.toContain('She let the door swing shut.');
    expect(forwardedText(delivered)).toBe(`${PROSE_DELTAS.join('')}\n\n`);
    expect(filter.completionText()).toBe(`${PROSE_DELTAS.join('')}\n\n`);
    expect(filter.boundaryHit).toBe(true);
    expect(filter.done).toBe(true);

    expect(records.at(-1)).toBe('data: [DONE]');
    const terminal = JSON.parse(records.at(-2).slice(6));
    expect(terminal.choices[0]).toEqual({ index: 0, delta: {}, finish_reason: 'stop' });
    expect(terminal).toMatchObject({ id: 'chatcmpl-77', object: 'chat.completion.chunk', created: 1757808000, model: 'gpt-test' });
    expect(Object.keys(terminal).sort()).toEqual(['choices', 'created', 'id', 'model', 'object']);
  });

  it('never forwards part of a literal split across three frames', () => {
    const filter = createBoundaryFilter(LITERAL);
    const frames = transcript(SPLIT_BOUNDARY_DELTAS);
    const seen = [];
    for (const frame of frames) {
      for (const bytes of filter.push(encoder.encode(frame))) seen.push(decoder.decode(bytes));
      expect(seen.join('')).not.toContain('Ma');
    }
    const delivered = seen.join('');
    expect(delivered).not.toContain('Ma');
    expect(forwardedText(delivered)).toBe(`${PROSE_DELTAS.join('')}\n\n`);
    expect(filter.boundaryHit).toBe(true);
  });

  it('emits the text before the cut when the literal shares a frame with prose', () => {
    const filter = createBoundaryFilter(LITERAL);
    const delivered = run(filter, chunksOfOne(transcript(['Keeper:\nThe lamp turned.\n\nMara:\nShe left.'])));
    expect(forwardedText(delivered)).toBe('Keeper:\nThe lamp turned.\n\n');
    expect(delivered).not.toContain('She left.');
    expect(filter.boundaryHit).toBe(true);
  });

  it('stops forwarding once it is done', () => {
    const filter = createBoundaryFilter(LITERAL);
    run(filter, chunksOfOne(transcript(BOUNDARY_DELTAS)));
    expect(filter.push(encoder.encode(deltaFrame('more prose')))).toEqual([]);
    expect(filter.flush()).toEqual([]);
  });
});

describe('what is not a boundary', () => {
  it('forwards a mid-paragraph occurrence untouched', () => {
    const frames = transcript(MID_PARAGRAPH_DELTAS);
    const filter = createBoundaryFilter(LITERAL);
    expect(run(filter, chunksOfOne(frames))).toBe(frames.join(''));
    expect(filter.boundaryHit).toBe(false);
    expect(filter.completionText()).toBe(MID_PARAGRAPH_DELTAS.join(''));
  });

  it('disables the filter entirely for an empty literal', () => {
    const frames = transcript(BOUNDARY_DELTAS);
    const filter = createBoundaryFilter('');
    expect(run(filter, chunksOfSize(frames, 29))).toBe(frames.join(''));
    expect(filter.boundaryHit).toBe(false);
    expect(filter.done).toBe(false);
  });

  it('returns the caller chunk object itself when the literal is empty', () => {
    const filter = createBoundaryFilter('');
    const chunk = encoder.encode('data: anything\n\n');
    expect(filter.push(chunk)).toEqual([chunk]);
  });
});
