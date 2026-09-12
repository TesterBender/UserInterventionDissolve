# 0004 — the mutable frontier is derived, not accumulated
Date: 2026-09-13
Brief: docs/briefs/0020a-derived-frontier.md
PLAN: §9, §10, §12, §16

## Decision

The mutable frontier stops being a string accumulated in `chatMetadata` and becomes a pure function of the visible chat plus the frozen watermark, recomputed on every request (`docs/modules/derive.md#derivation-rule`). Canonical state keeps only what has been *compiled*: the append-only `frozen` list, the `frozenIds` of messages a span has fully consumed, and a `{ messageId, offset }` watermark for the one message a cut ran through (`docs/modules/state.md#shape`). Everything above that watermark is read from `chat[]` at prompt-build time, transformed there (user turns through `toManuscriptBlock`, model turns verbatim), and joined into the single mutable turn the reconstruction sends.

The accumulated copy was a second log of the same text, and the two diverged the moment the collaborator edited, swiped or deleted anything: the model kept seeing the text as it had been when the message arrived, while the human edited the text on screen. PLAN §10 gives the collaborator manuscript-wide editing authority *within the mutable frontier*, and PLAN §12 says the still-mutable manuscript is reconstructed from scratch on every request. A stored frontier could satisfy neither without a resync path. The user's report was the trigger, verbatim: "I'm getting irritated by the thing where it just has a frozen snapshot of a previous thing instead of the current chat thing when I'm trying to debug via changing the past."

This does not weaken "compiled once, remembered" (`docs/protocol/host-mapping.md#s16-freeze`). A frozen span is still compiled exactly once and never recompiled or re-cut (INV-6); what was removed is the accumulation of the *un*compiled region, where nothing has been compiled and therefore nothing needs remembering. Brief 0018 already carved out the pristine case on this argument; this generalises it from "before anything is frozen" to "everything after the watermark".

## Alternatives rejected

- **Keep the stored frontier and re-derive it on MESSAGE_EDITED / SWIPED / DELETED.** Three more listeners, three more save paths, and a reconciliation between two copies that can still disagree whenever an edit arrives by a route that fires no event. The bug class survives the fix.
- **Positional inclusion (find the watermark's index, take the tail).** Needs repair code for a deleted frozen message, a deleted watermark message, and any reordering. Per-message inclusion by id needs none: an absent message is simply absent (`docs/modules/derive.md#per-message`).
- **Ids derived from the chat index, a counter or a timestamp.** Cheaper to read while debugging, and a permanent record of where in the interaction each message sat — exactly the transport topology INV-10 discards, persisted into the chat file.
- **Caching the derived string.** A dirty flag is a second source of truth about whether the chat changed, which is the failure this decision removes. The derivation is a string join over an in-memory array, once per generation.
- **Re-deriving the v1 frontier for chats that already have frozen spans.** The stored frontier has no message-level provenance, so there is no honest mapping back onto `chat[]`; guessing one would silently duplicate or drop text.

## Consequences

- Removed outright: `state.frontier`, `initialiseFromChat`, `setFrontier`, `appendToFrontier`, `isPristine`, `reseedIfPristine`, `maybeFreeze`, recovery's `appendedText` marker and `lastAppend` session record, recovery's swipe-replacement branch and its warning, and the `MESSAGE_SWIPED` / `MESSAGE_EDITED` / `MESSAGE_DELETED` subscriptions.
- `STATE_VERSION` is `2`, with a one-shot in-place `migrateV1` (`docs/modules/state.md#migration-v1`). Its approximation: a chat that already has frozen spans keeps its v1 frontier tail as an extra frozen span, so the model's view stays byte-continuous, but that tail becomes uneditable and a trailing incomplete block in it is dropped. Every existing non-system message is marked consumed, so nothing is sent twice.
- Every non-system message carries a random id in `extra[METADATA_KEY].id`, written by `capture` and `recovery` on saves they already perform.
- Recovery now writes the boundary trim into `message.mes` (and the active swipe), because the message text *is* the frontier; previously only its private copy was trimmed.
- Automatic freezing is back on since brief 0020b, which supplied the missing cut → message mapping (`docs/modules/freeze.md#watermark-mapping`). `selectCut` is unchanged; the apply step translates its character offset using the segment list the derivation already returns, marking wholly-consumed messages in `frozenIds` and recording at most one partially consumed message as the watermark. The mapping is refused rather than approximated when the cut would fall strictly inside a block whose derived text is not a verbatim slice of `mes` — a user turn that gained a tag header at derive time — because no true offset into `mes` exists there; the freeze simply does not happen and the next receipt tries again against a longer frontier. That refusal is the price of deriving instead of accumulating, and it is cheap: the cut point is advisory, not a deadline.
- The one consequence the collaborator can see is a toast when they edit a message a frozen span already consumed, since that edit reaches the visible log only (`docs/modules/freeze.md#frozen-edit-notice`).
- Accepted cost: deleting the watermark message deletes its un-frozen remainder from the manuscript. It is the collaborator's own edit, and the visible log just did the same thing.
