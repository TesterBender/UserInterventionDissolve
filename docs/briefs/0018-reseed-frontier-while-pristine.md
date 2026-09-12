# Brief 0018 — re-seed the frontier from the visible chat while canonical state is pristine
Status: done
Complexity: high
PLAN sections: §4 (canonical history is the persistent conditioning surface actually shown to the model; §12-style reconstruction reads it and nothing else, so an initial frontier that no longer matches the chat the collaborator is looking at is simply wrong input), §10 (editorial authority is manuscript-wide *within the mutable frontier*: before anything is frozen the whole frontier is the collaborator's to change, and choosing a different greeting is the earliest such change), §19 (cold start: the opening exemplar is the collaborator's chosen greeting; an alternate greeting is that choice being made)
Invariants touched: INV-4 (the frontier is the single mutable surface the reconstruction reads; this brief keeps its *initial seed* honest and changes nothing about per-request reconstruction), INV-10 (nothing about the live interaction — which swipe, how many edits — is recorded; only the resulting visible text is re-read)

## Goal
When the collaborator swipes the greeting to an alternate one, edits it, or deletes a message **before the manuscript has started**, the extension's seeded frontier follows that visible text, so the model is conditioned on the greeting actually on screen rather than the first one that happened to be present when `getState` materialised. Once the manuscript has started — anything frozen, or any `chat[]` message marked `captured`/`appended` — the seed is inert by construction and the three new handlers do nothing. User report, verbatim: "There is a strange interaction regarding alternate responses? In which, even when in the alternate starter, it chooses the first one."

## Why this is not a violation of "compiled once, remembered"
`docs/protocol/host-mapping.md#s16-freeze` says a frozen span is compiled once and thereafter no longer tracks `chat[]`. While the state is pristine **nothing has been compiled**: `frozen` is empty and no model or collaborator block has entered the frontier through `recovery`/`capture`. The initial frontier is not a compilation result but a convenience derived from the visible chat (`docs/modules/state.md#initialise-from-chat`), and until the manuscript starts it must follow the collaborator's greeting choice. The first capture or append makes `isPristine` false forever after, so the "remembered" rule takes over at exactly the moment it begins to apply.

## In scope
- **`src/state.js`** — two new exports, no change to any existing export's behaviour or signature:
  - `isPristine(state, chat)` → boolean, pure. `true` when **both**: `state` is an object whose `frozen` is an array of length `0` (a missing or non-array `frozen` is not pristine — an unknown-version structure is never re-seeded, matching `#unknown-version`'s refuse-to-touch rule), **and** no entry of `chat` has `extra?.[METADATA_KEY]?.captured === true` or `extra?.[METADATA_KEY]?.appended === true`. A non-array `chat` contributes no markers (the marker scan is skipped, the `frozen` test still decides). Those two markers are exactly the ones `src/capture.js` and `src/recovery.js` already write; no third marker is introduced and neither module is edited.
  - `reseedIfPristine(ctx = getCtx())` → `Promise<boolean>`, `async`. `const state = getState(ctx)`; if `!isPristine(state, ctx.chat)` return `false` having called nothing; otherwise `setFrontier(state, initialiseFromChat(ctx.chat).frontier)`, `await save(ctx)`, return `true`. Only `.frontier` is taken from the freshly initialised state — `frozen` is never assigned, replaced, or read from it. No comparison against the current frontier and no dirty check: pristine means re-seed, and the save is unconditional on that path. Never throws; the emitter swallows listener errors anyway (`docs/api/sillytavern.md#events`).
- **`index.js`** — three plain entries added to the existing `boundaryHandlers` map, each ignoring its payload entirely because the three payloads differ (`(mesId)`, `(id)`, `(chat.length)`) and none of them is needed:
  - `MESSAGE_SWIPED: () => reseedIfPristine()`
  - `MESSAGE_EDITED: () => reseedIfPristine()`
  - `MESSAGE_DELETED: () => reseedIfPristine()`
  They go through the same guarded loop as the rest, so an absent event name joins the existing `absent events:` warn line and nothing else changes. No composition with another handler, no ordering constraint, no new subscription site, no `off`/teardown.
- **`tests/helpers/fake-context.js`** — add exactly three keys to `defaultContext().eventTypes`: `MESSAGE_SWIPED: 'message_swiped'`, `MESSAGE_EDITED: 'message_edited'`, `MESSAGE_DELETED: 'message_deleted'`. Nothing else in that file changes.
- **`tests/bootstrap.test.js`** — the one assertion `expect(Object.keys(ctx.eventTypes)).toHaveLength(11)` and its test title become `14` / "fourteen". No other edit to that file.
- **`tests/state.test.js`** — the cases under Acceptance.
- **Docs** — the two headings listed below.

## Out of scope (explicit)
- **Re-seeding after the manuscript starts.** No "rebuild the frontier from `chat[]`" path once anything is captured, appended or frozen; no repair, no resync, no diff against `chat[]`, no reconciliation of a swiped/edited/deleted mid-manuscript message with canonical state. That is the "compiled once, remembered" rule and this brief does not touch it.
- **Extending `recovery`'s swipe handling.** `recovery` handles resampling of the *model's own last generation* on MESSAGE_RECEIVED with `type` `'swipe'`/`'regenerate'`, keyed on `extra[METADATA_KEY].appendedText`. MESSAGE_SWIPED is a different event and this brief must not route it into `recovery`, must not touch `lastAppend`, `resetRecoveryState`, or any file under `src/` other than `src/state.js`.
- Any change to `initialiseFromChat`'s rules (system-message filter, verbatim text, blank-line join), to `getState`, `setFrontier`, `appendToFrontier`, `pushFrozen`, `save`, or to the unknown-version policy.
- Any new marker, flag, timestamp, "seeded from swipe N" record, or per-message bookkeeping — INV-10: which swipe was chosen is live interaction topology and is not recorded anywhere.
- Debouncing, coalescing, or rate-limiting the three handlers; a `saveMetadataDebounced`; skipping the save when the text is unchanged.
- Reading `characters`, `characterId`, alternate-greeting arrays, `swipes`/`swipe_id`, or `message.swipe_info`. The handler re-reads `ctx.chat` and nothing else; `chat[i].mes` already holds the swiped-to text by the time the event fires.
- Any setting, toggle or UI surface; any `saveChat` call; any group-chat branch; any new dependency.

## Files
- allowed to create/modify: `src/state.js`, `index.js` (the three map entries only), `tests/state.test.js`, `tests/bootstrap.test.js` (the event-count assertion and its title only), `tests/helpers/fake-context.js` (the three event names only), `docs/modules/state.md`, `docs/modules/bootstrap.md`, and this brief's Status line
- must not touch: `src/capture.js`, `src/recovery.js`, `src/boundary.js`, `src/frontier.js`, `src/freeze.js`, `src/grammar.js`, `src/host.js`, `src/constants.js`, `src/prompt.js`, `src/starter.js`, `src/preset-template.js`, `src/ui/settings.js`, `style.css`, `manifest.json`, `presets/*`, `package.json`, `eslint.config.js`, `vitest.config.js`, `tools/*`, `PLAN.txt`, `CLAUDE.md`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, other `docs/briefs/*`, and every other `tests/*.test.js`

## ST APIs used
- `SillyTavern.getContext()` (via `getCtx()` in `src/host.js` only) — docs/api/sillytavern.md#getcontext (status: verified)
- `MESSAGE_SWIPED (mesId)`, `MESSAGE_EDITED (id)`, `MESSAGE_DELETED (chat.length)` event names and payloads — docs/api/sillytavern.md#message-lifecycle-events (status: verified) — payloads are documented here only to justify ignoring them
- Emitter semantics (async, sequential, listener errors swallowed) — docs/api/sillytavern.md#events (status: verified)
- Message object shape (`mes`, `is_system`, `extra`) — docs/api/sillytavern.md#message-shape (status: verified)
- `chatMetadata` + `saveMetadata()` per-chat persistence — docs/api/sillytavern.md#chat-metadata (status: verified)
- Context values read live at call time; `chat` is `[]` before a chat loads — docs/api/sillytavern.md#context-at-load (status: verified)

## Verification needed
- (empty — every entry above is `status: verified`.)

## Acceptance
- [x] `isPristine({ frozen: [], frontier: 'x' }, [])` is `true`; with `frozen: [{…}]` it is `false`; with a missing or non-array `frozen` it is `false`.
- [x] `isPristine` is `false` when any chat entry has `extra[METADATA_KEY].captured === true` or `extra[METADATA_KEY].appended === true`, and `true` when entries carry other `extra` content, an unrelated key, or `captured: false`.
- [x] `isPristine(state, undefined)` and `isPristine(state, null)` decide on `frozen` alone and do not throw.
- [x] On a pristine context whose `chat[0].mes` has changed since state was materialised, `await reseedIfPristine(ctx)` resolves `true`, leaves `ctx.chatMetadata[METADATA_KEY]` the **same object reference**, sets its `frontier` to `initialiseFromChat(ctx.chat).frontier`, leaves `frozen` `[]`, and calls `ctx.saveMetadata` exactly once and `ctx.saveChat` zero times.
- [x] A multi-message pristine chat re-seeds to every non-system non-blank `mes` in order, identical to `initialiseFromChat(ctx.chat).frontier` — including after a message is removed from `chat` (the delete case) and after a `mes` is rewritten (the edit case).
- [x] On a non-pristine context (non-empty `frozen`, or a `captured` marker, or an `appended` marker), `await reseedIfPristine(ctx)` resolves `false`, leaves `frontier` byte-identical, and calls `ctx.saveMetadata` zero times.
- [x] `reseedIfPristine` on a context with no stored state materialises it through `getState` and then re-seeds, without throwing.
- [x] Emitting MESSAGE_SWIPED, MESSAGE_EDITED and MESSAGE_DELETED after importing `index.js` each re-seeds a pristine chat's frontier; each handler ignores its argument (emitting with `0`, with `undefined`, and with a chat length all behave identically).
- [x] The same three emissions on a non-pristine chat leave `chatMetadata[METADATA_KEY].frontier` byte-identical and call `saveMetadata` zero times.
- [x] With those three names deleted from `eventTypes`, `init()` still succeeds and the existing `absent events:` warning names them; no throw.
- [x] `src/state.js` still contains no occurrence of the identifier `SillyTavern`, and the module's export list gains exactly `isPristine` and `reseedIfPristine`.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/state.md` — new heading `## Reseed while pristine {#reseed-while-pristine}`: what pristine means (`frozen` empty **and** no `captured`/`appended` marker in `chat[]`, i.e. the manuscript has not started), that the two markers are the ones `capture` and `recovery` already write so no new bookkeeping exists, why a pristine re-seed is not a re-compile (`docs/protocol/host-mapping.md#s16-freeze`: nothing has been compiled yet; the seed is derived from the visible chat and must follow the collaborator's greeting choice — PLAN §10, §19), why it becomes inert by construction after the first capture or append, why the save is unconditional rather than dirty-checked, and that which swipe was chosen is never recorded (INV-10). Update the file's `PLAN:` header line to include §10 and §19.
- `docs/modules/bootstrap.md` — new heading `## Pristine reseed subscriptions {#pristine-reseed-subscriptions}`: the three plain entries in the existing guarded handler map, that each ignores its payload because the three payloads differ and none is needed (`docs/api/sillytavern.md#message-lifecycle-events`), that MESSAGE_SWIPED here is unrelated to `recovery`'s `type: 'swipe'` handling on MESSAGE_RECEIVED, and that absent names simply join the existing warn list.
