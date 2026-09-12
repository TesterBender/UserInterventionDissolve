// log-prefix: shared console line prefix → docs/modules/bootstrap.md#capability-gate
export const LOG_PREFIX = '[UID]';

// metadata-key: chatMetadata namespace for canonical state → docs/protocol/host-mapping.md#s16-freeze
export const METADATA_KEY = 'userInterventionDissolve';

// settings-key: extensionSettings namespace → docs/modules/host.md#required-keys
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
