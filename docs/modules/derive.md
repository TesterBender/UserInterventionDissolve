# derive
Owns: INV-3, INV-4, INV-10 (docs/protocol/invariants.md)
PLAN: §9, §10, §12
Depends on: constants, grammar

`src/derive.js` computes the mutable frontier. It is not stored anywhere: the frontier is a pure function of the visible `chat[]` and the two fields of canonical state that say how much of that chat has already been compiled (`frozenIds`, `watermark`, `docs/modules/state.md#shape`). `deriveFrontier` is called once per request by `frontier` (`docs/modules/frontier.md#total-reconstruction`) and by nothing else. The module also owns the message ids that let a frozen span name the messages it consumed.

## Derivation rule {#derivation-rule}

`deriveFrontier(chat, state, literal)` walks `chat` in order and keeps a block per surviving message.

A message is **skipped** when it is not an object, its `mes` is not a string, `is_system === true` (ST's own prompt-exclusion filter, `docs/api/sillytavern.md#message-shape`), or its id is listed in `state.frozenIds` — its text has already been compiled into a frozen span and must not be sent twice. A message with no id at all is never in `frozenIds`, so a brand-new message that nothing has touched yet is included, which is what makes an ordinary send work with no bookkeeping in front of it.

The **source text** is `mes`, except for the single message named by `state.watermark.messageId`: that one message was cut through by a freeze, and only the part after the cut is still mutable, so the source is `mes.slice(watermark.offset)`. A watermark whose `offset` is not a finite number greater than zero takes the whole message.

The **transform** is INV-3: a message with `is_user === true` becomes `toManuscriptBlock(source, literal)` (`#transformation-rule`), so the collaborator's turn enters the manuscript as a tagged block of the external character. Any other message contributes `source.trim()` verbatim — the model's own text needs no transform, because `boundary` has already trimmed the reserved literal off the message itself (`docs/modules/boundary.md#receipt-trim`) and `recovery` has already rolled an incomplete trailing block out of the message itself (`docs/modules/recovery.md#rollback`).

A block that is empty after the transform contributes nothing: no text, no delimiter, no segment. The surviving blocks are joined with `BLOCK_DELIMITER` (`docs/modules/grammar.md#block-delimiter`) into `text`.

`segments` is the parallel list `[{ id, start, end, sourceStart }]`, in the same order, with `start`/`end` character offsets into `text` and `end` exclusive, so `text.slice(start, end)` is exactly that message's block; `id` is `null` for a message that has none. It exists because the freeze watermark cannot be mapped from a character cut in `text` back to a `(messageId, offset)` pair without it, and the same loop that builds `text` is the only place that knows the correspondence. `freeze` is its only consumer (`docs/modules/freeze.md#watermark-mapping`).

`sourceStart` is the offset **inside that message's `mes`** that corresponds to `segment.start`, or `null` when no such offset exists. It is a number exactly when the block is a verbatim slice of the source text — when the transformed block equals `source.trim()`, which is every assistant message and every user message whose tag header already named the external character. Then `sourceStart = base + (source.length - source.trimStart().length)`, where `base` is the watermark offset applied to that message (`0` for every message the watermark does not name) and the second term skips the leading whitespace `trim` removed. When the user transform prepended the reserved tag literal, the derived block contains characters that are not in `mes` at all, derived offsets past that point are shifted, and `sourceStart` is `null` — honest absence rather than an offset that would be wrong by the length of the header. Nothing else about the derivation changes with this field: it is computed from values the loop already has.

An empty chat, a chat whose every message is skipped, and a `chat` that is not an array all yield `{ text: '', segments: [] }`.

## Why per-message, not positional {#per-message}

Inclusion is decided per message, never by finding the watermark's index and taking the tail from there. The positional version needs a repair path for every way the collaborator can disturb the chat; the per-message rule needs none:

- a frozen message that is deleted is simply absent, and the remaining messages still derive correctly;
- the watermark message deleted is likewise absent, and every later message is still included, because no later message's inclusion was ever expressed relative to its index;
- messages reordered, inserted between older ones, or swiped to different text all derive from what is in `chat[]` at that moment.

The accepted cost is the deleted watermark message: its un-frozen remainder disappears from the manuscript along with the message. That is the same thing the visible log just did, and it is the collaborator's own edit — inventing a recovery for it would mean keeping a second copy of the text, which is exactly what this design removed.

## Purity {#purity}

`deriveFrontier` mutates neither argument. It assigns no id, writes no marker, calls no save, reads no clock and keeps no cache: the same `(chat, state)` pair produces the same `text` and the same `segments` every time it is called. That is INV-10 stated as a function signature — many live interaction histories that end in the same visible chat collapse to one manuscript, because nothing about *how* the chat came to look that way is an input.

There is deliberately no memoisation, no dirty flag and no "derive only when the chat changed". The build is a string join over an array that is already in memory, once per generation.

## Message ids {#message-ids}

`ensureMessageId(message)` returns `message.extra[METADATA_KEY].id`, assigning `Math.random().toString(36).slice(2, 10)` first if it is absent, spread over whatever else the namespace already holds so sibling markers survive (`docs/modules/boundary.md#boundary-marker`). The id is **meaningless**: not a counter, not a timestamp, not the chat index, not derived from the text. Any of those would record where in the interaction a message sat or when it arrived — transport topology that INV-10 exists to discard, persisted in the chat file where a later reader could reconstruct the seams from it. A random token answers the only question anyone asks of it: is this the same message the watermark or a frozen span named?

`assignIds(chat)` runs `ensureMessageId` over every eligible entry of the chat in one pass and reports whether anything was new. It is the only impure id path: `recovery` calls it and then performs the `saveChat()` it already performs, so ids are written once per batch, on the event that was already saving the chat. Derivation never assigns an id, which is what keeps it pure — a read-only pass that handed out ids would make the interceptor a writer.

## Transformation rule {#transformation-rule}

`toManuscriptBlock(text, literal)` trims the input and prefixes the reserved literal, unless the text already opens with that same tag. Everything past the first block header is passed through byte-identical: the tag-header regex is anchored at the start of the string (`docs/modules/grammar.md#tag-header`), so prefixing the whole trimmed text prefixes exactly the first block, and every later blank-line-separated block keeps its own bytes, its own separator and its own punctuation. Derivation does not split, merge, re-wrap, re-punctuate or re-tag anything.

"Already opens with that tag" is decided by `parseTagHeader` and compared case- and space-insensitively (`trim().toLowerCase()` on both sides), so `Mara: …`, `mara: …` and `Mara : …` are all recognised and left alone — the tag is never doubled.

A first block that carries a *different* actor's tag (`Anton: he looks up.`) is still prefixed, producing `Mara: Anton: he looks up.` That is the character-specific reading of §10, not a bug: the composer is the external character's authoring surface and nothing else, so every send is that character's block. The manuscript grammar is upheld by the collaborator, not policed in code (`docs/protocol/invariants.md#enforcement-model`); there is no validation, correction or rejection path here.

Input that is not a string, or that is empty or whitespace-only after trimming, yields `''`, which the caller reads as "nothing to contribute": derivation drops the block and emits no segment for it (`#derivation-rule`).

## The reserved literal is borrowed {#reserved-literal}

`toManuscriptBlock` never computes the persona name itself: it takes the literal as an argument, and its one caller (`#derivation-rule`) resolves it with `reservedLiteral(ctx)` from `src/boundary.js` (`docs/modules/boundary.md#reserved-literal`) — the same function that builds the stop string, so the string the model is forbidden to emit and the string the manuscript carries can never disagree. One persona switch, one source, both sides move together, and because the literal is resolved per request, a persona change re-tags the whole mutable region rather than leaving a mixed history behind.

An empty persona name is legal and yields `''`. In that case the trimmed text is used untagged: a bare `': '` prefix would be a colon-headed pseudo-tag with no actor, which the grammar would read as prose and the boundary would never match. No tag at all is the honest record.
