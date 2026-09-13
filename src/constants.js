// log-prefix: shared console line prefix → docs/modules/bootstrap.md#log-prefix
export const LOG_PREFIX = '[UID]';

// metadata-key: chatMetadata namespace for canonical state → docs/modules/host.md#metadata-namespace
export const METADATA_KEY = 'userInterventionDissolve';

// state-shape: version field of the stored per-chat structure → docs/modules/state.md#shape
export const STATE_VERSION = 3;

// block-delimiter: write-side join string; read side is grammar's parser → docs/modules/grammar.md#block-delimiter
export const BLOCK_DELIMITER = '\n\n';

// settings-key: extensionSettings namespace → docs/modules/host.md#settings-namespace
export const SETTINGS_KEY = 'userInterventionDissolve';

// interceptor-global: must equal manifest.json's generate_interceptor value → docs/modules/bootstrap.md#interceptor-placeholder
export const INTERCEPTOR_GLOBAL = 'userInterventionDissolveInterceptor';

// required-keys: every context key a host operation needs → docs/modules/host.md#required-keys
export const REQUIRED_KEYS = [
  'chat',
  'chatMetadata',
  'eventSource',
  'saveChat',
  'saveMetadata',
  'substituteParams',
  'name1',
  'stopGeneration',
  'extensionSettings',
  'saveSettingsDebounced',
];

// freeze-min-words: §16 target floor; no cut is considered below it → docs/modules/freeze.md#target-jitter
export const FREEZE_MIN_WORDS = 3000;

// freeze-max-words: advisory ceiling; a cut past it is an overrun → docs/modules/freeze.md#overrun
export const FREEZE_MAX_WORDS = 4200;

// final-min-words: floor below which units are not sealed into a final span → docs/modules/freeze.md#seal-policy
export const FINAL_MIN_WORDS = 6000;

// final-max-words: hard ceiling for one sealed final span → docs/modules/freeze.md#seal-policy
export const FINAL_MAX_WORDS = 10000;

