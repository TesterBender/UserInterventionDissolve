import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeContext, uninstall } from './helpers/fake-context.js';
import { REQUIRED_KEYS, LOG_PREFIX, INTERCEPTOR_GLOBAL } from '../src/constants.js';

function listSrcFiles() {
  return fs.readdirSync(path.resolve('src')).map((name) => path.join('src', name));
}

describe('manifest.json', () => {
  it('has exactly the twelve documented keys with the stated values', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));
    expect(Object.keys(manifest).sort()).toEqual(
      [
        'display_name',
        'loading_order',
        'requires',
        'optional',
        'js',
        'css',
        'author',
        'version',
        'minimum_client_version',
        'homePage',
        'auto_update',
        'generate_interceptor',
      ].sort(),
    );
    expect(manifest.display_name).toBe('User Intervention Dissolve');
    expect(manifest.loading_order).toBe(50);
    expect(manifest.requires).toEqual([]);
    expect(manifest.optional).toEqual([]);
    expect(manifest.js).toBe('index.js');
    expect(manifest.css).toBe('style.css');
    expect(manifest.author).toBe('mrdanger2nd');
    expect(manifest.version).toBe('0.0.0');
    expect(manifest.minimum_client_version).toBe('1.18.0');
    expect(manifest.auto_update).toBe(false);
    expect(manifest.generate_interceptor).toBe(INTERCEPTOR_GLOBAL);
  });
});

describe('index.js bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
    delete globalThis[INTERCEPTOR_GLOBAL];
  });

  it('logs exactly one ready line and no error on success', async () => {
    installFakeContext();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await import('../index.js');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(`${LOG_PREFIX} ready`);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('is idempotent: a second init() produces no further log line', async () => {
    installFakeContext();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../index.js');
    expect(logSpy).toHaveBeenCalledTimes(1);
    mod.init();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(mod.isReady()).toBe(true);
  });

  it('fails loudly on a missing required key, then succeeds once restored', async () => {
    installFakeContext({ saveChat: undefined });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await import('../index.js');
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain('saveChat');
    expect(logSpy).not.toHaveBeenCalled();
    expect(mod.isReady()).toBe(false);

    uninstall();
    installFakeContext();
    mod.init();
    expect(mod.isReady()).toBe(true);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(`${LOG_PREFIX} ready`);
  });

  it('succeeds when name1 is an empty string (presence, not truthiness)', async () => {
    installFakeContext({ name1: '' });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../index.js');
    expect(mod.isReady()).toBe(true);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('succeeds with only the legacy event_types alias', async () => {
    const reference = installFakeContext();
    const eventTypes = reference.eventTypes;
    uninstall();
    installFakeContext({ eventTypes: undefined, event_types: eventTypes });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await import('../index.js');
    expect(mod.isReady()).toBe(true);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('fails loudly with neither eventTypes nor event_types', async () => {
    installFakeContext({ eventTypes: undefined });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await import('../index.js');
    expect(mod.isReady()).toBe(false);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('wires a no-op generate_interceptor', async () => {
    installFakeContext();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../index.js');
    expect(typeof globalThis[INTERCEPTOR_GLOBAL]).toBe('function');
    const chat = [{ mes: 'a', extra: {} }, { mes: 'b', extra: {} }];
    const before = JSON.parse(JSON.stringify(chat));
    const abort = vi.fn();
    const result = await globalThis[INTERCEPTOR_GLOBAL](chat, 4096, abort, 'normal');
    expect(chat).toEqual(before);
    expect(abort).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

describe('getCtx', () => {
  it('returns a distinct object each call, proving no caching', async () => {
    const previous = globalThis.SillyTavern;
    globalThis.SillyTavern = { getContext: () => ({ chat: [] }) };
    const { getCtx } = await import('../src/host.js');
    expect(getCtx()).not.toBe(getCtx());
    globalThis.SillyTavern = previous;
  });
});

describe('fake context shape', () => {
  afterEach(() => uninstall());

  it('has every REQUIRED_KEYS entry and exactly eleven eventTypes constants', () => {
    const ctx = installFakeContext();
    for (const key of REQUIRED_KEYS) {
      expect(ctx[key]).not.toBeUndefined();
    }
    expect(Object.keys(ctx.eventTypes)).toHaveLength(11);
  });
});

describe('SillyTavern identifier leak', () => {
  it('occurs nowhere outside src/host.js, and only inside getCtx there', () => {
    const files = ['index.js', ...listSrcFiles()];
    for (const file of files) {
      const text = fs.readFileSync(path.resolve(file), 'utf8');
      if (file === path.join('src', 'host.js')) continue;
      expect(text.includes('SillyTavern')).toBe(false);
    }

    const hostText = fs.readFileSync(path.resolve('src', 'host.js'), 'utf8');
    const getCtxStart = hostText.indexOf('function getCtx');
    const getCtxEnd = hostText.indexOf('export function', getCtxStart + 1);
    const inside = hostText.slice(getCtxStart, getCtxEnd === -1 ? undefined : getCtxEnd);
    const outsideBefore = hostText.slice(0, getCtxStart);
    const outsideAfter = getCtxEnd === -1 ? '' : hostText.slice(getCtxEnd);
    expect(inside.includes('SillyTavern')).toBe(true);
    expect(outsideBefore.includes('SillyTavern')).toBe(false);
    expect(outsideAfter.includes('SillyTavern')).toBe(false);
  });
});

describe('style.css', () => {
  it('contains only the one prefixed root class', () => {
    const css = fs.readFileSync(path.resolve('style.css'), 'utf8');
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    expect(selectors).toEqual(['.uid-root']);
  });
});
