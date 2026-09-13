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

    expect(listened.map((entry) => `${entry.target.id}:${entry.type}`)).toEqual([
      'uid_install_preset:click',
      'uid_recompile:click',
      'uid_starter_input:input',
      'uid_starter_restructure:click',
      'uid_starter_copy:click',
    ]);
  });

  it('holds description, hint, one button and the status line, in that order', () => {
    const root = renderSettings(fakeCtx());
    const sections = root.querySelectorAll('.uid-settings-section');
    expect(sections).toHaveLength(4);

    const notes = root.querySelectorAll('.uid-settings-note');
    expect(notes[0].textContent.split('. ').filter(Boolean).length).toBeLessThanOrEqual(2);
    const hint = notes[1].textContent;
    for (const label of ['AI Response Configuration', 'Chat Completion Presets', 'Import preset', `presets/${OPENAI_PRESET_FILE}`]) {
      expect(hint).toContain(label);
    }
    expect(hint).toContain('README');

    const buttons = root.querySelectorAll('button');
    expect([...buttons].map((b) => b.id)).toEqual([
      'uid_install_preset',
      'uid_recompile',
      'uid_starter_restructure',
      'uid_starter_copy',
    ]);
    for (const b of buttons) {
      expect(b.type).toBe('button');
      expect(b.classList.contains('menu_button')).toBe(true);
    }

    const order = [...root.querySelectorAll('.uid-settings-note, button, #uid_reserved_literal, .uid-starter-input')];
    expect(order.indexOf(notes[0])).toBeLessThan(order.indexOf(notes[1]));
    expect(order.indexOf(notes[1])).toBeLessThan(order.indexOf(buttons[0]));
    const statusAt = order.findIndex((node) => node.id === 'uid_reserved_literal');
    expect(order.indexOf(buttons[0])).toBeLessThan(statusAt);
    expect(statusAt).toBeLessThan(order.findIndex((node) => node.id === 'uid_starter_input'));
    expect(order.at(-1).classList.contains('uid-starter-hint')).toBe(true);

    expect(root.querySelectorAll('input, select')).toHaveLength(0);
    expect([...root.querySelectorAll('textarea')].map((t) => t.id)).toEqual(['uid_starter_input', 'uid_starter_output']);
  });
});

describe('the Recompile button', () => {
  beforeEach(() => {
    clear();
    addContainer('extensions_settings2');
    delete globalThis.toastr;
  });

  afterEach(() => {
    uninstall();
    delete globalThis.toastr;
  });

  it('renders exactly one enabled button in the actions row with the pinned label and hint', () => {
    const root = renderSettings(fakeCtx());
    const buttons = root.querySelectorAll('#uid_recompile');
    expect(buttons).toHaveLength(1);
    const rebuild = buttons[0];
    expect(rebuild.textContent).toBe('Recompile');
    expect(rebuild.type).toBe('button');
    expect(rebuild.disabled).toBe(false);
    expect(rebuild.classList.contains('menu_button')).toBe(true);
    expect(rebuild.classList.contains('uid-recompile')).toBe(true);
    expect(rebuild.parentElement.classList.contains('uid-settings-actions')).toBe(true);
    expect(rebuild.parentElement.querySelector('#uid_install_preset')).not.toBeNull();

    const hints = [...root.querySelectorAll('.uid-settings-note')].map((n) => n.textContent);
    expect(hints).toContain('Rebuilds the compiled history from the chat as it is now.');
  });

  it('recompiles the live chat on click and reports the summary through notify', async () => {
    const ctx = installFakeContext();
    const toastr = { success: vi.fn() };
    globalThis.toastr = toastr;
    renderSettings(fakeCtx());

    document.getElementById('uid_recompile').click();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(ctx.saveMetadata).toHaveBeenCalledTimes(1);
    expect(toastr.success).toHaveBeenCalledTimes(1);
    expect(toastr.success.mock.calls[0][0]).toBe('Recompiled: 0 spans, 0 words frozen');
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
    for (const forbidden of ['SillyTavern', 'innerHTML', 'jQuery', '$(', 'extensionSettings', 'saveSettingsDebounced', 'fetch', 'merge-attributes', 'localStorage']) {
      expect(settings).not.toContain(forbidden);
    }
  });

  it('adds only uid-prefixed style rules, themed colours and no !important', () => {
    const css = readFileSync('style.css', 'utf8');
    expect(css).not.toContain('!important');
    expect(css).not.toContain('@media');
    for (const selector of css.split('}').map((rule) => rule.split('{')[0].trim()).filter(Boolean)) {
      for (const part of selector.split(',')) {
        expect(part.trim().startsWith('.uid-')).toBe(true);
      }
    }
    for (const colour of css.matchAll(/(?:^|\s)(?:color|background|border[a-z-]*):\s*([^;]+);/g)) {
      expect(colour[1]).toContain('var(--SmartTheme');
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

describe('the starter reformatter group', () => {
  let clipboard;

  beforeEach(() => {
    clear();
    addContainer('extensions_settings2');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    clipboard = { writeText: vi.fn(async () => {}) };
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: clipboard, configurable: true });
  });

  afterEach(() => {
    delete globalThis.toastr;
    vi.restoreAllMocks();
  });

  async function settle() {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  }

  function render(generateRaw) {
    const ctx = fakeCtx();
    ctx.generateRaw = generateRaw ?? vi.fn(async () => 'Anton: "Here."');
    renderSettings(ctx);
    return ctx;
  }

  function parts() {
    return {
      input: document.getElementById('uid_starter_input'),
      output: document.getElementById('uid_starter_output'),
      restructure: document.getElementById('uid_starter_restructure'),
      copy: document.getElementById('uid_starter_copy'),
    };
  }

  function type(value) {
    const { input } = parts();
    input.value = value;
    input.dispatchEvent(new globalThis.Event('input'));
  }

  it('renders one of each control, with the committed placeholder and hint', () => {
    render();
    const { input, output, restructure, copy } = parts();
    expect(document.querySelectorAll('#uid_starter_input, #uid_starter_output')).toHaveLength(2);
    expect(input.placeholder).toBe('Paste a starter in ordinary prose');
    expect(input.rows).toBe(4);
    expect(output.rows).toBe(8);
    expect(output.readOnly).toBe(true);
    expect(output.hidden).toBe(true);
    expect(restructure.textContent).toBe('Restructure');
    expect(copy.textContent).toBe('Copy');
    expect(document.querySelector('.uid-starter-hint').textContent).toBe("Paste into the character's Alternate Greetings.");
  });

  it('renders once on a second call and still calls the rewrite once per click', async () => {
    const generateRaw = vi.fn(async () => 'Anton: "Here."');
    const ctx = render(generateRaw);
    expect(renderSettings(ctx)).toBe(document.getElementById('uid_settings'));
    expect(document.querySelectorAll('#uid_starter_restructure')).toHaveLength(1);

    type('a starter');
    parts().restructure.click();
    await settle();
    expect(generateRaw).toHaveBeenCalledTimes(1);
  });

  it('enables Restructure only for non-whitespace input and Copy only for a filled output', async () => {
    render();
    expect(parts().restructure.disabled).toBe(true);
    expect(parts().copy.disabled).toBe(true);

    type('   \n  ');
    expect(parts().restructure.disabled).toBe(true);

    type('a starter');
    expect(parts().restructure.disabled).toBe(false);
    expect(parts().copy.disabled).toBe(true);

    parts().restructure.click();
    await settle();
    expect(parts().copy.disabled).toBe(false);
    expect(parts().restructure.disabled).toBe(false);
  });

  it('fills and unhides the output with the sanitised text', async () => {
    render(vi.fn(async () => '```\nAnton: "Here."\n```'));
    type('a starter');
    parts().restructure.click();
    await settle();
    expect(parts().output.value).toBe('Anton: "Here."');
    expect(parts().output.hidden).toBe(false);
  });

  it('leaves the output empty and hidden and notifies once when the rewrite comes back empty', async () => {
    globalThis.toastr = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
    render(vi.fn(async () => ''));
    type('a starter');
    parts().restructure.click();
    await settle();
    expect(parts().output.value).toBe('');
    expect(parts().output.hidden).toBe(true);
    expect(parts().copy.disabled).toBe(true);
    expect(globalThis.toastr.error).toHaveBeenCalledTimes(1);
  });

  it('copies the output through the clipboard once', async () => {
    render();
    type('a starter');
    parts().restructure.click();
    await settle();
    parts().copy.click();
    await settle();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith('Anton: "Here."');
  });

  it('selects the output instead when the clipboard is absent or rejects', async () => {
    render();
    type('a starter');
    parts().restructure.click();
    await settle();
    const select = vi.spyOn(parts().output, 'select').mockImplementation(() => {});
    vi.spyOn(parts().output, 'setSelectionRange').mockImplementation(() => {});

    Object.defineProperty(globalThis.navigator, 'clipboard', { value: undefined, configurable: true });
    expect(() => parts().copy.click()).not.toThrow();
    await settle();
    expect(select).toHaveBeenCalledTimes(1);

    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => { throw new Error('denied'); }) },
      configurable: true,
    });
    parts().copy.click();
    await settle();
    expect(select).toHaveBeenCalledTimes(2);
    expect(parts().output.value).toBe('Anton: "Here."');
  });

  it('persists nothing: a re-render starts empty and no store is written', async () => {
    const ctx = render();
    ctx.saveSettingsDebounced = vi.fn();
    ctx.extensionSettings = {};
    ctx.chatMetadata = {};
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {});
    type('a starter');
    parts().restructure.click();
    await settle();

    clear();
    addContainer('extensions_settings2');
    renderSettings(ctx);
    expect(parts().input.value).toBe('');
    expect(parts().output.value).toBe('');
    expect(ctx.saveSettingsDebounced).not.toHaveBeenCalled();
    expect(ctx.extensionSettings).toEqual({});
    expect(ctx.chatMetadata).toEqual({});
    expect(setItem).not.toHaveBeenCalled();
  });
});
