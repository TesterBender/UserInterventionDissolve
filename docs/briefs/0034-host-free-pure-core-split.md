# Brief 0034 — Split host-bound wrappers out of the lifted src/ modules
Status: draft
Complexity: high  (touches `src/frontier.js`, `src/state.js`, `src/boundary.js`, `src/freeze.js` and `index.js`; the INV-4/INV-5 reconstruction tests must survive byte-identical)
PLAN sections: §12 (immediate frontier normalization — `buildHistory`/`applyToRequestChat`/`shouldReconstruct` are the reconstruction and must stay exactly what they are; only the SillyTavern *call site* moves), §23 (what a host must provide — the protocol is host-independent, so the code that expresses the protocol must be importable without a host)
Invariants touched: INV-4, INV-5 (the reconstruction is the moved-around code's neighbour; nothing in it may change), INV-6 (`compileUnit` and `sealUnits` keep their current bodies and callers), INV-2 (`reservedLiteral`, `applyStopStrings`, `findBoundary`, `trimAtBoundary` stay in `src/boundary.js` unchanged)

Blocks: **brief 0032** (Status: partial, on `worktree-agent-a1e1a2b82f055c2c0`) and **brief 0033**. Both import pure functions from `src/` and are currently refused by `tests/janitor/isolation.test.js`. After this brief, 0032 should need no change other than its isolation test passing; 0033's import list becomes true as written.

Scope source: the `SCOPE_GAP` section of `docs/briefs/0032-janitor-identity-storage-shim.md` (that branch), `TamperContainment/PLAN-janitor.md` "Layout and build" (`janitor/` imports the pure modules from `src/` directly, so lifted-verbatim stays true), `docs/decisions/0002-structure-from-intercede.md` ("Pure core / impure shell", "Single host door").

## Goal
Every `src/` module that the Janitor bundle imports — `constants.js`, `prompt.js`, `grammar.js`, `derive.js`, `state.js`, `freeze.js`, `frontier.js`, `boundary.js` — imports `src/host.js` nowhere, directly or transitively, so a bundle built from them contains no reference to `globalThis.SillyTavern`. This is achieved by moving the host-bound functions verbatim into four sibling host modules, with **zero behaviour change** for the SillyTavern extension: no function body is edited, no export is renamed, every pure export keeps its current module and name, and the only edits to existing files outside the moves are import lines.

## Chosen shape, and why
Four sibling modules, one per split module — `src/state-host.js`, `src/frontier-host.js`, `src/boundary-host.js`, `src/freeze-host.js` — rather than one aggregate `src/host-bindings.js`. Reasons, to be recorded in `docs/modules/host.md#host-shell`:
1. `src/boundary.js`'s host half owns module-local mutable generation state (`currentType`, `currentDryRun`, `stoppedThisGeneration`, `suspendDepth`); in an aggregate that per-generation state would sit in the same file as state persistence and the interceptor, which are unrelated lifetimes.
2. `tools/build-janitor.mjs` fails a build on a duplicate top-level name across the bundled graph (`docs/modules/janitor-build.md#supported-module-syntax`). One aggregate concentrates every private helper name in a single basin; siblings keep each file's name set as small as it is today.
3. The pairing `x.js` / `x-host.js` makes the seam visible at every import site: an importer that names `-host` is admitting it needs SillyTavern.

Each `-host.js` file imports exactly `./host.js`, its own pure sibling, and whatever pure modules the moved bodies already imported. Nothing imports a `-host.js` module except `index.js`, `src/starter.js`, `src/recovery.js`, `src/recompile.js` and the existing tests.

## In scope

**`src/state-host.js`** (new) — `getState(ctx = getCtx())` and `save(ctx = getCtx())` moved from `src/state.js` **verbatim**, with their pointer comments (`// lazy-init: …`, `// v2-upgrade: …`, `// save-metadata-only: …`) and the `warned` WeakSet / `warnOnce` helper that only `getState` uses. `src/state.js` afterwards imports `./constants.js` and `./grammar.js` only, and exports `createState`, `canPushSpan`, `pushFrozen`, `pushUnit`, `sealUnits`, `advanceWatermark`.

**`src/frontier-host.js`** (new) — `interceptGeneration` moved from `src/frontier.js` verbatim, importing `getCtx`, `getState` (from `./state-host.js`), `deriveFrontier`, `reservedLiteral`, `consumeSoloFlag`/`resolveSoloControl`, and `buildHistory`/`applyToRequestChat`/`regeneratesLastMessage`/`shouldReconstruct` from `./frontier.js`. `src/frontier.js` afterwards imports `./constants.js` and `./prompt.js` only, and keeps `buildHistory`, `applyToRequestChat`, `regeneratesLastMessage`, `shouldReconstruct` and the private `reconstructed` helper unchanged, byte for byte.

**`src/boundary-host.js`** (new) — moved verbatim from `src/boundary.js`: `SKIPPED_TYPES`, `SKIPPED_RECEIPT_TYPES`, the four module-local `let`s, `resetBoundaryState`, `suspendBoundary`, `onGenerationStarted`, `onChatCompletionSettings`, `onTextCompletionSettings`, `onStreamToken`, `onMessageReceived`. `src/boundary.js` afterwards imports `./constants.js` and `./grammar.js` only, and keeps `STOP_FIELDS`, `reservedLiteral`, `applyStopStrings`, `findBoundary`, `trimAtBoundary`. (`METADATA_KEY` is used by the moved receipt handler; whether `src/boundary.js` still needs the import is decided by what remains, not by keeping the line.)

**`src/freeze-host.js`** (new) — `FROZEN_EDIT_NOTICE` and `noticeFrozenEdit` moved from `src/freeze.js` verbatim. `src/freeze.js` afterwards imports no `getCtx` and no `getState`; its `./state.js` import narrows to the names `compileUnit` actually uses (`canPushSpan`, `pushUnit`, `sealUnits`, `advanceWatermark`). `selectCut`, `compileUnit`, `countWords` and every private helper are untouched.

**Import-line-only edits** (no other change to these files, and no body edits):
- `index.js` — `getState` from `./src/state-host.js`; the five boundary handlers from `./src/boundary-host.js`; `interceptGeneration` from `./src/frontier-host.js`; `noticeFrozenEdit` from `./src/freeze-host.js`.
- `src/recovery.js` — `getState`, `save` from `./state-host.js`; `reservedLiteral`/`findBoundary`/`trimAtBoundary` stay on `./boundary.js`.
- `src/recompile.js` — `save` from `./state-host.js`; `createState` stays on `./state.js`.
- `src/starter.js` — `suspendBoundary` from `./boundary-host.js`; `reservedLiteral` stays on `./boundary.js`.
- `src/ui/settings.js` — only if a moved name is imported there; otherwise untouched.

**Existing tests** — import specifiers only. The test *files stay where they are*; no test is renamed, no new extension test file is created, no assertion is rewritten, except one:
- `tests/state.test.js:207` asserts the exact export surface of `src/state.js`. Remove `getState` and `save` from that list and add a sibling assertion that `src/state-host.js` exports exactly `getState` and `save`. This is the only assertion change permitted in this brief; name it in the implementation report.
- `tests/frontier.test.js`, `tests/freeze.test.js`, `tests/boundary.test.js`, `tests/recovery.test.js`, `tests/starter.test.js`, `tests/bootstrap.test.js`, `tests/ui-settings.test.js`, `tests/recompile.test.js`: split the affected `import { … } from '../src/x.js'` lines into a pure line and a `-host` line. Every `it(…)` body, fixture and expectation stays byte-identical.

**`tests/janitor/isolation.test.js`** — replace the blanket `src/` import ban with the rule the plan wants:
- Keep, unchanged, the per-file assertion that no file under `janitor/`, `tests/janitor/` or `tests/janitor/fixtures/` contains the string `SillyTavern` (assembled as today, so the test file itself does not contain it).
- Delete `CORE_IMPORT`. Add a transitive walk: starting from every `.js` file under `janitor/` and `tests/janitor/` (including `fixtures/`, excluding `fixtures/build/**`, which are synthetic bundler inputs), resolve every **relative** import specifier (`./`, `../`) to a path, recurse, and assert that (a) `src/host.js` is never reached and (b) no reached file contains `SillyTavern`. Bare specifiers (`vitest`, `node:*`) are skipped. Use the same import forms `tools/build-janitor.mjs` accepts; a specifier the walker cannot resolve fails the test rather than being ignored.
- Add `tests/janitor/fixtures/lifted-entry.js` (new): a bundler-shaped entry that imports and references exactly the names briefs 0032 and 0033 import from `src/` — `MANUSCRIPT_SYSTEM_PROMPT`, `CONTINUATION_CONTROL` (`src/prompt.js`); `METADATA_KEY`, `STATE_VERSION`, `BLOCK_DELIMITER`, `LOG_PREFIX` (`src/constants.js`); `deriveFrontier` (`src/derive.js`); `createState` (`src/state.js`); `compileUnit`, `countWords` (`src/freeze.js`); `buildHistory` (`src/frontier.js`); `applyStopStrings` (`src/boundary.js`). It exists so the entry-driven bundler has something to prove the property against before `janitor/main.js` imports anything; `src/recovery.js` and `src/recompile.js` are deliberately absent (0033 bans the first, and neither is on the Janitor path).
- Add two bundler-level assertions here (not in `tests/janitor/build.test.js`, which is not touched): `buildJanitorBundle(<lifted-entry>)` succeeds and its output contains no `SillyTavern`; and the committed `dist/janitor-manuscript-dissolve.user.js` contains no `SillyTavern`.

## Out of scope (explicit)
- **Any body edit.** Not a renamed parameter, not a dropped `= getCtx()` default, not a reordered statement, not a "while we're here" simplification of `interceptGeneration` or `getState`. A moved function's diff must be a pure relocation.
- Splitting `src/recovery.js` (`classifyOutcome` vs `onMessageReceived`) or `src/recompile.js` (`formatRecompileSummary` vs `recompile`). Neither is on brief 0032/0033's import path and 0033 bans importing `recovery`. The response-side Janitor brief files its own split, and it — not this brief — owns the `SKIPPED_RECEIPT_TYPES` name collision between `src/recovery.js` and `src/boundary-host.js`.
- Splitting `src/starter.js` or `src/ui/settings.js`; both are host-side in whole.
- Changing `tools/build-janitor.mjs` in any way, including its roots list (it already admits `src/`), and wiring `build:janitor` into `npm run check`.
- Rebuilding or editing `dist/janitor-manuscript-dissolve.user.js`. It is only read.
- Any change to `janitor/**` — `main.js` keeps `installTransport(() => false)`.
- Any change to `src/host.js`, `src/grammar.js`, `src/derive.js`, `src/prompt.js`, `src/constants.js`, `src/solo.js`, `src/preset-template.js`.
- A barrel/re-export module that re-exports the moved names from their old paths "for compatibility", a `src/pure/` or `src/host/` directory reshuffle, an `index` of the pure core, a lint rule enforcing the seam, or any dependency-injection container.
- New settings, toggles, constants or model-facing strings. No new dependency.
- `presets/**` and `manifest.json` are untouched.

## Files
- allowed to create: `src/state-host.js`, `src/frontier-host.js`, `src/boundary-host.js`, `src/freeze-host.js`, `tests/janitor/fixtures/lifted-entry.js`
- allowed to modify: `src/state.js`, `src/frontier.js`, `src/boundary.js`, `src/freeze.js` (removals and import lines only), `index.js`, `src/recovery.js`, `src/recompile.js`, `src/starter.js`, `src/ui/settings.js` (import lines only), `tests/state.test.js` (import lines plus the one export-surface assertion), `tests/frontier.test.js`, `tests/freeze.test.js`, `tests/boundary.test.js`, `tests/recovery.test.js`, `tests/starter.test.js`, `tests/bootstrap.test.js`, `tests/ui-settings.test.js`, `tests/recompile.test.js` (import lines only), `tests/janitor/isolation.test.js`, `docs/modules/host.md`, `docs/modules/state.md`, `docs/modules/frontier.md`, `docs/modules/boundary.md`, `docs/modules/freeze.md`
- must not touch: `src/host.js`, `src/grammar.js`, `src/derive.js`, `src/prompt.js`, `src/constants.js`, `src/solo.js`, `src/preset-template.js`, `janitor/**`, `dist/**`, `tools/**`, `tests/janitor/build.test.js`, `tests/janitor/shell.test.js`, `tests/janitor/envelope.test.js`, `tests/janitor/shape.test.js`, `tests/janitor/xhr-warning.test.js`, `tests/helpers/fake-context.js`, `package.json`, `eslint.config.js`, `manifest.json`, `presets/**`, `PLAN.txt`, `TamperContainment/**`, `docs/protocol/**`, `docs/briefs/**`

## ST APIs used
- `getContext()` single door — `docs/api/sillytavern.md#getcontext` (status: verified) — unchanged; only the modules that call it move.
- `chatMetadata` — `docs/api/sillytavern.md#chat-metadata` (status: verified) — read by the moved `getState`, unchanged.
- `saveMetadata` — `docs/api/sillytavern.md#chat-metadata` (status: verified) — called by the moved `save`, unchanged.
- `generate_interceptor` — `docs/api/sillytavern.md#generate-interceptor` (status: verified) — the moved `interceptGeneration` is its body, unchanged.
- stop-string settings events, `stopGeneration`, `updateMessageBlock`, `saveChat` — `docs/api/sillytavern.md#stop-chat-completion`, `#stop-text-completion`, `#stopgeneration`, `#message-shape` (status: verified) — used by the moved boundary handlers, unchanged.

No new API is introduced; if the implementer finds an anchor above that does not resolve, that is a doc-link fix in `docs/api/sillytavern.md`'s citing line only, reported as a `SCOPE_GAP`, not a verification run.

## Verification needed
- (empty) No new SillyTavern API is used. Every call site listed above already exists in the repository and only changes file.

## Acceptance
- [ ] `git diff` for every moved function shows relocation only: the moved text in the new file is byte-identical to the removed text in the old file, pointer comments included.
- [ ] `src/state.js`, `src/frontier.js`, `src/boundary.js`, `src/freeze.js`, `src/derive.js`, `src/grammar.js`, `src/prompt.js`, `src/constants.js` contain no `host.js` import, and a transitive walk from each of them reaches neither `src/host.js` nor the string `SillyTavern`.
- [ ] `buildJanitorBundle(tests/janitor/fixtures/lifted-entry.js)` succeeds (no duplicate top-level name, no cycle) and its output contains no `SillyTavern`; the committed `dist/janitor-manuscript-dissolve.user.js` contains no `SillyTavern`.
- [ ] The isolation walk fails loudly on a deliberately introduced `src/host.js` import (assert the negative case with a temporary in-test fixture path, not by editing a real file).
- [ ] `tests/frontier.test.js`, `tests/freeze.test.js`, `tests/boundary.test.js`, `tests/recovery.test.js`, `tests/state.test.js` differ from their previous versions in import lines only, except the single `src/state.js` export-surface assertion; the INV-4/INV-5 reconstruction assertions are byte-identical.
- [ ] `tests/state.test.js` asserts `src/state.js` exports exactly `advanceWatermark`, `canPushSpan`, `createState`, `pushFrozen`, `pushUnit`, `sealUnits`, and `src/state-host.js` exports exactly `getState`, `save`.
- [ ] `index.js` has the same runtime behaviour: the extension's interceptor global, its event subscriptions and its slash commands are wired exactly as before (`tests/bootstrap.test.js` passes unchanged apart from import lines).
- [ ] `janitor/**` and `dist/**` are byte-identical to their pre-brief state.
- [ ] `npm run check` passes
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/host.md` — new `## Host shell modules {#host-shell}`: the `x.js` / `x-host.js` convention; the rule that a pure module may never import `./host.js` and that the seam is enforced by `tests/janitor/isolation.test.js`'s import walk, not by convention alone; which four pairs exist; why siblings rather than one aggregate (the three reasons above); and that `recovery`, `recompile`, `starter` and `ui/settings` are host-side in whole, with `recovery`/`recompile` explicitly deferred to the response-side Janitor brief.
- `docs/modules/state.md#save` and `#lazy-init` — one line each: these two functions live in `src/state-host.js`; the rest of the module is host-free so a second host can import `createState`/`pushUnit`/`sealUnits` directly.
- `docs/modules/frontier.md#interceptor-body` — record that the interceptor body is `src/frontier-host.js` and that `buildHistory`/`applyToRequestChat`/`shouldReconstruct`/`regeneratesLastMessage` stayed in `src/frontier.js` unchanged, so INV-4/INV-5 are proved by the same tests against the same code on both hosts.
- `docs/modules/boundary.md#stream-fallback` (or `#suspension`, whichever the pointer comments target) — the split: the literal and the four pure text functions stay in `src/boundary.js`; the per-generation state and the five event handlers are `src/boundary-host.js`. Note that `applyStopStrings` is therefore importable by a non-SillyTavern host (INV-2 travels with it).
- `docs/modules/freeze.md#frozen-edit-notice` — the notice and its toast live in `src/freeze-host.js`; `selectCut`/`compileUnit`/`countWords` are host-free.
