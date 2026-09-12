# Brief 0011 — `freeze`: cut selection and promotion of the frontier into frozen spans
Status: implemented
Complexity: high
PLAN sections: §5 (a manuscript is atomic blocks separated by a blank line, each a tag block or a buffer block; "the compiler never freezes through the middle of a complete block"), §16 (the frontier is periodically promoted into immutable history; freezing is append-only and old spans are not re-cut; the nominal transport target is "approximately 3,000–4,200 words with modest jitter", the number belongs to the compiler and not to the model-visible prompt, the target is advisory and "the compiler may overrun it to reach a better block boundary"), §17 (transport cuts may intentionally correlate with low-salience structure that provides safe boundaries — mid-passage buffer boundaries, ordinary non-climactic transitions, boundaries after non-external tags — and should avoid immediately before/after the external character, dense external-character runs, scene openings and closures, chapter-like resolutions, emotional peaks, POV resets, obvious handoffs), §18 (generation horizon, authorship horizon and transport horizon are three independent lengths and must not be conflated; dense external-character activity must not produce short historical chunks, and a long absence must not lengthen them), §20 (read only to record that pre-freeze lint is *not* implemented: §20's own closing caveat plus `docs/decisions/0001-prompt-level-grammar.md` make lint advisory to the editor, never a gate on promotion)
Invariants touched: INV-6 (frozen spans are append-only and cut only at complete block boundaries — this brief is the module that chooses the cut), INV-7 (transport cuts avoid the external character and high-salience narrative structure — this brief is its owner), INV-10 (freezing depends only on the frontier text and the reserved literal, so many live interaction histories collapse to the same frozen spans)

## Goal
`src/freeze.js` exists and answers exactly one question: given the current mutable frontier and the reserved external literal, where — if anywhere — may a span be cut off and promoted into immutable history? It exports a pure `selectCut(frontierText, literal, opts)` that returns a block boundary chosen by mechanical salience rules over a jittered word target, and a `maybeFreeze(state, literal, opts)` that applies that cut through `pushFrozen`/`setFrontier` and reports what it did. The module touches no SillyTavern API, no clock, no persistence, and no `chat[]`: given the same frontier text, literal and seed it always produces the same cut, which is what makes INV-10 testable. Nothing calls it yet — the `recovery`/`index.js` hook-up is a later brief.

## In scope

### `src/constants.js` — exactly three added literals, nothing else
Each with a pointer comment resolving into `docs/modules/freeze.md`:
- `FREEZE_MIN_WORDS = 3000` — no cut is considered before the frontier has this many words (PLAN §16 target floor).
- `FREEZE_MAX_WORDS = 4200` — the advisory ceiling; a cut beyond it is an overrun, permitted only to reach a safe boundary.
- `FREEZE_DENSE_RADIUS = 2` — how many blocks either side of a boundary are scanned for reserved-literal blocks when rejecting dense runs.
These are module constants, edited in the file. They are **not** settings, not read from `extensionSettings`, and not exposed in any UI.

### `src/freeze.js` — new module
Imports: `parseManuscript`, `findTagLiteral` from `./grammar.js` (**import only**; `src/grammar.js` is not modified), `pushFrozen`, `setFrontier` from `./state.js` (**import only**), and the three constants above from `./constants.js`. It must not import `./host.js`, must not call `getState`/`save`, and must not contain the identifier `SillyTavern` (`tests/bootstrap.test.js` asserts that identifier appears nowhere outside `src/host.js`).

**Module-private constants** (with pointer comments):
- `SENTENCE_FINAL = /[.!?…]["”'’)\]*]*$/` — deliberately a copy of grammar's private `TERMINAL` (`src/grammar.js:8`). Grammar does not export it and this brief may not edit grammar; the duplication is recorded in `docs/modules/freeze.md#salience-heuristics`.
- `SCENE_SEPARATOR = /^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$/` — a line of three or more `*` or `-`, spaces allowed between them.

**Exports, and no others:**

1. `countWords(text)` → `(String(text ?? '').match(/\S+/g) ?? []).length`. The regex is `/\S+/g` and is defined **once** in this module. It is the same rule `pushFrozen` uses to fill `span.words` when the caller omits it (`src/state.js:63`), so a span frozen here carries the same count it would have been given. (`tests/prompt.test.js:145` uses `/[A-Za-z'’]+/g`; that is a letters-only count of a fixed English prompt asset and is deliberately **not** reused — it would undercount manuscript prose containing digits and non-Latin script.)

2. `selectCut(frontierText, literal, { min = FREEZE_MIN_WORDS, max = FREEZE_MAX_WORDS, jitterSeed } = {})` → `{ blockIndex, frozenEnd, index, words, target, overrun } | null`. Pure: no state, no host, no clock, no module-level mutation. Returns `null` (meaning "do not freeze") for a non-string or empty `frontierText`, for a frontier of fewer than two blocks, or when no candidate survives the hard rules. Algorithm, in this order:

   a. `blocks = parseManuscript(frontierText)`. For each block `i`, `cumWords(i) = countWords(frontierText.slice(0, blocks[i].end))`.

   b. **Candidates.** Boundary `i` (the gap between block `i` and block `i+1`) is a candidate when all of: `i <= blocks.length - 2` (never cut after the last block — the frontier must retain at least one block, and the trailing block is the one that may still be in progress); `blocks[i].complete === true` (INV-6 — never cut through an incomplete block; only the trailing block can be incomplete, so this is belt and braces); and `cumWords(i) >= min`.

   c. **Reserved-literal blocks.** Derive `actor` by stripping one trailing `:` from `literal`, call `findTagLiteral(frontierText, actor)` and keep occurrences with `atBlockStart === true`; block `j` is *reserved* when `blocks[j].start` is one of those indices. Matching goes through `findTagLiteral` only — never through `blocks[j].actor`, never through `classifyActor` — because the broadened tag-header rule makes `She rose. Mara` a legal actor string (carry-forward, `docs/briefs/0004-tag-header-rule.md`). When `literal` is not a non-empty string, or is just `':'`, no block is reserved and selection proceeds on the remaining rules.

   d. **Hard rule (a), adjacency.** Reject candidate `i` when block `i` or block `i+1` is reserved.

   e. **Hard rule (b), dense run.** Reject candidate `i` when any block `j` with `i - (FREEZE_DENSE_RADIUS - 1) <= j <= i + FREEZE_DENSE_RADIUS` is reserved — i.e. with radius 2: blocks `i-1`, `i` on the near side and `i+1`, `i+2` on the far side. Rule (a) is a subset of this but is kept as its own named check so it can be asserted and tuned separately.

   Let `safe` = candidates surviving (d) and (e), in ascending block order. If `safe` is empty → return `null`.

   f. **Target.** `target = min + jitterOffset(seed, max - min)`, drawn **once per `selectCut` call**. `seed` is `jitterSeed` when it is a finite number, otherwise `countWords(frontierText)` — a default derived from the input, never from a clock or a random source, so `selectCut` stays a pure function of `(frontierText, literal, opts)`. `jitterOffset` is exactly:

   ```js
   function jitterOffset(seed, span) {
     if (!(span > 0)) return 0;
     let x = (Number.isFinite(seed) ? Math.trunc(seed) : 0) >>> 0;
     x = (x + 0x9e3779b9) >>> 0;
     x ^= x << 13; x >>>= 0;
     x ^= x >>> 17;
     x ^= x << 5;  x >>>= 0;
     return x % (span + 1);
   }
   ```

   g. **Within budget.** `inBudget = safe.filter(c => cumWords(c) <= max)`. If non-empty, apply the two soft preferences as filters, taking the **first non-empty** of:
   - F1: `bufferNext(i) && !sceneSeam(i)`
   - F2: `bufferNext(i)`
   - F3: `!sceneSeam(i)`
   - F4: `inBudget` itself
   and from that set choose the candidate minimising `Math.abs(cumWords(i) - target)`; ties break to the **lower** `cumWords`, then to the lower block index. F2 preceding F3 is what makes preference (c) outrank preference (d).
   - `bufferNext(i)` = `blocks[i + 1].kind === 'buffer'` — preference (c), PLAN §17's "mid-passage buffer boundaries".
   - `sceneSeam(i)` = `SENTENCE_FINAL.test(blocks[i].raw.replace(/\s+$/, '')) && isSceneOpening(blocks[i + 1])` — preference (d): a closed sentence followed by a blank line followed by something that reads as a scene opening is exactly PLAN §17's "scene closures / scene openings" pair.
   - `isSceneOpening(block)`: take `first` = the block's first line, trimmed. `true` when `SCENE_SEPARATOR.test(first)`. Otherwise `false` when `block.kind === 'tag'` (a tag header is a commitment, never a scene marker) or when `countWords(block.raw) > 6`. Otherwise `true` when the first line is **all caps** (it contains at least two letters and equals its own `toUpperCase()`) or **Title Case** (every whitespace-separated word whose first character is a letter has that character equal to its own uppercase form). This is an avowed heuristic, not a semantic judgement (`docs/protocol/invariants.md#inv-7`, "low-salience only").

   h. **Overrun.** If `inBudget` is empty, return the **first** (lowest block index) member of `safe`, with `overrun: true`. The soft preferences are not applied to an overrun choice: PLAN §16 permits overrunning *to reach a better block boundary*, so the first safe boundary past the ceiling is taken and nothing is searched beyond it.

   Return fields: `blockIndex` = the chosen `i`; `frozenEnd` = `blocks[i].end`; `index` = `blocks[i + 1].start` (where the remaining frontier begins); `words` = `cumWords(i)`; `target`; `overrun` = `words > max`.

3. `maybeFreeze(state, literal, opts = {})` → `{ frozenIndex, words, index, target, overrun, blockIndex } | null`. The only impure export, and impure only in that it mutates the `state` object it is handed. Steps: `cut = selectCut(state?.frontier, literal, opts)`; return `null` when it is `null`. `text = state.frontier.slice(0, cut.frozenEnd)`; `rest = state.frontier.slice(cut.index)` — everything after the boundary kept **verbatim**, including any trailing whitespace; the inter-block delimiter itself is a separator and is dropped. Call `pushFrozen(state, { text, words: cut.words })`; if it returns `false`, return `null` and leave `state.frontier` byte-identical (the frontier is never emptied by a refused span). Only on `true`, call `setFrontier(state, rest)` and return the result object with `frozenIndex = state.frozen.length - 1`. `createdAt` is deliberately **not** passed — `pushFrozen` fills it, which keeps `Date.now()` out of this module.

### `tests/freeze.test.js` (new)
Vitest, no host fake needed (the module takes no context). Include a local fixture builder that emits N blocks of known word count so a manuscript can be described compactly; most cases pass small `{ min, max }` via `opts` to keep fixtures readable, and at least one case runs on a generated manuscript at the real `FREEZE_MIN_WORDS`/`FREEZE_MAX_WORDS` defaults. Cases per the Acceptance list below.

### `docs/modules/freeze.md` (new)
Per "Docs to write/update".

## Out of scope (explicit)
- **Any call site.** No `index.js` change, no subscription, no MESSAGE_RECEIVED/GENERATION_ENDED hook, no interceptor change. `maybeFreeze` is called by nobody in this brief; the `recovery`/bootstrap wiring is a later brief.
- **Any persistence.** No `saveMetadata`, no `save()` from `src/state.js`, no `getState()`, no `getCtx()`, no `chatMetadata` access. The caller persists.
- **Pre-freeze lint (§20)** in any form — no warning, no flag, no report object, no "would be rejected" field, no gate on promotion. §20's own caveat and `docs/decisions/0001-prompt-level-grammar.md` make lint advisory to the editor; it is not implemented here or anywhere yet.
- **Semantic salience.** PLAN §17 also names emotional peaks, chapter-like resolutions, major POV resets and obvious narrative handoffs. Those are not mechanically detectable and must not be attempted — no sentiment scoring, no keyword lists, no LLM call, no `generateQuietPrompt`. The module implements the mechanical subset only (`docs/protocol/invariants.md#enforcement-model`).
- **Re-cutting, merging, splitting or removing frozen spans**; any `unfreeze`, `recut`, `compact` or `mergeSpans` export. INV-6 and PLAN §16 forbid it (it disturbs demonstrations, invalidates cache prefixes, rewrites transport statistics).
- **Token-based targets.** No `getTokenCountAsync`, no token estimate, no character-count target. PLAN §16 states the target in words and this module counts words.
- **Seeding (§19).** No seed span is written, read or special-cased; `frozen[0]` has no privileged meaning here.
- **Rewriting manuscript text.** No normalisation, no re-joining, no delimiter repair, no trimming of the frozen text beyond the offsets `parseManuscript` already reports.
- **Rolling back an incomplete trailing block** (INV-8) — `recovery`'s brief. This module only *declines* to cut at one.
- **Any setting, toggle, slider, UI control or `extensionSettings` read** for the target, jitter, radius or heuristics. Tuning means editing `src/constants.js`.
- **Anything keyed to the generation or authorship horizon** (§18): no count of generations, no count of external-character appearances, no elapsed time, no "freeze after N turns". The only input is frontier text plus the literal.
- **Changes to `src/grammar.js` or `src/state.js`**, including exporting `TERMINAL` or adding a `words` helper there. Both are import-only.
- **New dependencies**; changes to `package.json`, `vitest.config.js`, `eslint.config.js`, `manifest.json`, `tools/`.

## Files
- allowed to create/modify: `src/freeze.js`, `src/constants.js` (the three added literals only), `tests/freeze.test.js`, `docs/modules/freeze.md`, and this brief's Status line
- must not touch: `index.js`, `src/state.js`, `src/grammar.js`, `src/host.js`, `src/prompt.js`, `src/boundary.js` or any other `src/` file, `tests/bootstrap.test.js`, `tests/grammar.test.js`, `tests/state.test.js`, `tests/prompt.test.js`, `tests/preset.test.js`, `tests/helpers/*`, `PLAN.txt`, `CLAUDE.md`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, other `docs/briefs/*`, `presets/`, `tools/*`, `manifest.json`, `style.css`, `package.json`, `eslint.config.js`, `vitest.config.js`

## ST APIs used
- none. `docs/protocol/host-mapping.md#rows`, row "§16, §17 — Freeze at low-salience block boundary, append-only — pure function over canonical state; persist via `saveMetadata`" — the `saveMetadata` leg is explicitly the caller's, not this brief's (`docs/api/sillytavern.md#chat-metadata`, status: verified, cited for the record only; no code here calls it).
- `docs/protocol/host-mapping.md#s16-freeze` "Compiled once, remembered" — the behavioural consequence this module must not violate: a span, once pushed, is never recompiled from `chat[]` and never revisited.

## Verification needed
- (empty — the module uses no SillyTavern API.)

## Acceptance
- [x] `countWords` is defined once from `/\S+/g`; for a frozen span produced by `maybeFreeze`, `span.words` equals what `pushFrozen` would have computed had `words` been omitted (assert by freezing once with the returned value and once through `pushFrozen(state, { text })` on a fresh state and comparing).
- [x] **No freeze under min:** a frontier whose total word count is below `min` yields `selectCut(...) === null` and `maybeFreeze(...) === null`, with `state.frozen.length === 0` and `state.frontier` byte-identical.
- [x] **Cut avoids adjacency (a):** in a manuscript where the only near-target boundaries touch a reserved-literal block, the chosen `blockIndex` is such that neither `blocks[blockIndex]` nor `blocks[blockIndex + 1]` starts with the literal; a boundary immediately before, and one immediately after, a reserved block are both never returned.
- [x] **Dense-run avoidance (b):** with a reserved block two blocks away from an otherwise perfect boundary, that boundary is rejected and a boundary with no reserved block in `[i-1, i+2]` is returned.
- [x] **Block-start only:** a frontier containing `He turned. Mara: left.` inside a block and `"Mara: stop," he said.` as quoted prose does not treat those blocks as reserved — the cut may sit next to them; only a block *starting* with the literal is avoided.
- [x] **Buffer preference (c) outranks scene-seam preference (d):** given one in-budget candidate whose next block is a buffer but which is a scene seam, and one whose next block is a tag and is not a seam, the buffer candidate is chosen.
- [x] **Scene-opening heuristic:** each of `* * *`, `***`, `---`, `THE NEXT MORNING`, `Later That Evening` as a following block marks the boundary a seam; a seven-word Title Case sentence, a tag block, and an ordinary lowercase-opening buffer do not.
- [x] **Closest to target:** among equally preferred in-budget candidates the one with `|words - target|` smallest is returned, ties going to the lower word count and then the lower block index; changing only `jitterSeed` moves the selection to a different candidate for a fixture built to straddle the range.
- [x] **Overrun:** when every candidate at or below `max` is rejected by (a)/(b), the returned cut has `overrun === true`, `words > max`, and is the **first** safe boundary past `max` — not a later, better-scoring one.
- [x] **No candidate → null:** a frontier past `min` in which every boundary is adjacent to or dense with reserved blocks returns `null` from both exports and leaves `state` untouched.
- [x] **INV-6, incomplete trailing block:** a frontier whose last block ends mid-sentence is never cut after that block; `frozenEnd` always equals the `end` of a block with `complete === true`, the remaining frontier always retains at least one block, and `frontier.slice(0, frozenEnd)` satisfies `isTrailingBlockComplete`.
- [x] **Verbatim remainder:** after `maybeFreeze`, `state.frontier === original.slice(cut.index)` exactly, and `state.frozen.at(-1).text === original.slice(0, cut.frozenEnd)` exactly — no re-joining, no added or removed characters other than the dropped inter-block delimiter.
- [x] **Determinism under a seed:** ten calls to `selectCut` with identical `(frontierText, literal, { jitterSeed: 7 })` return deep-equal results; with `jitterSeed` omitted the result is still identical across calls (the default seed is derived from the text, not a clock or random source). `src/freeze.js` contains no occurrence of `Date.now`, `Math.random`, or `performance`.
- [x] **INV-10:** two different synthetic live histories that normalise to the same frontier string produce byte-identical frozen span text and identical remaining frontier; `selectCut` takes no argument other than text, literal and options, and `maybeFreeze` reads no field of `state` besides `frontier`/`frozen`.
- [x] **Refusal is safe:** if `pushFrozen` refuses (simulate with a state whose text would end mid-block), `maybeFreeze` returns `null` and `state.frontier` is unchanged — the frontier is never emptied without a corresponding frozen span.
- [x] **Defaults case:** on a generated manuscript of ~6,000 words with reserved blocks placed away from the 3,000–4,200 window, `maybeFreeze(state, literal)` with no options freezes a span whose `words` is within `[FREEZE_MIN_WORDS, FREEZE_MAX_WORDS]`.
- [x] `src/freeze.js` contains no occurrence of the identifier `SillyTavern`, no import of `./host.js`, and no call to `getState`, `save`, `saveMetadata` or `getCtx`.
- [x] `src/constants.js` gains exactly three exports and no other change.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/freeze.md` (new; header block `Owns: INV-6 (cut point), INV-7 (cut selection), INV-10 (with frontier)` / `PLAN: §16, §17, §18` / `Depends on: grammar, state, constants`), one heading per pointer comment, at least:
  - `## Target and jitter {#target-jitter}` — the 3,000–4,200 window as PLAN §16's advisory compiler-side number that never appears in the model-visible prompt; the exact `jitterOffset` draw, that it happens once per candidate freeze, and that the default seed is derived from the frontier text so the function stays pure.
  - `## Candidates {#candidates}` — boundaries are blank-line block gaps; why the last block is never a cut point; why `complete === true` is required (INV-6, PLAN §5 "the compiler never freezes through the middle of a complete block"); what `frozenEnd` and `index` mean and that the remainder is verbatim.
  - `## Salience heuristics {#salience-heuristics}` — the tunable list, in priority order, each with its constant and its PLAN §17 line: (a) adjacency to a reserved-literal block; (b) dense run within `FREEZE_DENSE_RADIUS`; (c) prefer a buffer as the following block; (d) avoid a closed sentence followed by a scene-marker-like opening, with the full mechanical definition of "scene opening" (separator line; else ≤ 6 words and all caps or Title Case; never a tag block). State plainly that (c) and (d) are preferences and (a)/(b) are hard rules, that these are heuristics admitted under `docs/protocol/invariants.md#inv-7` ("low-salience only") and that false positives cost only a different, equally safe cut. Record that `SENTENCE_FINAL` duplicates grammar's private `TERMINAL` because grammar exports no such helper, and that matching the reserved literal goes through `findTagLiteral` and never through the parsed actor string (`docs/briefs/0004-tag-header-rule.md` carry-forward).
  - `## Overrun and refusal {#overrun}` — PLAN §16's "may overrun to reach a better block boundary" as implemented (first safe boundary past `max`, preferences not applied); and that no safe boundary at all means no freeze, which is a normal outcome, not an error.
  - `## Word counting {#word-counting}` — `/\S+/g`, defined once, matching `pushFrozen`'s fill rule in `src/state.js`; why the letters-only regex in `tests/prompt.test.js` is not reused.
  - `## Purity and INV-10 {#purity}` — inputs are frontier text, literal and options; no clock, no randomness, no host, no `chat[]`; therefore many live histories collapse to the same frozen spans. Note the "compiled once, remembered" consequence (`docs/protocol/host-mapping.md#s16-freeze`): once pushed, a span is never recompiled, so later edits to `chat[]` cannot change it.
  - `## Three horizons {#three-horizons}` — PLAN §18: this module owns the transport horizon only; it is never keyed to how long a generation ran or to how often the external character acts, so dense external activity does not shorten spans and a long absence does not lengthen them.
  - `## What freeze does not decide {#not-decided}` — no lint gate (§20 is advisory, `docs/decisions/0001-prompt-level-grammar.md`), no semantic salience detection, no persistence, no caller. Name the later brief that wires it.
