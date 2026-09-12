# capture
Owns: INV-3 (docs/protocol/invariants.md)
PLAN: §9, §10, §15
Depends on: host, constants, grammar, derive

`src/capture.js` owns the rule that turns what the collaborator typed into an ordinary manuscript block. It exports one pure transformation (`toManuscriptBlock`), applied at derive time to every user message (`docs/modules/derive.md#derivation-rule`), and one host-touching handler (`captureMessage`), which only marks the message the collaborator just sent. It writes no canonical state at all. It reconstructs nothing, renders nothing, and removes nothing from `chat[]`.

## Composer path {#composer-path}

Capture runs *after* the collaborator's message is already in `chat[]`, on `MESSAGE_SENT` (`docs/api/sillytavern.md#message-sent`). That is not a choice between equal options: SillyTavern has no pre-send transform-or-cancel hook (`docs/api/sillytavern.md#pre-send-hook`) — no event carries the composer text with a mutable or cancellable argument, and `generate_interceptor` runs after the push. The two remaining paths are host-mapping path 1 (accept the message into `chat[]`, keep it verbatim, and conceal it at prompt-build time) and path 2 (an extension-owned input surface). Path 1 is the approved one (`docs/protocol/host-mapping.md#s9-capture`).

The handler does exactly two things to the message: it gives it an id (`docs/modules/derive.md#message-ids`) and it sets `captured: true`. It computes no block, appends nothing anywhere, and calls `saveMetadata` never and `saveChat` once — ids and markers live on messages, so the chat file is the only thing that needs saving. A blank message needs no special case: it is marked like any other and simply derives to nothing.

INV-3 is satisfied at **derive time**, not here. `toManuscriptBlock` still lives in this module and is still the whole transform, but it is applied to the message text on every request by `src/derive.js`, which means a user turn the collaborator later edits is re-tagged from its current text rather than from a copy taken the moment it was sent (PLAN §10). The consequence is the same as before for the visible log: `message.mes` is never read-modify-written here, and no message is deleted, hidden, re-rendered or restyled.

## Transformation rule {#transformation-rule}

`toManuscriptBlock(text, literal)` trims the input and prefixes the reserved literal, unless the text already opens with that same tag. Everything past the first block header is passed through byte-identical: the tag-header regex is anchored at the start of the string (`docs/modules/grammar.md#tag-header`), so prefixing the whole trimmed text prefixes exactly the first block, and every later blank-line-separated block keeps its own bytes, its own separator and its own punctuation. Capture does not split, merge, re-wrap, re-punctuate or re-tag anything.

"Already opens with that tag" is decided by `parseTagHeader` and compared case- and space-insensitively (`trim().toLowerCase()` on both sides), so `Mara: …`, `mara: …` and `Mara : …` are all recognised and left alone — the tag is never doubled.

A first block that carries a *different* actor's tag (`Anton: he looks up.`) is still prefixed, producing `Mara: Anton: he looks up.` That is the character-specific reading of §10, not a bug: the composer is the external character's authoring surface and nothing else, so every send is that character's block. The manuscript grammar is upheld by the collaborator, not policed in code (`docs/protocol/invariants.md#enforcement-model`); there is no validation, correction or rejection path here. Manuscript-wide authorship is a separate authority (see [Editing is not capture](#editing-is-not-capture)).

Input that is not a string, or that is empty or whitespace-only after trimming, yields `''`, which the caller reads as "nothing to contribute": derivation drops the block and emits no segment for it (`docs/modules/derive.md#derivation-rule`).

## The reserved literal is borrowed {#reserved-literal}

Capture never computes the persona name itself, and no longer reads it at all: `toManuscriptBlock` takes the literal as an argument, and its one caller resolves it with `reservedLiteral(ctx)` from `src/boundary.js` (`docs/modules/boundary.md#reserved-literal`) — the same function that builds the stop string, so the string the model is forbidden to emit and the string the manuscript carries can never disagree. One persona switch, one source, both sides move together, and because the literal is resolved per request, a persona change re-tags the whole mutable region rather than leaving a mixed history behind.

An empty persona name is legal and yields `''`. In that case the trimmed text is used untagged: a bare `': '` prefix would be a colon-headed pseudo-tag with no actor, which the grammar would read as prose and the boundary would never match. No tag at all is the honest record.

## Capture marker {#capture-marker}

`message.extra[METADATA_KEY].captured` is a message-local idempotence flag, not canonical state. It answers exactly one question — "has this `chat[]` entry already been folded into the frontier?" — so that a re-emitted, replayed or slash-command-duplicated `MESSAGE_SENT` cannot append the same block twice. Nothing reads it to decide protocol behaviour, and reconstruction never consults it.

It is written by spreading the existing namespace object rather than replacing it, because `boundary` owns a sibling flag in the same key (`extra[METADATA_KEY].boundary`, `docs/modules/boundary.md#boundary-marker`). Both modules write `{ ...(message.extra[METADATA_KEY] ?? {}), <their flag>: true }` so neither can erase the other's.

The marker and the id both live on the message object and are persisted by the single `ctx.saveChat()` this handler performs (`docs/api/sillytavern.md#chat-metadata`). ST's own `saveChatConditional()` already ran *before* `MESSAGE_SENT` fired (`docs/api/sillytavern.md#message-sent`), so it saved the message without either of them. The same call persists the ids `assignIds(ctx.chat)` handed to every other message in the chat — the "once per batch" rule of `docs/modules/derive.md#message-ids`, which is why ids need no save path of their own.

## Barge-in is the same path {#barge-in}

§15 lets the collaborator insert the external character at any valid block boundary without waiting for the model. There is no separate barge-in path here, no affordance, no gate, and no check that a boundary stop preceded the send: every send at every moment is a capture, normalised by the same rule.

Nothing in storage distinguishes a capture that followed a stop from one that interrupted the model — no flag is written, no floor is recorded, `extra[METADATA_KEY].boundary` is never read (`docs/modules/boundary.md#barge-in`). That is deliberate and is the cheapest possible guarantee of §15's requirement that after reconstruction the two cases be indistinguishable: information that was never recorded cannot leak.

## Empty send is not a capture {#empty-send}

Pressing Send on an empty composer emits no `MESSAGE_SENT` at all — `Generate()` skips `sendMessageAsUser` entirely and pushes no message (`docs/api/sillytavern.md#empty-send`). The empty send is the continuation trigger, and this module deliberately contains no code for it: no empty-string branch in the handler, no "was this a continuation" test. The chat-completion `send_if_empty` quirk described in that entry produces a synthetic user message and is `frontier`'s to drop, not capture's to detect.

## Editing is not capture {#editing-is-not-capture}

§10's second half gives the collaborator manuscript-wide editing authority over the frontier. That authority needs no code in this module and no subscription: capture subscribes to `MESSAGE_SENT` and to nothing else — no `MESSAGE_EDITED`, `MESSAGE_UPDATED`, `MESSAGE_DELETED` or `MESSAGE_SWIPED`.

Editing the visible `chat[]` message after it has been captured changes what the model sees on the very next request anyway, because the message text *is* the frontier (`docs/modules/derive.md#derivation-rule`). The `captured` marker does not freeze the text; it only stops a replayed `MESSAGE_SENT` from re-marking the same entry. Once the message has been consumed by a frozen span the edit becomes cosmetic, which is INV-6 and not this module's business.
