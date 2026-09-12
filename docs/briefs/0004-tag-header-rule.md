# Brief 0004 — Tag header: recognise any `name:` at block start, case-insensitively
Status: partial
Complexity: low
PLAN sections: §5 (a manuscript is atomic blocks separated by a blank line; a block is a tag block or a buffer block; the tag block's shape is `Anton: sets the cup down. "No."` — a name, a colon, then the block body), §8 (the reserved external literal is the bare tag `Mara:`, not `\n\nMara:`; the stop is keyed to the reserved tag syntax itself)
Invariants touched: INV-1 (tag/buffer split is what makes commitment legible), INV-2 (the boundary stop literal is the persona name verbatim, so the actor text this module returns must not be case-normalised)

## Goal
`parseTagHeader` implements the rule the user stated: a block whose start matches `<tag>:` followed by whitespace or end-of-line is a tag block, confidently, regardless of the initial character's case. The tag part is as encompassing as a regex sanely allows — multi-word, articles, digits, apostrophes, hyphens, periods, unicode letters — with only a small exclusion set for shapes that are obviously not tags. The previous uppercase-initial narrowing (brief 0001) is removed, together with the `she said: "no"` acceptance case that forced it; the documented cost is that a lowercase `she said:` at block start now parses as a tag, which the seed span and system prompt make an unlikely shape. The actor string is returned verbatim apart from trimming.

## In scope
- Replace the `TAG_HEADER` constant in `src/grammar.js` with exactly this pattern (unicode flag required):

  ```js
  // tag-header: any name-then-colon at block start is a tag → docs/modules/grammar.md#tag-header
  const TAG_HEADER = /^(?!["“”'‘’«»])([\p{L}\p{N}][\p{L}\p{N} '’\-.]{0,39}):(?=\s|$)/u;
  ```

  Read as: not opening with a quote mark; a first character that is a unicode letter or digit; then 0–39 further characters drawn from unicode letters, digits, space, `'`, `’`, `-`, `.`; then `:`; then whitespace or end of block. The character class contains no newline, so the tag part cannot span lines — the match is confined to the block's first line.
- Keep `parseTagHeader`'s current contract and body-stripping behaviour unchanged: `{ actor, body } | null`, actor `match[1].trim()`, body = block text after the header with the separating whitespace/newline removed. No lowercasing, no case folding, no other normalisation of `actor` — `boundary` builds its stop literal from the persona name verbatim (`docs/protocol/host-mapping.md#s8-boundary`), and an actor string that had been normalised here could not be compared against it.
- `normalise()` stays where it is: it is used only for the case-insensitive comparison inside `classifyActor` and must not be applied to returned actor text.
- Exclusion set is exactly two rules, both expressed by the pattern above, and nothing more:
  1. a block whose first character is a quote mark (`"`, `“`, `”`, `'`, `‘`, `’`, `«`) is never a tag — it is quoted prose;
  2. the tag part must be non-empty, i.e. a block beginning with `:` is never a tag.
  `12:30 by the clock.` remains a buffer for the reason that already applied and still applies: the colon is not followed by whitespace or end-of-line. A header after leading whitespace, or a `Name:` later in the block, remains a buffer through the existing `^` anchoring, which is unchanged.
- Update `tests/grammar.test.js`:
  - Change `expect(parseTagHeader('she said: "no"')).toBeNull()` to assert it now parses with `actor: 'she said'`, with a comment naming this brief as the reason.
  - Change the `makes the rejected shapes parse as buffer blocks` case: with input `'12:30 by the clock.\n\nshe said: "no"\n\nHe turned. Anton: left.'` the kinds are now `['buffer', 'tag', 'buffer']` and the actors `[null, 'she said', null]`. Rename the test so it no longer claims all three are rejected.
  - Add cases: lowercase single-word tag (`anton: waits.` → actor `anton`, preserved verbatim, not `Anton`); a long multi-word tag with an article (`The tall woman in the doorway: steps back.`); digits inside a tag (`Guard 2: nods.`); a period inside a tag (`Dr. Weiss: frowns.`); unicode letters (`Élodie: waits.`, `Zoë: waits.`); quote-initial rejection (`"No," she said.` → buffer); colon-initial rejection (`: nothing.` → buffer); a tag part longer than 40 characters → buffer; a colon appearing only on the block's second line → buffer.
  - Leave every other existing test unchanged, including `parseTagHeader('Anton:')` → `{ actor: 'Anton', body: '' }`. A header-only block stays a valid tag; the "colon followed by nothing" exclusion in the task statement is implemented as the empty-*tag* rule above, because an empty body is a §5-legal tag block and is already covered by an acceptance test of brief 0001 that this brief does not overturn.
- Rewrite `docs/modules/grammar.md#tag-header` to state the user's rule, the exact pattern, the two exclusions, the anchoring reason (unchanged), and the accepted cost in plain terms: a lowercase attribution such as `she said:` at block start now parses as a tag; the seed span and the system prompt make that shape unlikely, and a wrongly-tagged block is a legibility cost, not a safety one — nothing downstream grants authority on the strength of a tag's *case*. Note there that the actor is returned verbatim and why (§8 stop literal).

## Out of scope (explicit)
- Any change to the block delimiter, completeness rule, `classifyActor`, `findTagLiteral`, or the boundary helpers.
- A "looks like a sentence" / verb-detection / stop-word heuristic to rescue `she said:`. The user's rule is confident matching; heuristics are refused.
- Any option, setting, flag or caller-supplied pattern for what counts as a tag. The pattern is a module constant.
- Warning, linting or flagging suspicious tags; `grammar` reports structure only (`docs/protocol/invariants.md#enforcement-model`).
- Escaping or rewriting manuscript text.
- Editing `docs/briefs/0001-grammar-module.md`. Its acceptance line naming `she said: "no"` is superseded by this brief and is left as historical record.
- Any SillyTavern API, state, I/O, or a character name in `src/grammar.js` — the purity test stays green.
- Changes to `index.js`, other `src/` modules, `package.json`, tooling or config.

## Files
- allowed to create/modify: `src/grammar.js`, `tests/grammar.test.js`, `docs/modules/grammar.md`
- must not touch: `PLAN.txt`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, `docs/briefs/*` (except this brief's Status line), `index.js`, any other `src/` file, `package.json`, `eslint.config.js`, `vitest.config.js`, `tools/*`

## ST APIs used
- none — `docs/protocol/host-mapping.md#rows`, row "§5–§7, §20 — Grammar structure — pure functions, no ST API"

## Verification needed
- (empty)

## Acceptance
- [x] `parseTagHeader('she said: "no"')` returns `{ actor: 'she said', body: '"no"' }`.
- [x] `parseTagHeader('anton: waits.').actor === 'anton'` — the actor is returned with its original case, never lowercased.
- [x] `The tall woman in the doorway:`, `Guard 2:`, `Dr. Weiss:`, `Élodie:`, `Jean-Luc:`, `D'Vora:`, `The Innkeeper:` all parse as tags with the actor text verbatim.
- [ ] `"No," she said.`, `: nothing.`, `12:30 by the clock.`, `  Anton: sets the cup down.`, `He turned. Anton: sets the cup down.` all parse as buffers. — the first four hold; the fifth does not: the mandated pattern (`. ` and space both admitted tag characters) matches `He turned. Anton:` as a tag (`actor: 'He turned. Anton'`). This is a contradiction between the brief's exact-pattern requirement and this acceptance line, not an implementation choice; the pattern was kept verbatim as specified and the conflict is documented in `docs/modules/grammar.md#tag-header` and covered by a test.
- [x] A tag part of 41+ characters parses as a buffer; a colon that appears only on the block's second line does not produce a header.
- [x] `src/grammar.js` applies no case transformation to any value returned from `parseTagHeader` or `parseManuscript`.
- [x] `docs/modules/grammar.md#tag-header` states the rule, the pattern, the two exclusions and the accepted `she said:` cost, and no longer claims an uppercase initial is required.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/grammar.md#tag-header` — rewritten per the In-scope bullet: the user's confident-match rule, the exact pattern and what each part admits, the two exclusions and why they are the only ones, why the header stays anchored at block start, the accepted cost of lowercase attributions parsing as tags, and that the actor is returned verbatim because `boundary`'s stop literal is the persona name verbatim (§8).
