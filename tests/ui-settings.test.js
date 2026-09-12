import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { installFakeContext, uninstall } from './helpers/fake-context.js';
import { renderSettings, installReferencePreset, refreshReservedLiteral } from '../src/ui/settings.js';
import { buildPresets, PRESET_NAME, OPENAI_PRESET_FILE } from '../src/preset-template.js';

function addContainer(id) {
  const div = document.createElement('div');
  div.id = id;
  document.body.append(div);
  return div;
}

function fakeCtx({ name1 = 'Mara', savePreset, getPresetManager } = {}) {
  const ctx = {
    name1,
    substituteParams: (s) => s,
  };
  if (getPresetManager !== null) {
    ctx.getPresetManager = getPresetManager ?? vi.fn(() => ({ savePreset: savePreset ?? vi.fn(async () => {}) }));
  }
  return ctx;
}

function clear() {
  while (document.body.firstChild) document.body.firstChild.remove();
}

describe('renderSettings container lookup', () => {
  beforeEach(clear);

  it('prefers extensions_settings2 when both columns exist', () => {
    const second = addContainer('extensions_settings2');
    const first = addContainer('extensions_settings');
    const root = renderSettings(fakeCtx());
    expect(root.id).toBe('uid_settings');
    expect(second.querySelectorAll('#uid_settings')).toHaveLength(1);
    expect(first.querySelector('#uid_settings')).toBeNull();
  });

  it('falls back to extensions_settings when it is the only column', () => {
    const first = addContainer('extensions_settings');
    renderSettings(fakeCtx());
    expect(first.querySelectorAll('#uid_settings')).toHaveLength(1);
  });

  it('appends nothing and returns null when neither column exists', () => {
    expect(renderSettings(fakeCtx())).toBeNull();
    expect(document.body.children).toHaveLength(0);
  });

  it('is idempotent: a second render adds no element and no second listener', async () => {
    addContainer('extensions_settings2');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const savePreset = vi.fn(async () => {});
    const ctx = fakeCtx({ savePreset });
    const first = renderSettings(ctx);
    expect(renderSettings(ctx)).toBe(first);
    expect(document.querySelectorAll('#uid_settings')).toHaveLength(1);

    document.getElementById('uid_install_preset').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(savePreset).toHaveBeenCalledTimes(1);
  });
});

describe('the rendered drawer', () => {
  beforeEach(() => {
    clear();
    addContainer('extensions_settings2');
  });

  it('emits the host drawer skeleton exactly once and registers no toggle listener', () => {
    const listened = [];
    const original = globalThis.Element.prototype.addEventListener;
    vi.spyOn(globalThis.Element.prototype, 'addEventListener').mockImplementation(function (type, fn, opts) {
      listened.push({ target: this, type });
      return original.call(this, type, fn, opts);
    });

    const root = renderSettings(fakeCtx());
    expect(root.querySelectorAll('.inline-drawer')).toHaveLength(1);
    expect(root.querySelectorAll('.inline-drawer-toggle.inline-drawer-header')).toHaveLength(1);
    expect(root.querySelectorAll('.inline-drawer-icon.fa-solid.fa-circle-chevron-down.down')).toHaveLength(1);
    expect(root.querySelectorAll('.inline-drawer-content')).toHaveLength(1);

    expect(listened).toHaveLength(1);
    expect(listened[0].type).toBe('click');
    expect(listened[0].target.id).toBe('uid_install_preset');
  });

  it('holds description, hint, one button and the status line, in that order', () => {
    const root = renderSettings(fakeCtx());
    const sections = root.querySelectorAll('.uid-settings-section');
    expect(sections).toHaveLength(3);

    const notes = root.querySelectorAll('.uid-settings-note');
    expect(notes[0].textContent.split('. ').filter(Boolean).length).toBeLessThanOrEqual(2);
    const hint = notes[1].textContent;
    for (const label of ['AI Response Configuration', 'Chat Completion Presets', 'Import preset', `presets/${OPENAI_PRESET_FILE}`]) {
      expect(hint).toContain(label);
    }
    expect(hint).toContain('README');

    const buttons = root.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].id).toBe('uid_install_preset');
    expect(buttons[0].type).toBe('button');
    expect(buttons[0].classList.contains('menu_button')).toBe(true);

    const order = [...root.querySelectorAll('.uid-settings-note, button, #uid_reserved_literal')];
    expect(order.indexOf(notes[0])).toBeLessThan(order.indexOf(notes[1]));
    expect(order.indexOf(notes[1])).toBeLessThan(order.indexOf(buttons[0]));
    expect(order.at(-1).id).toBe('uid_reserved_literal');

    expect(root.querySelectorAll('input, select, textarea')).toHaveLength(0);
  });
});

describe('installReferencePreset', () => {
  beforeEach(() => {
    clear();
    addContainer('extensions_settings2');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    delete globalThis.toastr;
  });

  afterEach(() => {
    delete globalThis.toastr;
  });

  it('saves the committed preset object under the committed name on click', async () => {
    const savePreset = vi.fn(async () => {});
    const getPresetManager = vi.fn(() => ({ savePreset }));
    renderSettings(fakeCtx({ getPresetManager }));

    document.getElementById('uid_install_preset').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(getPresetManager).toHaveBeenCalledTimes(1);
    expect(getPresetManager).toHaveBeenCalledWith('openai');
    expect(savePreset).toHaveBeenCalledTimes(1);
    expect(savePreset.mock.calls[0]).toHaveLength(2);
    const [name, object] = savePreset.mock.calls[0];
    expect(name).toBe(PRESET_NAME);
    expect(name).toBe('Manuscript Protocol');
    expect(object).toEqual(buildPresets()[OPENAI_PRESET_FILE]);
    expect(object).toEqual(JSON.parse(readFileSync(`presets/${OPENAI_PRESET_FILE}`, 'utf8')));
  });

  it('resolves false on a rejecting savePreset, leaving the DOM unchanged', async () => {
    const savePreset = vi.fn(async () => {
      throw new Error('nope');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = renderSettings(fakeCtx({ savePreset }));
    const before = root.outerHTML;

    await expect(installReferencePreset(fakeCtx({ savePreset }))).resolves.toBe(false);
    expect(root.outerHTML).toBe(before);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves false and calls nothing when the context has no preset manager', async () => {
    const ctx = fakeCtx({ getPresetManager: null });
    await expect(installReferencePreset(ctx)).resolves.toBe(false);
    expect('getPresetManager' in ctx).toBe(false);
  });

  it('resolves false when the manager has no savePreset', async () => {
    const getPresetManager = vi.fn(() => ({}));
    await expect(installReferencePreset(fakeCtx({ getPresetManager }))).resolves.toBe(false);
    expect(getPresetManager).toHaveBeenCalledTimes(1);
  });

  it('toasts success and failure once each, message first', async () => {
    globalThis.toastr = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await installReferencePreset(fakeCtx());
    expect(globalThis.toastr.success).toHaveBeenCalledTimes(1);
    expect(typeof globalThis.toastr.success.mock.calls[0][0]).toBe('string');
    expect(globalThis.toastr.success.mock.calls[0][0]).toContain(PRESET_NAME);
    expect(globalThis.toastr.error).not.toHaveBeenCalled();

    await installReferencePreset(fakeCtx({ getPresetManager: null }));
    expect(globalThis.toastr.error).toHaveBeenCalledTimes(1);
    expect(typeof globalThis.toastr.error.mock.calls[0][0]).toBe('string');
  });

  it('completes both paths with no toastr global at all', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(installReferencePreset(fakeCtx())).resolves.toBe(true);
    await expect(installReferencePreset(fakeCtx({ getPresetManager: null }))).resolves.toBe(false);
  });
});

describe('refreshReservedLiteral', () => {
  beforeEach(() => {
    clear();
    addContainer('extensions_settings2');
  });

  it('shows the reserved literal after render', () => {
    renderSettings(fakeCtx({ name1: 'Mara' }));
    expect(document.getElementById('uid_reserved_literal').textContent).toBe('Reserved tag: Mara:');
  });

  it('shows a no-persona sentence and no bare colon when the literal is empty', () => {
    renderSettings(fakeCtx({ name1: '' }));
    const text = document.getElementById('uid_reserved_literal').textContent;
    expect(text).toContain('No persona name is set');
    expect(text).not.toContain(':');
  });

  it('updates the line when the persona changes', () => {
    renderSettings(fakeCtx({ name1: 'Mara' }));
    refreshReservedLiteral(fakeCtx({ name1: 'Iris' }));
    expect(document.getElementById('uid_reserved_literal').textContent).toBe('Reserved tag: Iris:');
  });

  it('is a silent no-op when no drawer has been rendered', () => {
    clear();
    expect(() => refreshReservedLiteral(fakeCtx())).not.toThrow();
  });
});

describe('index.js wiring', () => {
  beforeEach(() => {
    clear();
    vi.resetModules();
  });

  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
  });

  it('renders the drawer once and refreshes it on CHAT_CHANGED, chat id or null', async () => {
    addContainer('extensions_settings2');
    const ctx = installFakeContext();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../index.js');

    expect(document.querySelectorAll('#uid_settings')).toHaveLength(1);
    expect(document.getElementById('uid_reserved_literal').textContent).toBe('Reserved tag: User:');

    ctx.name1 = 'Mara';
    await ctx.eventSource.emit(ctx.eventTypes.CHAT_CHANGED, 'chat-1');
    expect(document.getElementById('uid_reserved_literal').textContent).toBe('Reserved tag: Mara:');

    ctx.name1 = 'Iris';
    await ctx.eventSource.emit(ctx.eventTypes.CHAT_CHANGED, null);
    expect(document.getElementById('uid_reserved_literal').textContent).toBe('Reserved tag: Iris:');
  });
});

describe('module hygiene', () => {
  const settings = readFileSync('src/ui/settings.js', 'utf8');
  const template = readFileSync('src/preset-template.js', 'utf8');

  it('keeps src/ui/settings.js free of the host global, jQuery, innerHTML and settings storage', () => {
    for (const forbidden of ['SillyTavern', 'innerHTML', 'jQuery', '$(', 'extensionSettings', 'saveSettingsDebounced']) {
      expect(settings).not.toContain(forbidden);
    }
  });

  it('keeps src/preset-template.js browser-safe: no node: imports, no top-level side effect', () => {
    expect(template).not.toContain('node:');
    expect(template).not.toContain('process');
    const topLevel = template.split('\n').filter((line) => line !== '' && !/^\s/.test(line));
    for (const line of topLevel) {
      expect(/^(import |export |const |\}|\/\/)/.test(line)).toBe(true);
    }
  });

  it('produces output byte-identical to the committed preset file, twice over', () => {
    const serialise = () => `${JSON.stringify(buildPresets()[OPENAI_PRESET_FILE], null, 2)}\n`;
    expect(serialise()).toBe(readFileSync(`presets/${OPENAI_PRESET_FILE}`, 'utf8'));
    expect(serialise()).toBe(serialise());
  });
});
