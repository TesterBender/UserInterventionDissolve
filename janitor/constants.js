// sentinel-literal: exact match only, consumed by the request transform → docs/modules/janitor-adapter.md#sentinel
export const SENTINEL = '//';

// storage-key: one localStorage entry per Janitor chat id → docs/modules/janitor-adapter.md#stored-state
export const STORAGE_KEY_PREFIX = 'uid-janitor-v1:';

// stop-routes-key: its own entry, never a chat key, never per chat → docs/modules/janitor-transport.md#stop-rejection-learning
export const JANITOR_STOP_ROUTES_KEY = 'uid-janitor-stop-rejected-v1';

// janitor-format: this layer's own stored version, not src/'s STATE_VERSION → docs/modules/janitor-adapter.md#stored-state
export const JANITOR_STATE_FORMAT = 2;

// horizon-budget: host constant, never a setting and never read from Janitor → docs/modules/janitor-adapter.md#horizon-budget
export const JANITOR_HORIZON_TOKEN_BUDGET = 100_000;

// horizon-hysteresis: once over budget, drop to this fraction of it → docs/modules/janitor-adapter.md#transport-horizon
export const JANITOR_HORIZON_HYSTERESIS = 0.8;

// words-per-token: the estimate, no tokenizer and no dependency → docs/modules/janitor-adapter.md#horizon-budget
export const JANITOR_WORDS_PER_TOKEN = 1.4;

// lead-in: pinned user-first turn for providers that demand one → docs/modules/janitor-adapter.md#lead-in
export const JANITOR_LEAD_IN = 'Write the manuscript.';

// override-key: its own entry, never a chat state key → docs/modules/janitor-adapter.md#context-override
export const JANITOR_OVERRIDE_KEY_PREFIX = 'uid-janitor-context-v1:';

// override-format: this entry's own version, checked like janitorFormat → docs/modules/janitor-adapter.md#context-override
export const JANITOR_OVERRIDE_FORMAT = 1;
