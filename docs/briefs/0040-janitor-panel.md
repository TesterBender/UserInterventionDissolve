# Brief 0040 — Janitor panel: shadow-DOM launcher, status line, Recompile, Export/Import, cross-tab listener
Status: draft
Complexity: high  (it adds the script's first DOM surface and its first cross-tab listener, and it wires a second install call into the build entry)
PLAN sections: §10 (the rebuild is editorial authority and must be collaborator-initiated — this is the only place a human can ask for it), §23 (the host contract includes giving the human a way to see and keep canonical state, which this host otherwise hides in `localStorage`), §27 (the panel is human-facing and sits outside the model's world; nothing it renders may ever enter a request)
Invariants touched: INV-6 (the panel reports an edit to compiled text and offers a rebuild; it never repairs a span), INV-10 (the exported JSON and everything the panel renders stay on the page — no id, hash or offset may reach a request through this surface)

Depends on: **brief 0039** (`requestRecompile`, `getRequestStatus`, `setStatusListener`, `exportStateJson`, `importStateJson`, the drift-notice ledger), which must be merged first, and through it on briefs 0036, 0037 and 0038. This brief adds no logic of its own: every number it shows and every decision it takes was computed in 0039. Together they are phase 6 of `TamperContainment/PLAN-janitor.md#phasing`.

Scope source: `TamperContainment/PLAN-janitor.md` — "Architecture" layer 4 ("status line (reserved literal, finals/units/words, transport tier, router-enabled warning), Recompile, Export/Import state JSON. **No settings.**"), layer 1's shadow-DOM panel host and cross-tab `storage` listener, and realities 1 (proxy mode only), 4 (Janitor truncates history), 8 (persona switch is reported, never repaired), 17 (two tabs race; last writer wins) and 20 (storage is per browser). Layout patterns are read from `TamperContainment/TamperMonkeyJanAI.txt`: the host element and `attachShadow` at L3119–3126 and L3752, the launcher/panel layout at L3652–3750 **with everything editor-related stripped**, and the `storage` listener at L4640–4696. `docs/protocol/host-mapping.md` describes the SillyTavern host and does not apply here.

## Goal
A human running the userscript on janitorai.com sees one small launcher that opens one panel inside a closed-off shadow root. The panel tells them, from the last transformed request: the reserved literal in effect, how many final spans and unsealed units the state holds, how many words the frontier carried, whether the boundary is being enforced by the `stop` parameter or by the stream cut, a warning when the envelope reported `janitor_router_enabled` (in which case the script sees nothing at all), and one notice per edit to compiled text. It offers three actions and no settings: **Recompile**, which flags the chat and says plainly that the rebuild happens on the next message and can only use what Janitor still sends; **Export**, which puts the state JSON in a read-only textarea for the human to copy; and **Import**, which replaces the current chat's state from pasted JSON after a format check. The panel refreshes when a request is transformed and when another tab writes this chat's state, and it says in one line that two tabs on one chat is last-writer-wins. The DOM code is thin by design and carries no logic; the text it renders comes from a pure module that is tested. No framework, no dependency, no jsdom.

## In scope

**`janitor/panel-text.js`** (new; pure, no DOM, no storage — this is where every sentence and number lives):
- `statusLines(status)` → an array of strings built from brief 0039's snapshot (`docs/modules/janitor-adapter.md#status-snapshot`): the reserved literal; `finals`/`units`/frontier words; the transport tier, worded as the boundary being carried by the `stop` parameter or by the stream cut, from `status.stopSent`; the router warning when `status.routerEnabled`, saying the model call is happening on Janitor's servers and the script can neither see nor change it; and one line per entry in `status.driftNotices`. With no snapshot yet (`status.at === 0` or an empty `chatId`) it returns the single "no request seen on this page yet" line.
- `transferResultText(result)` → the sentence for each `importStateJson` outcome, one per `reason` plus the success case.
- `recompileRequestedText()` and the two standing notes (`staticNotes()`): that a recompile takes effect on the next message and rebuilds only from what Janitor still sends, and that two tabs on one chat overwrite each other last-writer-wins.
- Human-facing text is free (`PLAN-addendum-*` §13 — it is neither model-facing nor pinned): write it plainly, avoid protocol jargon the human has no way to check, and do not restate mechanics the human cannot act on. Nothing in this file is a pinned string, and tests must assert on the facts present (a count, an id, the word `stop`), never on whole sentences.

**`janitor/panel.js`** (new; the only file in the script that touches the DOM):
- `installPanel()` — idempotent, returns early when its host element already exists. Creates one `div` with the id `uid-manuscript-panel-host` (a module-level constant in this file; it has one consumer and does not belong in `janitor/constants.js`), appends it to `document.documentElement`, and calls `attachShadow({ mode: 'open' })` (L3119–3126, L3752). No wait-for-body, no `MutationObserver`, no retry: the host hangs off the document element, which exists at `document-start`.
- One `<style>` in the shadow root, `:host { all: initial }` plus a handful of rules — fixed position, a border, spacing, a monospace status block. No theme variables, no animation, no media queries, no responsive layout, no drag, no resize.
- A launcher button that toggles one panel element between shown and hidden. The open/closed state is not persisted anywhere.
- **Status area**: re-rendered from `statusLines(getRequestStatus())`. Registered through `setStatusListener` so a transformed request refreshes it live; also re-read when the panel is opened.
- **Recompile button**: calls `requestRecompile(status.chatId)` and renders `recompileRequestedText()`. Disabled with an explanation when there is no snapshot yet, since without a chat id there is nothing to flag.
- **Export**: a read-only `<textarea>` filled with `exportStateJson(chatId, loadJanitorState(chatId))`, selected on focus so a copy is one keystroke. **Decision: a textarea, not a download.** `<a download>` with a `Blob`/object URL is the fragile path under Tampermonkey — the script runs in a sandboxed context, the page's CSP can refuse the URL scheme, and a silently-blocked download loses the human's only backup with no error. `navigator.clipboard` is refused for the same class of reason (permission prompts, non-secure-context failures, and a "copied" claim that may be false). A textarea is visible proof the data exists.
- **Import**: a writable `<textarea>` plus a button that calls `importStateJson(text)` and, on `ok`, `saveJanitorState(status.chatId, result.state)` followed by a re-render; on failure it renders `transferResultText(result)` and writes nothing. It shows the exported chat id from the file when it differs from the current one, as information, and imports anyway.
- **Cross-tab listener**: `window.addEventListener('storage', …)` inside `installPanel`, filtering on `event.key?.startsWith(STORAGE_KEY_PREFIX)` and on the current chat's key (L4640–4696). It re-renders the panel and nothing else — no state is reloaded into any in-flight computation, because `janitor/transform.js` already reloads state from storage on every request (`docs/modules/janitor-adapter.md#request-pipeline`, step 2), which is the plan's "reload state before every derivation" requirement and is **already satisfied since brief 0033**. There is no lock, no leader election and no conflict resolution: two tabs on one chat is last-writer-wins, and the panel says so.
- The panel reads state through `loadJanitorState` only, and writes only through `saveJanitorState` on an import. It never calls the transform, never touches a request, never mutates a state object in place.

**`janitor/main.js`** — one added named import and one added call, `installPanel()`, after `installTransport(transformRequest)`. No side-effect import (the bundler refuses one, `docs/modules/janitor-build.md#supported-module-syntax`).

**Tests — `tests/janitor/panel-text.test.js`** (pure only):
- every snapshot field appears in the lines: a snapshot with `stopSent: true` says the `stop` parameter carries the boundary and one with `stopSent: false` says the stream cut does; the literal, the finals and units counts and the frontier word count each appear; `routerEnabled` adds the warning and its absence does not;
- one line per drift notice, and none when there are none;
- the empty snapshot yields exactly the one "nothing seen yet" line;
- every `importStateJson` reason maps to a distinct non-empty sentence, and so does success;
- the standing notes name both the next-message rule and last-writer-wins.

**Deliberately untested: `janitor/panel.js`.** It is DOM plumbing with no branching logic worth pinning — create, append, toggle, set `textContent`, add listener — and the alternative is a jsdom dependency this brief is forbidden to add, or a hand-rolled fake DOM that would test the fake. The rule that keeps this honest is the one this brief imposes: **every string, number, decision and refusal lives in `panel-text.js` or in brief 0039's modules; `panel.js` may contain no conditional other than element presence and the storage-key filter.** An implementer who finds themselves wanting a test for `panel.js` has put logic in the wrong file.

**`dist/janitor-manuscript-dissolve.user.js`** — regenerated with `npm run build:janitor` and committed. Never hand-edited. New top-level names must not collide with an existing module's, and the build fails loudly if they do.

### Decisions this brief takes (do not re-open during implementation)
- **Export is a textarea.** Reasons above. No `Blob`, no object URL, no `<a download>`, no clipboard API anywhere in the script.
- **No stop-button observer.** The task that commissioned this brief assumed one already existed from brief 0028; it does not — brief 0028 excluded "the stop-button observer, any UI at all" explicitly, and nothing under `janitor/` observes the DOM today. It is not added here: its only purpose in the plan is to refresh the panel, the panel already refreshes on `setStatusListener` (every transformed request) and on the `storage` event, and the optimizer's own implementation depends on hashed Janitor selectors that churn with every build and may never render for a short output (L370–373). Adding a fragile selector watcher for a refresh that already happens is bloat. If a capture later shows a refresh gap this is a new task, not a licence to add it in passing.
- **The panel is read-mostly.** Its only write is the import. It does not edit the manuscript, does not delete spans, does not repair drift, and does not expose the compiled text for editing — a context editor is what layer 1 was stripped of.
- **No settings, no toggles, no persisted UI state.** PLAN names nothing here as host-selectable; the sentinel and the horizon stay constants.

## Out of scope (explicit)
- The stop-button observer, any `MutationObserver`, any Janitor selector, any reading of Janitor's own DOM, and any attempt to render inside Janitor's chat.
- A prompt or context editor, a span viewer, a span editor, a per-message inspector, a log pane, a copy of the `console.info` stream, or anything that displays compiled manuscript text beyond what the export textarea contains.
- Settings of any kind: horizon budget, cut target, sentinel, literal override, "disable the script", a per-chat enable flag, a verbosity level, a theme.
- Solo mode, take-stock, starter restructure, preset install, slash commands — dropped for v1 by `TamperContainment/PLAN-janitor.md#deviations-from-the-st-implementation`.
- Any locking, leasing, leader election, merge or conflict UI for two tabs; any polling of `localStorage`.
- Any change to `janitor/transform.js`, `janitor/status.js`, `janitor/recompile.js`, `janitor/portable.js` or `janitor/storage.js` — if the panel needs something they do not expose, that is a `SCOPE_GAP` against brief 0039, not an edit here.
- Any `src/` change; any response-side change; any new state field or format bump.
- A dependency of any kind, and **jsdom in particular**, including as a devDependency, a vitest `environment` setting or a per-file `@vitest-environment` pragma.
- Editing `docs/api/janitor.md`, `docs/decisions/0007-janitor-host-deviations.md`, `docs/modules/janitor-adapter.md`, `PLAN.txt`, `TamperContainment/**` or `docs/protocol/**`.

## Files
- allowed to create: `janitor/panel.js`, `janitor/panel-text.js`, `tests/janitor/panel-text.test.js`, `docs/modules/janitor-panel.md`
- allowed to modify: `janitor/main.js` (the import and the one call), `docs/README.md` (the `modules/` row, to name the new file), `dist/janitor-manuscript-dissolve.user.js` (regenerated)
- must not touch: `src/**`, `janitor/transform.js`, `janitor/status.js`, `janitor/recompile.js`, `janitor/portable.js`, `janitor/storage.js`, `janitor/shell.js`, `janitor/sse.js`, `janitor/stop-routes.js`, `janitor/rollback.js`, `janitor/identity.js`, `janitor/history.js`, `janitor/envelope.js`, `janitor/shape.js`, `janitor/xhr-warning.js`, `janitor/constants.js`, `tools/**`, `package.json`, `eslint.config.js` (unless a browser global the lint genuinely lacks is needed — then one `globals` line, nothing else), `index.js`, `manifest.json`, `presets/**`, `style.css`, `tests/*.test.js`, `tests/janitor/**` except the one new file, `docs/modules/janitor-adapter.md`, `docs/modules/janitor-transport.md`, `docs/api/janitor.md`, `docs/decisions/**`, `PLAN.txt`, `TamperContainment/**`, `docs/protocol/**`

## ST APIs used
- none. This host is janitorai.com; `globalThis.SillyTavern` must not be referenced in `janitor/` or `tests/janitor/`. No `src/` import is expected in either new file; `panel.js` imports only from `janitor/`.

## Verification needed
- (empty) No SillyTavern API is involved, and no new Janitor fact is needed: the panel renders facts other briefs already captured or computed. The open ledger item behind the router warning (proxy-mode-only, plan reality 1) is exactly what the warning exists to make visible to the human, so it blocks nothing. Do not launch `st-api-verifier`; it verifies SillyTavern only.

## Acceptance
- [ ] `statusLines` renders the literal, finals, units and frontier words from a snapshot; says `stop` when `stopSent` is true and the stream cut when it is false; adds the router warning only when `routerEnabled`; renders one line per drift notice; and returns the single "nothing seen yet" line for an empty snapshot.
- [ ] Each `importStateJson` reason and the success case map to a distinct non-empty sentence; the standing notes state both the next-message rule and last-writer-wins.
- [ ] `janitor/panel.js` contains no string literal that is shown to a human other than element names, ids, CSS and the constant host id — every rendered sentence comes from `panel-text.js`.
- [ ] `janitor/panel.js` contains no conditional other than element presence and the storage-key filter; no `src/` import; no `SillyTavern`.
- [ ] `installPanel()` called twice creates exactly one host element; the host is a shadow root and the script adds no style rule outside it.
- [ ] The `storage` listener re-renders only for keys under `STORAGE_KEY_PREFIX` matching the current chat, and performs no state write.
- [ ] No test imports `janitor/panel.js`; `package.json` is byte-identical and no test file names jsdom or sets a DOM environment.
- [ ] `npm run build:janitor` regenerates `dist/janitor-manuscript-dissolve.user.js`, the committed file matches a fresh build, and it parses via `new Function`.
- [ ] `npm run check` passes
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/janitor-panel.md` (new) — header block in the house form (`Owns:` nothing; `PLAN:` §10, §23, §27; `Depends on:` `janitor/status.js`, `janitor/recompile.js`, `janitor/portable.js`, `janitor/storage.js`), then:
  - `## What the panel is {#what-it-is}` — one shadow-rooted launcher and panel, human-facing only, holding no state and taking no decision; why the shadow root (isolation from Janitor's CSS and vice versa, L3119–3126) and why it is appended to the document element rather than waiting for the body.
  - `## Status line {#status-line}` — each field, where it comes from (`docs/modules/janitor-adapter.md#status-snapshot`), and what a human should do about it: the literal (and that a persona switch changes it and is reported, never repaired — plan reality 8); finals/units/frontier words; the transport tier and what "the stream cut is carrying the boundary" means for them (`docs/modules/janitor-transport.md#stop-rejection-learning`); the router warning and the proxy-mode-only reality behind it; and the edit-to-compiled-text notice as this host's replacement for the SillyTavern toast (`docs/modules/freeze.md#frozen-edit-notice`), shown once per occurrence, reporting only.
  - `## Recompile {#recompile-button}` — that it flags and does not run, that the rebuild happens on the next message, and that it can only rebuild from what Janitor still sends; link `docs/modules/janitor-adapter.md#recompile` for the rule rather than restating it.
  - `## Export and import {#transfer}` — the textarea decision and the three reasons `<a download>` and the clipboard API were refused; that import replaces the current chat's state and never merges; that a state exported from another chat may be imported and why that is the point; and the blunt statement that this file is the only backup of the manuscript (plan realities 4 and 20).
  - `## Cross-tab behaviour {#cross-tab}` — the `storage` listener's filter and that it only re-renders; that state is reloaded from storage before every derivation already (brief 0033) and that this is what makes two tabs *safe enough*; and that two tabs on one chat is last-writer-wins with no lock, stated as a limit the panel tells the human rather than a bug.
  - `## Why the DOM is untested {#untested-dom}` — the split between `panel-text.js` (pure, tested) and `panel.js` (plumbing), the rule that keeps logic out of `panel.js`, and that adding jsdom to test element creation is refused.
  - `## No settings {#no-settings}` — one paragraph: PLAN names nothing here as host-selectable, the sentinel and horizon are constants, and the panel's action list is closed.
- `docs/README.md` — extend the `modules/` row to name `janitor-panel.md` as the panel surface, in the same sentence style as the existing `janitor-transport.md` / `janitor-adapter.md` / `janitor-build.md` mentions. No other change.
