# grammar
Owns: INV-1 (docs/protocol/invariants.md)
PLAN: §5, §7, §8, §14
Depends on: nothing

`src/grammar.js` is the only parser of manuscript text. It is pure: a string in, plain data out. No SillyTavern API, no state, no I/O, no configuration. Everything it answers is *structural* — where blocks begin and end, whether a block carries a tag header, how an actor name classifies against a caller-supplied membership set. Judgements about content (does this buffer introduce a commitment, does this tag commit someone else) belong to `lint`, not here.

## Block delimiter

A manuscript is a sequence of atomic blocks separated by a blank line (§5). The delimiter is a run of one or more lines that are empty or contain only spaces/tabs; `\r\n` counts the same as `\n`, so CRLF transcripts parse identically. A single newline inside a block is ordinary text and never splits it.

The blank line is the *only* delimiter. Nothing else — not a tag header, not terminal punctuation, not a horizontal rule — starts a new block. This matters because the freeze/recovery path must never cut mid-block (§14, INV-6): if a second delimiter existed, two modules could disagree about where a block ended and a cut could land inside one.

Leading and trailing whitespace of a segment is trimmed off before the block is recorded, and the block's `start`/`end` offsets are adjusted with it, so `text.slice(b.start, b.end) === b.raw` always holds and delimiters are never part of a block. Segments that are empty after trimming (leading or trailing blank lines of the whole text) yield no block, so empty or whitespace-only input yields no blocks at all.

## Tag header

A tag block is a block whose start matches `<tag>:` followed by whitespace or end-of-line — §5's `Anton: sets the cup down.`. The rule is confident matching, case-insensitively: any name-shaped run of characters at block start, immediately followed by `:` and then whitespace or end-of-block, is a tag, regardless of the initial character's case. The recognised shape is a module constant:

```js
/^(?!["“”'‘’«»])([\p{L}\p{N}][\p{L}\p{N} '’\-.]{0,39}):(?=\s|$)/u
```

- a first character that is a unicode letter or digit;
- then 0–39 further characters drawn from unicode letters, digits, space, `'`, `’`, `-`, `.` (so `Anton`, `anton`, `The Innkeeper`, `The tall woman in the doorway`, `Guard 2`, `Dr. Weiss`, `Jean-Luc`, `D'Vora`, `Élodie`, `Zoë` are all tags);
- immediately followed by `:`;
- followed by end-of-block or a whitespace character.

There are exactly two exclusions, both expressed by the pattern itself, and nothing more:

1. a block whose first character is a quote mark (`"`, `“`, `”`, `'`, `‘`, `’`, `«`) is never a tag — it is quoted prose, e.g. `"No," she said.`;
2. the tag part must be non-empty — a block beginning with `:` (e.g. `: nothing.`) is never a tag.

`12:30 by the clock.` remains a buffer for the reason that already applied: the colon is not followed by whitespace or end-of-line. There is no verb-detection or stop-word heuristic to rescue attribution-shaped prose — the user's rule is confident matching, and heuristics are refused.

The header is anchored at offset 0 of the block, and the character class contains no newline, so the tag part cannot span lines — a colon that appears only on the block's second line produces no header. A `Name:` further in is prose about someone, not a commitment by them, and a header that begins after leading whitespace is not at a block start at all. Anchoring is what keeps the tag/buffer split decidable from structure alone.

The accepted cost: a lowercase attribution such as `she said: "no"` at block start now parses as a tag block with actor `she said`. The seed span and the system prompt make that shape unlikely at block start, and a wrongly-tagged block is a legibility cost, not a safety one — nothing downstream grants authority on the strength of a tag's *case*. (Brief 0001's uppercase-initial narrowing, which existed to reject this shape, is superseded by brief 0004.)

Because `.` and space are both admitted tag characters, a block that opens with a complete sentence ending in a period, followed by a capitalised name and a colon — `He turned. Anton: left.` — matches the whole leading run `He turned. Anton` as the tag part, not just `Anton`. This is the same class of cost as the `she said:` case above: the pattern's job is confident structural matching of a name-then-colon shape at block start, not sentence boundary detection, and a wrongly-scoped tag is a legibility cost rather than a safety one.

The actor name is reported trimmed, exactly as matched, with **no lowercasing or other case normalisation** — `parseTagHeader` and `parseManuscript` apply no case transformation to any returned value. This matters because `boundary` builds its §8 stop literal from the persona name verbatim (`docs/protocol/host-mapping.md#s8-boundary`); an actor string normalised here could never be compared against that literal. `normalise()` exists only for the case-insensitive comparison inside `classifyActor`, below, and is never applied to a returned actor.

The body is the block text with the header and the whitespace that separates it from the body removed. A block with no valid header is `kind: 'buffer'`, `actor: null`, and its body is the whole block.

## Actor classification

An actor name classifies two ways against a set of *currently individuated* actors supplied by the caller (§7):

- `individual` — the name is in the supplied set (compared case-insensitively, after trimming). It commits exactly that character.
- `aggregate` — anything else. An aggregate tag (`The guards`, `The crowd`, `Everyone`) commits only those members who are not currently individuated, which is why the classification depends on the caller's set rather than on the name.

Membership is an argument, never module state: who is individuated changes as the manuscript advances, and that history belongs to the modules that track it. `grammar` must not cache, infer or default it — a stale set here would silently mis-classify a tag and let a commitment through.

A name like `Everyone` classifies as `aggregate` like any other unindividuated name; `grammar` has no notion of "universal" and no blocklist. Whether such a tag is discouraged or forbidden is regulated by the system prompt and the seed span, not by code (docs/decisions/0001-prompt-level-grammar.md, docs/protocol/invariants.md#enforcement-model).

## Tag literal lookup

`findTagLiteral(text, actor)` reports every occurrence of the literal `` `${actor}:` `` with its index and whether it starts a block. The name is always an argument. `grammar` has no notion of a reserved external character and contains no character name, so it cannot be the place a name leaks from.

The literal is bare — `Mara:`, not `\n\nMara:` (§8). The failure mode this exists to catch is an occurrence at offset 0 with no preceding newline, which a delimiter-prefixed search would miss. `atBlockStart` is computed from the parsed block starts, so the caller can distinguish "this block is tagged for that actor" from "that literal appears inside prose", and both are visible.

## Block completeness

A block followed by a blank-line delimiter is complete: the author moved on. Only the trailing block can be incomplete, and it is judged textually. After trimming trailing whitespace it is complete when

1. its last character is `.`, `!`, `?` or `…`, optionally followed by one or more of `"`, `”`, `'`, `’`, `)`, `]`, `*`; and
2. it contains an even number of `"` characters.

The test is textual because no finish reason is available: generation is streamed and cut at a stop sequence, so the only evidence of whether a sentence finished is the text itself. The quote-parity clause catches the common truncation inside spoken dialogue, where the punctuation test alone would pass.

This is the codebase's single definition of completeness. `freeze` and `recovery` call `isTrailingBlockComplete` / `lastCompleteBoundary` / `truncateToLastCompleteBlock` rather than re-deriving a rule (§14, INV-6, INV-8): two definitions would eventually disagree, and the disagreement would show up as a cut inside a block or a rollback that keeps a half-sentence.

`lastCompleteBoundary` returns the end offset of the last complete block, or `0` when no block is complete, so `truncateToLastCompleteBlock` can never return a partial block or a dangling delimiter.

## Spans {#spans}

A manuscript's paragraphs are not its ownership units. A header opens an **agency span** that persists across as many ordinary prose paragraphs as the passage needs, until the next header opens the next span (`PLAN-addendum-agency-spans.md` §2). `groupSpans(blocks)` takes exactly what `parseManuscript` returns and reports where those spans begin and end; it reads nothing else and is pure.

Two header forms open a span, and both are accepted for the same reason the tag rule is confident rather than clever:

- the own-line form, a bare `<tag>:` on the block's first line with the passage below it — `TAG_HEADER`'s `(?=\s|$)` lookahead already admits a newline, so the block parses as `kind: 'tag'` with the same actor it would have had inline;
- the legacy inline form, `<tag>: sets the cup down.`, which is what every chat written before spans existed contains. Dropping it would make old manuscripts re-group, so it stays.

The neutral header `∅:` (U+2205) needs its own test, `NEUTRAL_HEADER`, because `TAG_HEADER`'s first-character class is `[\p{L}\p{N}]` and `∅` is neither a letter nor a digit: a `∅:` block parses as `kind: 'buffer'` and would otherwise join the span in front of it. The literal is pinned; it is model-facing manuscript notation taught by the prompt, never something code inserts, suggests or repairs (addendum §5, §9).

Every block that is not a header block **joins the current span**. A run of header-less blocks before the first header is its own span with `header: null` — the ordinary shape of a manuscript that opens on narration.

The returned shape, in document order:

```js
[{ header, neutral, start, end, blockIndices }]
```

`header` is the parsed `actor` for a tag span, the string `'∅'` for a neutral span and `null` for a leading header-less run. `neutral` is `true` only for a `∅:` span. `start` is the first block's `start` and `end` the last block's `end`, so `text.slice(span.start, span.end)` covers exactly that span's blocks together with the delimiters between them. `blockIndices` is the ascending list of indices into the `blocks` array that was passed in. An empty `blocks` array yields `[]`.

`groupSpans` makes **no content judgement of any kind**. It does not decide whether prose is character narration or neutral narration, and contains no state machine that opens or closes a span on its own (addendum §3, §14). The two classifications it reports are "this block carries a header" and, for the caller, "this span's first block starts with the reserved literal" — which is `freeze`'s test, computed through `findTagLiteral`, not through `header` (`docs/modules/freeze.md#salience-heuristics`). Whether a neutral passage is warranted, or a character span has run too long, is a writing judgement the prompt elicits and the model performs.
