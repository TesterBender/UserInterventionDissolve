import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_DELIMITER } from '../../src/constants.js';
import { countWords } from '../../src/freeze.js';
import { toStShape } from '../../janitor/history.js';
import { prefixIdentity } from '../../janitor/identity.js';
import { freshState } from '../../janitor/storage.js';
import {
  requestRecompile,
  consumeRecompile,
  rebuildState,
  writeWatermarkInsurance,
} from '../../janitor/recompile.js';
import { PERSONA, prose } from './fixtures/manuscript-turns.js';

const LITERAL = `${PERSONA}:`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PURE_FILES = ['recompile.js', 'status.js', 'portable.js'];

function shapedTurns(turns) {
  return toStShape(turns.map((turn, index) => ({ ...turn, messageId: `m${index}` })));
}

function corpusOf(state) {
  return [...state.frozen, ...state.units].map((span) => span.text).join(BLOCK_DELIMITER);
}

describe('the modules this phase adds', () => {
  it.each(PURE_FILES)('%s touches no DOM, no storage and no host', (name) => {
    const text = readFileSync(join(ROOT, 'janitor', name), 'utf8');

    for (const forbidden of ['document', 'window', 'localStorage', 'src/recompile.js']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('the recompile flag', () => {
  beforeEach(() => {
    consumeRecompile('a');
    consumeRecompile('b');
  });

  it('is not set until it is asked for', () => {
    expect(consumeRecompile('a')).toBe(false);
  });

  it('is consumed once by the chat it names and never again', () => {
    requestRecompile('a');
    expect(consumeRecompile('a')).toBe(true);
    expect(consumeRecompile('a')).toBe(false);
  });

  it('is left alone by a request for a different chat', () => {
    requestRecompile('a');
    expect(consumeRecompile('b')).toBe(false);
    expect(consumeRecompile('a')).toBe(true);
  });
});

describe('the rebuild loop', () => {
  const longTurns = [
    { role: 'user', content: 'She pushed the door open.' },
    { role: 'assistant', content: prose('first', 360) },
    { role: 'user', content: 'And after that?' },
    { role: 'assistant', content: prose('second', 360) },
    { role: 'user', content: 'And after that again?' },
    { role: 'assistant', content: prose('third', 360) },
    { role: 'user', content: 'And then?' },
    { role: 'assistant', content: prose('last', 360) },
  ];

  it('compiles several spans and reports what it compiled', () => {
    const state = freshState();
    const result = rebuildState(shapedTurns(longTurns), LITERAL, state);

    expect(state.units.length + state.frozen.length).toBeGreaterThan(1);
    expect(result.spans).toBe(state.frozen.length);
    expect(result.units).toBe(state.units.length);
    expect(result.words).toBe(countWords(state.frozen.map((span) => span.text).join(BLOCK_DELIMITER)));
  });

  it('never consumes any part of the last shaped message', () => {
    const state = freshState();
    rebuildState(shapedTurns(longTurns), LITERAL, state);

    const corpus = corpusOf(state);
    expect(corpus).not.toContain('last 0 the lamp turned');
    expect(state.frozenIds).not.toContain('m7');
    expect(state.watermark.messageId).not.toBe('m7');
  });

  it('returns without looping on an empty or single-segment frontier', () => {
    const empty = freshState();
    expect(rebuildState([], LITERAL, empty)).toEqual({ spans: 0, words: 0, units: 0 });

    const single = freshState();
    const result = rebuildState(shapedTurns([{ role: 'assistant', content: prose('only', 360) }]), LITERAL, single);
    expect(result).toEqual({ spans: 0, words: 0, units: 0 });
    expect(single.units).toEqual([]);
  });

  it('returns without compiling when the cut rules refuse the frontier', () => {
    const state = freshState();
    const short = [
      { role: 'user', content: 'She pushed the door open.' },
      { role: 'assistant', content: 'The hinge complained.' },
      { role: 'user', content: 'What did the keeper say?' },
      { role: 'assistant', content: 'Nothing at first.' },
    ];

    expect(rebuildState(shapedTurns(short), LITERAL, state)).toEqual({ spans: 0, words: 0, units: 0 });
    expect(state.frozen).toEqual([]);
    expect(state.units).toEqual([]);
  });

  it('stops at the hard bound when a constructed input never advances', async () => {
    vi.resetModules();
    let passes = 0;
    vi.doMock('../../src/derive.js', () => ({
      deriveFrontier: () => ({ text: '', segments: [{ start: 0 }, { start: 5 }] }),
    }));
    vi.doMock('../../src/freeze.js', () => ({
      compileUnit: () => {
        passes += 1;
        return {};
      },
      countWords: () => 0,
    }));

    const { rebuildState: bounded } = await import('../../janitor/recompile.js');
    const state = freshState();
    expect(bounded([], LITERAL, state)).toEqual({ spans: 0, words: 0, units: 0 });
    expect(passes).toBe(1000);

    vi.doUnmock('../../src/derive.js');
    vi.doUnmock('../../src/freeze.js');
    vi.resetModules();
  });
});

describe('the shared watermark insurance', () => {
  const shaped = toStShape([
    { role: 'assistant', content: prose('body', 40), messageId: 'm0' },
    { role: 'user', content: 'And after that?', messageId: 'm1' },
  ]);

  it('writes the prefix hash and the raw text of the watermark message', () => {
    const state = freshState();
    state.watermark = { messageId: 'm0', offset: 120 };
    writeWatermarkInsurance(state, shaped);

    expect(state.watermark.prefixHash).toBe(prefixIdentity(shaped[0].mes, 120));
    expect(state.watermarkText).toBe(shaped[0].mes);
  });

  it('writes both empty when the watermark names no surviving message', () => {
    const state = freshState();
    state.watermark = { messageId: 'gone', offset: 120 };
    state.watermarkText = 'stale';
    writeWatermarkInsurance(state, shaped);

    expect(state.watermark.prefixHash).toBe('');
    expect(state.watermarkText).toBe('');
  });
});
