# bootstrap
Owns: —
PLAN: §23
Depends on: host, constants

`index.js` is the extension entry SillyTavern loads. It wires the `generate_interceptor` global as a no-op, verifies the host context is usable, and logs readiness. It does not subscribe to any event and does not implement any protocol behaviour — those belong to later briefs (`boundary`, `capture`, `recovery`, `frontier`).

## Log prefix {#log-prefix}

`LOG_PREFIX` (`'[UID]'`) is prepended to every console line this extension writes. SillyTavern's console carries output from every installed extension at once, so a fixed, greppable prefix is what lets a developer or user tell this extension's readiness and error lines apart from anyone else's.

## Load-time init {#load-time-init}

`init()` is called once at module top level, synchronously, with no polling and no `waitUntil` loop. The evidence that `globalThis.SillyTavern.getContext` is already defined when an extension's `index.js` executes is a real-install extension by the same author: `Intercede:../Test Probe Extension/index.js:1-5` destructures `SillyTavern.getContext()` at module top level and it works. If that evidence is ever contradicted on a real install, the sanctioned fallback — and the only one this brief allows — is a single `eventSource.on(EVENT(ctx).APP_READY, init)` subscription. APP_READY auto-fires for late subscribers (`docs/api/sillytavern.md#message-lifecycle-events`), so a listener attached after the event already fired still runs. No other retry mechanism (jQuery-ready branch, `DOMContentLoaded`, timed poll) is in scope.

## Capability gate {#capability-gate}

Before `ready` is set to `true`, `init()` requires: the global `SillyTavern` object and its context to exist, every name in `REQUIRED_KEYS` to be present on the context, and `EVENT(ctx)` (the `eventTypes`/`event_types` object) to be defined. "Present" is a presence test (`ctx[name] !== undefined`), not a truthiness test — `name1` is legitimately `''` for a persona-less setup and must not be treated as missing. If any check fails, `init()` logs one `console.error` naming the missing keys and returns without setting `ready`, so a later call to `init()` (e.g. from the APP_READY fallback, or a manual retry) can still succeed once the context is complete. This mirrors Intercede's "capability gate before init" (`docs/decisions/0002-structure-from-intercede.md`), adapted without the optional-keys tier or the probe function, neither of which this brief needs.

## Interceptor placeholder {#interceptor-placeholder}

The manifest's `generate_interceptor` key is wired to `globalThis[INTERCEPTOR_GLOBAL]` here so that later briefs only fill the function body — no packaging or host-door change is needed when `frontier` lands. The body in this brief is a real no-op: it must not read, mutate, reorder, or replace `chat`, and must not call `abort`, so that installing the extension with only this brief applied has zero effect on generation. The body that reconstructs model-visible history from canonical state is `docs/protocol/host-mapping.md#s12-frontier`.

## State materialisation {#state-materialisation}

`index.js` makes sure every open chat has its canonical state object (`docs/modules/state.md#lazy-init`) and does nothing else with it. Two call sites, both at the end of a successful `init()`:

- One `CHAT_CHANGED` subscription (`docs/api/sillytavern.md#message-lifecycle-events`), guarded by `EVENT(ctx).CHAT_CHANGED` being defined, whose handler calls `getState()` with a fresh context and returns. The payload is `getCurrentChatId()` and is used only to return early when it is nullish — that means no chat is open, and materialising state then would write into whatever metadata object happens to be current. The handler captures no `ctx`, because context values are read live at call time (`docs/api/sillytavern.md#context-at-load`). Listener errors are swallowed by the emitter (`docs/api/sillytavern.md#events`), so there is no try/catch and no extra logging.
- One direct call at the end of `init()`, because a chat may already be open when the extension loads and `CHAT_CHANGED` will not fire again for it. It is guarded by `Array.isArray(ctx.chat) && ctx.chat.length > 0`: `chat` is `[]` until a chat loads (`docs/api/sillytavern.md#context-at-load`), and materialising against a not-yet-loaded chat would persist an empty structure into the wrong metadata object.

`index.js` still implements no protocol behaviour. It creates the container; every read and write of what is inside it belongs to `capture`, `frontier`, `freeze` and `recovery`.

## Boundary subscriptions {#boundary-subscriptions}

The second block at the end of a successful `init()` registers exactly five listeners for `src/boundary.js` (`docs/modules/boundary.md`): `GENERATION_STARTED` (records the generation type and clears the per-generation stop flag), `CHAT_COMPLETION_SETTINGS_READY` and `TEXT_COMPLETION_SETTINGS_READY` (install the reserved literal as the first stop string), `STREAM_TOKEN_RECEIVED` (the stop fallback) and `MESSAGE_RECEIVED` (the receipt-side trim).

Each name is looked up on `EVENT(ctx)` (`docs/modules/host.md#event-alias`) and subscribed only when it is present; absent names are collected and reported in a single `console.warn` line prefixed with `LOG_PREFIX`, so a host build that lacks one event degrades to the remaining injection points instead of throwing at load and losing all of them. Listener errors are swallowed by the emitter (`docs/api/sillytavern.md#events`), so no handler is wrapped here.

`index.js` holds wiring only. It contains no type test, no literal computation and no message edit — every decision lives in `src/boundary.js`, and the block is one import line and one loop, so that later briefs can add their own block without touching this one.

## Fake context omission sentinel {#fake-context-omit}

`tests/helpers/fake-context.js`'s `installFakeContext(overrides)` shallow-merges `overrides` into the fake context object. The sentinel for "this key is absent" is the plain JS value `undefined`: any key in `overrides` whose value is `undefined` is `delete`d from the resulting context instead of being assigned, so `installFakeContext({ name1: undefined })` produces a context with no `name1` property at all (not a `name1: undefined` property — `requireKeys`'s presence test treats both the same, but deleting matches "absent" literally). Any other value shallow-overwrites the corresponding default.

## Capture subscription {#capture-subscription}

The third block at the end of a successful `init()` registers exactly one listener: `MESSAGE_SENT` (`docs/api/sillytavern.md#message-sent`) → `captureMessage` from `src/capture.js` (`docs/modules/capture.md#composer-path`). Like the boundary block it is guarded by presence of the name on `EVENT(ctx)` (`docs/modules/host.md#event-alias`), so a host build without that event loads with the rest of the extension intact instead of throwing at subscribe time.

The handler passes only the event payload — the message index — and takes a fresh context by default (`docs/api/sillytavern.md#getcontext`); it captures no `ctx` and assumes nothing else about the payload. Listener errors are swallowed by the emitter (`docs/api/sillytavern.md#events`), so there is no try/catch and no extra logging.

`index.js` still holds wiring only. It contains no message test, no transformation and no save — every decision, including which messages are capture input and how the text becomes a manuscript block, lives in `src/capture.js`. The block is one import line and one guarded `on(...)`, kept separate from the boundary block so neither brief's block has to be edited by the other.
