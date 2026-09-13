import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import {
  statusLines, staticNotes, recompileAvailability, recompileRequestedText, transferResultText, importOutcome,
} from '../../janitor/panel-text.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
const PANEL_SOURCE = fs.readFileSync(path.join(ROOT, 'janitor', 'panel.js'), 'utf8');

const SNAPSHOT = {
  chatId: 'chat-mx1',
  literal: 'Mara:',
  finals: 3,
  units: 2,
  frontierWords: 640,
  froze: true,
  rebuilt: false,
  stopSent: true,
  routerEnabled: false,
  driftNotices: [],
  at: 1_700_000_000_000,
};

const EMPTY = {
  chatId: '', literal: '', finals: 0, units: 0, frontierWords: 0,
  froze: false, rebuilt: false, stopSent: false, routerEnabled: false, driftNotices: [], at: 0,
};

function joined(status) {
  return statusLines(status).join('\n');
}

describe('the status lines', () => {
  it('carries every number and the reserved literal from the snapshot', () => {
    const text = joined(SNAPSHOT);
    expect(text).toContain('chat-mx1');
    expect(text).toContain('Mara:');
    expect(text).toMatch(/\b3\b/);
    expect(text).toMatch(/\b2\b/);
    expect(text).toContain('640');
  });

  it('names the stop parameter when the boundary was sent as one', () => {
    expect(joined({ ...SNAPSHOT, stopSent: true })).toContain('stop');
  });

  it('names the stream cut when the parameter was refused', () => {
    const text = joined({ ...SNAPSHOT, stopSent: false });
    expect(text).toContain('stream cut');
    expect(text).not.toContain('stop parameter:');
  });

  it('warns about the router only when the envelope reported it', () => {
    expect(joined({ ...SNAPSHOT, routerEnabled: true })).toContain('proxy');
    expect(joined(SNAPSHOT)).not.toContain('proxy');
  });

  it('renders one line per drift notice and none when there are none', () => {
    const before = statusLines(SNAPSHOT).length;
    const lines = statusLines({ ...SNAPSHOT, driftNotices: ['id-a', 'id-b'] });
    expect(lines.length).toBe(before + 2);
    expect(lines.at(-2)).toContain('id-a');
    expect(lines.at(-1)).toContain('id-b');
  });

  it('says only that nothing has been seen when there is no snapshot', () => {
    expect(statusLines(EMPTY)).toHaveLength(1);
    expect(statusLines({ ...SNAPSHOT, at: 0 })).toHaveLength(1);
    expect(statusLines({ ...SNAPSHOT, chatId: '' })).toHaveLength(1);
    expect(statusLines(EMPTY)[0]).not.toContain('0');
  });
});

describe('the recompile text', () => {
  it('is disabled with an explanation before the first request', () => {
    const availability = recompileAvailability(EMPTY);
    expect(availability.disabled).toBe(true);
    expect(availability.note.length).toBeGreaterThan(0);
  });

  it('is enabled without an explanation once a request has been seen', () => {
    expect(recompileAvailability(SNAPSHOT)).toEqual({ disabled: false, note: '' });
  });

  it('says the rebuild happens on the next message and uses only what Janitor sends', () => {
    expect(recompileRequestedText()).toMatch(/next message/);
    expect(recompileRequestedText()).toMatch(/Janitor still sends/);
  });
});

describe('the standing notes', () => {
  it('state the next-message rule and last-writer-wins', () => {
    const notes = staticNotes();
    expect(notes.join('\n')).toMatch(/next message/);
    expect(notes.join('\n')).toMatch(/last one to write wins/);
    expect(notes.every((note) => note.length > 0)).toBe(true);
  });
});

describe('the transfer sentences', () => {
  const reasons = ['unreadable', 'not-a-state', 'wrong-format'];

  it('gives every refusal reason and the success case a distinct non-empty sentence', () => {
    const sentences = [...reasons.map((reason) => transferResultText({ ok: false, reason })),
      transferResultText({ ok: true, chatId: 'chat-mx1', state: {} })];
    expect(sentences.every((sentence) => typeof sentence === 'string' && sentence.length > 0)).toBe(true);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it.each(reasons)('refuses to save anything on reason %s', (reason) => {
    const outcome = importOutcome({ ok: false, reason }, 'chat-mx1');
    expect(outcome.saveChatId).toBe('');
    expect(outcome.state).toBeNull();
    expect(outcome.message).toBe(transferResultText({ ok: false, reason }));
  });

  it('saves an accepted state under the current chat, not the exported one', () => {
    const state = { frozen: [] };
    const outcome = importOutcome({ ok: true, chatId: 'chat-old', state }, 'chat-mx1');
    expect(outcome.saveChatId).toBe('chat-mx1');
    expect(outcome.state).toBe(state);
    expect(outcome.message).toContain('chat-old');
  });

  it('says nothing about the exported chat id when it is the current one', () => {
    const outcome = importOutcome({ ok: true, chatId: 'chat-mx1', state: {} }, 'chat-mx1');
    expect(outcome.message).toBe(transferResultText({ ok: true }));
  });
});

// untested-dom: the rule that keeps panel.js free of logic is asserted on its source → docs/modules/janitor-panel.md#untested-dom
describe('the DOM file stays plumbing', () => {
  it('branches only on element presence and the two storage-key checks', () => {
    expect(PANEL_SOURCE.match(/\bif\s*\(/g)).toHaveLength(3);
    expect(PANEL_SOURCE).not.toMatch(/\belse\b/);
    expect(PANEL_SOURCE).not.toMatch(/\?[^.]/);
  });

  it('imports nothing from src/ and names no other host', () => {
    expect(PANEL_SOURCE).not.toContain("from '../src/");
    expect(PANEL_SOURCE).not.toContain(['Silly', 'Tavern'].join(''));
  });

  it('reaches the human only through panel-text.js', () => {
    expect(PANEL_SOURCE).toContain("from './panel-text.js'");
    const withoutCss = PANEL_SOURCE.replace(/const PANEL_CSS = `[^`]*`;/, '');
    expect(withoutCss.match(/'[^']*'/g).filter((literal) => literal.includes(' '))).toEqual([]);
  });
});
