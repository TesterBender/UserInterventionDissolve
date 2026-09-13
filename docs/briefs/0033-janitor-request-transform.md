# Brief 0033 — Janitor request transform (live rewrite)
Status: implemented
Complexity: high  (touches INV-2, INV-3, INV-4, INV-5, INV-6, INV-10; wires the shell seam; adds a new pinned model-facing string; rebuilds the committed bundle)
PLAN sections: §9 (the collaborator's input must not survive as a model-visible user turn — the sentinel drop and the derivation are what implement that here), §12 (immediate frontier normalization: the non-system messages are rebuilt every request so earlier live seams disappear, and only one continuation-control turn remains at the edge), §13 (continuation control is neutral and byte-identical in frozen history — `CONTINUATION_CONTROL` is imported, never re-composed), §16 (freezing is append-only and the target belongs to the compiler; timing is the host's), §17 (cut selection stays in `selectCut`; this brief only supplies the clamp value), §18 (three independent horizons — the transport window applied here is a fourth, provider-side constraint and must not become a freeze schedule), §23 (reconstruction from separately stored canonical state is sufficient when native history editing is unavailable), §27 (nothing added here may make the transport narratively legible: the lead-in turn and the folded system message are judged by this)
Invariants touched: INV-2 (the reserved literal is written first into the stop array), INV-3 (user turns become manuscript blocks), INV-4 and INV-5 (total reconstruction, one control at the edge), INV-6 (freeze happens through `compileUnit` with the clamp, never by a local cut), INV-10 (the model-visible request must be identical for histories that normalise the same way)

Depends on: **brief 0031** (the `maxFrozenEnd` option, merged) and **brief 0032** (identity, storage, envelope diff, shim, merged). Do not start until both are done.

Scope source: `TamperContainment/PLAN-janitor.md` — "Per-generation pipeline" request side steps 3, 3b, 4, 5, 6, 7, 8, 9; "State and identity on Janitor" (the horizon paragraph); "Decisions"; "Deviations from the ST implementation"; "Layout and build"; the answered items of the "Verification ledger". The SillyTavern host mapping does not apply.

## Goal
The Janitor userscript rewrites a proxy chat-completion request end to end: it loads state for the envelope's chat id, folds injections into the assembled system message and prepends `MANUSCRIPT_SYSTEM_PROMPT`, drops every sentinel turn, derives the frontier with the persona literal from `profile.name`, attempts one clamped freeze and persists the result, replaces the non-system messages with `[final, control] × n, frontier, edge` trimmed to a fixed transport window, adds the pinned user-first lead-in when the first history message would be assistant, writes the reserved literal first into the `stop` array, re-serialises only because it changed something, and prints one `console.info` line naming finals, units, frontier words and whether a freeze happened. `janitor/main.js` installs this transform instead of the no-op, and `dist/janitor-manuscript-dissolve.user.js` is rebuilt and committed. Vitest over recorded bodies proves the model-visible prefix is byte-identical across three consecutive turns.

## In scope

**`janitor/constants.js`** (extend, brief 0032 created it):
- `JANITOR_HORIZON_TOKEN_BUDGET = 100_000` — a **host constant, not a setting and not read from Janitor**. The context-size field of `generation_settings` is an open ledger item (`docs/api/janitor.md#open`), so the script cannot read the real window; it applies its own fixed budget on top of Janitor's own truncation. The doc must say this and name the ledger item that would replace it.
- `JANITOR_HORIZON_HYSTERESIS = 0.8` — once over budget, drop down to this fraction of it.
- `JANITOR_WORDS_PER_TOKEN = 1.4` — the words → tokens estimate the plan prescribes. No tokenizer, no dependency.
- `JANITOR_LEAD_IN` — the pinned model-facing string below.

**`janitor/transform.js`** (new) — one exported `transformRequest(data, context)` returning the shell's truthy/falsy modified flag (`docs/modules/janitor-transport.md#transform-seam`), plus small private helpers. Order of operations, exactly:
1. **Gate.** Return `false` untouched when `context.adapter.kind !== 'chat'`, when `context.chatId` is absent, when `context.personaName` is empty, or when the located request container has a **top-level `system` string** — that last case is the Anthropic-shaped body the shell misclassifies as `chat` (`docs/modules/janitor-transport.md#chat-shape-adapter`); the Anthropic adapter is a later phase and such a body passes through with brief 0028's behaviour. One `console.warn`, once per page, for the missing-envelope case; the Anthropic case is silent.
2. **State.** `loadJanitorState(context.chatId)` — reloaded on every request, never cached across requests (cross-tab safety; plan, realities #17).
3. **Classify.** `classifyMessages(messages, context.chatMessages)` (brief 0032).
4. **Sentinel.** Drop every history message with `role === 'user'` and `content === SENTINEL`, at every occurrence, every request — exact match, no trim, no normalisation.
5. **Identity.** `assignIdentities` over the surviving history, then `matchWatermark` to re-point the stored watermark at its message when it moved or its tail was edited, and `classifyDrift` for the report.
6. **System message.** Rewrite the message at `systemIndex`: `MANUSCRIPT_SYSTEM_PROMPT` + `BLOCK_DELIMITER` + Janitor's own text, then every injection's content appended in input order, each separated by `BLOCK_DELIMITER`. The prepend is skipped when the first sentence of `MANUSCRIPT_SYSTEM_PROMPT` (computed from the imported constant at module load — `slice(0, indexOf('.') + 1)`, never a copied literal) already occurs in Janitor's text. Janitor's own text is never edited, reordered or trimmed. When there is no system message, insert one holding the prompt and the injections at index 0.
7. **Derive.** `deriveFrontier(toStShape(history, ids), state, literal)` where `literal` is `` `${context.personaName}:` `` — built here, because `src/boundary.js#reservedLiteral` reads a SillyTavern context. Everything else about the derivation is `src/derive.js`, unchanged.
8. **Freeze.** `compileUnit(state, derived, literal, { maxFrozenEnd })` with `maxFrozenEnd` = the `start` offset of the **last** entry of `derived.segments` (brief 0031) — so no cut consumes any part of the last non-sentinel message; with fewer than two segments, no freeze is attempted. On a non-`null` result: write `watermark.prefixHash` and `watermarkText` from the watermark message's raw content (`prefixIdentity`), re-run the derivation against the updated state, and `saveJanitorState` **before** the body is dispatched. On `null`, nothing is written.
9. **Reconstruct.** `fromStShape(buildHistory(state, { name1: context.personaName, name2: '' }, { frontier: derived.text }))` — `src/frontier.js`, unchanged — giving `[final, control] × n, frontier, edge`. Replace the non-system messages of `messagesContainer.messages` with the system message followed by the reconstruction. Janitor's trailing assistant prefill is gone by construction, since every non-system message is replaced and `buildHistory` ends on a user turn; `prefill_text` is never re-added.
10. **Horizon.** Estimate tokens as `countWords(text) * JANITOR_WORDS_PER_TOKEN` (`src/freeze.js#countWords`) summed over the system message and the reconstruction. While the estimate exceeds `JANITOR_HORIZON_TOKEN_BUDGET`, drop whole `[final, control]` pairs from the front, **starting at the second pair** — the first pair is the §19 seed or greeting and is never dropped — until the estimate is at or below `JANITOR_HORIZON_HYSTERESIS × budget`; when nothing more may be dropped, stop and warn once. The frontier turn and the edge control are never dropped or trimmed, and canonical state is never touched.
11. **Lead-in.** If the first message after the system message is `assistant`, insert `{role: 'user', content: JANITOR_LEAD_IN}` before it. Applied after the horizon so the lead-in is present regardless of drops.
12. **Stop.** `applyStopStrings(context.adapter.requestContainer, literal, 'chat')` (`src/boundary.js`) — the literal first in `stop`, duplicates removed (INV-2, `docs/modules/boundary.md#why-first-in-stop-array`).
13. **Report.** Exactly one `console.info` per transformed request, prefixed with `LOG_PREFIX`, naming: number of finals, number of units, frontier word count, and whether a freeze happened this request. Operator-facing only; it is never part of the body.
14. Return `true`.

**`janitor/main.js`** — replace `installTransport(() => false)` with `installTransport(transformRequest)`. Nothing else in `janitor/shell.js`, `envelope.js`, `shape.js` or `xhr-warning.js` changes.

**`dist/janitor-manuscript-dissolve.user.js`** — rebuilt with `npm run build:janitor` and committed. Note for the implementer: `src/recovery.js` must **not** be imported anywhere in `janitor/` — it is response-side and it collides with `src/boundary.js` on the top-level name `SKIPPED_RECEIPT_TYPES`, which fails the build (`docs/modules/janitor-build.md#supported-module-syntax`). If the build fails on a duplicate top-level name between two `src/` modules on the legitimate import path, that is a `SCOPE_GAP` — `src/` may not be edited in this brief.

**Tests** — `tests/janitor/transform.test.js` (and a `tests/janitor/horizon.test.js` if the horizon helper is exported separately), driving the real shell with a fake `window.fetch` and a fake `localStorage`, over fixtures extending `tests/janitor/fixtures/`:
- three consecutive turns built from one recorded body plus appended turns, asserting the dispatched bodies share a **byte-identical model-visible prefix** (the system message and every `[final, control]` pair that survives in all three), and that the continuation control is byte-identical to `CONTINUATION_CONTROL`;
- sentinel drop at every occurrence; injection folding into the system message with history untouched; persona tagging of a user turn (`` `${persona}:\n` ``); the freeze clamp (no compiled unit contains any text of the last message, asserted on a body long enough to freeze); the horizon drop (a body over budget loses whole front pairs but keeps the first pair, the frontier and the edge); the lead-in (present when the first history message is assistant, absent otherwise); the prefill strip (a trailing assistant prefill in the incoming body never appears in the dispatched one and the last message is a user turn); stop-first (`stop[0] === literal`, no duplicate);
- pass-through: an Anthropic-shaped body (top-level `system`) and a body with no envelope are dispatched byte-identically to the input, the flag is falsy;
- `JANITOR_LEAD_IN` banned-word assertion per `docs/decisions/0003-duplication-filter-wording.md`.

### Pinned model-facing string

`JANITOR_LEAD_IN` is new model-facing text. It exists only because some providers require the first message to be a user turn; it must read as an ordinary request to write and must not describe the transport. Proposed text, to be reviewed by the user before implementation:

```
Write the manuscript.
```

Do not reword during implementation. A user-requested change goes through the pinned-string lane (`docs/workflow/workflow.md#pinned-string-lane`) as an amendment to this brief.

`MANUSCRIPT_SYSTEM_PROMPT` and `CONTINUATION_CONTROL` are **imported from `src/prompt.js`**, byte-for-byte, never copied, re-wrapped or re-composed, so both hosts stay cache-compatible.

## Out of scope (explicit)
- Everything response-side: the stream cut, the stop-fallback suppression, synthesised terminal frames, boundary recording into `state.boundaries`, `classifyOutcome`, `truncateToLastCompleteBlock`, the INV-8 derivation-time trim. `state.boundaries` is round-tripped and never written here.
- The panel, the shadow-DOM host, Export/Import, Recompile, the stop-button observer, the cross-tab `storage` event listener, any warning surfaced anywhere but `console`.
- The Anthropic adapter, `stop_sequences`, `stopSequences`, the `responses` shape, a top-level `system` writer, XHR anything.
- Per-route rejected-`stop` learning and the "skip stop on this route" branch — no route has rejected anything, and there is no live path to record it in this phase.
- Reading any Janitor setting: context size, response length, prefill, `generateType`. The horizon budget is a constant; `generateType` and prefill are recorded by the shell and unused here.
- Any settings, toggle or UI for the sentinel, the budget, the hysteresis or the lead-in.
- Editing `src/` for any reason, including adding `prefixHash` to `advanceWatermark`, a Janitor branch in `reservedLiteral`, or a token-aware variant of `countWords`.
- A solo variant, take-stock, starter restructure, preset install or slash commands (plan, Deviations: dropped for v1).
- Repairing drift, re-keying state, or acting on a persona switch beyond using the new literal (plan, realities #8: report, do not repair — and the report here is the one `console.info` line).
- Wiring `build:janitor` into `npm run check`, or any dependency.

## Files
- allowed to create: `janitor/transform.js`, `tests/janitor/transform.test.js`, `tests/janitor/horizon.test.js`, `tests/janitor/fixtures/*.js`
- allowed to modify: `janitor/constants.js` (the four constants above), `janitor/main.js` (the transform argument only), `dist/janitor-manuscript-dissolve.user.js` (regenerated, never hand-edited), `docs/modules/janitor-adapter.md` (new headings), `docs/modules/janitor-transport.md` (`## Transform seam` only — record that the seam is now wired), `docs/decisions/0007-janitor-host-deviations.md` (append two sections)
- must not touch: `src/**`, `janitor/shell.js`, `janitor/envelope.js`, `janitor/shape.js`, `janitor/xhr-warning.js`, `janitor/identity.js`, `janitor/storage.js`, `janitor/history.js`, `tools/**`, `package.json`, `eslint.config.js`, `index.js`, `manifest.json`, `presets/**`, `tests/*.test.js`, `PLAN.txt`, `TamperContainment/**`, `docs/protocol/host-mapping.md`, `docs/protocol/invariants.md`

## ST APIs used
- none. `globalThis.SillyTavern` must not be referenced in `janitor/` or `tests/janitor/`. Imports from `src/prompt.js`, `src/constants.js`, `src/derive.js`, `src/frontier.js`, `src/freeze.js`, `src/state.js` and `src/boundary.js` are pure-function imports; the functions used (`deriveFrontier`, `buildHistory`, `compileUnit`, `countWords`, `applyStopStrings`, `createState`) reach no host object.

## Verification needed
- (empty) Every Janitor fact used is answered in `docs/api/janitor.md`: transport is fetch + SSE (2026-09-13); `/generateAlpha` precedes every model invocation (2026-09-13); the persona lives at `profile.name` (2026-09-13); Janitor sends no default `stop` list, so the script owns all slots (2026-09-13); non-history turns are injected in any role (2026-09-13); a regenerate drops the replaced assistant message (2026-09-13); the custom prompt may not be empty (2026-09-13). The one open item that reaches this brief — the `generation_settings` context-size field and its unit — is deliberately **not** waited on: the horizon uses the fixed host constant above instead of reading a setting, which is recorded as a deviation. The remaining open items (save path, sentinel acceptance, Anthropic path, stop-sequence and early-close behaviour, exact injection shapes) are response-side, later-phase, or exercised through the diff's tested fallback. Do not launch `st-api-verifier`.

## Acceptance
- [x] Three consecutive turns over the fixture produce dispatched bodies whose system message is byte-identical and whose surviving `[final, control]` pairs are byte-identical, with `CONTINUATION_CONTROL` byte-equal to the `src/prompt.js` export.
- [x] The dispatched body contains no message equal to `SENTINEL`, for a fixture with sentinels at three different depths.
- [x] Every injected message's content appears exactly once, inside the system message, in input order; no injected content appears in any non-system message; Janitor's own system text is present unmodified.
- [x] `MANUSCRIPT_SYSTEM_PROMPT` is prepended once; a second pass over a body that already carries it prepends nothing, and the resulting system message is byte-identical to the first pass's.
- [x] A human user turn appears in the dispatched body only as `` `${persona}:\n…` `` inside an assistant-role message; no dispatched user message carries manuscript content other than the control turns and the lead-in.
- [x] With a frontier long enough to freeze, `state.frozen`/`state.units` gain a span whose text ends before the start of the last message's derived text, and the saved state is written before `fetch` is called (asserted by ordering on the fakes).
- [x] A body whose estimate exceeds `JANITOR_HORIZON_TOKEN_BUDGET` loses whole front pairs down to at most `0.8 ×` budget, keeps the first pair, the frontier turn and the edge control, and leaves the stored state byte-identical; a body under budget loses nothing.
- [x] The lead-in is present exactly once when the first post-system message is assistant, and absent when it is a user turn; `JANITOR_LEAD_IN` contains none of decision 0003's banned words.
- [x] The dispatched body's last message is a user turn, and Janitor's `prefill_text` string appears nowhere in it.
- [x] `stop[0] === literal`, with the literal appearing exactly once in the array.
- [x] Exactly one `console.info` per transformed request, naming finals, units, frontier words and freeze yes/no.
- [x] An Anthropic-shaped body (top-level `system`) and a completion with no envelope are dispatched byte-identically to the caller's own body string, with a falsy flag.
- [x] `npm run build:janitor` regenerates `dist/janitor-manuscript-dissolve.user.js`, it parses via `new Function`, and the committed file matches a fresh build.
- [x] `npm run check` passes
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`)

### Implementation note

Janitor's trailing prefill has no envelope counterpart, so the diff of step 3b classifies it as an **injection** and step 6 would have folded it into the system message — the acceptance line "prefill_text appears nowhere" and step 9's "gone by construction" do not hold on their own. The transform therefore drops, rather than folds, the last message of the incoming array when it is an injection with role `assistant`. No Janitor setting is read (`generation_settings.prefill_text` is untouched); the test is positional and role-based. Recorded at `docs/modules/janitor-adapter.md#prefill-strip`.

The report line carries a fifth fact, the count from `classifyDrift` (step 5 asks for the classification "for the report", and the console line is the only report this phase has).

The lead-in's absent case is exercised where no assistant turn follows the system message (a history of nothing but sentinels). A reconstruction whose first post-system message is a `user` turn is unreachable: `buildHistory` always opens on an assistant span.

## Docs to write/update
- `docs/modules/janitor-adapter.md` — new headings for this brief's pointers: `## Request pipeline {#request-pipeline}` (the fourteen steps in order and why the order is load-bearing — identity before derivation, freeze before reconstruction, horizon before the lead-in); `## System message {#system-message}` (prepend rule and the first-sentence test computed from the imported constant, Janitor's text never edited, injections appended in order and why appending keeps the cached prefix stable, the empty-custom-prompt hazard); `## Sentinel {#sentinel}` (exact match, every occurrence, why an edited sentinel silently becomes a persona block); `## Freeze at request build {#freeze-at-request-build}` (idempotence, the `maxFrozenEnd` value taken from the last segment, and the pointer to `docs/modules/freeze.md#last-message-clamp`); `## Transport horizon {#transport-horizon}` (whole pairs from the front, span 0 pinned, hysteresis, that canonical state is untouched so addendum §7/§11 hold, and that this is a transport-window policy and explicitly not one of PLAN §18's three horizons); `## Horizon budget is a constant {#horizon-budget}` (why a constant and not a setting or a read of `generation_settings`, naming the open ledger item and the `words × 1.4` estimate); `## Lead-in turn {#lead-in}` (why it exists, that it is pinned and byte-stable, and its §27 / decision 0003 justification); `## Prefill strip {#prefill-strip}` (stripped by construction; the trailing-assistant shape modern Gemini rejects and the non-manuscript turn §27 forbids); `## Stop array {#stop-array}` (literal first, `applyStopStrings` reused, Janitor ships no defaults); `## Request report {#request-report}` (the one `console.info` line, its four facts, and that it is the only sign of life until the panel exists).
- `docs/modules/janitor-transport.md#transform-seam` — one paragraph: the seam is now wired to `janitor/transform.js`; the phase-2 no-op is gone and the pass-through property now holds only for bodies the transform gates out.
- `docs/decisions/0007-janitor-host-deviations.md` — append two sections: **Script-enforced horizon** (fixed budget, hysteresis, pinned span 0; alternatives rejected: reading Janitor's context setting, which is an uncaptured field; trimming the frontier, which would desynchronise the watermark) and **Trailing prefill stripped** (why a provider prefill is both a protocol violation under §27 and a provider-compatibility hazard). Do not edit the sections written by briefs 0031 and 0032.
