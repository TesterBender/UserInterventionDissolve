# Brief 0020a — the mutable frontier becomes derived from the visible chat
Status: done
Complexity: high
PLAN sections: §9 (collaborator input is captured and *transformed* into a manuscript block before it reaches the model; the transform is what INV-3 needs, not the moment it happens), §10 (editing authority is manuscript-wide **within the mutable frontier** — the collaborator may change Mara blocks, model tags, buffers, ordering and wording of anything not yet frozen), §12 (normalization happens **every request**; the next request reconstructs the still-mutable manuscript from scratch so earlier live seams disappear), §16 (freezing is append-only and old frozen spans are not re-cut — unchanged by this brief and the reason frozen spans stay compiled-once)
Invariants touched: INV-3 (the transform moves from capture-time to derive-time and must still apply to every user message), INV-4 (reconstruction every request — this brief makes it literal), INV-6 (frozen spans stay append-only and immutable), INV-10 (derivation must be a pure function of `(chat, state)` so many live histories collapse to one manuscript)

## Goal
The mutable frontier stops being a string accumulated in `chatMetadata` and becomes a pure function of the visible chat plus the frozen watermark, computed on every request. Editing, swiping or deleting any not-yet-frozen message in SillyTavern's chat changes what the model sees on the very next generation, with no extra code path and no resync. Frozen spans are untouched: still compiled once, still immutable, still the only thing that stops tracking `chat[]`. When this brief is done, `state.frontier` no longer exists, `capture` and `recovery` no longer append text anywhere, and the reconstruction reads `ctx.chat` through one pure derivation.

## Why this does not break "compiled once, remembered"
`docs/protocol/host-mapping.md#s16-freeze` says a frozen span is compiled exactly once and thereafter no longer tracks `chat[]`. That stays true verbatim. What this brief removes is the accumulation of the **un**compiled region into a second copy of the same text: until a span is frozen, nothing has been compiled, so there is nothing to remember, and the honest source is the chat the collaborator is looking at. Brief 0018 already carved out the pristine case on exactly this argument; this brief generalises it from "before anything is frozen" to "everything after the freeze watermark", which is precisely PLAN §10's mutable frontier. User report, verbatim: "I'm getting irritated by the thing where it just has a frozen snapshot of a previous thing instead of the current chat thing when I'm trying to debug via changing the past. Anyway, on to actual implementation of the next thing to then allow for the freedom to EDIT THINGS without freezing them."

## Sequencing
This brief is 0020a of two. Brief **0020b** re-enables freezing on top of the derived frontier (cut offset → `(messageId, offset)` watermark advance) and adds the frozen-edit toast. They share files (`src/state.js`, `src/freeze.js`, `src/recovery.js`, `index.js`, docs) and must run in order; 0020a leaves automatic freezing **switched off** and deletes `maybeFreeze` outright rather than leaving a function wired to a state field that no longer exists.

## In scope

### `src/constants.js`
- `STATE_VERSION` becomes `2`. No other constant is added, removed or changed.

### `src/state.js` — state shape v2
- `createState()` returns `{ version: 2, frozen: [], frozenIds: [], watermark: { messageId: null, offset: 0 } }`. There is no `frontier` key and no code may create one.
  - `frozen` — unchanged: `[{ text, words, createdAt }]`, append-only.
  - `frozenIds` — array of extension-assigned message ids whose text has been **fully** consumed by a frozen span. Order is irrelevant; membership is the only query. Stored as an array because `chatMetadata` is JSON.
  - `watermark` — the one **partially** consumed message: `{ messageId, offset }`, where `offset` is a character offset into that message's `mes`. `messageId: null` means no message is partially consumed. Only brief 0020b writes it; 0020a only reads it and migrates it.
- `getState(ctx)` keeps its current structure with one addition: a stored object with `version === 1` is migrated **in place** by `migrateV1(state, chat)` (see below) before being returned, and the migrated object is the same object reference that stays in `chatMetadata`. `getState` still never calls `saveMetadata`; the first `save()` from any caller persists the migration. Any version that is neither 1 nor 2 keeps the existing `#unknown-version` behaviour exactly: return untouched, warn once per object via the `WeakSet`, never repair.
- `migrateV1(state, chat)` — exported, deterministic, one-shot:
  - Sets `version = 2`, ensures `frozen` is an array (a non-array `frozen` is not migrated: leave the object alone, warn once, return `false` — that is an unknown structure, not a v1 one).
  - If `frozen.length === 0`: `delete state.frontier`, `frozenIds = []`, `watermark = { messageId: null, offset: 0 }`. The v1 frontier text is discarded because derivation reproduces it from the same chat it was seeded from (brief 0018's pristine path).
  - If `frozen.length > 0`: the v1 frontier text is a compiled tail with no message-level provenance, so it is preserved as history rather than as mutable text — `truncateToLastCompleteBlock(state.frontier)` (`src/grammar.js`) and, if non-empty, `pushFrozen(state, { text })`; then `delete state.frontier`; then assign an id to every non-system message currently in `chat` and put **all** of them in `frozenIds`; `watermark = { messageId: null, offset: 0 }`. **Documented approximation**, to be written in the decision record and in `docs/modules/state.md`: the pre-migration tail keeps the model's view byte-continuous but becomes uneditable, and any trailing incomplete block in it is dropped. Nothing else in the chat is altered and no `saveChat` happens inside `migrateV1` (the caller that triggers the migration saves; see `capture`/`recovery` below).
- `pushFrozen(state, span)` — unchanged, including the mid-block refusal.
- `save(ctx)` — unchanged (`saveMetadata` only).
- **Removed exports** (delete the functions, their pointer comments and their tests): `initialiseFromChat`, `setFrontier`, `appendToFrontier`, `isPristine`, `reseedIfPristine`. Derivation subsumes all of them.

### `src/derive.js` (new)
- `ensureMessageId(message)` → string. Reads `message.extra?.[METADATA_KEY]?.id`; if absent, assigns a fresh random id (`Math.random().toString(36).slice(2, 10)`; no collision handling, no counter, no timestamp, no chat index — an id that encoded position or time would record interaction topology, INV-10) into `extra[METADATA_KEY].id` by spreading the existing marker object, and returns it. Mutates the message; does not save.
- `assignIds(chat)` → boolean. One pass over `chat`; for every entry that is an object with a string `mes` and `is_system !== true`, `ensureMessageId`. Returns `true` if any id was newly assigned. This is the **only** impure id path in 0020a: `capture` and `recovery` call it and then perform the `saveChat` they already perform, which is the "once per batch" rule. Derivation never assigns an id.
- `deriveFrontier(chat, state, literal)` → `{ text, segments }`, **pure**: it reads `chat` and `state` and mutates neither.
  - Build `frozenIds` as a `Set` from `state.frozenIds ?? []`; read `watermark` defensively as `{ messageId: null, offset: 0 }` when absent.
  - Iterate `chat` in order. Skip an entry that is not an object, whose `mes` is not a string, whose `is_system === true`, or whose id (read only, `extra?.[METADATA_KEY]?.id`) is in `frozenIds`. A message with **no** id is never in `frozenIds`, so it is included — that is what makes a brand-new message work before anyone has touched it.
  - Source text: `mes.slice(watermark.offset)` when the message's id equals `watermark.messageId` and the offset is a finite number `> 0`; otherwise `mes`.
  - Transform: `is_user === true` → `toManuscriptBlock(sourceText, literal)` imported from `src/capture.js`; otherwise `sourceText.trim()` verbatim (the model's own text needs no transform — `boundary` already trimmed the reserved tag on receipt and `recovery` already rolled back an incomplete trailing block **in the message itself**).
  - A block that is `''` after the transform contributes nothing and produces no segment.
  - `text` is the surviving blocks joined with `BLOCK_DELIMITER`; `segments` is `[{ id, start, end }]` in the same order, offsets into `text`, `end` exclusive, `id` being the message's existing id or `null` when it has none. (Brief 0020b adds one more field to each segment; nothing in 0020a consumes `segments` beyond its tests, and it is specified here because the same loop computes it and 0020b cannot map a cut back to a message without it.)
  - Empty chat, all-skipped chat, or a non-array `chat` → `{ text: '', segments: [] }`.
- Inclusion is **per message, not positional**: there is no "find the watermark index and take the tail". This is the rule chosen over an index/offset scan because it survives deletion of a frozen message (simply absent), deletion of the watermark message (absent; every later message is still included correctly), and reordering, with no repair code. Cost, to be documented: if the collaborator deletes the watermark message, its un-frozen remainder is gone from the manuscript — the same thing the visible log just did.

### `src/frontier.js`
- `buildHistory(state, { name1, name2 }, options)` — `options.frontier` (a string) supplies the mutable turn; `state.frontier` is no longer read anywhere. Frozen spans still come from `state.frozen`. All other rules unchanged: empty-state returns `[]`, a blank frontier adds no turn, `options.control` still overrides the control string.
- `interceptGeneration` — computes `const state = getState(ctx)` and `const { text } = deriveFrontier(ctx.chat, state, reservedLiteral(ctx))` on every call, then `buildHistory(state, …, { control?, frontier: text })`. It performs no writes: no id assignment, no `saveChat`, no `saveMetadata`.

### `src/capture.js`
- `toManuscriptBlock` is unchanged and stays exported from this module.
- `captureMessage(index, ctx)` keeps its guards (user, non-system, not already `captured`) and now does exactly: `ensureMessageId(message)`, mark `captured: true` (spread, as today), `assignIds(ctx.chat)`, `await ctx.saveChat()`. It no longer imports or calls `getState`, `appendToFrontier` or `save`, and no longer computes a block or returns `false` for a blank message — a blank message simply derives to nothing. Return value stays a boolean: `false` only for the existing guard failures.

### `src/recovery.js`
- Keeps: `SKIPPED_RECEIPT_TYPES`, `classifyOutcome`, the boundary trim, and the rollback that edits `message.mes` / `message.swipes[message.swipe_id]` + `updateMessageBlock` + `saveChat`. INV-8 is unchanged and its tests stay.
- The boundary trim now writes back into the message: when the outcome is `boundary`, the `trimAtBoundary` result is assigned to `message.mes` and to `message.swipes[message.swipe_id]` when present, followed by `updateMessageBlock` — previously the trim only affected the copy that was appended to the frontier, and with a derived frontier the message text *is* the frontier.
- Marker rename: `appended` → `received`. Assign `ensureMessageId(message)`, then `extra[METADATA_KEY] = { ...existing, received: true }`. Call `assignIds(ctx.chat)` before the save.
- **Removed entirely**: `appendToFrontier`/`setFrontier` use, `appendedText`, the module-level `lastAppend`, the whole swipe-replacement block and its `LOG_PREFIX` warning. If nothing is left for `resetRecoveryState` to reset, delete it and its call sites. Keep the `type === 'swipe' || type === 'regenerate'` check only if it is still needed to let a resampled message past the `received` guard; state which in the module doc.
- `maybeFreeze` is **not** called. Delete the import and leave exactly one pointer comment at the old call site: `// freeze-disabled: re-enabled with the watermark mapping → docs/modules/recovery.md#freeze-hookup`. No word-count check, no partial freeze, no fallback.
- `save(ctx)` (metadata) may be dropped if this module no longer changes metadata; `saveChat()` still runs when the message or its markers changed.

### `src/freeze.js` — narrow deletion only
- Delete `maybeFreeze` and the `import { pushFrozen, setFrontier } from './state.js'` line, because both of those names and `state.frontier` are gone. **Nothing else in the file changes**: `countWords`, `selectCut`, the jitter, the salience heuristics and every pointer comment stay byte-identical. Brief 0020b re-introduces `maybeFreeze` in its derived form.

### Tests
- New `tests/derive.test.js`; rewrite `tests/state.test.js`, `tests/capture.test.js`, `tests/recovery.test.js`, `tests/frontier.test.js` as needed; update the event-count assertion and title in `tests/bootstrap.test.js` (14 → 11) and any bootstrap assertion about the removed handlers. `tests/helpers/fake-context.js` keeps all current event names (0020b re-subscribes two of them) — add nothing unless a new test needs it.
- `tests/freeze.test.js`: delete only the `maybeFreeze` cases. Every `selectCut`/`countWords` case stays unchanged.

### `index.js`
- Remove the `MESSAGE_SWIPED`, `MESSAGE_EDITED` and `MESSAGE_DELETED` entries and the `reseedIfPristine` import (0020b re-adds EDITED and SWIPED for a different purpose). Every other subscription, the `getState()` materialisation on CHAT_CHANGED, the slash command and the settings render are unchanged.

## Out of scope (explicit)
- **Any freeze behaviour.** No cut selection change, no watermark advance, no `frozenIds` entry after migration, no re-enabling of automatic freezing, no temporary "freeze on word count" stopgap. The only edit to `src/freeze.js` is the deletion named above; brief 0020b owns the rest.
- **The frozen-edit toast** and any other UI, notification, status line or indicator. 0020b owns the toast; it is the only UI either brief adds.
- **Caching or memoising the derivation.** No per-request cache, no dirty flag, no "derive only when chat changed", no debounce. It is a pure string build over a chat that is already in memory.
- **Repair, resync or reconciliation paths.** No detection of a missing watermark message beyond the per-message inclusion rule, no "state looks wrong" recovery, no consistency check between `frozen` and `chat`.
- **Migration beyond v1→v2.** No v0 handling, no forward migration, no re-derivation of old frozen spans, no re-cutting (INV-6). Unknown versions keep the refuse-and-warn policy.
- **Persisting the derived text** anywhere, for any reason, including "for debugging".
- Changing `toManuscriptBlock`'s rules, the reserved-literal source, `CONTINUATION_CONTROL`, the solo variant, the boundary module, the grammar, the prompt text, or any model-facing string.
- New settings, toggles, slash commands, dependencies, or an id scheme with meaning (no counters, no timestamps, no `msg-<index>`).

## Files
- allowed to create/modify: `src/constants.js` (`STATE_VERSION` only), `src/state.js`, `src/derive.js` (new), `src/frontier.js`, `src/capture.js`, `src/recovery.js`, `src/freeze.js` (the deletion named above only), `index.js`, `tests/derive.test.js` (new), `tests/state.test.js`, `tests/capture.test.js`, `tests/recovery.test.js`, `tests/frontier.test.js`, `tests/freeze.test.js` (the `maybeFreeze` cases only), `tests/bootstrap.test.js`, `tests/helpers/fake-context.js`, `docs/modules/derive.md` (new), `docs/modules/state.md`, `docs/modules/capture.md`, `docs/modules/recovery.md`, `docs/modules/frontier.md`, `docs/modules/freeze.md`, `docs/modules/bootstrap.md`, `docs/modules/README.md` (index line for `derive.md`), `docs/protocol/host-mapping.md`, `docs/decisions/0004-derived-frontier.md` (new), `docs/decisions/README.md` (index line), and this brief's Status line
- authorised by orchestrator 2026-09-13: (a) `docs/decisions/README.md` gains a `## Records` list of 0001–0004 rather than a single index line, because the file held no index to append to; (b) `tests/freeze.test.js`'s `selectCut`/`countWords` cases were reshaped where they had reached through `maybeFreeze` (span word count, below-min and dense refusals, the INV-10 collapse, the default-window case), coverage preserved
- must not touch: `src/boundary.js`, `src/grammar.js`, `src/prompt.js`, `src/solo.js`, `src/starter.js`, `src/host.js`, `src/preset-template.js`, `src/ui/**`, `style.css`, `manifest.json`, `presets/*`, `package.json`, `eslint.config.js`, `vitest.config.js`, `tools/*`, `PLAN.txt`, `CLAUDE.md`, `docs/api/sillytavern.md`, `docs/protocol/invariants.md`, `tests/boundary.test.js`, `tests/grammar.test.js`, every other `tests/*.test.js`, other `docs/briefs/*`

## ST APIs used
- `SillyTavern.getContext()` (only via `getCtx()` in `src/host.js`) — docs/api/sillytavern.md#getcontext (status: verified)
- Message object shape: `mes`, `is_user`, `is_system`, `extra`, `swipes`, `swipe_id` — docs/api/sillytavern.md#message-shape (status: verified)
- `MESSAGE_SENT (index)` — docs/api/sillytavern.md#message-sent (status: verified)
- `MESSAGE_RECEIVED (index, type)` — docs/api/sillytavern.md#message-received (status: verified)
- `MESSAGE_EDITED / MESSAGE_DELETED / MESSAGE_SWIPED / CHAT_CHANGED` names and payloads — docs/api/sillytavern.md#message-lifecycle-events (status: verified) — cited here only to justify *unsubscribing* from them
- `updateMessageBlock(messageId, message)` — docs/api/sillytavern.md#updatemessageblock (status: verified)
- Edit-on-receipt ordering (streaming needs the explicit re-render) — docs/api/sillytavern.md#edit-on-receipt (status: verified)
- `chatMetadata` + `saveMetadata()`, `saveChat()` — docs/api/sillytavern.md#chat-metadata (status: verified)
- `generate_interceptor` (per-request chat copy, skipped on dryRun) — docs/api/sillytavern.md#generate-interceptor (status: verified)
- Context values read live; `chat` is `[]` before a chat loads — docs/api/sillytavern.md#context-at-load (status: verified)

## Verification needed
- (empty — every entry above is `status: verified`.)

## Acceptance
- [x] `createState()` deep-equals `{ version: 2, frozen: [], frozenIds: [], watermark: { messageId: null, offset: 0 } }`; no code path in `src/` writes a `frontier` key (grep for `.frontier` in `src/` returns only `options.frontier` in `frontier.js` and its caller).
- [x] `deriveFrontier` on `[system, user "Mara opens the door.", assistant "The hall is cold."]` yields the user block prefixed with the reserved literal, the assistant text verbatim, joined by `BLOCK_DELIMITER`, with the system message absent, and `segments` whose `text.slice(start, end)` equals each block.
- [x] `deriveFrontier` skips every message whose id is in `state.frozenIds`, applies `mes.slice(offset)` to the watermark message only, and — when the watermark message id is not present in `chat` at all — returns exactly the blocks of the remaining unfrozen messages with no throw.
- [x] `deriveFrontier` mutates neither argument: deep-equal snapshots of `chat` and `state` before and after are unchanged (including no id assignment).
- [x] INV-10: two different live histories that produce identical `chat` arrays and identical states produce deep-equal `buildHistory` output; calling `deriveFrontier` twice returns identical `text` and `segments`.
- [x] Editing `chat[i].mes`, swiping it (assigning a new `mes`), or removing the entry from `chat` changes the next `interceptGeneration` result accordingly, with no listener involved and no state write.
- [x] `captureMessage` assigns an id, sets `captured: true`, calls `saveChat` once and `saveMetadata` zero times, and leaves `chatMetadata[METADATA_KEY]` deep-equal to before (ids live on messages, never in state).
- [x] `onMessageReceived` still rolls back an incomplete trailing block in `message.mes` and `message.swipes[swipe_id]` and calls `updateMessageBlock` (INV-8 tests preserved); a `boundary` outcome now also trims `message.mes` itself; re-swiping the same message produces the correct derived frontier with no replacement logic and no `lastAppend`.
- [x] `src/recovery.js` contains no import from `src/freeze.js`; `src/freeze.js` contains no import from `src/state.js` and no `maybeFreeze` export; every `selectCut` test still passes unmodified.
- [x] Migration: a stored `{ version: 1, frozen: [], frontier: 'seeded text' }` becomes the v2 shape with `frontier` gone and derives from `chat`; a stored v1 with one frozen span and a frontier of two complete blocks ends with two frozen spans, every current non-system message id in `frozenIds`, an empty derived frontier, and the original frozen span byte-identical; a v1 whose frontier has no complete block ends with the original frozen list unchanged.
- [x] A stored `{ version: 7 }` is returned untouched with exactly one `console.warn`, as before.
- [x] After importing `index.js`, emitting MESSAGE_EDITED / MESSAGE_SWIPED / MESSAGE_DELETED changes nothing and calls no save; `init()` still succeeds with those names absent from `eventTypes`.
- [x] `src/derive.js` and `src/state.js` contain no occurrence of the identifier `SillyTavern`.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/derive.md` (new) — headings `## Derivation rule {#derivation-rule}` (per-message inclusion, the skip list, the watermark slice, user vs assistant transform, the join, what a segment is and who will consume it), `## Why per-message, not positional {#per-message}` (survives deletes and reordering with no repair code; the accepted cost when the watermark message is deleted), `## Purity {#purity}` (INV-10: same chat + same state ⇒ same output; no id assignment, no save, no cache), `## Message ids {#message-ids}` (random, meaningless, assigned only by `capture`/`recovery` via `assignIds`, persisted by the `saveChat` those handlers already do; why an index- or time-derived id would violate INV-10).
- `docs/modules/state.md` — rewrite `#shape` for v2 (`frozen`, `frozenIds`, `watermark`; no `frontier`), add `## Migration from v1 {#migration-v1}` (the two cases, the documented approximation for the frozen case, why a one-time bump is allowed here while `#unknown-version` still refuses everything else — this codebase wrote v1 and fully understands it, the user is the only installation, and the alternative is a permanently wrong frontier), delete `#initialise-from-chat` and `#reseed-while-pristine` and fix every inbound link to them.
- `docs/modules/capture.md` — `#composer-path` now records only a marker and an id; INV-3 is satisfied at derive time by `toManuscriptBlock`, which still lives here.
- `docs/modules/recovery.md` — `#append` becomes "receipt": classification, in-message rollback and trim, the `received` marker; `#swipes` rewritten to say why resampling needs no replacement logic now; `#freeze-hookup` says automatic freezing is off until brief 0020b and why (the cut offset cannot yet be mapped back to a message).
- `docs/modules/frontier.md` — `#total-reconstruction` now reads "frozen spans from state, mutable frontier derived from `chat[]` on every call"; note that the interceptor never writes.
- `docs/modules/freeze.md` — note under the existing candidate heading that `maybeFreeze` is absent between 0020a and 0020b and that `selectCut` is unchanged; remove references to `setFrontier`.
- `docs/modules/bootstrap.md` — delete `#pristine-reseed-subscriptions` and fix inbound links.
- `docs/protocol/host-mapping.md` — `#s9-capture` (capture marks and ids; the transform happens during derivation), `#s12-frontier` (the frontier is derived per request from `chat[]` above the watermark; this is what makes §12 literal), `#s16-freeze` ("Compiled once, remembered" narrowed explicitly to frozen spans; the sentence that editing/deleting/swiping after the freeze is cosmetic now applies only to messages already consumed by a frozen span, and the uncompiled region is re-read on every request), `#architecture` (canonical history = frozen spans + a watermark; the frontier is not stored).
- `docs/decisions/0004-derived-frontier.md` (new) — why derived beats accumulated (the accumulated copy silently diverged from the chat the collaborator edits; PLAN §10/§12 want a mutable region, not a second log); what was removed (`state.frontier`, `initialiseFromChat`, `setFrontier`, `appendToFrontier`, `isPristine`, `reseedIfPristine`, `appendedText`, `lastAppend`, the swipe-replacement branch, three lifecycle subscriptions); why frozen spans are unaffected; the v1→v2 migration approximation and its cost; the per-message inclusion rule and its deleted-watermark cost. Add its line to `docs/decisions/README.md`.
