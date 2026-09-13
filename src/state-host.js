import { getCtx } from './host.js';
import { METADATA_KEY, STATE_VERSION, LOG_PREFIX } from './constants.js';
import { createState } from './state.js';

// unknown-version: warn once per stored object, never migrate → docs/modules/state.md#unknown-version
const warned = new WeakSet();

function warnOnce(stored) {
  if (warned.has(stored)) return;
  warned.add(stored);
  console.warn(`${LOG_PREFIX} unknown state version: ${stored.version}`);
}

// lazy-init: materialised on first read, assigned but not saved → docs/modules/state.md#lazy-init
export function getState(ctx = getCtx()) {
  const stored = ctx.chatMetadata?.[METADATA_KEY];
  // v2-upgrade: units added in place, existing spans stay final → docs/modules/state.md#unknown-version
  if (stored !== undefined && stored.version === 2) {
    stored.units = [];
    stored.version = STATE_VERSION;
    return stored;
  }

  if (stored === undefined || stored.version !== STATE_VERSION) {
    if (stored !== undefined) warnOnce(stored);
    const state = createState();
    ctx.chatMetadata[METADATA_KEY] = state;
    return state;
  }

  return stored;
}

// save-metadata-only: message markers are saved by their own handlers → docs/modules/state.md#save
export async function save(ctx = getCtx()) {
  await ctx.saveMetadata();
}
