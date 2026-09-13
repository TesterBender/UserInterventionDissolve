# recovery
Owns: INV-8 (docs/protocol/invariants.md)
PLAN: §11, §14, §16, §18
Depends on: host, constants, grammar, boundary, derive

`src/recovery.js` owns the "model generation → merged into the manuscript" leg of PLAN §11's live cycle. On every received assistant message of an eligible type it classifies the text into one of PLAN §14's four outcomes and makes the message itself correct: an incomplete trailing block is rolled back to the last complete block boundary, a boundary handoff is trimmed at the reserved literal. Nothing is appended anywhere, because the message *is* the manuscript block now (`docs/modules/derive.md#derivation-rule`) — this module's whole job is to make sure the text the next request derives is the text PLAN §14 says should survive.

## Classification is textual {#classification}

SillyTavern never surfaces why a generation ended: there is no `finish_reason`, `stop_reason` or equivalent anywhere in the host (`docs/api/sillytavern.md#finish-reason`, status: **absent**). The text of the received message is therefore the entire signal, and `classifyOutcome(text, literal, boundaryMarked)` is the entire classifier. It is pure — no context, no state, no I/O — and decides in exactly this order:

1. `String(text ?? '').trim() === ''` ⇒ `'empty'`.
2. `boundaryMarked === true` ⇒ `'boundary'`. The flag is `message.extra[METADATA_KEY].boundary`, written by `boundary`'s own MESSAGE_RECEIVED handler (`docs/modules/boundary.md#boundary-marker`).
3. `literal` non-empty and `findBoundary(text, literal).endsAtLiteral` ⇒ `'boundary'`.
4. `isTrailingBlockComplete(text)` ⇒ `'complete'`.
5. otherwise ⇒ `'incomplete'`.

**Emptiness is tested before the boundary marker on purpose, and the order must not be swapped.** A message that `boundary` trimmed down to nothing is PLAN §14's *"Empty output at the boundary"* — the model tried to place the external character immediately — and the action is the same either way: append nothing, freeze nothing, leave the floor with the collaborator. Testing emptiness first makes the table total and unambiguous instead of leaving one cell decided by two competing rules.

Step 3 is a textual fallback for the case where `boundary`'s trim did not run at all: the event was not registered on this host build, the persona name is empty, or an unusual backend delivered the tag some other way. Recovery does not trim in that case — the trim belongs to `boundary` — it only recognises the outcome.

Steps 4 and 5 are one distinction, not three. PLAN §14's "Natural completion" is transport behaviour and nothing special happens; "Maximum-output termination" and "Safety, recitation, provider interruption" collapse into the same textual signature (a trailing block without terminal punctuation) and therefore into the same default action, the rollback below. Without a finish reason there is no information that could separate them, and inventing one would be pretending to know something the host does not tell us.

## Rollback {#rollback}

INV-8 as behaviour: when the outcome is `'incomplete'`, the trailing incomplete block is discarded from the message before anything else happens — and since the message is what the next request derives from, discarding it there is the whole of the rollback. `truncateToLastCompleteBlock(message.mes)` (`docs/modules/grammar.md#block-completeness`) yields the text up to the last complete block boundary; that string is written back to `message.mes` and, when the message carries a swipe array, to `message.swipes[message.swipe_id]` as well, because an in-place edit that skips the swipe array is undone the moment the user browses swipes (`docs/api/sillytavern.md#message-shape`). "Exceptional stop artifacts must not become fictional events": a half-sentence cut off by a token cap is transport debris and is never frozen into history.

The branch then calls `ctx.updateMessageBlock(index, message)` with exactly two arguments, passing the very object that was mutated — the renderer reads the object it is handed, not `chat[messageId]` (`docs/api/sillytavern.md#updatemessageblock`). One unconditional call in this branch is right for both receipt paths (`docs/api/sillytavern.md#edit-on-receipt`): on the non-streaming path MESSAGE_RECEIVED fires before `addOneMessage`, so no DOM node carries that id yet and the call is a silent no-op; on the streaming path the message is already painted with the streamed text and this call is the only thing that repaints it. It is the only branch that edits message text, so it is the only place that calls the renderer.

If nothing complete remains, the text becomes `''` and the message stays in `chat[]` with empty content. It is **not** deleted, no placeholder is substituted, and no regeneration, retry or continuation is triggered. PLAN §14 permits a host to recover "according to host policy"; this host's policy is to do nothing and leave the next move to the collaborator, which is also what §14's empty-output rule requires — text must never be forced merely to avoid an empty generation.

## Boundary outcomes are not rolled back {#boundary-not-rolled-back}

Decision: a `'boundary'` outcome is appended even when its trailing block lacks terminal punctuation, and `updateMessageBlock` is not called for it.

The rollback rule exists to discard text the model did not mean to end where it ended. A boundary is the opposite case: the model handed the floor to the external character deliberately, at a block boundary, and the block before the handoff is finished prose as far as the model is concerned — it may simply end on dialogue, an em-dash or a fragment. Rolling it back would delete text the model meant to keep and would turn a correct handoff into a lost turn. The incompleteness here is a property of the prose, not an artifact of the transport, and only transport artifacts are rolled back.

What the boundary branch *does* do is trim, and unlike in v1 it writes the trim back into the message. INV-2 says the reserved literal never appears in model-visible history, and step 3 of [the classifier](#classification) recognises a boundary precisely when the text still *ends with* the literal — the case where `boundary`'s own trim did not run. Leaving that text in `message.mes` would carry the literal into the derived frontier and from there into the prompt, because the message text *is* the frontier now; trimming a private copy would protect nothing. So the branch assigns `trimAtBoundary(message.mes, literal)` to `message.mes` and, when the message carries a swipe array, to `message.swipes[message.swipe_id]`, then repaints with `updateMessageBlock` exactly as the rollback branch does. `trimAtBoundary` is idempotent on the normal path (`boundary` has already trimmed, so no block-start occurrence remains and the text is returned unchanged), which is why one unconditional call is both safe and sufficient; on that path the write-back assigns the same bytes and the repaint is the same no-op the rollback branch documents (`docs/api/sillytavern.md#edit-on-receipt`).

If the trim leaves nothing — the whole generation was the handoff — the invocation is treated as the `'empty'` outcome and returns `'empty'`: nothing is appended, nothing is frozen, no marker is written. That is PLAN §14's "Empty output at the boundary" reached by a second route, and the action must be the same one.

## Receipt {#append}

PLAN §11's "block merged into the manuscript" no longer copies anything: the received message stays in `chat[]` and derivation reads it there on the next request. What happens at receipt is therefore only what must happen *before* that read — classification, the in-message rollback, and the in-message boundary trim. **No marker is written at receipt.**

Classification is unconditional and idempotent, so no idempotence flag is needed to guard against a repeated MESSAGE_RECEIVED for the same index: the rollback and the boundary trim are idempotent on already-trimmed text (a second call finds nothing left to cut), the id `ensureMessageId`/`assignIds` would assign is already present, and a second `compileUnit` attempt on the post-freeze derivation finds a shorter frontier and either finds no new candidate or pushes a legitimate further span. A second receipt for the same index is therefore safe to classify again from scratch, which is exactly what happens — there is no branch that skips it.

The message and its id need `ctx.saveChat()`; this module writes no metadata and calls no `saveMetadata`. `assignIds(ctx.chat)` runs just before that save, so any message still without an id gets one on the same write (`docs/modules/derive.md#message-ids`). One received message can produce **two** `saveChat()` calls in total — `boundary`'s, after it trims and writes its own marker, and recovery's — which is why the end-to-end test in `tests/boundary.test.js` asserts that `saveChat` was called rather than a call count.

## Swipes and regeneration {#swipes}

A swipe or a regenerate re-fires MESSAGE_RECEIVED for a message this module already saw, with different text. Under the derived frontier that needs no code: the message object carries the new text, so the next request derives the new text, and the old text is gone because it was never stored anywhere else. There is no replacement branch, no `endsWith` test against a frontier edge, no session record of the last append and no warning — all of them existed only to repair a second copy that no longer exists.

A resample needs no special case here, because there is no idempotence guard to bypass: classification is unconditional, so `type === 'swipe'` or `'regenerate'` runs through exactly the same path as a first receipt, and the new text — including a fresh incomplete trailing block — is classified and rolled back or trimmed like any other receipt. There is no type-specific branch in this module.

Browsing back to an older swipe, editing a received message and deleting it now all change what the model sees on the next request, which is the point of PLAN §10's mutable frontier. Once a message has been consumed by a frozen span, editing it is cosmetic again (INV-6, `docs/modules/state.md#append-only`).

## Abnormal termination needs no code {#abnormal}

Message text is edited on MESSAGE_RECEIVED and on nothing else. A generation that is aborted, fails, hits a provider error or simply never produces a message therefore leaves both the visible chat and canonical state byte-identical, and INV-8 holds for abnormal termination by construction rather than by a handler. This module subscribes to no GENERATION_STOPPED, no GENERATION_ENDED, no MESSAGE_EDITED/UPDATED/SWIPED/DELETED and no STREAM_TOKEN_RECEIVED.

Trying to do better would not work anyway: STOPPED carries no arguments and ENDED carries `chat.length`, ST emits fewer ENDED than STARTED, and the two cannot be reliably paired with a STARTED (`docs/api/sillytavern.md#generation-stopped`). A stop during streaming keeps the partial text as the message and fires MESSAGE_RECEIVED for it (`docs/api/sillytavern.md#stopgeneration`) — which is exactly the text this module then classifies as `'incomplete'` and rolls back.

## Freeze hook-up {#freeze-hookup}

A freeze is attempted **once per receipt and nowhere else** — not on send, not on edit, not on chat load, and with no timer. The receipt is the moment the manuscript last grew, so it is the only moment at which a new cut can become available.

The attempt runs after the receipt markers are written and after `assignIds(ctx.chat)`, so every message the derivation can see already has an id and can be named by `frozenIds` or the watermark:

```js
const state = getState(ctx);
const result = compileUnit(state, deriveFrontier(ctx.chat, state, literal), literal, {});
```

The frontier handed to `compileUnit` is derived fresh from the live chat (`docs/modules/derive.md#derivation-rule`); this module keeps no copy of it and passes the `{ text, segments }` object straight through, because the segments are what let the chosen cut be mapped back to a `(messageId, offset)` watermark (`docs/modules/freeze.md#watermark-mapping`). `compileUnit` may also **seal** the units it just extended into a final span (`docs/modules/freeze.md#seal-policy`); that is still one call and still one save, and this module has no branch for it. `result === null` means no unit was pushed — no candidate, a refused cut, or a cut inside a non-offset-preserving block — and in that case canonical state is untouched and **no metadata save happens**. Only a real freeze costs a `saveMetadata()`; the `saveChat()` this handler already performs is unrelated and unconditional.

The rule is unchanged — recovery makes no decision about *whether* the manuscript is long enough. That is `freeze`'s word-count rule alone (`docs/modules/freeze.md#target-jitter`), which is what keeps PLAN §18's three horizons apart: the generation horizon must never become the transport horizon, and "one generation, one chunk" is exactly the conflation §18 forbids.

## Ordering with boundary {#ordering}

Recovery's handler runs **after** `boundary`'s for the same MESSAGE_RECEIVED event. The emitter awaits listeners sequentially in registration order (`docs/api/sillytavern.md#events`), so by the time recovery reads the message, `boundary` has already trimmed the text back to the character before the reserved literal and written `extra[METADATA_KEY].boundary` (`docs/modules/boundary.md#receipt-trim`, `#boundary-marker`). That is why the marker — not the text — is recovery's reliable boundary signal: the literal is gone from `mes` by then. The wiring that guarantees the order is `docs/modules/bootstrap.md#recovery-subscription`.

The eligibility list (`'quiet'`, `'impersonate'`, `'first_message'` are skipped; unknown and `undefined` types are processed, `docs/api/sillytavern.md#message-received`) is **intentionally duplicated** from `boundary` rather than imported. The two handlers are wired independently and either may run without the other on a host build that lacks an event; a shared constant would suggest a coupling that does not exist and would make one module's change silently redefine the other's contract. The lists are identical today by intent, and each module states its own.
