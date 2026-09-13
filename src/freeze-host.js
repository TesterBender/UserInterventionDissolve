import { getCtx } from './host.js';
import { METADATA_KEY } from './constants.js';
import { getState } from './state-host.js';

// pinned-string: the only user-visible text in the freeze path → docs/modules/freeze.md#frozen-edit-notice
export const FROZEN_EDIT_NOTICE = 'That part of the manuscript is already frozen; this edit stays in the log only.';

// frozen-edit-notice: one toast, consumed messages only, writes nothing → docs/modules/freeze.md#frozen-edit-notice
export function noticeFrozenEdit(index, ctx = getCtx()) {
  const id = ctx.chat?.[index]?.extra?.[METADATA_KEY]?.id;
  if (typeof id !== 'string') return false;
  if (!getState(ctx).frozenIds.includes(id)) return false;

  globalThis.toastr?.info(FROZEN_EDIT_NOTICE);
  return true;
}
