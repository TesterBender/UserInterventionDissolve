# Brief 0017 — suspend the boundary during the starter restructure call
Status: implemented
Complexity: high
PLAN sections: §8 "Hard boundary" (generation must be terminated before the model can commit the externally owned character's block; the stop is keyed to the reserved tag literal itself — this brief scopes *when* that stop is armed, never weakens the rule for manuscript generation), §10 (editorial authority: the collaborator or editor may modify any material in the mutable frontier, including the externally owned character's blocks — the rewrite output is material the collaborator edits and installs by hand, not a committed model turn)
Invariants touched: INV-2 (owner: `boundary`; this brief adds a suspension window scoped to one off-path call and must not widen it), INV-3 / INV-10 (named only because the sanitiser is their guarantee for this module; unchanged in kind here)

## Goal
`src/boundary.js` exposes a counted suspension that turns off its three *request-side* injection points, and `src/starter.js` holds that suspension for exactly the duration of its `generateRaw` call. After this, the starter restructure no longer truncates at the collaborator persona's tag: the model may write the externally owned figure's blocks in a rewritten opening scene, which is what a faithful rewrite of a greeting that already features her requires. The suspension is released in a `finally`, so no stale flag can survive into a normal chat generation; the receipt-side trim is never suspended.

## Why this is needed (live fact)
`CHAT_COMPLETION_SETTINGS_READY` (chat path) and `TEXT_COMPLETION_SETTINGS_READY` (text path) **do** fire for `generateRaw`, so `boundary`'s `applyStopStrings` currently runs on the restructure request and the reserved literal is installed as a stop string on a call that legitimately needs to emit it. `docs/api/sillytavern.md#generateraw` is being corrected by the `st-api-verifier` to record this; this brief depends on that corrected entry (see **Verification needed**). The claim in `docs/modules/starter.md#off-path` that "it fires neither `GENERATION_STARTED` nor `CHAT_COMPLETION_SETTINGS_READY`, so `boundary` neither arms nor applies its stop strings on that path" is therefore wrong and is rewritten by this brief.

Note also that `currentType` is sticky across generations (carry-forward in `docs/briefs/0008-boundary-module.md#carry-forward-from-scope-audit`): a settings-ready event arriving with no `GENERATION_STARTED` of its own inherits the previous generation's type, so the restructure call is treated as whatever ran before it. Fixing the stickiness is **not** this brief (see Out of scope); the suspension makes the outcome deterministic regardless of it.

## In scope
- `src/boundary.js`: add module-level `let suspendDepth = 0;` and export `suspendBoundary()`.
  - `suspendBoundary()` increments the counter and returns a `resume()` function. `resume()` is **idempotent per handle**: it decrements at most once no matter how often it is called (a captured local flag), and never lets the counter go below `0`.
  - A counter, not a boolean, so two overlapping suspensions cannot release each other early.
  - `resetBoundaryState()` also sets `suspendDepth = 0` (tests only; it is already exported for that).
- `src/boundary.js`: while `suspendDepth > 0`, three handlers return immediately and do nothing else — `onChatCompletionSettings`, `onTextCompletionSettings` (no stop field is created, no array is touched, the body is byte-identical on return) and `onStreamToken` (no `reservedLiteral` call, no `stopGeneration`, and `stoppedThisGeneration` is left as it was). The suspension check is the **first** statement in each of the three, before the existing type/dry-run guards.
- `src/boundary.js`: `onGenerationStarted` and `onMessageReceived` are **not** suspendable. `generateRaw` writes nothing to `chat[]`, so the receipt handler cannot see the rewrite; making it suspendable would only create a way for a leaked suspension to disarm the last line of defence on a real message.
- `src/starter.js`: `restructureStarter` imports `suspendBoundary` from `./boundary.js` (it already imports `reservedLiteral` from there) and wraps the call exactly as
  `const resume = suspendBoundary(); try { … await ctx.generateRaw(…) … } finally { resume(); }`.
  The `finally` is load-bearing: a rejected `generateRaw`, or a throw from `sanitiseRewrite`, must still release. The existing `catch` that logs one `console.error` and returns `''` stays; the suspension wraps the `generateRaw` call and its sanitise step, and nothing outside them. The missing-`generateRaw` early return happens **before** any suspension is taken.
- `src/starter.js`: `sanitiseRewrite` no longer calls `dropReservedBlocks`. It keeps every existing strip — leading/trailing `[OOC: …]` echo, leading `<content>` / trailing `</content>` echo, enclosing and stray fence lines — and returns the remainder trimmed. **This is the one addition beyond the user's literal ask.** Reason: with the stop string suspended the model can now write the externally owned figure's blocks, and a greeting in which she appears is the normal case; dropping those blocks silently deletes content the collaborator asked to have reformatted, which is worse than the output containing a figure the collaborator is about to paste into a card by hand anyway.
- `dropReservedBlocks` stays in the module and stays wired into `buildRewriteRequest` unchanged (the request side still strips reserved blocks from the pasted starter). Its pointer comment and `docs/modules/starter.md#sanitise` must be updated to say it is now a request-side step only.
- Tests per **Acceptance**, in `tests/boundary.test.js` and `tests/starter.test.js` only.
- Docs per **Docs to write/update**.

## INV-2 analysis (for the scope auditor)
INV-2 is "the model cannot generate the externally owned character's committing tag" — a statement about the manuscript, per PLAN §8, which constrains what the model may **commit** in it. The suspension window is scoped to a side-channel `generateRaw` call that: creates no chat message, runs no `generate_interceptor`, reads no chat history, and writes no canonical state, freeze span or frontier (`docs/api/sillytavern.md#generateraw`, `docs/modules/starter.md#off-path`). Its output is returned to a drawer output box; the collaborator reads it, edits it, and pastes it into the character card's Alternate Greetings themselves. That is PLAN §10 editorial authority — the human deciding the content of the externally owned figure's blocks — not the model committing her tag in a live manuscript. Live generation is unaffected: every `Generate()` path still runs with `suspendDepth === 0`, and the receipt-side trim is never suspended at all.

**Residual risk, accepted for now:** the counter is global to the module, so a normal chat generation that happens to run *concurrently* with a restructure would share the suspension window and lose its stop strings for the overlap. The receipt-side trim still catches the result. Mitigation idea, deliberately **out of scope**: disable the Restructure button while a generation is in flight. Record it as the known limitation in `docs/modules/boundary.md#suspension`; do not implement it here.

## Out of scope (explicit)
- Any UI change: no button disabling, no in-flight generation detection, no `is_send_press`/`streamingProcessor` read, no drawer edit. `index.js` is not touched at all, and neither is `src/ui/`.
- Fixing the sticky `currentType` / `currentDryRun` carry-forward, or adding `GENERATION_ENDED` / `GENERATION_STOPPED` handling or subscriptions. Named here so it is refused; it is a separate task.
- Any setting, toggle or persisted flag for the suspension. It has exactly one caller and no user-facing surface.
- Removing `dropReservedBlocks`, changing `buildRewriteRequest`'s request-side stripping, or changing `REWRITE_INSTRUCTION`, `CONTENT_OPEN`/`CONTENT_CLOSE` or any other model-facing string. `REWRITE_INSTRUCTION` is pinned: do not reword during implementation. A user-requested change goes through the pinned-string lane (`docs/workflow/workflow.md#pinned-string-lane`) as an amendment to the brief that owns it.
- Suspending `onMessageReceived`, or adding a suspension-aware branch anywhere outside `src/boundary.js`'s three request-side handlers.
- A generic "suspend the extension" mechanism, a shared suspension registry, or exporting the counter/`suspendDepth` for anything other than `resetBoundaryState()`.
- Any change to `capture`, `frontier`, `freeze`, `recovery`, `state` or `grammar`, and any new call into them from `starter`.
- Editing `docs/briefs/0015-starter-reformatter.md`. Its rule "every block whose header is the reserved literal is dropped from the sanitised result" is **superseded by this brief** for the sanitiser; that supersession is recorded here and in `docs/modules/starter.md#sanitise`, and 0015 keeps its Status line as-is.

## Files
- allowed to create/modify: `src/boundary.js`, `src/starter.js`, `tests/boundary.test.js`, `tests/starter.test.js`, `docs/modules/boundary.md`, `docs/modules/starter.md`, and this brief's Status line.
- must not touch: `index.js`, `style.css`, `manifest.json`, `PLAN.txt`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, every other `docs/briefs/*` (0015 included), every other `src/**` file (`src/ui/settings.js`, `src/grammar.js`, `src/host.js`, `src/prompt.js`, `src/constants.js`, `src/state.js`, `src/capture.js`, `src/frontier.js`, `src/freeze.js`, `src/recovery.js`, `src/preset-template.js`), every other `tests/**` file including `tests/helpers/fake-context.js`, `package.json`, `eslint.config.js`, `vitest.config.js`, `tools/*`, `presets/*`.

## ST APIs used
- `SillyTavern.getContext()` — docs/api/sillytavern.md#getcontext (status: verified) — unchanged usage through `getCtx`.
- `generateRaw` — docs/api/sillytavern.md#generateraw (status: verified, **as corrected**: `CHAT_COMPLETION_SETTINGS_READY` / `TEXT_COMPLETION_SETTINGS_READY` do fire for it; it still fires no `GENERATION_STARTED` and runs no `generate_interceptor`, and adds nothing to `chat[]`).
- CHAT_COMPLETION_SETTINGS_READY — docs/api/sillytavern.md#chat-completion-settings-ready (status: verified) — the handler this brief gates.
- TEXT_COMPLETION_SETTINGS_READY — docs/api/sillytavern.md#text-completion-settings-ready (status: verified) — likewise.
- STREAM_TOKEN_RECEIVED — docs/api/sillytavern.md#stream-token-received (status: verified) — likewise.
- `stopGeneration` — docs/api/sillytavern.md#stopgeneration (status: verified) — cited only as the call that must not happen while suspended.
- MESSAGE_RECEIVED — docs/api/sillytavern.md#message-received (status: verified) — cited as the handler that stays armed.

## Verification needed
- `docs/api/sillytavern.md#generateraw` must carry the corrected note (settings-ready events fire for `generateRaw`) with file:line evidence before implementation starts. The `st-api-verifier` is landing it concurrently; the implementer must read the corrected entry, not this brief's paraphrase, and must not edit that file.

## Acceptance
- [x] `suspendBoundary()` returns a function; with one suspension outstanding, `onChatCompletionSettings({})` and `onTextCompletionSettings({})` leave the body deep-equal to `{}` (no `stop`, no `stopping_strings` key created).
- [x] Nested/overlapping: two `suspendBoundary()` handles, releasing the first, still suppresses injection; releasing the second restores it. Calling one handle's `resume()` twice does not release the other suspension, and the counter never goes negative (a stray extra `resume()` followed by a fresh `suspendBoundary()` still suspends).
- [x] After `resume()`, `onChatCompletionSettings(body)` again puts the reserved literal at `body.stop[0]`, and `onTextCompletionSettings` at `stopping_strings[0]` and `stop[0]`.
- [x] While suspended, `onStreamToken('He waits.\n\nMara: steps in.')` does not call `ctx.stopGeneration()`; after `resume()` the same text does call it exactly once.
- [x] `onMessageReceived` still trims, marks and saves while a suspension is outstanding (the receipt path is not suspendable).
- [x] `resetBoundaryState()` clears an outstanding suspension.
- [x] `restructureStarter` releases the suspension when `generateRaw` resolves **and** when it rejects: after either, `onChatCompletionSettings({})` injects the literal again. (Assert through the exported handlers, not by reading module internals.)
- [x] `sanitiseRewrite('Mara: She set the lamp down.\n\nAnton: "You came."', 'Mara:')` returns both blocks unchanged; the fence/OOC/`<content>` strips all still pass; `sanitiseRewrite('', 'Mara:')` and `sanitiseRewrite(undefined, 'Mara:')` are still `''`.
- [x] `buildRewriteRequest` still drops a block beginning with the reserved literal and still keeps a mid-block mention (existing tests unchanged).
- [x] Only the `tests/starter.test.js` cases that asserted the sanitiser's reserved-block drop are rewritten; no other existing assertion in either test file is deleted or weakened.
- [x] `src/boundary.js` and `src/starter.js` still contain no occurrence of `SillyTavern` and no hard-coded character name; `tests/starter.test.js`'s module-hygiene lists still pass unchanged.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/boundary.md` — new `## Suspension {#suspension}`: what `suspendBoundary()` returns and why it is a counter with a per-handle-idempotent `resume()`; that exactly the three request-side handlers are gated and the receipt-side trim and `onGenerationStarted` are not; why `resume()` must be called from a `finally`; the one caller (`docs/modules/starter.md#boundary-suspended`) and the INV-2 argument in one paragraph (side channel, no chat message, no canonical state, §10 editorial authority at the paste step); and the accepted residual risk that a concurrent live generation shares the window, with the deferred mitigation named. Update the module's opening paragraph so "three points of one generation" reads correctly alongside the suspension.
- `docs/modules/starter.md` — new `## The boundary is suspended for this call {#boundary-suspended}`: the settings-ready events *do* fire for `generateRaw`, so the stop string was being installed on a call that must be free to write the externally owned figure; the `try/finally` shape; that the receipt handler is unaffected because nothing reaches `chat[]`.
- `docs/modules/starter.md#off-path` — correct the false claim that `generateRaw` fires neither settings-ready event and that `boundary` never reaches this path, and correct the "isolation is by construction, not by guard, so there is no suppression flag" sentence: there is now exactly one guard, scoped to this call. The interceptor and `chat[]` isolation claims stay.
- `docs/modules/starter.md#sanitise` — the reserved-block drop is removed from the sanitiser and why (a greeting may legitimately feature the collaborator's figure; silently deleting her blocks loses content the collaborator asked to have reformatted, and the collaborator reviews and pastes the result by hand). State that `dropReservedBlocks` now runs on the request side only, and that this supersedes the sanitiser rule in `docs/briefs/0015-starter-reformatter.md`.
