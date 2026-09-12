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

A tag block is a block whose first characters are an actor name followed by a colon — §5's `Anton: sets the cup down.`. The recognised shape is a module constant:

- an uppercase letter, then 0–39 further characters drawn from letters, digits, spaces, `-` and `'` (so `Anton`, `The Innkeeper`, `Jean-Luc`, `D'Vora` are actors);
- immediately followed by `:`;
- followed by end-of-block or a whitespace character.

The header is anchored at offset 0 of the block. A `Name:` further in is prose about someone, not a commitment by them, and a header that begins after leading whitespace is not at a block start at all. Anchoring is what keeps the tag/buffer split decidable from structure alone.

Deliberately rejected non-tags: `12:30 by the clock.` (starts with a digit, and the colon is not followed by whitespace), `she said: "no"` (lowercase initial — dialogue attribution in prose, not an actor name), and any block whose colon appears after the first character. The uppercase requirement is what separates an actor name from a mid-sentence clause opener; it costs the ability to tag a lowercase-named actor, which the protocol does not use.

The actor name is reported trimmed, and the body is the block text with the header and the whitespace that separates it from the body removed. A block with no valid header is `kind: 'buffer'`, `actor: null`, and its body is the whole block.

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
