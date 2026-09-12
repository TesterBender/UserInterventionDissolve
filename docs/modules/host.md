# host
PLAN: §23
Depends on: —

`src/host.js` is the single door between the extension and SillyTavern. Every other module reaches the host only through the exports here: `getCtx()`, `requireKeys()`, `EVENT()`.

## Single door {#single-door}

`src/host.js` is the only file in the repository allowed to contain the identifier `SillyTavern`. All other modules receive context values as function arguments (a `ctx` parameter, defaulted to a fresh `getCtx()` call where a brief needs that convenience) rather than naming the global directly. `tests/bootstrap.test.js` enforces this: it reads `index.js` and every file under `src/` from disk and asserts the identifier occurs zero times outside `src/host.js`, and within `src/host.js` only inside `getCtx`. The check enumerates `src/` dynamically, so a future module cannot slip past it by being added after the test was written.

## Never cache {#never-cache}

`getCtx()` calls `globalThis.SillyTavern.getContext()` on every invocation and never stores the result in a module-level variable. `chat`, `name1`, `mainApi`, `onlineStatus`, `streamingProcessor` and similar fields are captured **by value at call time** inside `getContext()` (`docs/api/sillytavern.md#getcontext`), so a cached context object silently goes stale the moment the live chat changes. Every call site that needs current values calls `getCtx()` fresh; nothing wraps or memoizes it.

## Event alias {#event-alias}

`EVENT(ctx)` returns `ctx.eventTypes ?? ctx.event_types` and `undefined` if neither exists. `eventTypes` is the current context key (`st-context.js:138`); `event_types` is a legacy alias still present on the same object (`st-context.js:222`, `docs/api/sillytavern.md#context-keys`). Reading through `EVENT()` instead of naming `eventTypes` directly means a host that only exposes the legacy alias still works, and callers that need the value handle an `undefined` result themselves — `EVENT()` does not throw or log.

## Metadata namespace {#metadata-namespace}

`METADATA_KEY` is the property name canonical state is nested under inside `ctx.chatMetadata` (`chatMetadata.<METADATA_KEY>`), saved with `saveMetadata()` (`docs/api/sillytavern.md#chat-metadata`). Namespacing under one key keeps the extension's frozen spans and frontier isolated from other extensions' data sharing the same `chatMetadata` object, and from ST's own fields on it.

## Settings namespace {#settings-namespace}

`SETTINGS_KEY` is the property name this extension's settings are nested under inside `ctx.extensionSettings` (`extensionSettings.<SETTINGS_KEY>`), persisted by calling `saveSettingsDebounced()` after a write (`docs/api/sillytavern.md#extension-settings`). Namespacing under one key is the same convention `chatMetadata` uses and for the same reason: `extensionSettings` is shared by every installed extension.

## Required keys {#required-keys}

`REQUIRED_KEYS` (declared in `src/constants.js`) lists every context key a §23 host operation needs, each traced to a row in `docs/protocol/host-mapping.md#rows`: `chat` and `chatMetadata` (canonical-state storage and reconstruction, §9/§12), `eventSource` (all event-driven modules), `saveChat` and `saveMetadata` (persisting recovery edits and frozen spans, §14/§16), `substituteParams` and `name1` (the reserved boundary literal, §8), `stopGeneration` (the streaming fallback, §8), `extensionSettings` and `saveSettingsDebounced` (settings persistence, once a brief adds settings). `eventTypes`/`event_types` is checked separately through `EVENT(ctx)` because of the alias, not listed in `REQUIRED_KEYS`. `sendMessageAsUser` and `isGenerating` are never added to this list: both are confirmed absent from the context object (`docs/api/sillytavern.md#context-keys-absent`), so requiring them would make `init()` fail forever.
