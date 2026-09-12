# Brief 0001 — Manuscript grammar: block parsing, tag actors, aggregate/universal tags, block boundaries
Status: done
Complexity: high
PLAN sections: §5 (manuscript = atomic blocks separated by a blank line; a block is a tag block or a buffer block; never freeze mid-block), §7 (aggregate tags commit only currently unindividuated members; universal tags such as `Everyone:` are forbidden), §8 (the reserved external tag is the bare literal `Mara:`, not `\n\nMara:`; ordinary manuscript content may not contain that literal), §14 (rollback to the last complete block boundary when the trailing block is incomplete — reason for the boundary helpers only; recovery policy is not implemented here)
Invariants touched: INV-1, INV-9 (and INV-6/INV-8 are served by the boundary helpers this module exposes)

## Goal
`src/grammar.js` exists as the single pure parser for manuscript text: given a string it yields an ordered list of atomic blocks, each classified as a tag block (with its actor name) or a buffer block, and it answers the two structural questions other modules need — where the last complete block ends, and whether the trailing block is complete. It also classifies a tag actor as individual / aggregate / forbidden-universal given a caller-supplied set of individuated actors, and can report occurrences of an arbitrary tag literal (so `boundary` can ask about the reserved external character without `grammar` knowing who that is). No SillyTavern API, no state, no I/O, no configuration.

## In scope
- Create `src/grammar.js` (ES module, named exports only) with exactly these exports:
  - `parseManuscript(text)` → `Block[]`. Blocks are split on the blank-line delimiter (§5): a run of one or more lines that are empty or whitespace-only. Each `Block` is `{ kind: 'tag' | 'buffer', actor: string | null, body: string, raw: string, start: number, end: number, complete: boolean }`, where `start`/`end` are offsets into `text` for `raw` (delimiters excluded), `body` is the block text with a tag header removed, and `complete` is `true` for every block except possibly the last (see below).
  - `parseTagHeader(blockText)` → `{ actor, body } | null`. Recognises a tag header at offset 0 of the block only (§5 example `Anton: sets the cup down.`). Actor pattern is a module constant, documented in `docs/modules/grammar.md`: starts with a letter, then letters/digits/spaces/`-`/`'`, length 1–40, immediately followed by `:` and then end-of-block or a whitespace character. No other shape is a tag.
  - `classifyActor(actor, individuatedActors)` → `'universal' | 'individual' | 'aggregate'`. `'universal'` if the actor matches the forbidden-universal list; else `'individual'` if it is in the caller-supplied `individuatedActors` (case-insensitive, may be an array or a Set); else `'aggregate'` (§7).
  - `FORBIDDEN_UNIVERSAL_TAGS` — frozen array of exactly `['everyone', 'everybody', 'all']`, compared case-insensitively (§7, INV-9). Extending the list requires a later brief.
  - `findForbiddenUniversalTags(blocks)` → array of the tag blocks whose actor classifies as `'universal'` (INV-9 detection surface for `lint`).
  - `findTagLiteral(text, actor)` → array of `{ index, atBlockStart }` for every occurrence of the literal `` `${actor}:` `` in `text`; `atBlockStart` is true when the occurrence begins a block. Caller supplies the name; the module has no notion of an external character (§8).
  - `isTrailingBlockComplete(text)` → boolean, per the completeness rule below.
  - `lastCompleteBoundary(text)` → offset such that `text.slice(0, offset)` ends at a complete block boundary (`0` when no block is complete).
  - `truncateToLastCompleteBlock(text)` → `text.slice(0, lastCompleteBoundary(text))` with trailing whitespace trimmed.
- Completeness rule (one place, documented in `docs/modules/grammar.md`): a block that is followed by a blank-line delimiter is complete. The trailing block is complete only if, after trimming trailing whitespace, (a) its last character is one of `.`, `!`, `?`, `…` optionally followed by one or more of `"`, `”`, `'`, `’`, `)`, `]`, `*`, and (b) it contains an even number of `"` characters. Otherwise it is incomplete. This is the only completeness definition in the codebase; `recovery` and `freeze` will call it rather than re-deriving one.
- Empty or whitespace-only input yields `[]`, `lastCompleteBoundary === 0`, `isTrailingBlockComplete === false`.
- Pointer comments only, per `docs/workflow/comment-policy.md`, each resolving to a heading in `docs/modules/grammar.md`.
- Create `tests/grammar.test.js` (vitest) covering: blank-line splitting including multi-blank-line and CRLF input; tag vs buffer classification; actor names with spaces/hyphens/apostrophes; non-tags that must not parse as tags (`12:30`, a mid-block `Name:`, a colon inside prose, a leading-whitespace header); `classifyActor` for all three outcomes; `FORBIDDEN_UNIVERSAL_TAGS` detection via `findForbiddenUniversalTags`; `findTagLiteral` finding a bare literal at the very start of the text with no preceding newline (§8 failure mode) and distinguishing `atBlockStart`; complete/incomplete trailing blocks including unbalanced quote; `lastCompleteBoundary` / `truncateToLastCompleteBlock` on both complete and truncated manuscripts; empty input.
- Create `docs/modules/grammar.md` with the header shape required by `docs/modules/README.md` and one heading per pointer comment written.

## Out of scope (explicit)
- Any judgement about *content*: whether a buffer introduces a voluntary commitment, whether a tag commits another character, cross-character commitment, formatting drift — all of that is `lint` (§20) and must not appear here.
- Membership tracking for aggregates (who is currently individuated). `grammar` receives the set as an argument and never maintains or infers it.
- Knowing, storing, defaulting or hard-coding the external character's name (§8). No `MARA`, no "reserved actor" constant.
- Durable-commitment modelling (§6).
- Cut selection, salience scoring, freezing, transport targets (§16, §17).
- Rollback/recovery behaviour, generation-outcome classification (§14) — only the boundary helpers those modules will call.
- Escaping or rewriting manuscript text; all functions are read-only over their input.
- Any SillyTavern API, `getContext()`, events, persistence, DOM, UI.
- Options objects, settings, configurable delimiters or configurable universal-tag lists.
- New dependencies; no changes to `package.json`, `eslint.config.js`, `vitest.config.js`.
- `index.js`, `manifest.json`, or any other `src/` module.

## Files
- allowed to create/modify: `src/grammar.js`, `tests/grammar.test.js`, `docs/modules/grammar.md`
- must not touch: `PLAN.txt`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/briefs/*` (except setting this brief's Status), `package.json`, `eslint.config.js`, `vitest.config.js`, `tools/*`, `index.js`, any other `src/` file

## ST APIs used
- none — `docs/protocol/host-mapping.md#rows` row "§5–§7, §20: pure functions, no ST API"

## Verification needed
- (empty)

## Acceptance
- [x] `parseManuscript` splits on blank-line delimiters and round-trips: for every block, `text.slice(b.start, b.end) === b.raw`.
- [x] A tag block reports its actor and a body with the header removed; a block with no valid header is `kind: 'buffer'` with `actor: null`.
- [x] `12:30 by the clock.`, `she said: "no"`, and a block whose `Name:` appears after the first character all parse as buffers.
- [x] `classifyActor('Everyone', [...])` is `'universal'` regardless of the supplied set; an actor in the supplied set is `'individual'`; any other is `'aggregate'`.
- [x] `findTagLiteral('Mara: steps in.', 'Mara')` returns one occurrence with `atBlockStart === true` and `index === 0` (the §8 no-leading-newline case).
- [x] `isTrailingBlockComplete` is false for a manuscript ending mid-sentence or with an odd number of `"`, true for one ending in terminal punctuation (with optional closing quote).
- [x] `truncateToLastCompleteBlock` on a manuscript whose last block is incomplete returns exactly the earlier blocks with no partial block and no trailing delimiter; on a fully complete manuscript it returns the whole trimmed text.
- [x] `src/grammar.js` contains no reference to `SillyTavern`, `getContext`, `window`, `document`, or any character name.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/grammar.md#block-delimiter` — what separates blocks and why the blank line is the only delimiter (§5).
- `docs/modules/grammar.md#tag-header` — the actor pattern, why it is anchored at block start, and the non-tag cases it deliberately rejects.
- `docs/modules/grammar.md#actor-classification` — individual vs aggregate vs universal, why membership is a caller argument, and how this serves INV-9 (§7).
- `docs/modules/grammar.md#tag-literal-lookup` — why the literal lookup takes the name as an argument and never knows the external character (§8).
- `docs/modules/grammar.md#block-completeness` — the exact completeness rule, why it is textual (no finish reason exists), and that `freeze`/`recovery` must not define their own (§14, INV-6, INV-8).

## Carry-forward (from scope audit)
- INV-9 detector blind spot: tag headers require an uppercase initial, so a lowercase `everyone:` block parses as a buffer and `findForbiddenUniversalTags` will not report it. The `lint` brief must add a case-insensitive universal-tag scan over buffer-leading words. See docs/modules/grammar.md#tag-header.
