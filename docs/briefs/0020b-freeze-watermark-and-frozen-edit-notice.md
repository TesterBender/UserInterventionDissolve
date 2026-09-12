# Brief 0020b — freezing against the derived frontier: watermark mapping and the frozen-edit notice
Status: implemented
Complexity: high
PLAN sections: §16 (freezing promotes the mutable frontier into immutable history; append-only, old spans never re-cut, target 3,000–4,200 words with jitter, overrun allowed for a better boundary), §17 (cut selection avoids the external character and high-salience structure — unchanged heuristics, re-used verbatim), §12 (the frontier is normalized every request; freezing is the separate, occasional event that moves text out of it), §10 (editing authority is manuscript-wide within the mutable frontier — the notice tells the collaborator when an edit has fallen outside it)
Invariants touched: INV-6 (append-only, cuts only at complete block boundaries — now also "never inside a message whose transform is not offset-preserving"), INV-7 (cut selection heuristics unchanged), INV-4 (freezing is the only thing that moves the watermark), INV-10 (the watermark records a text offset, never a turn count, index or timestamp)

## Prerequisite
Brief **0020a** must be merged first. It removes `state.frontier` and `maybeFreeze`, adds `src/derive.js` with `deriveFrontier(chat, state, literal) → { text, segments }`, and leaves automatic freezing switched off. This brief turns it back on.

## Goal
Freezing works again, against the derived frontier: after a receipt, `recovery` derives the frontier, `freeze` selects a cut with its existing §17 heuristics, the frozen text is pushed into `state.frozen`, and the cut position is translated back into `(messageId, offset)` so the next derivation starts exactly where the frozen span ended. Fully consumed messages join `state.frozenIds`. Editing a message that a frozen span already consumed produces one toast telling the collaborator the edit is log-only. Nothing else about freezing changes: same target, same jitter, same salience rules, same append-only refusal.

## In scope

### `src/derive.js` — one field
- Each segment gains `sourceStart`: the offset **within the source message's `mes`** that corresponds to `segment.start` in the derived text, or `null` when the mapping is not offset-preserving.
  - Let `base` be the watermark offset applied to that message (`0` for every message other than the watermark one).
  - If the transformed block equals `sourceText.trim()` — true for every assistant message and for a user message whose tag header already matched — then `sourceStart = base + (sourceText.length - sourceText.trimStart().length)`.
  - Otherwise (the user block got a `${literal} ` prefix, so derived offsets no longer line up with `mes`) `sourceStart = null`.
- No other change to `deriveFrontier`; it stays pure and its existing tests stay valid.

### `src/state.js` — one export
- `advanceWatermark(state, { messageId, offset, consumedIds })` — mutates in place: pushes each id of `consumedIds` that is a non-empty string and not already present onto `state.frozenIds`, and sets `state.watermark = { messageId: messageId ?? null, offset: Number.isFinite(offset) ? offset : 0 }`. No removal path, no sorting, no dedup beyond the membership check, no return value beyond `undefined`. `pushFrozen`, `getState`, `migrateV1` and `save` are unchanged.

### `src/freeze.js` — `maybeFreeze` returns in derived form
- `selectCut`, `countWords`, the jitter and every salience heuristic are **unchanged**; do not re-tune, re-order or re-test them.
- `maybeFreeze(state, derived, literal, opts = {})` where `derived` is the `{ text, segments }` object:
  1. `const cut = selectCut(derived.text, literal, opts)`; `null` ⇒ return `null`.
  2. Map `cut.frozenEnd` (an offset into `derived.text`) to a message position:
     - Find the segment `s` with `s.start <= cut.frozenEnd && cut.frozenEnd <= s.end`. No such segment (impossible for a well-formed derivation, but the cut may land exactly on a delimiter between segments) ⇒ treat a `frozenEnd` that equals some segment's `end` as that segment; if still unmatched, return `null` without freezing.
     - **Fully consumed**: `cut.frozenEnd === s.end` ⇒ `consumedIds` = the ids of every segment with `end <= cut.frozenEnd`, `messageId = null`, `offset = 0`.
     - **Partially consumed**: `cut.frozenEnd` strictly inside `s` ⇒ if `s.sourceStart === null` or `s.id === null`, return `null` without freezing (the cut would fall inside a transformed user block whose tag prefix cannot be reconstructed from `mes`; the next receipt will try again at a different boundary — this is the INV-6 "never freeze through the middle of a block" rule extended to message transforms). Otherwise `consumedIds` = ids of every segment with `end <= s.start`, `messageId = s.id`, `offset = s.sourceStart + (cut.frozenEnd - s.start)`.
     - A segment whose `id` is `null` in `consumedIds` is dropped by `advanceWatermark`'s non-empty-string check; an untouched message therefore never gets marked consumed. Since `recovery` calls `assignIds` before freezing, this only happens for messages that are not in `chat` handling at all.
  3. `pushFrozen(state, { text: derived.text.slice(0, cut.frozenEnd), words: cut.words })`; a refusal returns `null` and leaves `state` byte-identical (no watermark move).
  4. `advanceWatermark(state, { messageId, offset, consumedIds })`.
  5. Return `{ frozenIndex, words, target, overrun, blockIndex, watermark: { messageId, offset } }`. The old `index` field is dropped; nothing consumed it.
- `FROZEN_EDIT_NOTICE` — exported const, exact text:
  `That part of the manuscript is already frozen; this edit stays in the log only.`
  **Do not reword during implementation. A user-requested change goes through the pinned-string lane (`docs/workflow/workflow.md#pinned-string-lane`) as an amendment to this brief.**
- `noticeFrozenEdit(index, ctx = getCtx())` → boolean. Reads `ctx.chat?.[index]`; returns `false` unless the message's `extra?.[METADATA_KEY]?.id` is a string present in `getState(ctx).frozenIds`. Otherwise calls `globalThis.toastr?.info(FROZEN_EDIT_NOTICE)` — no title, no options, no console fallback, no throw if `toastr` is missing — and returns `true`. It writes nothing and saves nothing. The **watermark message is deliberately not covered**: an edit there re-derives the part after the offset, which is correct behaviour, so no notice is shown.
- This is the only impure function in `src/freeze.js`; it and `maybeFreeze`'s `getState` use are the reason the module now imports from `host.js`/`state.js`.

### `src/recovery.js` — re-enable freezing
- After the receipt markers are set and before the saves: `const state = getState(ctx); const result = maybeFreeze(state, deriveFrontier(ctx.chat, state, reservedLiteral(ctx)), literal, {});` and `await save(ctx)` (metadata) when `result !== null`. `assignIds(ctx.chat)` must already have run so every segment has an id. Remove the `freeze-disabled` pointer comment from 0020a and restore a `// freeze-after-receipt: … → docs/modules/recovery.md#freeze-hookup` pointer.
- No other recovery behaviour changes. Freezing is attempted **once per receipt** and nowhere else — not on send, not on edit, not on chat load.

### `index.js` — two subscriptions
- Re-add to the existing guarded handler map: `MESSAGE_EDITED: (id) => noticeFrozenEdit(id)` and `MESSAGE_SWIPED: (id) => noticeFrozenEdit(id)`. MESSAGE_DELETED stays unsubscribed. No other wiring changes.

### Tests
- `tests/freeze.test.js` — restore `maybeFreeze` coverage in its new form; `selectCut` cases untouched.
- `tests/derive.test.js` — `sourceStart` cases.
- `tests/state.test.js` — `advanceWatermark` cases.
- `tests/recovery.test.js` — the freeze hookup.
- `tests/bootstrap.test.js` — the event-count assertion and title (11 → 13) and the toast handlers.
- `tests/helpers/fake-context.js` — only if a toastr stub is needed; install it on `globalThis.toastr` and remove it on teardown.

## Out of scope (explicit)
- **Re-cutting, un-freezing, or editing a frozen span** (INV-6). No "unfreeze last span", no repair, no recompile, no span merge or split.
- **Changing cut selection**: no new heuristic, no target change, no configurable size, no forced freeze when a message is huge, no retry loop that scans for another cut within the same call.
- **Freezing anywhere other than after a receipt**: no timer, no on-load freeze, no manual freeze command, no freeze on capture.
- **Any further UI.** The toast is the only surface. No frontier-length indicator, no "frozen up to here" marker in the chat, no settings entry, no styling, no toast on delete, on capture, or on a watermark-message edit, no second string.
- **Rewriting `mes` when a span is frozen.** The visible log is left exactly as it is; freezing changes only `chatMetadata`.
- Changing `deriveFrontier`'s inclusion rules, the message-id scheme, `toManuscriptBlock`, the boundary module, the prompt text, or any model-facing string.
- New dependencies; `toastr` is an existing page global, not an import.

## Files
- allowed to create/modify: `src/freeze.js`, `src/state.js` (`advanceWatermark` only), `src/derive.js` (`sourceStart` only), `src/recovery.js` (the freeze hookup only), `index.js` (the two handler entries only), `tests/freeze.test.js`, `tests/state.test.js`, `tests/derive.test.js`, `tests/recovery.test.js`, `tests/bootstrap.test.js`, `tests/helpers/fake-context.js`, `docs/modules/freeze.md`, `docs/modules/state.md`, `docs/modules/derive.md`, `docs/modules/recovery.md`, `docs/modules/bootstrap.md`, `docs/protocol/host-mapping.md` (`#s16-freeze` only), `docs/decisions/0004-derived-frontier.md` (the watermark-mapping paragraph only, plus one bullet on the frozen-edit toast — authorised by orchestrator 2026-09-13), and this brief's Status line
- must not touch: `src/frontier.js`, `src/capture.js`, `src/constants.js`, `src/boundary.js`, `src/grammar.js`, `src/prompt.js`, `src/solo.js`, `src/starter.js`, `src/host.js`, `src/preset-template.js`, `src/ui/**`, `style.css`, `manifest.json`, `presets/*`, `package.json`, `eslint.config.js`, `vitest.config.js`, `tools/*`, `PLAN.txt`, `CLAUDE.md`, `docs/api/sillytavern.md`, `docs/protocol/invariants.md`, `tests/frontier.test.js`, `tests/capture.test.js`, `tests/boundary.test.js`, `tests/grammar.test.js`, other `docs/briefs/*`

## ST APIs used
- `SillyTavern.getContext()` (only via `getCtx()` in `src/host.js`) — docs/api/sillytavern.md#getcontext (status: verified)
- `chatMetadata` + `saveMetadata()` — docs/api/sillytavern.md#chat-metadata (status: verified)
- `MESSAGE_EDITED (id)` / `MESSAGE_SWIPED (mesId)` payloads — docs/api/sillytavern.md#message-lifecycle-events (status: verified)
- `MESSAGE_RECEIVED (index, type)` — docs/api/sillytavern.md#message-received (status: verified)
- Message object shape (`mes`, `extra`) — docs/api/sillytavern.md#message-shape (status: verified)
- `toastr` as a page global, `toastr.info(message)` — docs/api/sillytavern.md#toastr (status: verified)

## Verification needed
- (empty — every entry above is `status: verified`.)

## Acceptance
- [x] A derived frontier long enough to cut freezes: `state.frozen` gains one span whose text is `derived.text.slice(0, cut.frozenEnd)`, and the next `deriveFrontier` with the updated state returns exactly the remainder — byte-identical to `derived.text.slice(cut.index)` after trimming the delimiter.
- [x] Fully consumed messages land in `state.frozenIds` and the watermark is `{ messageId: null, offset: 0 }`; a cut inside an assistant message sets `watermark = { messageId: <that id>, offset }` with `mes.slice(offset)` equal to the un-frozen remainder of that message.
- [x] A cut that would fall strictly inside a segment with `sourceStart === null` returns `null` and leaves `state` deep-equal to before (no span pushed, no watermark move).
- [x] `pushFrozen` refusal (mid-block text) leaves `frozenIds` and `watermark` untouched.
- [x] `advanceWatermark` never adds a duplicate or a `null` id and never removes one.
- [x] After a freeze, a second `maybeFreeze` on the newly derived (now short) frontier returns `null`; freezing happens once per receipt.
- [x] INV-10: freezing twice from two different live histories that yield the same derived text and state produces deep-equal `frozen`, `frozenIds` and `watermark`.
- [x] `noticeFrozenEdit` calls `globalThis.toastr.info` exactly once with the exact `FROZEN_EDIT_NOTICE` text for a message whose id is in `frozenIds`; returns `false` and calls nothing for an unfrozen message, for the watermark message, for a message with no id, for an out-of-range index, and when `globalThis.toastr` is undefined (no throw).
- [x] Emitting MESSAGE_EDITED and MESSAGE_SWIPED after importing `index.js` routes the payload id to `noticeFrozenEdit`; MESSAGE_DELETED has no subscriber.
- [x] Every pre-existing `selectCut` test passes unchanged and `src/freeze.js`'s heuristic code is byte-identical apart from the new exports.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/freeze.md` — new `## Watermark mapping {#watermark-mapping}` (derived-text offset → `(messageId, offset)`; the fully-vs-partially-consumed cases; why a cut inside a non-offset-preserving user block is refused rather than approximated, and that refusing costs nothing because the next receipt retries); new `## Frozen-edit notice {#frozen-edit-notice}` (the pinned string verbatim, that it is the only UI in the freeze path, why the watermark message is excluded, and that `toastr` is a page global accessed defensively — `docs/api/sillytavern.md#toastr`). Restore the `maybeFreeze` description under the existing candidates heading.
- `docs/modules/state.md` — `advanceWatermark` under the shape/append-only headings: the only writer of `watermark` and `frozenIds`, no removal path.
- `docs/modules/derive.md` — `#derivation-rule` gains `sourceStart`: what it means, when it is `null`, and that `freeze` is its only consumer.
- `docs/modules/recovery.md` — `#freeze-hookup` rewritten: freezing runs once per receipt against a freshly derived frontier, after ids are assigned; metadata is saved only when a span was pushed.
- `docs/modules/bootstrap.md` — the two lifecycle subscriptions exist again, now for the notice only, and MESSAGE_DELETED intentionally has none.
- `docs/protocol/host-mapping.md#s16-freeze` — freezing now consumes messages: the watermark and `frozenIds` are what "compiled once, remembered" means concretely, and an edit to a consumed message is log-only and says so once.
- `docs/decisions/0004-derived-frontier.md` — one paragraph on the cut→message mapping and the refusal rule.

## Carry-forward
- The INV-10 freeze test covers only the interleaved-system-message case: two histories whose derived text matches because the extra messages are skipped. The stronger case — the same derived text split across a *different number* of messages — is untested, and `watermark`/`frozenIds` may legitimately differ in shape there (different ids; a partial cut in one history where the other cuts on a clean message boundary) while the model-visible manuscript is identical. Whether INV-10 is stated over the derived text alone or over the state shape too needs deciding before that test can be written.
