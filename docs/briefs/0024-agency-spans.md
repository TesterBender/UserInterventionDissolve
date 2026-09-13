# Brief 0024 — carry the agency-span grammar in code
Status: draft
Complexity: high
PLAN sections: §5 (a manuscript is atomic blocks separated by a blank line; a block is a tag block or a buffer block; the compiler never freezes through the middle of a complete block), §9 (the collaborator's input is transformed into manuscript text and merged after the model-generated material, never left as a user turn), §17 (transport cuts may correlate with low-salience structure — mid-passage buffer boundaries, ordinary non-climactic transitions — and must avoid immediately before/after the external character, dense external runs, scene openings and closures), plus `PLAN-addendum-agency-spans.md` §2 (a character header opens a span that persists across paragraphs), §3 (the application recognises headers only where ownership protection needs it and never judges prose as character vs neutral), §9 (the host may recognise `∅:` structurally for safe cut selection; it must never manufacture a neutral buffer), §10 (lint stays advisory — not implemented), §12 (transport must not become aligned with every agency transition), §14 (no state machine deciding when narration enters or leaves neutral scope)
Invariants touched: INV-1 (commitment occurs through ownership-safe tag blocks — "block" now reads as "span", `docs/protocol/invariants.md#agency-spans`), INV-7 (transport cuts avoid the external character — the avoided unit becomes the external character's *span*, not a single block)

## Goal
The three modules that already parse manuscript structure carry the agency-span grammar: `grammar` can group parsed blocks into spans opened by an own-line header (`Anton:` on its own line, or the legacy inline `Tag: text` form so existing chats still parse) and by the neutral header `∅:`; `derive` tags the collaborator's contribution with an own-line header so a multi-paragraph message stays one contribution under one owner; and `freeze` selects cuts over spans rather than blocks, so it never cuts inside or beside the external character's span however long that span runs, prefers span starts (neutral first) when one is in budget, and still cuts at ordinary paragraph gaps inside non-external spans so transport does not line up with every agency transition. Nothing in this brief judges prose as character-owned or neutral: the only classifications are "this block opens a span" and "this span's opening block starts with the reserved literal".

## In scope

### `src/grammar.js`
- Add a module-private `NEUTRAL_HEADER = /^∅:(?=\s|$)/u`, with a pointer comment resolving to `docs/modules/grammar.md#spans`. `∅` (U+2205) is outside `TAG_HEADER`'s first-character class, so it needs its own test; `TAG_HEADER` itself is **unchanged**.
  - The literal `∅:` is pinned. Do not reword during implementation. A user-requested change goes through the pinned-string lane (`docs/workflow/workflow.md#pinned-string-lane`) as an amendment to this brief.
- Add one export, `groupSpans(blocks)`, pure, taking the array `parseManuscript` returns and reading nothing else:
  - A block **opens a span** when `block.kind === 'tag'` (which already covers both the own-line `Anton:\n…` form — `TAG_HEADER`'s lookahead accepts a newline — and the legacy inline `Anton: …` form) or when `NEUTRAL_HEADER.test(block.raw)`.
  - Every other block **joins the current span**.
  - A run of header-less blocks before the first opener is its own span with `header: null`.
  - Returns `[{ header, neutral, start, end, blockIndices }]` in document order, where `header` is `block.actor` for a tag span, the string `'∅'` for a neutral span and `null` for a leading header-less run; `neutral` is `true` only for a `∅:` span; `start` is the first block's `start` and `end` the last block's `end`; `blockIndices` is the ascending list of indices into `blocks`. An empty `blocks` array yields `[]`.
  - No content judgement of any kind: no attempt to decide whether prose is character narration or neutral narration (addendum §3, §14).

### `src/derive.js`
- `toManuscriptBlock(text, literal)` returns `` `${literal}\n${trimmed}` `` instead of `` `${literal} ${trimmed}` ``. The header sits on its own line and the collaborator's paragraphs follow verbatim below it, so a multi-paragraph message is one contribution under one header (addendum §2, §3; PLAN §9).
- The existing "already opens with that tag" short-circuit is kept and now accepts **either** form: `parseTagHeader` already matches `Mara:\ntext` and `Mara: text` alike, so the current `header.actor` comparison needs no change — confirm it and leave it. The tag is never doubled.
- Everything else in the function is unchanged: non-string / empty / whitespace-only input still yields `''`; an empty literal still yields the untagged trimmed text; a first block carrying a *different* actor's tag is still prefixed (now as `Mara:\nAnton: he looks up.`).
- `sourceStart` continues to be `null` for a block that gained a header, for the same reason as before (the derived block contains characters that are not in `mes`); no change to the segment loop.

### `src/freeze.js`
- Build `spans = groupSpans(blocks)` and a block-index → span-index map from `span.blockIndices`.
- Replace `reservedBlocks` with **reserved spans**: span `k` is reserved when its **first** block's `start` is one of the `findTagLiteral(frontierText, actor)` hits with `atBlockStart === true`. Matching goes through `findTagLiteral` only — never `span.header`, never `block.actor`, never `classifyActor` (carry-forward from `docs/briefs/0004-tag-header-rule.md`: `She rose. Mara` is a legal actor string). An absent, empty or bare-`':'` literal reserves nothing.
- **Rule (a), adjacency** becomes: reject candidate boundary `i` when the span containing block `i` or the span containing block `i + 1` is reserved. A cut therefore never lands inside the external character's span, however many paragraphs it runs.
- **Rule (b), dense run** counts spans: let `a` be the span index of block `i` and `b` the span index of block `i + 1`; reject when any span `k` with `a - (FREEZE_DENSE_RADIUS - 1) <= k <= b + (FREEZE_DENSE_RADIUS - 1)` is reserved. `FREEZE_DENSE_RADIUS` keeps its value; only its unit changes. (a) remains a subset of (b) and stays a separately named check.
- **Rule (c)** is replaced. `bufferNext` is deleted. Define `spanStart(i)` = block `i + 1` is the first block of its span, and `neutralStart(i)` = block `i + 1` is the first block of a span with `neutral === true`. The survivor set is the first non-empty of, in order:
  1. `neutralStart(i) && !sceneSeam(i)`
  2. `neutralStart(i)`
  3. `spanStart(i) && !sceneSeam(i)`
  4. `spanStart(i)`
  5. `!sceneSeam(i)`
  6. `inBudget` itself
  Tiers 5 and 6 contain the ordinary paragraph gaps inside non-external spans, which remain full candidates: because spans routinely run several paragraphs, most in-budget windows contain no span start at all and the cut falls mid-span, which is what keeps transport from coinciding with every agency transition (addendum §12). Within the chosen tier the tie-break is unchanged: smallest `|cumWords(i) - target|`, then lower `cumWords`, then lower block index.
- **Rule (d)** keeps its heuristic, with one consistency fix: `isSceneOpening(block)` must return `false` for a block that **opens a span** — today it returns `false` for `block.kind === 'tag'`, and that clause is extended to a `∅:` opener (otherwise `∅:` alone on the first line passes the Title-Case test, since it contains no letters, and rule (d) would fight rule (c)). `SCENE_SEPARATOR`, the ≤ 6-word limit, the all-caps and Title-Case tests are otherwise untouched.
- Overrun behaviour, candidate hard requirements (`i <= blocks.length - 2`, `blocks[i].complete`, `cumWords >= min`), jitter, `countWords`, `maybeFreeze`, the watermark mapping and `noticeFrozenEdit` are all unchanged.

### Tests
- `tests/grammar.test.js` — `groupSpans`: own-line header opens a span; legacy inline header opens a span; following header-less blocks join it; `∅:` opens a span with `neutral === true`; a leading header-less run is a span with `header: null`; two consecutive header blocks are two one-block spans; offsets satisfy `frontier.slice(span.start, span.end)` covering exactly its blocks; `groupSpans([])` is `[]`.
- `tests/derive.test.js` — update the existing expectations to the own-line form (`'Mara:\nsets the cup down. "No."'`, `'Mara:\nAnton: he looks up.'`, and the `deriveFrontier` cases at lines ~130 and ~163); add: a multi-paragraph user message becomes one block with one header and byte-identical paragraphs below; input already headed in the own-line form and input already headed in the inline form are both left alone; empty literal still yields untagged text.
- `tests/freeze.test.js` — a long multi-block external span is never cut inside or adjacent to, at any `jitterSeed`; a `∅:` span start in budget wins over a non-neutral span start and over a mid-span gap at the same distance tier; a mid-span paragraph gap inside a non-external span is still returned when no span start is in budget; dense-run rejection counted in spans; the INV-6, overrun, determinism and INV-10 cases continue to pass unchanged.
- `tests/frontier.test.js` — update any fixture or expectation that embeds the old `"Mara: "` inline derive output; no new behaviour asserted there.

### Docs
Per "Docs to write/update" below.

## Out of scope (explicit)
- **Deleting `classifyActor`.** Finding, for the record: after this brief its only consumers are `tests/grammar.test.js` and prose in `docs/modules/{grammar,boundary,freeze}.md` plus `docs/decisions/0001`; `src/freeze.js`, `src/derive.js` and `src/boundary.js` do not call it. Removing it would require editing `docs/modules/boundary.md`, which is outside this brief's file set, and the doc sentences that name it ("matching never goes through `classifyActor`") are load-bearing guidance. Report it as a `SCOPE_GAP`; do not delete it here.
- **Any change to `TAG_HEADER`**, the block delimiter, the completeness rule, `findTagLiteral`, `parseTagHeader`, `lastCompleteBoundary` or `truncateToLastCompleteBlock`.
- **Any change to the stop string or the boundary check.** `src/boundary.js` keeps detecting the reserved literal at a *block* start; an own-line header still starts a block, so nothing there moves (INV-2).
- **Any change to recovery.** Rollback stays at the last complete block (paragraph-level), not at the last complete span (INV-8).
- **Prompt, seed or starter text.** Teaching the model own-line headers and `∅:` is `prompt`/`starter` work and belongs to a later brief; `∅:` must never be inserted, suggested or repaired by code (addendum §5, §9).
- **Any lint.** No advisory flag, warning, report field or "neutral buffer misused" check (addendum §10, `docs/decisions/0001-prompt-level-grammar.md`, `docs/protocol/invariants.md#enforcement-model`).
- **Manufacturing or splitting spans.** No code path inserts a neutral header, closes a span, splits a character span, or re-tags an existing block (addendum §9, §14).
- **Judging prose.** No sentiment, keyword, verb or agency detection; no model call.
- **Making span boundaries the transport unit.** Freezing still cuts at block boundaries; spans only rank and reject them (INV-6 unchanged).
- **Settings, toggles or constants tuning.** `FREEZE_DENSE_RADIUS`, `FREEZE_MIN_WORDS`, `FREEZE_MAX_WORDS` keep their values and stay module constants.
- **New exports** beyond `groupSpans`; no `spanIndexOf`, `currentOwner`, `spanText` or similar helper with one consumer.
- **New dependencies**; no change to `package.json`, `eslint.config.js`, `vitest.config.js`, `manifest.json`, `tools/`.

## Files
- allowed to create/modify: `src/grammar.js`, `src/derive.js`, `src/freeze.js`, `tests/grammar.test.js`, `tests/derive.test.js`, `tests/freeze.test.js`, `tests/frontier.test.js`, `docs/modules/grammar.md`, `docs/modules/derive.md`, `docs/modules/freeze.md`, `docs/protocol/host-mapping.md` (the one added line in `#s9-capture` only), `docs/decisions/0005-agency-spans.md` (new), `docs/decisions/README.md` (one added list line), and this brief's Status line
- must not touch: `src/prompt.js`, `src/starter.js`, `src/boundary.js`, `src/recovery.js`, `index.js`, `src/state.js`, `src/constants.js`, `src/frontier.js`, `src/capture.js`, `src/host.js`, `src/ui/*`, `presets/`, `tools/*`, `PLAN.txt`, `PLAN-addendum-agency-spans.md`, `CLAUDE.md`, `docs/api/sillytavern.md`, `docs/protocol/invariants.md`, `docs/modules/boundary.md`, `docs/modules/recovery.md`, other `docs/briefs/*`, other `docs/decisions/*`, `tests/boundary.test.js`, `tests/recovery.test.js`, `tests/state.test.js`, `tests/starter.test.js`, `tests/prompt.test.js`, `tests/bootstrap.test.js`, `style.css`

## ST APIs used
- none. All three modules are pure and take no SillyTavern context; `src/grammar.js`, `src/derive.js` and `src/freeze.js` must continue to contain no occurrence of the identifier `SillyTavern` (asserted by `tests/bootstrap.test.js`).

## Verification needed
- (empty — no SillyTavern API is involved.)

## Acceptance
- [ ] `groupSpans` groups own-line headers, legacy inline headers and `∅:` correctly, marks only `∅:` spans `neutral`, gives a leading header-less run `header: null`, and returns `[]` for `[]`.
- [ ] `TAG_HEADER` in `src/grammar.js` is byte-identical to its pre-brief form; `parseManuscript`, `parseTagHeader`, `findTagLiteral`, `isTrailingBlockComplete`, `lastCompleteBoundary` and `truncateToLastCompleteBlock` are unchanged.
- [ ] `toManuscriptBlock('sets the cup down.', 'Mara:')` is `'Mara:\nsets the cup down.'`; a two-paragraph input yields one block whose text after the first newline is byte-identical to the trimmed input; `'Mara:\nshe waits.'` and `'Mara: she waits.'` are both returned unchanged; an empty literal still yields the untagged trimmed text.
- [ ] `src/derive.js` contains no occurrence of the old `` `${literal} ` `` space-joined form.
- [ ] A frontier containing a six-block span opened by the reserved literal yields no cut with `blockIndex` inside that span or immediately before/after it, for every `jitterSeed` in a swept range.
- [ ] With a `∅:` span start and a character span start both in budget and neither a scene seam, the `∅:` boundary is chosen; with only non-neutral span starts in budget, a span start is chosen over a mid-span gap; with no span start in budget, a mid-span paragraph gap inside a non-external span is returned rather than `null`.
- [ ] `isSceneOpening` returns `false` for a `∅:` opening block and for a tag-header opening block; the `SCENE_SEPARATOR`, all-caps and Title-Case cases from brief 0011 still pass.
- [ ] The INV-6 (never cut at an incomplete trailing block), overrun, determinism-under-seed, verbatim-remainder and INV-10 cases in `tests/freeze.test.js` still pass unmodified in substance.
- [ ] `npm run check` passes.
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/grammar.md` — new `## Spans {#spans}`: a header opens a span that persists across paragraphs until the next header; both accepted header forms and why the legacy inline form is still accepted; `∅:` needs its own regex because `TAG_HEADER`'s first-character class excludes U+2205; the returned shape; and the explicit statement that `groupSpans` performs no content judgement (addendum §3, §14) — it reports where headers are, nothing about what the prose means. Keep `## Actor classification` as it stands.
- `docs/modules/derive.md#transformation-rule` — rewrite to the own-line header, plus a new `## Own-line header {#own-line-header}` explaining why the header is on its own line (a multi-paragraph contribution stays one contribution under one owner, PLAN §9 + addendum §2), that both header forms are recognised so the tag is never doubled, and that `sourceStart` is still `null` for a headed block.
- `docs/modules/freeze.md#salience-heuristics` — rewrite (a), (b) and (c) in span terms: adjacency and dense-run are computed over reserved *spans*; the new preference ladder with `∅:` first and the within-tier tie-break; and a paragraph on addendum §12 — why intra-span paragraph gaps stay candidates and why span starts are a preference rather than a rule. Update (d) for the span-opener exclusion. Keep the `findTagLiteral`-not-`classifyActor` paragraph and extend it to spans (the *first block* of the span is what is tested).
- `docs/protocol/host-mapping.md#s9-capture` — one added line: the collaborator's captured input is tagged with an own-line header, so a multi-paragraph contribution enters the manuscript as one agency span.
- `docs/decisions/0005-agency-spans.md` (new, template in `docs/decisions/README.md`) — Decision: what moved into code (span grouping, own-line tagging, span-aware cut selection) and what stays prompt-level (when to open a span, when `∅:` is warranted, whether a neutral passage is misused); Alternatives rejected: an owner state machine (addendum §14), a neutral-buffer lint (addendum §10), making span boundaries the transport unit (addendum §12), deleting `classifyActor` in this brief; Consequences: `∅:` is a pinned literal in `src/grammar.js`, cuts can no longer land inside a long external span so freezes may be postponed more often, and old chats keep parsing because the inline header form is still accepted.
- `docs/decisions/README.md` — one line added to the Records list.
