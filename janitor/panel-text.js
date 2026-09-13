// panel-sentences: every human-facing string and every panel decision lives here → docs/modules/janitor-panel.md#untested-dom
export const PANEL_LABELS = {
  launcher: 'Manuscript',
  title: 'Manuscript',
  close: 'Close',
  recompile: 'Recompile',
  exportHeading: 'Export — copy this somewhere safe',
  importHeading: 'Import — paste an export here',
  importButton: 'Replace this chat from the pasted text',
};

const NOTHING_SEEN = 'No request seen on this page yet. Send a message in this chat and the panel fills in.';
const RECOMPILE_UNAVAILABLE = 'Nothing to rebuild yet: the panel has not seen a request, so it does not know which chat you are in.';

export function hasSnapshot(status) {
  return status.at !== 0 && status.chatId !== '';
}

function transportLine(status) {
  return status.stopSent
    ? 'The boundary is carried by the stop parameter: the provider halts the model at the right place.'
    : 'The boundary is carried by the stream cut: this provider refused the parameter, so the script ends the reply itself. A little extra text may be generated and thrown away.';
}

// router-blind: proxy mode only, and only the human can change it → docs/modules/janitor-panel.md#status-line
function routerLines(status) {
  if (!status.routerEnabled) return [];
  return ['Janitor is running this model call on its own servers, so the script sees nothing and changes nothing. Point Janitor at a proxy for the manuscript to work.'];
}

function driftLines(status) {
  return status.driftNotices.map((messageId) => `The text of an already-sealed message changed (${messageId}). The sealed copy is what the model keeps reading; the panel reports this and never rewrites it. Recompile if you want the edit to count.`);
}

export function statusLines(status) {
  if (!hasSnapshot(status)) return [NOTHING_SEEN];

  return [
    `Chat: ${status.chatId}`,
    `Your reserved name: ${status.literal}`,
    `Sealed spans: ${status.finals} · unsealed units: ${status.units} · live scene: ${status.frontierWords} words`,
    transportLine(status),
    ...routerLines(status),
    ...driftLines(status),
  ];
}

export function recompileAvailability(status) {
  const ready = hasSnapshot(status);
  return { disabled: !ready, note: ready ? '' : RECOMPILE_UNAVAILABLE };
}

export function recompileRequestedText() {
  return 'Rebuild requested. It happens on your next message, not now, and it can only use the messages Janitor still sends — anything older than its window is gone from the manuscript.';
}

export function staticNotes() {
  return [
    'A rebuild takes effect on the next message you send, and rebuilds only from what Janitor still sends.',
    'Two tabs open on the same chat overwrite each other: the last one to write wins. Keep one tab per chat.',
  ];
}

const TRANSFER_FAILURES = {
  unreadable: 'That is not readable JSON. Paste the whole export, from the first brace to the last.',
  'not-a-state': 'That JSON is not a manuscript export. Nothing was changed.',
  'wrong-format': 'That export was written by a different version of the script and cannot be read. Nothing was changed.',
};

export function transferResultText(result) {
  if (result.ok) return 'Imported. This chat now holds the manuscript from that export; whatever it held before is gone.';
  return TRANSFER_FAILURES[result.reason];
}

// import-decision: the sentence and the save target in one place, so panel.js branches on nothing → docs/modules/janitor-panel.md#transfer
export function importOutcome(result, chatId) {
  const foreign = result.ok && result.chatId !== chatId
    ? ` The export came from chat ${result.chatId}; it was imported into this one anyway.`
    : '';
  return {
    message: transferResultText(result) + foreign,
    saveChatId: result.ok ? chatId : '',
    state: result.ok ? result.state : null,
  };
}
