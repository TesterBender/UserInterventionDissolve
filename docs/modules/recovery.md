# recovery
Owns: INV-8 (docs/protocol/invariants.md)
PLAN: §11, §14, §16, §18
Depends on: host, constants, grammar, state, boundary, freeze

`src/recovery.js` owns the "model generation → merged into the manuscript" leg of PLAN §11's live cycle. On every received assistant message of an eligible type it classifies the text into one of PLAN §14's four outcomes, rolls an incomplete trailing block back to the last complete block boundary, appends what is left to the mutable frontier exactly once, asks `freeze` whether a span may now be promoted, and persists. It is the only place where model-generated text enters canonical state.

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

INV-8 as behaviour: when the outcome is `'incomplete'`, the trailing incomplete block is discarded before anything else happens. `truncateToLastCompleteBlock(message.mes)` (`docs/modules/grammar.md#block-completeness`) yields the text up to the last complete block boundary; that string is written back to `message.mes` and, when the message carries a swipe array, to `message.swipes[message.swipe_id]` as well, because an in-place edit that skips the swipe array is undone the moment the user browses swipes (`docs/api/sillytavern.md#message-shape`). "Exceptional stop artifacts must not become fictional events": a half-sentence cut off by a token cap is transport debris and is never frozen into history.

The branch then calls `ctx.updateMessageBlock(index, message)` with exactly two arguments, passing the very object that was mutated — the renderer reads the object it is handed, not `chat[messageId]` (`docs/api/sillytavern.md#updatemessageblock`). One unconditional call in this branch is right for both receipt paths (`docs/api/sillytavern.md#edit-on-receipt`): on the non-streaming path MESSAGE_RECEIVED fires before `addOneMessage`, so no DOM node carries that id yet and the call is a silent no-op; on the streaming path the message is already painted with the streamed text and this call is the only thing that repaints it. It is the only branch that edits message text, so it is the only place that calls the renderer.

If nothing complete remains, the text becomes `''` and the message stays in `chat[]` with empty content. It is **not** deleted, no placeholder is substituted, and no regeneration, retry or continuation is triggered. PLAN §14 permits a host to recover "according to host policy"; this host's policy is to do nothing and leave the next move to the collaborator, which is also what §14's empty-output rule requires — text must never be forced merely to avoid an empty generation.

## Boundary outcomes are not rolled back {#boundary-not-rolled-back}

Decision: a `'boundary'` outcome is appended even when its trailing block lacks terminal punctuation, and `updateMessageBlock` is not called for it.

The rollback rule exists to discard text the model did not mean to end where it ended. A boundary is the opposite case: the model handed the floor to the external character deliberately, at a block boundary, and the block before the handoff is finished prose as far as the model is concerned — it may simply end on dialogue, an em-dash or a fragment. Rolling it back would delete text the model meant to keep and would turn a correct handoff into a lost turn. The incompleteness here is a property of the prose, not an artifact of the transport, and only transport artifacts are rolled back.

What the boundary branch *does* do is trim: the text it appends is `trimAtBoundary(text, literal)`, never the raw message text. INV-2 says the reserved literal never appears in model-visible history, and step 3 of [the classifier](#classification) recognises a boundary precisely when the text still *ends with* the literal — the case where `boundary`'s own trim did not run. Appending that text raw would carry the literal into the frontier and from there into the prompt. `trimAtBoundary` is idempotent for the normal path (`boundary` has already trimmed, so no block-start occurrence remains and the text is returned unchanged), which is why one unconditional call in this branch is both safe and sufficient. Recovery trims here only as a safety net for what it appends: it does not touch `message.mes`, `swipes[]` or the rendered message — the visible-message trim belongs to `boundary` alone (`docs/modules/boundary.md#receipt-trim`).

If the safety-net trim leaves nothing — the whole generation was the handoff — the invocation is treated as the `'empty'` outcome and returns `'empty'`: nothing is appended, nothing is frozen, no marker is written. That is PLAN §14's "Empty output at the boundary" reached by a second route, and the action must be the same one.

## The frontier is written here and only here {#append}

PLAN §11's "block merged into the manuscript" happens at exactly one point in this extension: `appendToFrontier(state, text)` in this module. Nothing else appends model text to canonical state, which is why every guard that matters — eligibility, the idempotence marker, the rollback — can live in one function and be reasoned about as a whole.

`appendedText` is recorded as `text.trim()` because that is byte-exactly what `appendToFrontier` writes into the frontier (it trims and joins with `BLOCK_DELIMITER`, `docs/modules/state.md#mutation-is-storage`). Recording the same string the frontier received is what makes the `endsWith` test in [Swipes and regeneration](#swipes) exact rather than approximate.

The `appended` marker lives in `message.extra[METADATA_KEY]` and is written with a spread over whatever is already there, so sibling flags owned by other modules in the same namespace survive (`boundary` writes `boundary`, `capture` writes `captured`). It is a **message-local idempotence flag, not canonical state**: it records that this chat entry has already been merged, so a repeated MESSAGE_RECEIVED for the same index cannot append twice. Because it lives on the message it needs `saveChat()`, while the frontier and any new frozen span live in chat metadata and need `saveMetadata()` via `save()` (`docs/modules/state.md#save`). At most one of each per invocation. Note that one received message can therefore produce **two** `saveChat()` calls in total — `boundary`'s, after it trims and writes its own marker, and recovery's, after the `appended` marker — which is why the end-to-end test in `tests/boundary.test.js` asserts that `saveChat` was called rather than a call count.

## Swipes and regeneration {#swipes}

A swipe or a regenerate re-fires MESSAGE_RECEIVED for a message this module appended moments ago, with different text. That is the single case where the frontier is edited rather than extended, and the rule is deliberately minimal: if the frontier (ignoring trailing whitespace) **ends with** the previously appended string, that trailing occurrence — and only that trailing occurrence — is removed before the new text is appended. Anything else is left alone.

The previous string comes from `message.extra[METADATA_KEY].appendedText` when it is there, and otherwise from `lastAppend`, a module-local `{ index, text }` record of the last append made in this session. The fallback exists because the host may replace rather than edit the message object on a resample path, which would carry the marker away with it; it depends on no unverified ST behaviour, and when neither source yields a previous string the branch simply does nothing and the new text is appended as a fresh block.

When the previous text is no longer at the frontier edge — `freeze` has already promoted it into an immutable span, or the collaborator has written past it — the frontier is **left untouched and the new text is appended anyway**, with one `console.warn` line prefixed with `LOG_PREFIX`. INV-6: frozen spans are append-only and are never edited, not even to undo a swipe. The duplicated passage is a visible cost, and it is the accepted one; re-opening a frozen span is not.

Accepted limitation: this module syncs nothing else between `chat[]` and canonical state. Browsing back to an older swipe, editing a received message afterwards, or deleting it changes the visible log only — the frontier keeps the text that was appended when the message was received. There is no general diffing, no re-derivation of the frontier from `chat[]` and no resync command.

## Abnormal termination needs no code {#abnormal}

The frontier changes on MESSAGE_RECEIVED and on nothing else. A generation that is aborted, fails, hits a provider error or simply never produces a message therefore leaves canonical state byte-identical, and INV-8 holds for abnormal termination by construction rather than by a handler. This module subscribes to no GENERATION_STOPPED, no GENERATION_ENDED, no MESSAGE_EDITED/UPDATED/SWIPED/DELETED and no STREAM_TOKEN_RECEIVED.

Trying to do better would not work anyway: STOPPED carries no arguments and ENDED carries `chat.length`, ST emits fewer ENDED than STARTED, and the two cannot be reliably paired with a STARTED (`docs/api/sillytavern.md#generation-stopped`). A stop during streaming keeps the partial text as the message and fires MESSAGE_RECEIVED for it (`docs/api/sillytavern.md#stopgeneration`) — which is exactly the text this module then classifies as `'incomplete'` and rolls back.

## Freeze hook-up {#freeze-hookup}

`maybeFreeze(state, literal, {})` is called on every successful append and on no other occasion: not for the `'empty'` outcome, not for a rollback that empties the message, and never twice for one message. No options are passed and the return value is not used.

Recovery makes no decision about *whether* the frontier is long enough. That is `freeze`'s word-count rule alone (`docs/modules/freeze.md#target-jitter`), which is the mechanism that keeps PLAN §18's three horizons apart: the generation horizon — how long one generation happened to run — must never become the transport horizon. "One generation, one chunk" is exactly the conflation §18 forbids, so this module calls after every append and lets word count decide. `freeze` is pure and never persists; recovery is its caller and the one that calls `save(ctx)` afterwards, so a span promoted inside `maybeFreeze` is written to metadata by the same invocation that created it.

## Ordering with boundary {#ordering}

Recovery's handler runs **after** `boundary`'s for the same MESSAGE_RECEIVED event. The emitter awaits listeners sequentially in registration order (`docs/api/sillytavern.md#events`), so by the time recovery reads the message, `boundary` has already trimmed the text back to the character before the reserved literal and written `extra[METADATA_KEY].boundary` (`docs/modules/boundary.md#receipt-trim`, `#boundary-marker`). That is why the marker — not the text — is recovery's reliable boundary signal: the literal is gone from `mes` by then. The wiring that guarantees the order is `docs/modules/bootstrap.md#recovery-subscription`.

The eligibility list (`'quiet'`, `'impersonate'`, `'first_message'` are skipped; unknown and `undefined` types are processed, `docs/api/sillytavern.md#message-received`) is **intentionally duplicated** from `boundary` rather than imported. The two handlers are wired independently and either may run without the other on a host build that lacks an event; a shared constant would suggest a coupling that does not exist and would make one module's change silently redefine the other's contract. The lists are identical today by intent, and each module states its own.
