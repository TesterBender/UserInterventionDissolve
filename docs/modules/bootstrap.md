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

## Interceptor {#interceptor-placeholder}

The manifest's `generate_interceptor` key is wired to `globalThis[INTERCEPTOR_GLOBAL]` here, in the entry file, so that the packaging contract (`docs/api/sillytavern.md#manifest`) and the host door stay in one place. The global's whole body is a single delegating call to `interceptGeneration` from `src/frontier.js` (`docs/modules/frontier.md#interceptor-body`): `index.js` holds no reconstruction logic, no generation-type test, no state read and no array mutation, and the global keeps the name and arity ST calls it with.

The interceptor deliberately does not depend on `ready`. The capability gate protects the subscriptions and the state materialisation `init()` performs; the interceptor takes a fresh context of its own on every call and reads only what it needs, so on a host that passed the gate but has no canonical state the request array is left alone (on a host where `getContext` is absent the call rejects, which is the same outcome as a failed gate: no reconstruction) (`docs/modules/frontier.md#empty-state`).

## State materialisation {#state-materialisation}

`index.js` makes sure every open chat has its canonical state object, and that a v1 structure is migrated when the chat opens rather than mid-request (`docs/modules/state.md#lazy-init`, `docs/modules/state.md#migration-v1`). It does nothing else with it. Two call sites, both at the end of a successful `init()`:

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

Capture adds one name to the same guarded subscription loop the boundary block already runs (see [Boundary subscriptions](#boundary-subscriptions)): `MESSAGE_SENT` (`docs/api/sillytavern.md#message-sent`) → `captureMessage` from `src/capture.js` (`docs/modules/capture.md#composer-path`). It is not a separate block, so an absent `MESSAGE_SENT` degrades exactly like an absent boundary event — the name is collected and reported in the one `console.warn` line, and the remaining listeners still register.

The handler passes only the event payload — the message index — and lets `captureMessage` take a fresh context by default (`docs/api/sillytavern.md#getcontext`); it captures no `ctx` and assumes nothing else about the payload. Listener errors are swallowed by the emitter (`docs/api/sillytavern.md#events`), so there is no try/catch and no extra logging.

`index.js` still holds wiring only. It contains no message test, no transformation and no save — every decision, including which messages are capture input and how the text becomes a manuscript block, lives in `src/capture.js`. Capture's whole cost in the entry file is one import line and one entry in the handler map.

## Settings drawer wiring {#settings-drawer-wiring}

`init()` calls `renderSettings(ctx)` once, as its last statement, after the capability gate has passed and `ready` is set. The call is unconditional and unguarded: the context is known complete by then (`docs/api/sillytavern.md#context-at-load`), and `renderSettings` itself handles both the absent-container case and a repeat call (`docs/modules/ui-settings.md#container`). Its return value is discarded — nothing in `index.js` holds a reference to the drawer.

The status line is refreshed by one added statement, not by a new subscription: the existing `CHAT_CHANGED` handler (see [State materialisation](#state-materialisation)) calls `refreshReservedLiteral(getCtx())` as its **first** statement, ahead of the nullish-`chatId` early return. The order matters. The persona can change together with the chat, and closing a chat (payload `null`) is exactly the case where the displayed literal is most likely to be stale; state materialisation must still skip that case, but the status line must stay honest when no chat is open. Refreshing is a `textContent` write against an element that may not exist, so it costs nothing when the drawer was never rendered (`docs/modules/ui-settings.md#status-line`).

`index.js` holds no drawer logic: one import, one render call, one refresh call. What the drawer contains, where it attaches, what the button does and how failures are reported all live in `src/ui/settings.js`.
## Recovery subscription {#recovery-subscription}

Recovery does not get its own subscription. `src/recovery.js`'s MESSAGE_RECEIVED handler **must** run after `boundary`'s for the same event — it reads text `boundary` has trimmed and a marker `boundary` has written (`docs/modules/recovery.md#ordering`) — so the two are composed into the single `MESSAGE_RECEIVED` entry of the guarded handler map:

```js
MESSAGE_RECEIVED: async (...args) => {
  await onMessageReceived(...args);
  await onRecoveryMessageReceived(...args);
},
```

Composition rather than a second `eventSource.on` call for the same event is not just tidier — it behaves differently, and the difference is the point. The emitter awaits listeners sequentially in registration order but **isolates their errors**: a listener that throws is caught and logged, and the next listener runs anyway (`docs/api/sillytavern.md#events`). Two subscriptions would therefore still run recovery after `boundary` threw — appending text that had not been trimmed at the reserved literal, on the one path where the trim is known to have failed. In the composed handler the second `await` is downstream of the first, so a throw in `boundary` propagates out of the composed handler into the emitter's catch and recovery never runs. That is the intended **fail-closed** behaviour: if the trim step fails, nothing is appended to canonical state, and the generation is simply lost rather than merged untrimmed.

Composition also makes the ordering local. As two subscriptions it would be an invisible property of two distant lines in `init()` that any later reordering of the map or of the blocks could silently break; inside one entry the dependency is one `await` in front of another. And it keeps the absent-event guard honest: if the host build lacks `MESSAGE_RECEIVED`, both handlers are skipped together and the name is reported once in the existing `console.warn`.

The handler passes on only the event payload — `(index, type)` — and lets `onMessageReceived` take a fresh context by default (`docs/api/sillytavern.md#getcontext`); it captures no `ctx`. There is no try/catch: the emitter's own catch is what handles a throw, and adding one here would defeat the fail-closed chain above.

`index.js` still holds wiring only. It contains no outcome classification, no rollback, no append and no save — every decision lives in `src/recovery.js`. Recovery's whole cost in the entry file is one import line and one map entry.

## No edit, swipe or delete subscriptions {#no-edit-subscriptions}

`MESSAGE_SWIPED`, `MESSAGE_EDITED` and `MESSAGE_DELETED` are not subscribed to at all. Every one of them changes `chat[]`, and `chat[]` is read fresh by the derivation on the next request (`docs/modules/derive.md#derivation-rule`), so an edit takes effect with no listener, no handler and nothing saved — the events carry no information the next request does not already have. Emitting any of them changes nothing in this extension.

`MESSAGE_SWIPED` is unrelated to `recovery`'s swipe handling, which classifies a *model resample* arriving on MESSAGE_RECEIVED with `type` `'swipe'`/`'regenerate'` (`docs/modules/recovery.md#swipes`) — a different event on a different path.

## Slash commands {#slash-commands}

`init()` registers exactly one slash command, `/uidsolo`, after the event wiring and before `renderSettings(ctx)`:

```js
const { SlashCommandParser, SlashCommand } = ctx;
SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'uidsolo', callback, helpString, returns }));
```

Both classes are read off `getContext()`, never imported from ST's own modules (`docs/api/sillytavern.md#slash-command-registration`). The command takes no arguments and has no alias, so `aliases`, `namedArgumentList` and `unnamedArgumentList` are omitted; every field is simply assigned onto the instance and never schema-checked. No duplicate-name defence is written: re-registering a name only `console.trace`-warns and overwrites, it never throws, and `init()` is already idempotent through the `ready` flag.

The callback arms a one-shot solo continuation (`docs/modules/frontier.md#solo-variant`) and then calls `await ctx.generate('normal')` — the real `Generate`, which runs the same pipeline as pressing Send on an empty composer: no user message is pushed and the reply continues from the existing history (`docs/api/sillytavern.md#generate-normal-from-slash`). Pushing a message instead would put a visible user turn into the live chat, which is exactly the transport evidence the protocol removes. The resolved value is ignored and not inspected: `Generate` resolves to the reply text on a completed run but to `undefined` when it is blocked early, so nothing may be inferred from it. The callback returns `''` because a slash-command callback's return value is what the parser substitutes into the command's output.

If `ctx.generate` throws or rejects, the callback consumes and discards the flag, logs one error and still returns `''` — a failed start must never leave a solo armed for whatever the collaborator does next.

Registration is guarded like the event wiring, not gated like a required key: if `ctx.SlashCommandParser`, `ctx.SlashCommand` or `ctx.generate` is absent, `init()` logs one `console.warn` and skips registration. Their absence costs the collaborator one convenience command; it does not stop the extension from reconstructing history, so they are deliberately not in `REQUIRED_KEYS` (see [Capability gate](#capability-gate)). There is no retry and no throw.

The command is discoverable through ST's own slash-command autocomplete, which `helpString` feeds; the settings drawer says nothing about it.
