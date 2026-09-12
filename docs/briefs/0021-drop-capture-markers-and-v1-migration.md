# Brief 0021 — drop the capture module, the receipt markers and the v1 migration
Status: implemented
Complexity: low
PLAN sections: §9 (collaborator input is captured and transformed into manuscript text before it is merged — the transform, not the moment it happens, is what §9 requires), §10 (capture is character-specific, editing is manuscript-wide within the mutable frontier), §14 (four outcomes classified per generation; incomplete trailing blocks rolled back), §15 (barge-in is normalised exactly like a stop-triggered insertion, and the two must be indistinguishable after reconstruction)
Invariants touched: INV-3, INV-8

## Goal

After the derived frontier (decision 0004) the extension still carries three pieces of bookkeeping that nothing reads any more: the `captured` message marker and the whole `MESSAGE_SENT` handler that writes it, the `received` message marker plus the resample bypass that exists only to get past it, and the v1→v2 state migration. When this is done, `src/capture.js` no longer exists, `toManuscriptBlock` lives in `src/derive.js` next to its only caller, `index.js` subscribes to no send event, `src/recovery.js` classifies every eligible receipt unconditionally, and `getState` treats any stored structure whose `version` is not `2` as absent: it warns once and replaces it with a fresh `createState()`. Behaviour the collaborator can observe is unchanged except that opening a chat written by v1 starts that chat's protocol state over.

Why each removal is safe, in one line each: derivation transforms **every** user message from its current text on every request, so nothing consults `captured`; `assignIds(ctx.chat)` in recovery already gives every eligible message an id at receipt, so capture's id pass is redundant; SillyTavern only ever resamples the last message, and a repeated receipt on the same message is idempotent under derivation (the rollback and the boundary trim are idempotent on already-trimmed text, the id is already present, and a second `maybeFreeze` on the post-freeze derivation finds a shorter frontier); old test chats are inconsequential, so migration is dead weight next to "discard and start fresh".

## In scope

### Capture removal

- Move `toManuscriptBlock` from `src/capture.js` into `src/derive.js` unchanged — same signature, same body, same behaviour, still exported. Its two pointer comments move with it and must now resolve to `docs/modules/derive.md#transformation-rule` and `docs/modules/derive.md#reserved-literal`. `src/derive.js` imports `parseTagHeader` from `./grammar.js` and no longer imports from `./capture.js`.
- Delete `src/capture.js`. Its only other contents are `captureMessage` (id assignment + `captured` marker + `saveChat`), all of which go with it.
- Remove from `index.js`: the `import { captureMessage } from './src/capture.js'` line, the `MESSAGE_SENT` entry of the handler map, and the `// capture-subscription:` pointer comment above it. Nothing else in `index.js` changes; the guarded subscription loop keeps its shape.
- Delete `tests/capture.test.js`. Move its `describe('toManuscriptBlock', …)` block verbatim into `tests/derive.test.js`; drop everything else in the file (the `captureMessage` suite, the `MESSAGE_SENT subscription` suite, and the `src/capture.js` source-shape suite).

### Recovery

- In `src/recovery.js` `onMessageReceived`: delete the `isResample` constant and its pointer comment, delete the `if (mark.received === true && !isResample) return 'skipped'` guard and its pointer comment, and delete the `message.extra[METADATA_KEY] = { ...message.extra[METADATA_KEY], received: true }` write. `mark` stays, because `mark.boundary` is still the classifier's boundary signal.
- Delete the now-redundant `ensureMessageId(message)` call that immediately preceded the marker write — the following `assignIds(ctx.chat)` covers that message by the same eligibility test the handler already applied. Drop `ensureMessageId` from the module's import list if it becomes unused.
- There is no `resetRecoveryState` in the module today; if the implementer finds any other symbol that existed solely to reset the `received` marker, delete it too and say so.
- `tests/recovery.test.js`: drop the `received`-marker assertions; replace the "does nothing on a repeated event for the same index" test with one asserting that a second receipt for the same index is **idempotent** — same returned outcome, `message.mes` unchanged, the id unchanged, the derived frontier unchanged, and no second frozen span pushed — while accepting that it saves the chat again.

### State

- Delete `migrateV1` from `src/state.js` and its export. `truncateToLastCompleteBlock`, `assignIds` and `METADATA_KEY` imports go if they become unused; `STATE_VERSION` stays `2`.
- `getState`: an absent key still materialises `createState()` as today. A stored structure whose `version !== STATE_VERSION` is now treated as absent — `warnOnce(stored)`, then assign a fresh `createState()` to `ctx.chatMetadata[METADATA_KEY]` and return it. Nothing is saved here; the first real write persists it, exactly as for the absent case.
- `tests/state.test.js`: delete the `migrateV1` suite, remove `'migrateV1'` from the export-surface assertion, and replace the v1-in-metadata cases with assertions that a `version: 1` (and a version-less, and a `version: 99`) structure is replaced by a fresh v2 state, warned about once per object, and not saved.
- `tests/bootstrap.test.js`: update only what the removed `MESSAGE_SENT` entry breaks. The existing subscription assertions are inclusion-style, so a no-op outcome is the expected result; do not add new assertions for the absence.

### Docs

- Delete `docs/modules/capture.md`.
- `docs/modules/derive.md`: header block becomes `Owns: INV-3, INV-4, INV-10` / `Depends on: constants, grammar`. Add the `#transformation-rule` and `#reserved-literal` headings, carried over from `capture.md` and edited only where they say capture owns them. Fix the `#derivation-rule` and `#message-ids` references to `docs/modules/capture.md#…`; the sibling-marker sentence under `#message-ids` should cite `docs/modules/boundary.md#boundary-marker` instead, and drop `capture` from "`capture` and `recovery` call it".
- `docs/modules/recovery.md`: rewrite `#append` so it describes a receipt that writes no marker at all, and rewrite `#swipes` so it says a resample needs no special case because classification is unconditional and idempotent. Keep both anchors — they are cited from code and from other docs.
- `docs/modules/state.md`: delete the `## Migration from v1 {#migration-v1}` section; fold its replacement rule into `## Unknown version`, which now says the structure is **replaced**, not preserved, and explains why (the stored structure is the model's conditioning surface, but a shape this codebase cannot read is not usable as one, and v1 chats are test chats). Update the `Depends on:` line if `derive` and `grammar` drop out.
- `docs/modules/bootstrap.md`: delete `## Capture subscription {#capture-subscription}`; remove the migration clause from `#state-materialisation`; remove `capture` from the module lists in the intro paragraph and in the `#state-materialisation` closing sentence.
- `docs/protocol/host-mapping.md`: in the row table, change the module cell for the §9/§10 row and the §15 row from `capture` to `derive`, and change the ST-mechanism cell of the §9/§10 row to say no pre-send hook exists and the transform happens at prompt build. Rewrite `#s9-capture` to say that capture is now implicit in derivation: the composer message lands in `chat[]` verbatim, **nothing happens at send**, and the message is transformed into a tagged manuscript block at request time by `toManuscriptBlock` inside the derivation. Keep the "no pre-send hook" fact and the INV-3 argument; drop the two-paths choice, which has been made.
- `docs/protocol/invariants.md`: in the row table only, change INV-3's owning module from `capture` to `derive`. No other edit to that file. (This file is not in the task's allowlist; it is added here because the table would otherwise name a module that no longer exists.)
- `docs/decisions/0004-derived-frontier.md`: append a short `## Status` section at the end recording that brief 0021 removed the `captured` and `received` markers, the `MESSAGE_SENT` subscription and `migrateV1`, that ids are now written by `recovery` alone, and that a non-v2 state is discarded rather than migrated. Do **not** edit the existing Decision, Alternatives or Consequences prose — a decision record is history.
- `CLAUDE.md`: remove `capture` from the `src/` layout line. Nothing else in that file.

## Out of scope (explicit)

- Any change to `src/freeze.js`, `src/boundary.js`, `src/frontier.js`, `src/grammar.js`, `src/constants.js` or their docs and tests. Freeze is untouched, including the frozen-edit toast, which stays exactly as it is.
- Removing or renaming the `boundary` message marker. It is still read by the classifier.
- Removing `extra[METADATA_KEY].id` or changing how ids are generated or spread.
- A cleanup pass over `captured`/`received` values that appear as *fixture data* in `tests/frontier.test.js`, `tests/boundary.test.js` and `tests/derive.test.js`. They are arbitrary extra keys there and prove the spread-preservation behaviour; leave them.
- Editing `docs/modules/boundary.md`, `docs/modules/host.md` or `docs/decisions/0002-structure-from-intercede.md`, all of which mention `capture` in prose. Stale prose there is a `SCOPE_GAP`, not this brief's work.
- Migration, import or repair of any kind for non-v2 state. No backup copy, no "migrate on demand" command, no user prompt before discarding.
- A settings toggle for anything above, a `capture` shim module that re-exports `toManuscriptBlock`, or a deprecation period. The import is updated at its one call site.
- Renaming `deriveFrontier`, `assignIds`, `getState`, `createState` or any other surviving export.

## Files

- allowed to create/modify: `src/capture.js` (delete), `src/derive.js`, `src/recovery.js`, `src/state.js`, `index.js`, `tests/capture.test.js` (delete), `tests/derive.test.js`, `tests/recovery.test.js`, `tests/state.test.js`, `tests/bootstrap.test.js`, `docs/modules/capture.md` (delete), `docs/modules/derive.md`, `docs/modules/recovery.md`, `docs/modules/state.md`, `docs/modules/bootstrap.md`, `docs/protocol/host-mapping.md`, `docs/protocol/invariants.md` (INV-3 row cell only), `docs/decisions/0004-derived-frontier.md` (appended `## Status` section only), `CLAUDE.md` (layout line only), and this brief's Status line.
- must not touch: `src/freeze.js`, `src/boundary.js`, `src/frontier.js`, `src/grammar.js`, `src/constants.js`, `src/host.js`, `src/solo.js`, `src/prompt*`, `src/ui/**`, `tests/helpers/**`, `tests/frontier.test.js`, `tests/boundary.test.js`, `tests/freeze.test.js`, `manifest.json`, `presets/**`, `PLAN.txt`, `docs/modules/README.md` (it does not list `capture`; verify and leave it), every other file under `docs/`.

## ST APIs used

- `SillyTavern.getContext()` — docs/api/sillytavern.md#getcontext (status: verified)
- Message object shape (`mes`, `extra`, `swipes`, `swipe_id`, `is_user`, `is_system`) — docs/api/sillytavern.md#message-shape (status: verified)
- MESSAGE_RECEIVED — docs/api/sillytavern.md#message-received (status: verified)
- MESSAGE_SENT — docs/api/sillytavern.md#message-sent (status: verified) — cited only because this brief stops using it
- `updateMessageBlock` — docs/api/sillytavern.md#updatemessageblock (status: verified)
- Per-chat persistence (`chatMetadata`, `saveChat`, `saveMetadata`) — docs/api/sillytavern.md#chat-metadata (status: verified)
- Pre-send transform/cancel hook — docs/api/sillytavern.md#pre-send-hook (status: absent) — the fact `#s9-capture` keeps

## Verification needed

- (empty)

## Acceptance

- [x] `src/capture.js` and `tests/capture.test.js` do not exist; no file in `src/`, `index.js` or `tests/` imports `./capture.js`.
- [x] `toManuscriptBlock` is exported from `src/derive.js`, and every assertion of the moved `toManuscriptBlock` suite passes unchanged in `tests/derive.test.js`.
- [x] Emitting `MESSAGE_SENT` after loading `index.js` writes nothing to the message and calls neither `saveChat` nor `saveMetadata`; the next derivation still tags that message's text. Untestable as a new assertion in `tests/bootstrap.test.js`/`tests/state.test.js` per this brief's own instruction ("do not add new assertions for the absence"); guaranteed structurally instead — `index.js` registers no `MESSAGE_SENT` handler at all (grep-verified), so the emitter has no listener to run and nothing can be written; the next request's `deriveFrontier` still transforms the message's current text regardless (covered by `tests/derive.test.js`).
- [x] No source file under `src/` or `index.js` contains the string `captured` or `received` as a metadata key (grep-verified).
- [x] Calling `onMessageReceived` twice for the same complete message returns the same outcome both times and leaves `mes`, the id and the derived frontier identical after the second call, with no second frozen span pushed.
- [x] A message received with `type` `'swipe'` or `'regenerate'` whose text ends in an incomplete block is still rolled back (INV-8), with no type-specific branch in the module.
- [x] `src/state.js` exports exactly `advanceWatermark`, `createState`, `getState`, `pushFrozen`, `save`.
- [x] `getState` on a context whose metadata holds `{ version: 1, … }`, a version-less object, or `{ version: 99 }` returns a fresh `createState()` object, assigns it to `chatMetadata[METADATA_KEY]`, emits exactly one `console.warn` per stored object, and calls no save.
- [x] `getState` on a valid `version: 2` structure returns that same object identity, unchanged.
- [x] `docs/modules/capture.md` is gone and no non-brief file under `docs/` links to it.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update

- `docs/modules/derive.md#transformation-rule` — the tag-the-first-block-only rule, carried over from capture, now owned here.
- `docs/modules/derive.md#reserved-literal` — the literal is an argument, borrowed from `boundary`, empty name writes no tag.
- `docs/modules/derive.md#message-ids` — ids are written by `recovery` alone, on the save it already performs.
- `docs/modules/recovery.md#append` — a receipt writes no marker; classification is unconditional and idempotent, and why that is safe.
- `docs/modules/recovery.md#swipes` — a resample needs no bypass because there is no guard to bypass.
- `docs/modules/state.md#unknown-version` — any non-v2 structure is discarded and replaced with a fresh state; why discarding beats migrating here.
- `docs/modules/bootstrap.md#state-materialisation` — materialisation only; no migration step at chat open.
- `docs/protocol/host-mapping.md#s9-capture` — capture is implicit in derivation: nothing happens at send, the composer message is transformed at request time.
- `docs/decisions/0004-derived-frontier.md#status` — what brief 0021 removed and what replaced the migration.
