# Brief 0026 — Hierarchical compilation: Tier-1 units, sealed final spans, interleaved continuations
Status: done
Complexity: high
PLAN sections: §12 (the mutable frontier is reconstructed every request so earlier live seams cannot survive), §13 (continuation control is a neutral host constant; frozen history uses one byte-identical string), §16 (freezing is append-only, old spans are not re-cut; 3,000–4,200 words with jitter is an advisory transport target the compiler may overrun for a better boundary), §17 (cuts may correlate with low-salience structure, never with authorship or high-salience fiction). Governing spec for this brief: `PLAN-addendum-hierarchical-compilation.md` (§1–§16), read in full.
Invariants touched: INV-4, INV-5, INV-6, INV-7, INV-10

## Goal
Compilation becomes two-tier. A cut at the existing 3,000–4,200-word target no longer produces a permanent historical span; it produces a **Tier-1 unit** held in canonical state. Units accumulate and are **sealed** into one **final frozen span** when the next unit could no longer fit under a 10,000-word ceiling. The model-visible history becomes `[final span, canonical continuation] × n`, then one assistant message carrying the unsealed units plus the hot derived frontier, then the single live control turn — so the provider-visible prefix grows monotonically and is byte-identical across calls that change only the frontier (addendum §5–§8, §11). Existing final spans are never merged, re-cut or rewritten (addendum §7, §11; INV-6). Internal tier boundaries create no model-visible turns (addendum §10).

## In scope

### 1. State v3 (`src/state.js`, `src/constants.js`)
- `STATE_VERSION = 3`. `createState()` returns `{ version: 3, frozen: [], units: [], frozenIds: [], watermark: { messageId: null, offset: 0 } }`.
- `frozen[]` holds **final** spans only; `units[]` holds compiled Tier-1 units awaiting promotion. Both entries have the shape `{ text, words, createdAt }`.
- `getState()`: a stored object with `version === 2` is upgraded **in place** — set `units = []`, set `version = 3`, return the same object. Its existing `frozen` entries stay final and untouched (addendum §7/§11 forbids merging them). No validation of the v2 body: it is our own former write. The upgrade is a mutation of the stored metadata object and is therefore persisted by the next `saveMetadata`, exactly like today's lazy init — do not add a save here.
- Any other `version` keeps today's behaviour: `warnOnce`, discard, fresh state.
- Export `canPushSpan(text)` — the existing accept test factored out (`typeof text === 'string' && text.trim() !== '' && isTrailingBlockComplete(text)`). Two consumers: `pushFrozen`/`pushUnit` and `freeze`'s pre-check (below). No other abstraction.
- Export `pushUnit(state, unit)` — same contract as `pushFrozen` (refuse blank or mid-block text; fill `words` and `createdAt`), appending to `state.units`.
- Export `sealUnits(state)` — if `state.units` is empty, return `null`. Otherwise build one span `{ text: units.map(u => u.text).join(BLOCK_DELIMITER), words: sum(u.words) }`, append it to `state.frozen` through `pushFrozen`, clear the units in place (`state.units.length = 0`), and return the new `frozen` index. `sealUnits` decides nothing about *when* to seal.
- New constants, documented in `constants.js` with pointer comments:
  - `FINAL_MAX_WORDS = 10000` — ceiling for a sealed final span (addendum §4).
  - `FINAL_MIN_WORDS = 6000` — floor below which units are not sealed.

### 2. Cutting (`src/freeze.js`)
- `selectCut` is unchanged: same `FREEZE_MIN_WORDS`/`FREEZE_MAX_WORDS` target, same jitter, same span-aware hard rules and salience preferences (INV-6, INV-7 keep their only implementation).
- Rename `maybeFreeze` → `compileUnit`. Same arguments, same watermark mapping and partial-refusal rule, same "a refused cut leaves the state byte-identical" property. No back-compat alias export.
- Order of operations inside `compileUnit`:
  1. `selectCut`; map the cut onto a message as today; on any refusal return `null` before mutating anything.
  2. Pre-check the span text with `canPushSpan`; if it fails, return `null` (this is what keeps step 3 from mutating state for a cut that would then be refused).
  3. **Ceiling guard:** if `state.units` is non-empty and `unitsWords(state) + unit.words > FINAL_MAX_WORDS`, call `sealUnits(state)` first. A combination above the ceiling is never created.
  4. `pushUnit(state, unit)`, then `advanceWatermark(...)` exactly as today.
  5. **Seal policy:** if `unitsWords(state) >= FINAL_MIN_WORDS` **and** `unitsWords(state) + FREEZE_MAX_WORDS > FINAL_MAX_WORDS`, call `sealUnits(state)`.
- Return `{ unitIndex, words, target, overrun, blockIndex, watermark, seals }`, where `unitIndex` is the index the unit had in `state.units` after step 4 and `seals` is an array of `{ frozenIndex, words }` for the seals this call performed (length 0, 1, or — in the overrun case where both steps 3 and 5 fire — 2). A non-`null` return still means "state changed", which is all the callers test.
- Arithmetic to state in the docs and the decision record: a unit is normally 3,000–4,200 words, so two units are ≥ 6,000 and satisfy both seal clauses; finals therefore normally land at 6.0k–8.4k, and a third unit is never combined on top (7.3k + 4.2k > 10k). The `FINAL_MIN_WORDS` clause is not redundant: a single overrun unit of ≥ 6,000 words seals alone, and a single overrun unit below 6,000 waits for the ceiling guard rather than producing a 10.1k final.
- **No jitter on `FINAL_MIN_WORDS`.** Delaying a seal by jitter can only be paid for by admitting one more unit, which can carry the combination past the ceiling; unit-level jitter already decorrelates boundaries from narrative structure (INV-7, addendum invariant 11). Record this in the decision record.
- `FROZEN_EDIT_NOTICE` and `noticeFrozenEdit` are unchanged. Messages consumed into a unit are in `frozenIds`, so editing them still warns, and the notice is still true: the edit reaches the log only. Do not reword during implementation. A user-requested change goes through the pinned-string lane (`docs/workflow/workflow.md#pinned-string-lane`) as an amendment to this brief.

### 3. Reconstruction (`src/frontier.js`)
- `buildHistory(state, { name1, name2 }, options)` emits, in order:
  1. for each non-empty `state.frozen[i]`: an assistant message with the span text, **then** a user message whose text is `CONTINUATION_CONTROL` used by reference, byte-identical, never `options.control` and never the solo variant (addendum §6, §11; INV-5);
  2. one assistant "current frontier" message whose text is `[...state.units.map(u => u.text), options.frontier]` filtered to non-blank pieces and joined with `BLOCK_DELIMITER`; omitted entirely when every piece is blank (addendum §10 — units get no turns of their own);
  3. the live edge user turn: `options.control` when it is a non-empty string, else `CONTINUATION_CONTROL` — pushed **only if step 2 pushed a message**, so the array never contains two consecutive user turns.
- Consequences to preserve: empty state still returns `[]`; the result strictly alternates assistant/user and always ends with a user turn; when there are finals but nothing unsealed and nothing hot, the canonical control after the last final is the edge seam and the one-shot solo variant is dropped for that request (document it under `#solo-variant`).
- `applyToRequestChat`, `regeneratesLastMessage`, `shouldReconstruct`, `interceptGeneration` are unchanged apart from `buildHistory`'s new output.

### 4. Call sites
- `src/recovery.js`: import and call `compileUnit` instead of `maybeFreeze`. Call-site only — one attempt per receipt, `save(ctx)` when the result is non-`null`. No new branch for seals.
- `src/recompile.js`: same rename; the loop is unchanged. After `compileUnit` returns `null`, the trailing units are by construction below the seal policy, so there is **no** post-loop seal step — say so at `docs/modules/recompile.md#loop`. `formatRecompileSummary` and the `{ spans, words }` counts keep their present meaning (final frozen spans only) and the pinned string is unchanged.

## Out of scope (explicit)
- Any frontend/visible-log presentation change (addendum §13 forbids inferring one).
- Rewording `CONTINUATION_CONTROL`, `SOLO_CONTINUATION_CONTROL`, `FROZEN_EDIT_NOTICE` or the recompile summary line; and reporting unit counts/words in the recompile summary (that changes a pinned string).
- A third tier, a `sealedUnits` back-reference array, per-unit ids, a "promote now" command, settings or toggles for `FINAL_MIN_WORDS`/`FINAL_MAX_WORDS`, or jitter on the final floor.
- Re-cutting, splitting, merging or rewriting any existing `frozen` span; a migration that would merge v2 spans into larger finals.
- Changing `selectCut`'s target, jitter or salience rules; changing `deriveFrontier`; touching `grammar.js` (importing `isTrailingBlockComplete` from it is fine, editing it is not).
- Cache-control headers or provider-specific cache features (addendum §11 last line).
- dryRun/token-preview parity (brief 0012).

## Files
- allowed to create/modify: `src/state.js`, `src/freeze.js`, `src/frontier.js`, `src/recovery.js` (call site only), `src/recompile.js`, `src/constants.js`, `tests/state.test.js`, `tests/freeze.test.js`, `tests/frontier.test.js`, `tests/recovery.test.js`, `tests/recompile.test.js`, `docs/modules/state.md`, `docs/modules/freeze.md`, `docs/modules/frontier.md`, `docs/modules/recovery.md`, `docs/modules/recompile.md`, `docs/protocol/host-mapping.md`, `docs/decisions/0006-hierarchical-compilation.md`, `docs/decisions/README.md`
- must not touch: `src/derive.js`, `src/grammar.js`, `src/boundary.js`, `src/prompt.js`, `src/solo.js`, `index.js`, `src/ui/`, `docs/protocol/invariants.md`, `PLAN.txt`, `PLAN-addendum-hierarchical-compilation.md`, `presets/`

## ST APIs used
- `SillyTavern.getContext()` — docs/api/sillytavern.md#getcontext (status: verified)
- Context keys `chat`, `chatMetadata`, `saveChat`, `saveMetadata`, `name1`, `name2` — docs/api/sillytavern.md#context-keys (status: verified)
- Per-chat persistence (`chatMetadata.<ext>` + `saveMetadata`) — docs/api/sillytavern.md#chat-metadata (status: verified)
- `generate_interceptor` (per-request chat copy, in-place mutation honored) — docs/api/sillytavern.md#generate-interceptor (status: verified)
- `toastr` — docs/api/sillytavern.md#toastr (status: verified)

## Verification needed
- (empty)

## Acceptance
- [x] `createState()` is `{ version: 3, frozen: [], units: [], frozenIds: [], watermark }`; a stored v2 object is upgraded in place — same object identity, `frozen` entries byte-identical, `units` added as `[]`, `version` 3 — and a `version: 1` or `version: 99` object still warns once and is replaced.
- [x] `compileUnit` on a fresh state pushes to `state.units` and leaves `state.frozen` empty; `frozenIds`/`watermark` advance exactly as `maybeFreeze` did (existing watermark-mapping and partial-refusal tests pass unchanged against the new name).
- [x] Seal policy table: one 3.5k unit → not sealed; 3.5k + 3.8k → sealed as one 7.3k final (`frozen.length === 1`, `units` empty, final text equals the two unit texts joined by `BLOCK_DELIMITER`, final `words` equals the sum and equals `countWords` of the joined text); a further 3.4k unit starts a new unit set and is not sealed.
- [x] Ceiling guard: units holding a single 5.9k overrun unit followed by a 4.2k unit seals the 5.9k alone and leaves `units = [4.2k]`; no final of 10.1k is ever produced.
- [x] Over a long synthetic run (≥ 40k words of manuscript compiled through repeated `compileUnit` calls) no entry in `state.frozen` exceeds `FINAL_MAX_WORDS`, and every entry except a lone-overrun seal is ≥ `FINAL_MIN_WORDS`.
- [x] Append-only identity: snapshot `state.frozen` as JSON before further cuts/seals and assert every previously existing entry is byte-identical afterwards, and that `frozen` only ever grows.
- [x] `buildHistory` shape: two finals + two units + hot text ⇒ `[A(final0), U(canonical), A(final1), U(canonical), A(units+hot), U(edge)]`, strictly alternating, every historical control byte-identical to `CONTINUATION_CONTROL`, and the frontier message equal to `unit0 + BLOCK_DELIMITER + unit1 + BLOCK_DELIMITER + hot`.
- [x] `buildHistory` omits the frontier message when units and hot text are all blank and then does not append a second user turn (finals-only state ends with exactly one canonical control after the last final; the solo variant is not emitted in that case).
- [x] Prefix stability: building twice from the same `state.frozen` with different `units`/`frontier` yields byte-identical first `2n` messages; appending a new final leaves the first `2n` messages unchanged (monotonic prefix growth, addendum §8/§11).
- [x] INV-10: identical state + identical chat produce deep-equal arrays across calls, and two different live interaction histories that compile to the same state produce identical arrays.
- [x] `recompile` over a long chat yields sealed finals plus trailing units in `state.units`, seals nothing after the loop, and its summary line is byte-identical to today's format.
- [x] `recovery.onMessageReceived` still saves metadata exactly when a compile happened, including when that compile also sealed.
- [x] `npm run check` passes
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/state.md#shape` — v3 shape, `frozen` = final spans vs `units` = Tier-1 units; `#unknown-version` — the v2→v3 in-place upgrade and why v2 spans stay final; new headings for `pushUnit`, `sealUnits`, `canPushSpan` (mechanism only, no policy numbers).
- `docs/modules/freeze.md#target-jitter` / `#overrun` — the unit target is unchanged; new heading for the seal policy: the two clauses, `FINAL_MIN_WORDS = 6000`, `FINAL_MAX_WORDS = 10000`, the ceiling guard, the arithmetic above, and why there is no jitter on the floor. Rename references from `maybeFreeze` to `compileUnit`.
- `docs/modules/frontier.md#shape` — the `[A,U]×n, A_frontier, U_edge` shape and the no-two-user-turns rule; `#solo-variant` — the solo variant is dropped when the frontier message is omitted; `#inv-10` — prefix stability as the second testable property.
- `docs/modules/recovery.md#freeze-hookup` — one `compileUnit` per receipt, which may seal.
- `docs/modules/recompile.md#loop` / `#summary` — why no post-loop seal exists and why the summary still counts finals only.
- `docs/protocol/host-mapping.md#s12-frontier` — rewrite the reconstruction bullet for the tiered shape and the monotonic prefix; `#s16-freeze` — rewrite for two tiers: `selectCut` → unit → seal → final span, "compiled once, remembered" now covering units as well as finals.
- `docs/decisions/0006-hierarchical-compilation.md` (+ entry in `docs/decisions/README.md`) — the policy numbers and arithmetic, why units are cleared on seal rather than kept as references (addendum §9 permits either; a retained copy duplicates the span bytes in `chatMetadata` with no consumer and no test that can observe it), why there is no jitter on `FINAL_MIN_WORDS`, and the continuation-between-finals fix (back-to-back assistant spans were relying on the host to keep them distinct).

## Amendment 1 (orchestrator, 2026-09-13)

`sealUnits` must honour `pushFrozen`'s boolean: when the push is refused it leaves `state.units` untouched and returns `false`, so no text is lost and no caller can read a `frozen` entry that was never created. `compileUnit`'s seal step handles a `false` seal by recording no entry in `seals`.

Revised after re-audit (INV-6, addendum §16.4): when the **ceiling guard** is the seal that was refused, `compileUnit` **stalls** — it does not push the new unit, does not advance the watermark, returns `null` with the state byte-identical, and warns once per state object (`console.warn` with `LOG_PREFIX`). Pushing anyway would build the over-ceiling combination the guard exists to prevent, and the post-push clause would then seal it as one oversized final. The ceiling therefore holds under any state, including an unsealable unit set.

- [x] `sealUnits` returns `false` and keeps the units when `pushFrozen` refuses; `compileUnit` records no seal
- [x] a refused ceiling-guard seal yields `null` with no new unit, `units`, `frozen`, `frozenIds` and `watermark` unchanged, and one warning per state
