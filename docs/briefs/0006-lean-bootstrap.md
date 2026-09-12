# Brief 0006 — lean bootstrap: manifest, host door, constants, fake context
Status: done
Complexity: low
PLAN sections: §23 (host requirements — the host must expose continuation, boundary, capture, reconstruction, frontier and freeze operations; this brief only opens the single door through which every later module reaches them, and asserts the required operations are present before declaring the extension ready)
Invariants touched: none directly. The bootstrap creates the registration point that INV-2 (`boundary`) and INV-4 (`frontier`) handlers will later attach to; it must not implement either.

## Goal
SillyTavern loads the extension: `manifest.json` is accepted, `index.js` runs at load, `getCtx()` returns a fresh context, the required context keys are verified once, one `[UID] ready` line is logged, and the `generate_interceptor` global named in the manifest exists as a no-op. No behaviour beyond that exists. When this is done, the `boundary` brief can add event subscriptions and the `frontier` brief can fill the interceptor body without touching packaging, the host door, or the test harness.

## In scope
- **`manifest.json`** — exactly these keys, every one honored per `docs/api/sillytavern.md#manifest`:
  | key | value | why |
  |---|---|---|
  | `display_name` | `"User Intervention Dissolve"` | `#manifest` (extensions.js:581) |
  | `loading_order` | `50` | `#manifest` (extensions.js:49-50); same value Intercede shipped |
  | `requires` | `[]` | `#manifest` (extensions.js:578, 596-600) — no ST module requirements |
  | `optional` | `[]` | `#manifest` (extensions.js:972) |
  | `js` | `"index.js"` | `#manifest` (extensions.js:429, 814) |
  | `css` | `"style.css"` | `#manifest` (extensions.js:782) |
  | `author` | `"mrdanger2nd"` | `#manifest` (UI field) |
  | `version` | `"0.0.0"` | `#manifest` (extensions.js:918); matches `package.json` |
  | `minimum_client_version` | `"1.18.0"` | `#manifest` (extensions.js:580, 586-590); the inventory baseline |
  | `homePage` | `"https://example.invalid/user-intervention-dissolve"` | `#manifest` (UI field) — **placeholder, the user replaces it**; do not invent a real URL |
  | `auto_update` | `false` | `#manifest` (UI field) |
  | `generate_interceptor` | `"userInterventionDissolveInterceptor"` | `#generate-interceptor` (extensions.js:2024, 2028) — wired once here so the `frontier` brief only fills the function body |
  No other key. No `dependencies`, no `i18n`.
- **`src/constants.js`** — only these literals, each with a consumer in this brief or the manifest: `LOG_PREFIX = '[UID]'`, `METADATA_KEY = 'userInterventionDissolve'` (namespace under `chatMetadata`, `#chat-metadata`), `SETTINGS_KEY = 'userInterventionDissolve'` (namespace under `extensionSettings`, `#extension-settings`), `INTERCEPTOR_GLOBAL = 'userInterventionDissolveInterceptor'` (must equal the manifest value character-for-character), and `REQUIRED_KEYS` (the array below). Nothing else — no version string, no event names, no continuation string.
- **`src/host.js`** — three exports and nothing else:
  - `getCtx()` → `globalThis.SillyTavern.getContext()` evaluated on **every call**, never stored in a module variable, never memoized (`#getcontext`: `chat`, `name1`, `mainApi` etc. are captured by value at call time).
  - `requireKeys(ctx, names)` → returns the array of names for which `ctx?.[name] === undefined` (presence test, **not** truthiness — `name1` may legitimately be `''`). Returns `[]` when all present. Pure; does not log, throw, or call `getCtx()`.
  - `EVENT(ctx)` → `ctx.eventTypes ?? ctx.event_types` (`#context-keys`: `eventTypes` at st-context.js:138, legacy alias `event_types` at 222). Returns `undefined` if neither exists; callers handle that.
  - `REQUIRED_KEYS` (in constants, consumed here and by `index.js`): `['chat', 'chatMetadata', 'eventSource', 'saveChat', 'saveMetadata', 'substituteParams', 'name1', 'stopGeneration', 'extensionSettings', 'saveSettingsDebounced']` — every one verified present at `#context-keys`, and each is required by a §23 host operation (`docs/protocol/host-mapping.md#rows`). `eventTypes` is checked separately via `EVENT(ctx)` because of the alias. Do **not** add `sendMessageAsUser` or `isGenerating` (`#context-keys-absent`).
  - **`src/host.js` is the only file in the repository allowed to contain the identifier `SillyTavern`.**
- **`index.js`** — roughly 30 lines, in this shape and no more:
  - `globalThis[INTERCEPTOR_GLOBAL] = async function (chat, contextSize, abort, type) { return; }` — a real no-op: it must not read, mutate, reorder or replace entries of `chat`, and must not call `abort`. Signature per `#generate-interceptor` (extensions.js:2028).
  - `let ready = false;` module flag; `export function init()` returns immediately if `ready` is true (idempotent).
  - `init()` calls `getCtx()`; if the global/context is unavailable, or `requireKeys(ctx, REQUIRED_KEYS)` returns a non-empty list, or `EVENT(ctx)` is `undefined`, it logs one `console.error` line with `LOG_PREFIX` and the missing names and returns **without** setting `ready` (a later retry stays possible, per `docs/decisions/0002-structure-from-intercede.md` "capability gate before init").
  - On success: `ready = true` and exactly one `console.log(`${LOG_PREFIX} ready`)`.
  - `init()` is invoked once at module top level — **no polling, no `waitUntil`, no jQuery-ready branch**. Evidence that the context is available to an extension's `index.js` at load: the author's real-install Test Probe extension destructures `SillyTavern.getContext()` at module top level, `Intercede:../Test Probe Extension/index.js:1-5`. If that evidence is ever contradicted, the sanctioned fallback is a **single** `eventSource.on(EVENT(ctx).APP_READY, init)` subscription, which auto-fires for late subscribers (`#message-lifecycle-events`, events.js:113) — nothing else.
  - Export `init` (and a test-only `isReady()` if the tests need to observe the flag; no other export, no `globalThis` surface).
- **`style.css`** — one prefixed root class (e.g. `.uid-root { }`) and nothing else. No comment (the pointer-policy tool checks `.css`; an empty rule needs no pointer).
- **`tests/helpers/fake-context.js`** — `installFakeContext(overrides)` sets `globalThis.SillyTavern = { getContext: () => ctx }` where `ctx` has: `chat` (array), `chatMetadata` (object), `eventSource` with `on`/`off`/`emit` where `emit` is **async and awaits listeners sequentially, swallowing listener errors** (`#events`, eventemitter.js:129-157), `eventTypes` with the string constants `APP_READY`, `CHAT_CHANGED`, `MESSAGE_SENT`, `MESSAGE_RECEIVED`, `GENERATION_STARTED`, `GENERATION_ENDED`, `GENERATION_STOPPED`, `CHAT_COMPLETION_SETTINGS_READY`, `TEXT_COMPLETION_SETTINGS_READY`, `CHAT_COMPLETION_PROMPT_READY`, `STREAM_TOKEN_RECEIVED`, plus `name1`, `saveChat`, `saveMetadata`, `saveSettingsDebounced`, `extensionSettings`, `substituteParams`, `stopGeneration` (all functions are plain spies/stubs). `overrides` shallow-merges into `ctx` and may delete a key (support `installFakeContext({ name1: undefined })` meaning *absent* by using a documented sentinel or an `omit` array — pick one and document it in `docs/modules/bootstrap.md`). Also export `uninstall()` restoring `globalThis.SillyTavern` to its previous value.
- **`tests/bootstrap.test.js`** (vitest, `vi.resetModules()` between cases): the Acceptance list below.

## Out of scope (explicit)
- Any event subscription in `index.js` — no `CHAT_CHANGED`, no `APP_READY` (unless the documented fallback is triggered), no `MESSAGE_SENT`/`MESSAGE_RECEIVED` handler. Those belong to `boundary`, `capture`, `recovery`.
- Any interceptor body: no reconstruction, no reading `chat`, no `abort()`, no marker, no dryRun parity via `CHAT_COMPLETION_PROMPT_READY`. That is the `frontier` brief (`docs/protocol/host-mapping.md#s12-frontier`).
- Any stop-string work (`boundary`, INV-2), any capture, any freeze, any canonical-state schema. `METADATA_KEY`/`SETTINGS_KEY` are declared here but **nothing reads or writes `chatMetadata` or `extensionSettings` in this brief**.
- Settings panel, settings object, defaults, toggles, drawer, wand menu, slash commands, popups, toasts, buttons, `setExtensionPrompt`, `globalThis.UID` diagnostics surface.
- CSS beyond the one root class; no Intercede CSS is copied yet (the aesthetic-only allowance in `docs/decisions/0002-structure-from-intercede.md` is for the `ui` brief).
- A capability *probe* (`probeHostGeneration`), an optional-keys tier, an error taxonomy (`errors.js`), a custom event emitter (`events.js`), a localforage vault, a retry/poll loop, `waitUntil`.
- Failure injection in the fake context (`failSetOnce`, `swallowSetOnce`, storage fakes) — added by the brief that first needs it.
- Wiring the "install reference preset" button that brief 0005 forward-referenced as "brief 0006". That is a different, later brief; this number is the bootstrap.
- Changing `package.json` (`check:comments` already globs `index.js` and `src/**/*.js`), `eslint.config.js`, `vitest.config.js`, or `CLAUDE.md`. No new dependencies.

## Files
- allowed to create/modify: `manifest.json`, `index.js`, `style.css`, `src/host.js`, `src/constants.js`, `tests/helpers/fake-context.js`, `tests/bootstrap.test.js`, `docs/modules/bootstrap.md`, `docs/modules/host.md`, and this brief's Status line
- must not touch: `src/grammar.js`, `src/prompt.js`, `tests/grammar.test.js`, `tests/prompt.test.js`, `tests/preset.test.js`, `presets/`, `tools/`, `package.json`, `eslint.config.js`, `vitest.config.js`, `PLAN.txt`, `CLAUDE.md`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, other `docs/briefs/*`

## ST APIs used
- `SillyTavern.getContext()` — docs/api/sillytavern.md#getcontext (status: verified)
- Context keys present (`chat`, `chatMetadata`, `eventSource`, `eventTypes`/`event_types`, `saveChat`, `saveMetadata`, `saveSettingsDebounced`, `extensionSettings`, `substituteParams`, `stopGeneration`, `name1`) — docs/api/sillytavern.md#context-keys (status: verified)
- Context keys absent (`sendMessageAsUser`, `isGenerating`, `chat_metadata`) — docs/api/sillytavern.md#context-keys-absent (status: absent; used only as a prohibition)
- `manifest.json` honored keys — docs/api/sillytavern.md#manifest (status: verified)
- `generate_interceptor` manifest key and `(chat, contextSize, abort, type)` signature — docs/api/sillytavern.md#generate-interceptor (status: verified)
- APP_READY auto-fires for late subscribers (fallback path only) — docs/api/sillytavern.md#message-lifecycle-events (status: verified)
- Emitter semantics for the fake `eventSource.emit` — docs/api/sillytavern.md#events (status: verified)

## Verification needed
- (empty — nothing is blocked.) Non-blocking follow-up for the `st-api-verifier`: the *timing* fact "`globalThis.SillyTavern.getContext` is already defined when an extension's `index.js` executes" is not yet an entry in `docs/api/sillytavern.md`; the real-install evidence is `Intercede:../Test Probe Extension/index.js:1-5`. This brief proceeds on that evidence and on the documented APP_READY fallback, and does not require the entry to exist first.

## Acceptance
- [x] `manifest.json` parses and its top-level key set is exactly the twelve keys listed above, with the stated values; `manifest.generate_interceptor === INTERCEPTOR_GLOBAL` from `src/constants.js` (assert in the test).
- [x] With a fake context installed, importing `index.js` logs exactly one line equal to `` `${LOG_PREFIX} ready` `` and no error.
- [x] `init()` is idempotent: calling it again after a successful load produces no further log line and leaves the flag `true`.
- [x] With a fake context missing one `REQUIRED_KEYS` entry, `init()` logs an error naming that key, logs no `ready` line, and leaves the module not-ready; a subsequent `init()` with the key restored succeeds.
- [x] With a context whose `name1` is `''`, `init()` succeeds (presence test, not truthiness).
- [x] With a context exposing only the legacy `event_types` alias, `init()` succeeds; with neither alias, it fails loudly and does not become ready.
- [x] After import, `typeof globalThis[INTERCEPTOR_GLOBAL] === 'function'`; calling it with a populated chat array and a spy `abort` leaves the array deep-equal to its prior value (same length, same objects, same field values) and leaves `abort` uncalled, and it resolves to `undefined`.
- [x] `getCtx()` returns a distinct object each call when the fake's `getContext` builds fresh objects, proving no caching.
- [x] Fake-context shape test: every name in `REQUIRED_KEYS` is present on the fake context, and its `eventTypes` has exactly the eleven listed constants — so the harness cannot drift from `#context-keys`.
- [x] Leak test: a test reads `index.js` and every file in `src/` from disk and asserts the identifier `SillyTavern` occurs **zero** times outside `src/host.js` (and, in `src/host.js`, only inside `getCtx`). The test enumerates `src/` dynamically so a future module cannot slip past it.
- [x] `style.css` contains only the one prefixed root class; no unprefixed selector exists.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/bootstrap.md` — header per `docs/modules/README.md` (`Owns: —`, `PLAN: §23`, `Depends on: host, constants`), then one heading per pointer comment written in `index.js`, at least:
  - `#load-time-init` — why init runs at script load with no polling; the Test Probe evidence line; the APP_READY fallback and when it would be adopted.
  - `#capability-gate` — why a missing required key must fail *before* the ready flag is set, and what "presence, not truthiness" protects.
  - `#interceptor-placeholder` — why the manifest key is wired now and the body deliberately empty; which brief fills it (`docs/protocol/host-mapping.md#s12-frontier`).
- `docs/modules/host.md` — header (`PLAN: §23`, `Depends on: —`), then:
  - `#single-door` — `src/host.js` is the only file that may name `SillyTavern`, and the test that enforces it.
  - `#never-cache` — context values are captured by value at call time (`docs/api/sillytavern.md#getcontext`); every call site calls `getCtx()` fresh.
  - `#event-alias` — why `EVENT(ctx)` exists (`eventTypes` vs legacy `event_types`).
  - `#required-keys` — the list, each key traced to the §23 host operation that needs it (`docs/protocol/host-mapping.md#rows`), and why absent keys (`sendMessageAsUser`, `isGenerating`) are never depended on.
