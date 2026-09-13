import { describe, it, expect } from 'vitest';
import { rollbackHistory } from '../../janitor/rollback.js';

const LITERAL = 'Mara:';
const COMPLETE = 'Keeper:\nThe lamp turned once.\n\nThe rain kept on.';
const DEBRIS = '\n\nShe reached for the';

function entry(role, content, messageId = '') {
  return { index: 0, role, content, messageId };
}

function rolled(entries, boundaries = []) {
  return rollbackHistory(entries, LITERAL, new Set(boundaries));
}

describe('the incomplete trailing block', () => {
  it('is cut back to the last complete block', () => {
    const result = rolled([entry('assistant', COMPLETE + DEBRIS, '1')]);
    expect(result.entries[0].content).toBe(COMPLETE);
    expect(result.rollbacks).toBe(1);
  });

  it('leaves a message whose trailing block is complete as the same object', () => {
    const original = entry('assistant', COMPLETE, '1');
    const result = rolled([original]);
    expect(result.entries[0]).toBe(original);
    expect(result.rollbacks).toBe(0);
  });

  it('keeps index, role and messageId on a message it did change', () => {
    const result = rolled([{ index: 4, role: 'assistant', content: COMPLETE + DEBRIS, messageId: '77' }]);
    expect(result.entries[0]).toEqual({ index: 4, role: 'assistant', content: COMPLETE, messageId: '77' });
  });
});

describe('a message recorded as a boundary stop', () => {
  it('is exempt from both steps', () => {
    const original = entry('assistant', `${COMPLETE}\n\n${LITERAL}\nShe pushed on and`, '9');
    const result = rolled([original], ['9']);
    expect(result.entries[0]).toBe(original);
    expect(result.rollbacks).toBe(0);
  });

  it('is not exempt when its id is empty and the empty string is on record', () => {
    const result = rolled([entry('assistant', COMPLETE + DEBRIS, '')], ['']);
    expect(result.entries[0].content).toBe(COMPLETE);
  });
});

describe('the reserved literal', () => {
  it('removes everything from a block-start occurrence onward', () => {
    const result = rolled([entry('assistant', `${COMPLETE}\n\n${LITERAL}\nShe pushed the door open.`, '1')]);
    expect(result.entries[0].content).toBe(COMPLETE);
    expect(result.rollbacks).toBe(1);
  });

  it('leaves a mid-paragraph occurrence alone', () => {
    const text = 'Keeper:\nHe read the label aloud: Mara: two crates, and shrugged.';
    const original = entry('assistant', text, '1');
    expect(rolled([original]).entries[0]).toBe(original);
  });

  it('is not applied when the caller has no literal', () => {
    const text = `${COMPLETE}\n\n${LITERAL}\nShe pushed the door open.`;
    const result = rollbackHistory([entry('assistant', text, '1')], '', new Set());
    expect(result.entries[0].content).toBe(text);
    expect(result.rollbacks).toBe(0);
  });

  it('is cut before the trailing block is judged, not after', () => {
    const text = `Keeper:\nThe lamp turned once.\n\nHe reached for the door and\n\n${LITERAL}\nShe pushed the door open.`;
    const result = rolled([entry('assistant', text, '1')]);
    expect(result.entries[0].content).toBe('Keeper:\nThe lamp turned once.');
  });
});

describe('the human\'s own turns', () => {
  it('are never trimmed, mid-sentence or literal-carrying', () => {
    const entries = [
      entry('user', 'She pushed the door open and', '1'),
      entry('user', `${LITERAL}\nnot a generation`, '2'),
    ];
    const result = rolled(entries);
    expect(result.entries[0]).toBe(entries[0]);
    expect(result.entries[1]).toBe(entries[1]);
    expect(result.rollbacks).toBe(0);
  });
});

describe('the rollback count', () => {
  it('counts changed entries only, in a mixed history', () => {
    const result = rolled([
      entry('user', 'She pushed the door open and', '1'),
      entry('assistant', COMPLETE, '2'),
      entry('assistant', COMPLETE + DEBRIS, '3'),
      entry('assistant', `${COMPLETE}\n\n${LITERAL}\nShe pushed on.`, '4'),
      entry('assistant', COMPLETE + DEBRIS, '5'),
    ], ['5']);
    expect(result.rollbacks).toBe(2);
    expect(result.entries.map((item) => item.content)).toEqual([
      'She pushed the door open and',
      COMPLETE,
      COMPLETE,
      COMPLETE,
      COMPLETE + DEBRIS,
    ]);
  });
});
