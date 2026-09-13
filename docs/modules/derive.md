# derive
Owns: INV-3, INV-4, INV-10 (docs/protocol/invariants.md)
PLAN: §9, §10, §12
Depends on: constants, grammar

`src/derive.js` computes the mutable frontier. It is not stored anywhere: the frontier is a pure function of the visible `chat[]` and the two fields of canonical state that say how much of that chat has already been compiled (`frozenIds`, `watermark`, `docs/modules/state.md#shape`). `deriveFrontier` is called once per request by `frontier` (`docs/modules/frontier.md#total-reconstruction`) and by nothing else. The module also owns the message ids that let a frozen span name the messages it consumed.

## Derivation rule {#derivation-rule}

`deriveFrontier(chat, state, literal, options = {})` walks `chat` in order and keeps a block per surviving message. The fourth argument carries the one scope choice the caller makes, `options.excludeLastAssistant` (see [Regeneration scope](#regeneration-scope)); with no fourth argument, with `{}`, or with the flag `false`, every rule below applies to the whole chat.

A message is **considered** when it is an object, its `mes` is a string and `is_system !== true` — that last condition is ST's own prompt-exclusion filter (`docs/api/sillytavern.md#message-shape`) — and everything else is out of the derivation entirely. A considered message is then **skipped** when it is the message excluded by scope (`#regeneration-scope`), or when its id is listed in `state.frozenIds` — its text has already been compiled into a frozen span and must not be sent twice. A message with no id at all is never in `frozenIds`, so a brand-new message that nothing has touched yet is included, which is what makes an ordinary send work with no bookkeeping in front of it.

The **source text** is `mes`, except for the single message named by `state.watermark.messageId`: that one message was cut through by a freeze, and only the part after the cut is still mutable, so the source is `mes.slice(watermark.offset)`. A watermark whose `offset` is not a finite number greater than zero takes the whole message.

The **transform** is INV-3: a message with `is_user === true` becomes `toManuscriptBlock(source, literal)` (`#transformation-rule`), so the collaborator's turn enters the manuscript as a tagged block of the external character. Any other message contributes `source.trim()` verbatim — the model's own text needs no transform, because `boundary` has already trimmed the reserved literal off the message itself (`docs/modules/boundary.md#receipt-trim`) and `recovery` has already rolled an incomplete trailing block out of the message itself (`docs/modules/recovery.md#rollback`).

A block that is empty after the transform contributes nothing: no text, no delimiter, no segment. The surviving blocks are joined with `BLOCK_DELIMITER` (`docs/modules/grammar.md#block-delimiter`) into `text`.

`segments` is the parallel list `[{ id, start, end, sourceStart }]`, in the same order, with `start`/`end` character offsets into `text` and `end` exclusive, so `text.slice(start, end)` is exactly that message's block; `id` is `null` for a message that has none. It exists because the freeze watermark cannot be mapped from a character cut in `text` back to a `(messageId, offset)` pair without it, and the same loop that builds `text` is the only place that knows the correspondence. `freeze` is its only consumer (`docs/modules/freeze.md#watermark-mapping`).

`sourceStart` is the offset **inside that message's `mes`** that corresponds to `segment.start`, or `null` when no such offset exists. It is a number exactly when the block is a verbatim slice of the source text — when the transformed block equals `source.trim()`, which is every assistant message and every user message whose tag header already named the external character. Then `sourceStart = base + (source.length - source.trimStart().length)`, where `base` is the watermark offset applied to that message (`0` for every message the watermark does not name) and the second term skips the leading whitespace `trim` removed. When the user transform prepended the reserved tag literal, the derived block contains characters that are not in `mes` at all, derived offsets past that point are shifted, and `sourceStart` is `null` — honest absence rather than an offset that would be wrong by the length of the header. Nothing else about the derivation changes with this field: it is computed from values the loop already has.

An empty chat, a chat whose every message is skipped, and a `chat` that is not an array all yield `{ text: '', segments: [] }`.

## Regeneration scope {#regeneration-scope}

`options.excludeLastAssistant === true` means "derive the manuscript as it stood *before* the last model output" — the scope a **swipe** needs, and only a swipe. On a swipe the message being replaced is still sitting in the live `chat[]`; ST removes it from the request copy alone, with `coreChat.pop()` (`docs/api/sillytavern.md#swipe-scope`), and derivation reads the live chat, so derivation has to drop it itself. On a `regenerate` ST has already deleted the message from `chat[]` before generation starts, so the caller passes `false` there and this rule never runs (`docs/modules/frontier.md#interceptor-body`). Derivation finds the **last considered message** of `chat` (the gate in [Derivation rule](#derivation-rule): object, string `mes`, not `is_system`) and, if that message's `is_user` is not `true`, skips it entirely: no text, no delimiter, no segment, exactly as an empty block is dropped. If the last considered message *is* a user message there is no model output at the edge to replace, so nothing is excluded. Trailing `is_system` messages are not considered, so they neither get excluded themselves nor shield the assistant message in front of them. Exactly one message is ever excluded, and any other `options` value — absent, `{}`, `false` — excludes nothing.

The exclusion is decided before the `frozenIds` and watermark rules and is independent of them: a last message that is already frozen would be skipped anyway, and because the excluded message contributes no segment, `segments` offsets stay in step with `text` for the one consumer that reads them (`docs/modules/freeze.md#watermark-mapping`).

It is an **option rather than something derivation works out for itself**, because the only in-band evidence would be the interceptor's per-request `chat` copy, and that copy cannot be mapped onto canonical state: `coreChat` is built as fresh objects from `chat.filter(...)` (`docs/api/sillytavern.md#generate-interceptor`) and whether those objects carry the `extra` namespace the ids live in is not verified. Derivation therefore keeps reading the live `ctx.chat` and takes the scope as a pure argument from the one caller that knows the generation type (`docs/modules/frontier.md#interceptor-body`), which is what keeps the function a pure function of `(chat, state, literal, options)` and INV-10 mechanically testable.

ST does **not** blank the swiped message's `mes` while the swipe is in flight — the "..." is a UI state, and `clearMessageData` strips `extra` and the generation timers, not the text (`docs/api/sillytavern.md#swipe-scope`) — so the exclusion is load-bearing, not a formality. Because it drops the last *considered* message, it lands on the same message ST's own `coreChat.pop()` lands on: both operate on the history with `is_system` entries already filtered out.

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

`toManuscriptBlock(text, literal)` trims the input and prefixes the reserved literal **followed by a newline**, unless the text already opens with that same tag. Everything past the header is passed through byte-identical: the tag-header regex is anchored at the start of the string (`docs/modules/grammar.md#tag-header`), so prefixing the whole trimmed text heads exactly the contribution, and every blank-line-separated paragraph inside it keeps its own bytes, its own separator and its own punctuation. Derivation does not split, merge, re-wrap, re-punctuate or re-tag anything.

"Already opens with that tag" is decided by `parseTagHeader` and compared case- and space-insensitively (`trim().toLowerCase()` on both sides), so `Mara: …`, `mara: …`, `Mara : …` and `Mara:\n…` are all recognised and left alone — the tag is never doubled.

## Own-line header {#own-line-header}

The header sits on its own line — `` `${literal}\n${trimmed}` `` — because a header opens an **agency span** that persists across paragraphs until the next header (`docs/modules/grammar.md#spans`, `PLAN-addendum-agency-spans.md` §2). A multi-paragraph turn from the collaborator is one contribution by one owner, and the own-line form says exactly that: one header, then however many paragraphs the passage needs. The inline form `Mara: she stands.` would head only the first paragraph and leave the rest looking like a separate, unowned passage, which is precisely the paragraph-as-ownership-unit reading the addendum removes. PLAN §9 asks that the collaborator's input be merged into the manuscript as manuscript text; nothing in §9 asks for it to be chopped into per-paragraph commitments.

Both header forms are recognised by the "already opens with that tag" short-circuit, because `parseTagHeader` matches `Mara:\ntext` and `Mara: text` alike (`TAG_HEADER`'s lookahead admits a newline). A collaborator who types either form gets their text back byte-identical; only an unheaded turn gains a header.

`sourceStart` is still `null` for a block that gained a header, for the reason given in [Derivation rule](#derivation-rule): the derived block now contains characters — the literal and the newline — that are not in `mes`, so no honest offset into the message exists. The newline changes nothing about that rule, and the segment loop is unchanged.

A first block that carries a *different* actor's tag (`Anton: he looks up.`) is still prefixed, producing `Mara: Anton: he looks up.` That is the character-specific reading of §10, not a bug: the composer is the external character's authoring surface and nothing else, so every send is that character's block. The manuscript grammar is upheld by the collaborator, not policed in code (`docs/protocol/invariants.md#enforcement-model`); there is no validation, correction or rejection path here.

Input that is not a string, or that is empty or whitespace-only after trimming, yields `''`, which the caller reads as "nothing to contribute": derivation drops the block and emits no segment for it (`#derivation-rule`).

## The reserved literal is borrowed {#reserved-literal}

`toManuscriptBlock` never computes the persona name itself: it takes the literal as an argument, and its one caller (`#derivation-rule`) resolves it with `reservedLiteral(ctx)` from `src/boundary.js` (`docs/modules/boundary.md#reserved-literal`) — the same function that builds the stop string, so the string the model is forbidden to emit and the string the manuscript carries can never disagree. One persona switch, one source, both sides move together, and because the literal is resolved per request, a persona change re-tags the whole mutable region rather than leaving a mixed history behind.

An empty persona name is legal and yields `''`. In that case the trimmed text is used untagged: a bare `': '` prefix would be a colon-headed pseudo-tag with no actor, which the grammar would read as prose and the boundary would never match. No tag at all is the honest record.
