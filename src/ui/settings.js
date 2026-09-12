// four-elements: description, hint, one button, one status line; no settings → docs/modules/ui-settings.md#four-elements
import { reservedLiteral } from '../boundary.js';
import { LOG_PREFIX } from '../constants.js';
import { buildPresets, PRESET_NAME, OPENAI_PRESET_FILE } from '../preset-template.js';

const ROOT_ID = 'uid_settings';
const STATUS_ID = 'uid_reserved_literal';
const DISPLAY_NAME = 'User Intervention Dissolve';
const NO_PERSONA = 'No persona name is set, so no tag is reserved.';

// notifications: guarded toastr(message, title), console fallback → docs/modules/ui-settings.md#notifications
function notify(kind, message) {
  if (globalThis.toastr?.[kind] === undefined) {
    console.log(`${LOG_PREFIX} ${message}`);
    return;
  }
  globalThis.toastr[kind](message, DISPLAY_NAME);
}

// plain-dom: createElement plus textContent, never markup strings → docs/modules/ui-settings.md#plain-dom
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// container: extensions_settings2 ?? extensions_settings, host drawer skeleton → docs/modules/ui-settings.md#container
export function renderSettings(ctx) {
  const rendered = document.getElementById(ROOT_ID);
  if (rendered !== null) return rendered;
  const container = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
  if (container === null) return null;

  const root = el('div', 'uid-settings');
  root.id = ROOT_ID;
  const drawer = el('div', 'inline-drawer');
  const header = el('div', 'inline-drawer-toggle inline-drawer-header');
  header.append(el('b', undefined, DISPLAY_NAME), el('div', 'inline-drawer-icon fa-solid fa-circle-chevron-down down'));
  const content = el('div', 'inline-drawer-content');

  const about = el('div', 'uid-settings-section');
  about.append(
    el('div', 'uid-settings-heading', 'What this does'),
    el('div', 'uid-settings-note', 'The chat is kept as one continuous manuscript written in tagged blocks. The externally authored character’s tag is reserved, so generation stops before it and the model never writes that character.'),
  );

  const preset = el('div', 'uid-settings-section');
  const actions = el('div', 'uid-settings-actions');
  const button = el('button', 'menu_button uid-install-preset', 'Install reference preset');
  button.id = 'uid_install_preset';
  button.type = 'button';
  button.addEventListener('click', () => {
    installReferencePreset(ctx).catch(() => {});
  });
  actions.append(button);
  preset.append(
    el('div', 'uid-settings-note', `By hand: AI Response Configuration → Chat Completion Presets → Import preset → presets/${OPENAI_PRESET_FILE}. The README lists the same steps.`),
    actions,
  );

  const status = el('div', 'uid-settings-section');
  const line = el('div', 'uid-settings-status');
  line.id = STATUS_ID;
  status.append(el('div', 'uid-settings-heading', 'Boundary'), line);

  content.append(about, preset, status);
  drawer.append(header, content);
  root.append(drawer);
  container.append(root);
  refreshReservedLiteral(ctx);
  return root;
}

// install-preset: savePreset(name, shared template); saving does not activate → docs/modules/ui-settings.md#install-preset
export async function installReferencePreset(ctx) {
  const manager = ctx.getPresetManager?.('openai');
  if (manager == null || typeof manager.savePreset !== 'function') {
    notify('error', 'Chat completion presets are unavailable here, so nothing was installed.');
    return false;
  }
  try {
    await manager.savePreset(PRESET_NAME, buildPresets()[OPENAI_PRESET_FILE]);
  } catch (error) {
    console.error(`${LOG_PREFIX} could not save the reference preset`, error);
    notify('error', 'The reference preset could not be saved.');
    return false;
  }
  notify('success', `Saved. Select ${PRESET_NAME} under Chat Completion Presets to use it.`);
  return true;
}

// status-line: reports boundary's literal, read-only, recomputed per call → docs/modules/ui-settings.md#status-line
export function refreshReservedLiteral(ctx) {
  const line = document.getElementById(STATUS_ID);
  if (line === null) return;
  const literal = reservedLiteral(ctx);
  line.textContent = literal === '' ? NO_PERSONA : `Reserved tag: ${literal}`;
}
