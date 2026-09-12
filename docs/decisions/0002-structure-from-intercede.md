# 0002 — Code structure borrowed from Intercede
Date: 2026-09-12
Brief: (assessment; applied by the boundary/bootstrap briefs that follow)
PLAN: §23

Intercede (`../Intercede`, same author) is a working ST 1.18.0 extension with the same host discipline we mandate. This records what to adopt, adapt, and skip. File:line references are into Intercede.

## Decision

### Adopt (copy the pattern)
- **Single host door.** Only `src/stcontext.js` touches `globalThis.SillyTavern.getContext()`; a grep test enforces it (Intercede: zero leaks outside `stcontext.js` and the readiness poll at `index.js:300`).
- **Capability gate before init.** `checkCapabilities()` (`stcontext.js:204-236`) splits required vs optional context keys; a missing required key fails loudly *before* `initialized = true`, so a retry stays possible.
- **Bootstrap shape.** `waitUntil(() => globalThis.SillyTavern?.getContext?.(), 20000, 250)` → `init()` guarded by an `initialized` flag; jQuery-ready / DOMContentLoaded / immediate triple branch (`index.js:296-313`); CHAT_CHANGED and APP_READY handlers each guarded by `if (eventTypes.X)`.
- **Injectable host.** Host-touching functions take `ctx = getCtx()` as a defaulted parameter (`transaction.js:100,168,183,201`); no DI container.
- **Pure core / impure shell.** Parsing and validation modules import nothing host-side; stateful modules import `stcontext`. Ours: `grammar`, `freeze`, `frontier` pure; `boundary`, `capture`, `recovery` host-touching.
- **Test harness.** `tests/helpers/fake-context.js` installs a fake `globalThis.SillyTavern` and mocks no modules; `vi.resetModules()` + `freshModules()` per test; `createFakeStorage` with `failSetOnce` / `failGetOnce` / `swallowSetOnce`; emitters that reproduce real ST semantics (GENERATION_ENDED carries `chat.length`; STARTED is paired with AFTER_COMMANDS).
- **Packaging.** 11-key manifest, no build step, ES modules from disk, `loading_order: 50`, `minimum_client_version: "1.18.0"`, all CSS classes prefixed. We add `generate_interceptor` (Intercede does not use it; `docs/protocol/host-mapping.md#s12-frontier` requires it).
- **Shared literals in one place** (`constants.js`), error taxonomy in `errors.js`.

### Adapt (copy with named changes)
- `probeHostGeneration` (`stcontext.js:120-161`): drop the `ctx.isGenerating` rung (verified absent, `docs/api/sillytavern.md#context-keys-absent`); likely drop the whole probe, since `recovery` keys off MESSAGE_RECEIVED.
- Optional-capability list: remove `sendMessageAsUser` (absent from context), keep `saveMetadata`, `SlashCommandParser`, `stopGeneration`, `substituteParams`; add `Popup`.
- Per-chat state: `chatMetadata.<ext> = { version: 1, frozen: [], frontier: … }` with span bodies inline (`docs/api/sillytavern.md#chat-metadata`); Intercede's localforage vault (`vault.js`) is a documented later migration, not a day-one dependency.
- `globalThis.<Ext>` public surface: smaller, diagnostics only when a brief asks.
- `events.js` custom-event emitter: same pattern, but only once a consumer exists.

### Skip
- The overlay / inline-mode duality plus `visibility.js` sentinel rendering (~570 lines): it instruments a rendered host message; our frontier is owned plain text.
- `compare.js`, `message-button.js`, wand-menu injection: the protocol has no per-message action.
- The one layering violation, `transaction.js:58 → ui/modal.js`: confirmations are passed in from the UI as callbacks instead.
- Self-probing diagnostics (`index.js:40-56`) until a support burden exists.
- Prose comments: port the *content* of Intercede's `@see RATIONALE#TAG` pointers (Intercede's own rationale file) into our `// slug: … → docs/…#anchor` form.

## Minimum UI (opinion, to be confirmed by the ui brief)
Four surfaces, roughly 450 lines: a frontier editor panel (one textarea over the canonical frontier; serves §9 capture on the own-input path and §10 editing), a seed-entry dialog reusing that textarea (§19), a settings drawer with the import-preset hint, and a toast helper. Reuse Intercede's `ui/modal.js` (76 lines) and `ui/open.js` dispatcher shape. UI imports domain, never the reverse.

## Alternatives rejected
- Forking Intercede wholesale — 1,571 lines of UI and the lease/transaction machinery solve a different problem (surgical mid-message insertion with rollback), and would arrive as untraceable scope.
- Passing a host object through every call (DI) — Intercede's defaulted-parameter form gives the same testability with less ceremony.

## Consequences
- The next brief is the bootstrap + host wrapper (`index.js`, `manifest.json`, `src/stcontext.js`, `tests/helpers/fake-context.js`), adapted per above; `boundary` then builds on it.
- The UI brief starts from the four-surface minimum and must justify each addition against PLAN §9, §10, §19.

## User ruling (2026-09-12)
- **UI:** take only the aesthetic (look of `style.css`: drawer, modal, button treatment). No Intercede UI code or surfaces are inherited; the four-surface minimum above stands as the starting point.
- **Adopt list:** not a mandate. Each item is used only in its most straightforward form and only if the boundary/bootstrap brief needs it; a simpler direct implementation wins where it suffices.
- **Adapt list:** "maybe" — treated as notes on what not to copy blindly, not as work items.
