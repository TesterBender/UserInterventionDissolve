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

## Fake context omission sentinel {#fake-context-omit}

`tests/helpers/fake-context.js`'s `installFakeContext(overrides)` shallow-merges `overrides` into the fake context object. The sentinel for "this key is absent" is the plain JS value `undefined`: any key in `overrides` whose value is `undefined` is `delete`d from the resulting context instead of being assigned, so `installFakeContext({ name1: undefined })` produces a context with no `name1` property at all (not a `name1: undefined` property — `requireKeys`'s presence test treats both the same, but deleting matches "absent" literally). Any other value shallow-overwrites the corresponding default.
