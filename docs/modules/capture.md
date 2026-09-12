# capture
Owns: INV-3 (docs/protocol/invariants.md)
PLAN: §9, §10, §15
Depends on: host, constants, grammar, boundary, state

`src/capture.js` turns what the collaborator typed into the composer into an ordinary manuscript block on the canonical frontier. It exports one pure transformation (`toManuscriptBlock`) and one host-touching handler (`captureMessage`), and it writes to canonical state only through `src/state.js`'s API (`docs/modules/state.md#mutation-is-storage`). It reconstructs nothing, renders nothing, and removes nothing from `chat[]`.

## Composer path {#composer-path}

Capture runs *after* the collaborator's message is already in `chat[]`, on `MESSAGE_SENT` (`docs/api/sillytavern.md#message-sent`). That is not a choice between equal options: SillyTavern has no pre-send transform-or-cancel hook (`docs/api/sillytavern.md#pre-send-hook`) — no event carries the composer text with a mutable or cancellable argument, and `generate_interceptor` runs after the push. The two remaining paths are host-mapping path 1 (accept the message into `chat[]`, keep it verbatim, and conceal it at prompt-build time) and path 2 (an extension-owned input surface). Path 1 is the approved one (`docs/protocol/host-mapping.md#s9-capture`).

The consequence is that the visible chat log stays a faithful record of what the collaborator actually typed: `message.mes` is never read-modified-written, no message is deleted, hidden, re-rendered or restyled here. INV-3 — the model must never perceive where the human intervened — holds not because the user turn was erased, but because model-visible history is rebuilt in full from canonical state and never read back out of `chat[]` (`docs/protocol/host-mapping.md#architecture`). Concealment is `frontier`'s job at prompt-build time (`docs/protocol/host-mapping.md#s12-frontier`), and it is the only place it happens.

## Transformation rule {#transformation-rule}

`toManuscriptBlock(text, literal)` trims the input and prefixes the reserved literal, unless the text already opens with that same tag. Everything past the first block header is passed through byte-identical: the tag-header regex is anchored at the start of the string (`docs/modules/grammar.md#tag-header`), so prefixing the whole trimmed text prefixes exactly the first block, and every later blank-line-separated block keeps its own bytes, its own separator and its own punctuation. Capture does not split, merge, re-wrap, re-punctuate or re-tag anything.

"Already opens with that tag" is decided by `parseTagHeader` and compared case- and space-insensitively (`trim().toLowerCase()` on both sides), so `Mara: …`, `mara: …` and `Mara : …` are all recognised and left alone — the tag is never doubled.

A first block that carries a *different* actor's tag (`Anton: he looks up.`) is still prefixed, producing `Mara: Anton: he looks up.` That is the character-specific reading of §10, not a bug: the composer is the external character's authoring surface and nothing else, so every send is that character's block. The manuscript grammar is upheld by the collaborator, not policed in code (`docs/protocol/invariants.md#enforcement-model`); there is no validation, correction or rejection path here. Manuscript-wide authorship is a separate authority (see [Editing is not capture](#editing-is-not-capture)).

Input that is not a string, or that is empty or whitespace-only after trimming, yields `''`, which the caller reads as "nothing to capture" — no append, no save.

## The reserved literal is borrowed {#reserved-literal}

Capture never computes the persona name itself. It calls `reservedLiteral(ctx)` from `src/boundary.js` (`docs/modules/boundary.md#reserved-literal`), the same function that builds the stop string, so the string the model is forbidden to emit and the string capture writes can never disagree — one persona switch, one source, both sides move together.

An empty persona name is legal and yields `''`. In that case the trimmed text is appended untagged: a bare `': '` prefix would be a colon-headed pseudo-tag with no actor, which the grammar would read as prose and the boundary would never match. No tag at all is the honest record.

## Capture marker {#capture-marker}

`message.extra[METADATA_KEY].captured` is a message-local idempotence flag, not canonical state. It answers exactly one question — "has this `chat[]` entry already been folded into the frontier?" — so that a re-emitted, replayed or slash-command-duplicated `MESSAGE_SENT` cannot append the same block twice. Nothing reads it to decide protocol behaviour, and reconstruction never consults it.

It is written by spreading the existing namespace object rather than replacing it, because `boundary` owns a sibling flag in the same key (`extra[METADATA_KEY].boundary`, `docs/modules/boundary.md#boundary-marker`). Both modules write `{ ...(message.extra[METADATA_KEY] ?? {}), <their flag>: true }` so neither can erase the other's.

The write needs both save legs. The frontier lives in chat metadata and is persisted by `save(ctx)` → `saveMetadata` (`docs/modules/state.md#save`); the `captured` marker lives on the message object and is persisted by `ctx.saveChat()` (`docs/api/sillytavern.md#chat-metadata`). ST's own `saveChatConditional()` already ran *before* `MESSAGE_SENT` fired (`docs/api/sillytavern.md#message-sent`), so it saved the message without the marker — this module owns the `saveChat` leg that brief 0007 deferred, and skipping it would let the marker vanish on reload and the block be captured a second time.

## Barge-in is the same path {#barge-in}

§15 lets the collaborator insert the external character at any valid block boundary without waiting for the model. There is no separate barge-in path here, no affordance, no gate, and no check that a boundary stop preceded the send: every send at every moment is a capture, normalised by the same rule.

Nothing in storage distinguishes a capture that followed a stop from one that interrupted the model — no flag is written, no floor is recorded, `extra[METADATA_KEY].boundary` is never read (`docs/modules/boundary.md#barge-in`). That is deliberate and is the cheapest possible guarantee of §15's requirement that after reconstruction the two cases be indistinguishable: information that was never recorded cannot leak.

## Empty send is not a capture {#empty-send}

Pressing Send on an empty composer emits no `MESSAGE_SENT` at all — `Generate()` skips `sendMessageAsUser` entirely and pushes no message (`docs/api/sillytavern.md#empty-send`). The empty send is the continuation trigger, and this module deliberately contains no code for it: no empty-string branch in the handler, no "was this a continuation" test. The chat-completion `send_if_empty` quirk described in that entry produces a synthetic user message and is `frontier`'s to drop, not capture's to detect.

## Editing is not capture {#editing-is-not-capture}

§10's second half gives the collaborator manuscript-wide editing authority over the frontier. That authority is a distinct surface that does not go through the composer, and it is not implemented here. Capture is character-specific and composer-only: it subscribes to `MESSAGE_SENT` and to nothing else — no `MESSAGE_EDITED`, `MESSAGE_UPDATED`, `MESSAGE_DELETED` or `MESSAGE_SWIPED`.

So editing the visible `chat[]` message after it has been captured changes the visible log and nothing else; the block already on the frontier stays as it was, and the edit does not re-enter canonical state. The `captured` marker makes that explicit rather than accidental. Correcting the manuscript is the job of the editing brief, through its own path.
