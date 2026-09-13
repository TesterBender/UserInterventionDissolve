import { STORAGE_KEY_PREFIX } from './constants.js';
import { loadJanitorState, saveJanitorState, stateKey } from './storage.js';
import { getRequestStatus, setStatusListener } from './status.js';
import { requestRecompile } from './recompile.js';
import { exportStateJson, importStateJson } from './portable.js';
import {
  PANEL_LABELS, statusLines, staticNotes, recompileAvailability, recompileRequestedText, importOutcome,
} from './panel-text.js';

// panel-host: one id, one consumer, appended to the document element → docs/modules/janitor-panel.md#what-it-is
const PANEL_HOST_ID = 'uid-manuscript-panel-host';

const PANEL_CSS = `
:host { all: initial; }
.launcher, .panel { position: fixed; right: 12px; font: 12px/1.5 system-ui, sans-serif; color: #e8e8e8; }
.launcher { bottom: 12px; z-index: 2147483647; background: #23252b; border: 1px solid #4a4d55; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.panel { bottom: 48px; width: 420px; max-height: 70vh; overflow: auto; z-index: 2147483646; background: #17181c; border: 1px solid #4a4d55; border-radius: 6px; padding: 12px; }
.head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.title { font-weight: 600; }
.status { white-space: pre-wrap; font-family: ui-monospace, monospace; background: #101114; border: 1px solid #33353c; border-radius: 4px; padding: 8px; }
.notes, .message { white-space: pre-wrap; margin-top: 8px; color: #b6b8bf; }
.section { margin-top: 12px; }
.section-head { font-weight: 600; margin-bottom: 4px; }
textarea { width: 100%; height: 96px; box-sizing: border-box; font-family: ui-monospace, monospace; font-size: 11px; background: #101114; color: #e8e8e8; border: 1px solid #33353c; border-radius: 4px; padding: 6px; }
button { font: inherit; background: #23252b; color: #e8e8e8; border: 1px solid #4a4d55; border-radius: 4px; padding: 3px 8px; cursor: pointer; }
button[disabled] { opacity: 0.5; cursor: default; }
`;

const ui = {};

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function renderPanel() {
  const status = getRequestStatus();
  const availability = recompileAvailability(status);

  ui.status.textContent = statusLines(status).join('\n');
  ui.recompile.disabled = availability.disabled;
  ui.recompile.title = availability.note;
  ui.exportArea.value = exportStateJson(status.chatId, loadJanitorState(status.chatId));
}

function onRecompile() {
  requestRecompile(getRequestStatus().chatId);
  ui.message.textContent = recompileRequestedText();
}

function onImport() {
  const outcome = importOutcome(importStateJson(ui.importArea.value), getRequestStatus().chatId);
  saveJanitorState(outcome.saveChatId, outcome.state);
  ui.message.textContent = outcome.message;
  renderPanel();
}

// same-chat-only: the cross-tab filter, and the only other branch in this file → docs/modules/janitor-panel.md#cross-tab
function onStorage(event) {
  if (!event.key?.startsWith(STORAGE_KEY_PREFIX)) return;
  if (event.key !== stateKey(getRequestStatus().chatId)) return;
  renderPanel();
}

function buildPanel() {
  const panel = makeElement('section', 'panel', '');
  panel.hidden = true;

  const head = makeElement('div', 'head', '');
  head.append(makeElement('span', 'title', PANEL_LABELS.title));
  panel.append(head);

  ui.status = makeElement('div', 'status', '');
  panel.append(ui.status);
  panel.append(makeElement('div', 'notes', staticNotes().join('\n')));

  ui.recompile = makeElement('button', 'recompile', PANEL_LABELS.recompile);
  ui.recompile.type = 'button';
  ui.recompile.addEventListener('click', onRecompile);
  const actions = makeElement('div', 'section', '');
  actions.append(ui.recompile);
  panel.append(actions);

  ui.message = makeElement('div', 'message', '');
  panel.append(ui.message);

  const exportSection = makeElement('div', 'section', '');
  exportSection.append(makeElement('div', 'section-head', PANEL_LABELS.exportHeading));
  ui.exportArea = makeElement('textarea', 'export', '');
  ui.exportArea.readOnly = true;
  ui.exportArea.spellcheck = false;
  ui.exportArea.addEventListener('focus', () => ui.exportArea.select());
  exportSection.append(ui.exportArea);
  panel.append(exportSection);

  const importSection = makeElement('div', 'section', '');
  importSection.append(makeElement('div', 'section-head', PANEL_LABELS.importHeading));
  ui.importArea = makeElement('textarea', 'import', '');
  ui.importArea.spellcheck = false;
  const importButton = makeElement('button', 'import-run', PANEL_LABELS.importButton);
  importButton.type = 'button';
  importButton.addEventListener('click', onImport);
  importSection.append(ui.importArea, importButton);
  panel.append(importSection);

  return panel;
}

export function installPanel() {
  if (document.getElementById(PANEL_HOST_ID) !== null) return;

  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PANEL_CSS;

  const panel = buildPanel();
  const launcher = makeElement('button', 'launcher', PANEL_LABELS.launcher);
  launcher.type = 'button';
  launcher.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    renderPanel();
  });

  shadow.append(style, launcher, panel);
  document.documentElement.append(host);

  setStatusListener(renderPanel);
  window.addEventListener('storage', onStorage);
  renderPanel();
}
