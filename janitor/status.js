import { LOG_PREFIX } from '../src/constants.js';

// notice-cap: a notice surface, not a log → docs/modules/janitor-adapter.md#status-snapshot
const DRIFT_NOTICE_CAP = 20;

// last-request-snapshot: the panel's whole view of the request side → docs/modules/janitor-adapter.md#status-snapshot
const snapshot = {
  chatId: '',
  literal: '',
  finals: 0,
  units: 0,
  frontierWords: 0,
  froze: false,
  rebuilt: false,
  stopSent: false,
  routerEnabled: false,
  driftNotices: [],
  capturedContext: '',
  at: 0,
};

let noticed = new Set();
let statusListener = null;
let warnedListenerThrew = false;

// one-listener: the panel is the only consumer → docs/modules/janitor-adapter.md#status-snapshot
export function setStatusListener(fn) {
  statusListener = fn;
}

export function getRequestStatus() {
  return { ...snapshot, driftNotices: [...snapshot.driftNotices] };
}

function notify() {
  if (!statusListener) return;
  try {
    statusListener(getRequestStatus());
  } catch (error) {
    if (warnedListenerThrew) return;
    warnedListenerThrew = true;
    console.warn(`${LOG_PREFIX} the status listener threw and is being kept: ${error.message}`);
  }
}

export function setRequestStatus(patch) {
  Object.assign(snapshot, patch, { at: Date.now() });
  notify();
}

// once-per-occurrence: this host's replacement for the toastr notice → docs/modules/janitor-adapter.md#status-snapshot
export function noteDrift(chatId, messageIds) {
  if (chatId !== snapshot.chatId) {
    snapshot.chatId = chatId;
    snapshot.driftNotices = [];
    noticed = new Set();
  }

  let added = 0;
  for (const messageId of messageIds) {
    if (noticed.has(messageId)) continue;
    noticed.add(messageId);
    snapshot.driftNotices.push(messageId);
    if (snapshot.driftNotices.length > DRIFT_NOTICE_CAP) snapshot.driftNotices.shift();
    added += 1;
  }
  return added;
}
