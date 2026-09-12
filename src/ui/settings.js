// four-elements: description, hint, button, status line, starter group → docs/modules/ui-settings.md#four-elements
import { reservedLiteral } from '../boundary.js';
import { LOG_PREFIX } from '../constants.js';
import { buildPresets, PRESET_NAME, OPENAI_PRESET_FILE } from '../preset-template.js';
import { restructureStarter } from '../starter.js';

const ROOT_ID = 'uid_settings';
const STATUS_ID = 'uid_reserved_literal';
const STARTER_INPUT_ID = 'uid_starter_input';
const STARTER_OUTPUT_ID = 'uid_starter_output';
const RESTRUCTURE_ID = 'uid_starter_restructure';
const COPY_ID = 'uid_starter_copy';
const DISPLAY_NAME = 'User Intervention Dissolve';
const NO_PERSONA = 'No persona name is set, so no tag is reserved.';
const PASTE_HINT = "Paste into the character's Alternate Greetings.";

let rewriting = false;

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

  const starter = el('div', 'uid-settings-section');
  const starterInput = el('textarea', 'uid-starter-input');
  starterInput.id = STARTER_INPUT_ID;
  starterInput.rows = 4;
  starterInput.placeholder = 'Paste a starter in ordinary prose';
  starterInput.addEventListener('input', updateStarterControls);
  const starterActions = el('div', 'uid-settings-actions');
  const restructure = el('button', 'menu_button uid-starter-restructure', 'Restructure');
  restructure.id = RESTRUCTURE_ID;
  restructure.type = 'button';
  restructure.addEventListener('click', () => {
    runRestructure(ctx).catch(() => {});
  });
  const copy = el('button', 'menu_button uid-starter-copy', 'Copy');
  copy.id = COPY_ID;
  copy.type = 'button';
  copy.addEventListener('click', () => {
    copyStarterOutput().catch(() => {});
  });
  starterActions.append(restructure, copy);
  const starterOutput = el('textarea', 'uid-starter-output');
  starterOutput.id = STARTER_OUTPUT_ID;
  starterOutput.rows = 8;
  starterOutput.readOnly = true;
  starterOutput.hidden = true;
  starter.append(
    el('div', 'uid-settings-heading', 'Starter'),
    el('div', 'uid-settings-note', 'Paste a starter written as ordinary prose. The restructured version appears below for you to check.'),
    starterInput,
    starterActions,
    starterOutput,
    el('div', 'uid-settings-note uid-starter-hint', PASTE_HINT),
  );

  content.append(about, preset, status, starter);
  drawer.append(header, content);
  root.append(drawer);
  container.append(root);
  refreshReservedLiteral(ctx);
  updateStarterControls();
  return root;
}

// starter-enablement: one recompute, disabled only, label never changes → docs/modules/ui-settings.md#starter-group
function updateStarterControls() {
  const input = document.getElementById(STARTER_INPUT_ID);
  if (input === null) return;
  document.getElementById(RESTRUCTURE_ID).disabled = rewriting || input.value.trim() === '';
  document.getElementById(COPY_ID).disabled = document.getElementById(STARTER_OUTPUT_ID).value === '';
}

// starter-handlers: thin wrappers over the reformatter, nothing stored → docs/modules/starter.md#rewrite-request
async function runRestructure(ctx) {
  const output = document.getElementById(STARTER_OUTPUT_ID);
  rewriting = true;
  updateStarterControls();
  try {
    const text = await restructureStarter(document.getElementById(STARTER_INPUT_ID).value, ctx);
    if (text === '') {
      notify('error', 'The starter could not be restructured. Edit it and try again.');
      return;
    }
    output.value = text;
    output.hidden = false;
  } finally {
    rewriting = false;
    updateStarterControls();
  }
}

// clipboard-fallback: selection when the clipboard is absent or refuses → docs/modules/ui-settings.md#starter-group
async function copyStarterOutput() {
  const output = document.getElementById(STARTER_OUTPUT_ID);
  const clipboard = globalThis.navigator?.clipboard;
  const copied = clipboard?.writeText === undefined
    ? false
    : await clipboard.writeText(output.value).then(() => true, () => false);
  if (copied) {
    notify('success', 'The restructured starter is on the clipboard.');
    return;
  }
  output.select();
  output.setSelectionRange(0, output.value.length);
  notify('info', 'The restructured starter is selected, ready to copy.');
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
