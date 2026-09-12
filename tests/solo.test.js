import { describe, it, expect, vi, afterEach } from 'vitest';
import { installFakeContext, uninstall } from './helpers/fake-context.js';
import { CONTINUATION_CONTROL, SOLO_CONTINUATION_CONTROL } from '../src/prompt.js';
import { armSolo, consumeSoloFlag, resolveSoloControl } from '../src/solo.js';

const SENTENCE = 'For this stretch, {{user}} is in the scene but stays out of the writing; let the others carry it.';

afterEach(() => {
  consumeSoloFlag();
  uninstall();
  vi.restoreAllMocks();
});

describe('SOLO_CONTINUATION_CONTROL', () => {
  it('is the canonical string, a space and exactly the pinned sentence', () => {
    expect(SOLO_CONTINUATION_CONTROL.startsWith(CONTINUATION_CONTROL)).toBe(true);
    expect(SOLO_CONTINUATION_CONTROL.slice(CONTINUATION_CONTROL.length)).toBe(` ${SENTENCE}`);
    expect(SOLO_CONTINUATION_CONTROL).toContain('{{user}}');
  });
});

describe('resolveSoloControl', () => {
  it('uses substituteParams when it resolves the placeholder', () => {
    const ctx = installFakeContext({ substituteParams: (s) => s.replace('{{user}}', 'Mara') });
    const resolved = resolveSoloControl(ctx);
    expect(resolved).toContain('Mara is in the scene');
    expect(resolved).not.toContain('{{user}}');
  });

  it('falls back to name1 when substituteParams throws or leaves the placeholder', () => {
    const thrower = installFakeContext({
      name1: 'Mara',
      substituteParams: () => {
        throw new Error('no');
      },
    });
    expect(resolveSoloControl(thrower)).toContain('Mara is in the scene');
    uninstall();

    const passthrough = installFakeContext({ name1: 'Mara', substituteParams: (s) => s });
    expect(resolveSoloControl(passthrough)).toContain('Mara is in the scene');
    expect(resolveSoloControl(passthrough)).not.toContain('{{user}}');
  });

  it('replaces the placeholder with the empty string when name1 is empty', () => {
    const ctx = installFakeContext({ name1: '', substituteParams: (s) => s });
    const resolved = resolveSoloControl(ctx);
    expect(resolved).not.toContain('{{user}}');
    expect(resolved).toContain(' is in the scene');
  });

  it('returns a non-string substituteParams result to the name1 fallback', () => {
    const ctx = installFakeContext({ name1: 'Mara', substituteParams: () => 42 });
    expect(resolveSoloControl(ctx)).toContain('Mara is in the scene');
  });
});

describe('the one-shot flag', () => {
  it('is true at most once per arm, however often it was armed', () => {
    armSolo();
    armSolo();
    expect(consumeSoloFlag()).toBe(true);
    expect(consumeSoloFlag()).toBe(false);
  });

  it('starts cleared', () => {
    expect(consumeSoloFlag()).toBe(false);
  });
});
