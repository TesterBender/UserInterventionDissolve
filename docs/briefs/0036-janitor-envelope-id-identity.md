# Brief 0036 — Janitor message identity moves to the envelope's database ids
Status: done
Complexity: high  (it replaces the identity scheme `frozenIds` and the watermark are expressed over, changes the INV-10 argument recorded in decision 0007, bumps the store's own format, and touches five `janitor/` modules plus the envelope record)
PLAN sections: §3 (interaction-topology non-identifiability — the stored identity must not record where in the exchange a turn sat, and nothing stored may reach the model), §9 (the human's turn becomes manuscript text; identity is what decides whether it is still frontier or already compiled), §10 (manuscript-wide editing inside the mutable frontier — an edit to an uncompiled message must keep its identity, and a tail edit of the watermark message must still slice), §23 (canonical state reconstructs model-visible history because this host owns the history and the script does not), §27 (no transport information reaches the model)
Invariants touched: INV-6 (compiled text is never rewritten; an edit to a compiled message is reported, never re-compiled or re-sent), INV-10 (the stored identity is now a server-assigned database id — the argument that no transport topology is persisted has to be re-made, not inherited)

Depends on: brief 0032 (the adapter layer), brief 0033 (the request transform) and brief 0035 (persona-prefix alignment) — all merged. Brief 0035 explicitly deferred this change ("Changing the identity scheme … is a follow-up brief") and left decision 0007's rejection rationale to be revised here.

Scope source: `TamperContainment/PLAN-janitor.md` (git-ignored, on disk), section "State and identity on Janitor" — the stored shape, the `{hash, prefixHash, offset}` watermark, the edit-to-compiled-text rule, the INV-10 argument, and the paragraph "Envelope ids are positional … they are therefore *not* used as identity", whose premise the 2026-09-14 capture retired. `docs/api/janitor.md#envelope-message-entries-carry-database-ids` (status: answered, captured 2026-09-14) is the fact this brief acts on: each `chatMessages` entry carries `{character_id, chat_id, created_at, id, is_bot, is_main, message}` and `id` is a large integer database id, not a position. `docs/protocol/host-mapping.md` describes the SillyTavern host and does not apply here.

## Goal
On the Janitor host a message's identity is the `id` of the `/generateAlpha` envelope entry it aligned to, rendered as a string, and that id is what `extra[METADATA_KEY].id`, `state.frozenIds`, `state.watermark.messageId` and `state.boundaries` hold. Content hashing survives only as the watermark's `prefixHash`, so a §10 tail edit of the partially compiled message still slices at the same offset when its id is gone from the request. The occurrence-index scheme disappears with the hash identity, and with it the duplicate-collision cost brief 0032 accepted: two byte-identical messages now have different ids because Janitor's database says so. `classifyDrift` stops guessing from match positions and answers exactly: a message whose id is in `frozenIds` but whose text is no longer the text that was compiled is an edit to compiled text — excluded from the frontier by `frozenIds` membership alone, and reported. The store's own format version is bumped so every hash-keyed state written before this brief is discarded on load. `src/` is not modified in any way, including `src/constants.js`'s `STATE_VERSION`.

## In scope

**`janitor/envelope.js`** — one field. `readEnvelope`'s `chatMessages` mapping additionally carries `id: <the entry's id as a string, '' when absent or not a string/finite number>`. `position`, `isMain`, `isBot` and `message` are unchanged, and nothing else in the file moves. (Without this, the id never reaches the adapter layer: the current record drops it.)

**`janitor/history.js`**
- Each `history` entry returned by `classifyMessages` gains `messageId`: the aligned envelope entry's `id` string, or `''` when the entry carries no usable id and on the no-envelope fallback path. `index`, `role` and `content` are unchanged, including brief 0035's rule that a prefix-matched user turn carries the **bare** envelope text. Injections gain nothing.
- Alignment itself does **not** change: two cursors, `isMain` entries only, exact content equality plus brief 0035's one persona-prefix form, in order. The id is read off the entry that alignment already chose; it is never used to *find* the entry.
- `toStShape(historyMessages)` loses its `ids` parameter and reads `message.messageId` for `extra[METADATA_KEY].id`. The other three fields (`mes`, `is_user`, `is_system: false`) are unchanged.
- `fromStShape` is untouched.

**`janitor/identity.js`**
- Removed: `messageIdentity` and `assignIdentities`. The occurrence index ceases to exist anywhere.
- Kept unchanged: `fnv1a32` and `prefixIdentity(content, offset)` — the watermark's prefix hash is the one surviving consumer, and it is why `fnv1a32` stays.
- `matchWatermark(entries, watermark)` (entries, not a parallel `ids` array) returns the index of the watermark message or `-1`, in this order: (1) an entry whose `messageId` is non-empty and equal to `watermark.messageId`; (2) with `watermark.offset > 0` and a non-empty `watermark.prefixHash`, an entry at least `offset` characters long whose `prefixIdentity(content, offset)` equals `prefixHash` — the §10 tail-edit / re-keyed case; (3) `-1`. An empty `messageId` never matches by rule 1.
- `classifyDrift(entries, state)` replaces the matched-flags version and returns `{ editedCompiledIndexes }`, the indexes of entries that are demonstrably no longer the text that was compiled:
  - an entry whose non-empty `messageId` is in `state.frozenIds`, whose `content` is non-empty, and whose `content` is not a substring of the compiled corpus — `[...state.frozen, ...state.units]` joined by `BLOCK_DELIMITER`. A fully consumed message's text sits verbatim inside a compiled span (a user turn only gains the own-line header in front of it), so "still present" is decidable without storing a second copy or a per-message hash;
  - the entry matched as the watermark message by id, when `prefixIdentity(content, watermark.offset) !== watermark.prefixHash` — its compiled head changed.
  It reports and no more: no re-keying, no span deletion, no recompile, no log line of its own. Exclusion from the frontier is `frozenIds` membership doing its existing job, not something this function performs.

**`janitor/constants.js`**
- `JANITOR_STATE_FORMAT = 2` — the adapter's own stored-format version, independent of `src/constants.js`'s `STATE_VERSION`, which is not touched. `STORAGE_KEY_PREFIX` stays `'uid-janitor-v1:'` so the stale entry is overwritten rather than orphaned in `localStorage`.

**`janitor/storage.js`**
- `freshState()` includes `janitorFormat: JANITOR_STATE_FORMAT`.
- `loadJanitorState` requires `stored.version === STATE_VERSION` **and** `stored.janitorFormat === JANITOR_STATE_FORMAT`; a mismatch takes the existing no-migration path — fresh state, one `console.warn`. Every state written before this brief lacks the field and is therefore discarded, which is the intended effect: its `frozenIds` are hashes and would name nothing.
- `saveJanitorState` is otherwise unchanged.

**`janitor/transform.js`** — call sites only, step order unchanged (`docs/modules/janitor-adapter.md#request-pipeline`):
- ids come from the entries (`kept.map((entry) => entry.messageId)` where an array is still wanted); `toStShape(kept)`; `matchWatermark(kept, state.watermark)`; on a match, `state.watermark.messageId` is re-keyed to the matched entry's `messageId` only when that is non-empty; `classifyDrift(kept, state)`.
- The freeze attempt additionally requires every kept entry to carry a non-empty `messageId`, so an id-less alignment can never write `''` into `frozenIds` or the watermark. This is one condition on the existing gate, not a new branch or a new code path.
- The post-freeze `prefixHash` / `watermarkText` write finds the watermark message by `messageId` instead of by hash id; its behaviour is otherwise what brief 0033 specified.
- The `console.info` report's last field reads the new drift shape; it stays one line with the same four facts.

### Decisions this brief takes (do not re-open during implementation)
- **`boundaries[]` becomes envelope ids.** It is still round-tripped only — no writer exists yet — but it is documented as holding envelope id strings, since that is the only identity this layer now has.
- **`watermarkText` stays as it is**: the full raw text of the watermark message, insurance for the turn on which Janitor trims that message out of the request entirely. It is not keyed by anything and needs no change.
- **`prefixHash` stays on the watermark**, per the task: an id match is the normal path now, but a regenerate that replaces a message gives the replacement a new database id, and a request that no longer carries the watermark message needs the hash to recognise it when it returns.

**Tests — `tests/janitor/`** (existing files may be rewritten where they assert the removed scheme):
- alignment carries ids: every history entry of the fixture gets the `id` of the envelope entry it aligned to, as a string, including the persona-prefixed user turn from brief 0035's fixture; `toStShape` puts it in `extra[METADATA_KEY].id`.
- an edited compiled message is detected by id: a message whose id is in `frozenIds` and whose text was changed appears in `editedCompiledIndexes`, stays out of the derived frontier, and the same message unedited does not appear.
- duplicate identical messages no longer collide: two byte-identical user messages with different envelope ids get different identities; compiling the first does not drop the second from the frontier (the occurrence-index failure brief 0032 accepted, now absent).
- regenerate: a body whose trailing assistant message is replaced by a different draft with a new envelope id leaves `frozenIds`, the watermark and the derived frontier consistent — nothing compiled is re-sent and nothing uncompiled is dropped.
- the watermark still slices after a tail edit of the watermark message, and is re-found by `prefixHash` when its id is absent from the request.
- the three-turn byte-identical prefix property still holds through the real transform (the assertion that exists today, unchanged in intent).
- old-format stored state is discarded: a blob with `version: STATE_VERSION` but no `janitorFormat` (and one with a wrong `janitorFormat`) yields a fresh state and exactly one `console.warn`.
- No file under `janitor/` or `tests/janitor/` references `SillyTavern`.

**`dist/janitor-manuscript-dissolve.user.js`** — regenerated with `npm run build:janitor` and committed. Never hand-edited.

## Out of scope (explicit)
- **Any `src/` change**, including `STATE_VERSION`, `advanceWatermark` learning about `prefixHash`, `createState` learning the Janitor fields, or `deriveFrontier` becoming friendlier to this layer. If the change cannot be made without one, that is a `SCOPE_GAP`.
- **A migration from hash-keyed state.** The store is discarded, deliberately. No re-keying pass, no best-effort remap, no "try to find the old spans", no export before wipe.
- **Using the envelope's ids for anything other than identity.** Not for alignment (alignment stays two-cursor by content and order), not for ordering, not for deduplication, not for the horizon, not for `created_at`, `character_id`, `is_bot` or `position`.
- **Storing any further envelope field** — no `created_at`, no `chat_id` per message, no `is_bot`, no position. One id per message, nothing else.
- **A per-message content hash or a second copy of compiled text in state** to make drift detection cheaper. The corpus-substring test above is the pinned rule; `fnv1a32` survives for the watermark prefix only.
- **Repairing drift.** `classifyDrift` reports indexes. No deletion, no re-keying, no automatic recompile, no toast, no panel.
- Anything response-side (stream cut, boundary recording, `classifyOutcome`), the panel, Export/Import, Recompile, the cross-tab `storage` listener, the Anthropic adapter.
- Changing the request pipeline's step order, the system-message fold, the horizon, the lead-in, the prefill strip or the stop array.
- Any setting, toggle, storage-format option or new dependency.
- Editing decision 0007's existing sections, `docs/decisions/0004-derived-frontier.md`, `PLAN.txt` or `TamperContainment/**`.

## Files
- allowed to modify: `janitor/identity.js`, `janitor/history.js`, `janitor/storage.js`, `janitor/transform.js`, `janitor/constants.js`, `janitor/envelope.js` (the `chatMessages` mapping line only), `docs/modules/janitor-adapter.md`, `docs/modules/janitor-transport.md` (the `#envelope-record` `chatMessages` table row only), `docs/decisions/0007-janitor-host-deviations.md` (append one section; earlier sections untouched), `docs/api/janitor.md` (only to say the deferred follow-up is this brief and that the ids are now stored identity — no other entry edited), `dist/janitor-manuscript-dissolve.user.js` (regenerated)
- allowed to create/modify under: `tests/janitor/**`
- must not touch: `src/**`, `janitor/main.js`, `janitor/shell.js`, `janitor/shape.js`, `janitor/xhr-warning.js`, `tools/**`, `index.js`, `manifest.json`, `package.json`, `eslint.config.js`, `presets/**`, `tests/*.test.js`, `PLAN.txt`, `TamperContainment/**`, `docs/protocol/**`, `docs/decisions/0004-derived-frontier.md`, `docs/README.md`

## ST APIs used
- none. This host is janitorai.com; `globalThis.SillyTavern` must not be referenced in `janitor/` or `tests/janitor/`. Importing pure values from `src/` (`METADATA_KEY`, `STATE_VERSION`, `BLOCK_DELIMITER`, `createState`, `deriveFrontier`, `buildHistory`, `compileUnit`) is not an ST API use and is permitted by `tests/janitor/isolation.test.js` since brief 0034.

## Verification needed
- (empty) The one Janitor fact this brief acts on is answered: `docs/api/janitor.md#envelope-message-entries-carry-database-ids`, status answered, captured 2026-09-14 — `id` is a large integer database id, entries carry `is_bot`/`is_main`/`created_at`, and the envelope includes the message being sent. The supporting facts are answered too: `is_main` marks the selected alternative (2026-09-13), the persona prefix on user turns (2026-09-14), regenerate drops the replaced assistant message (2026-09-13), `/generateAlpha` precedes every model invocation (2026-09-13). Do not launch `st-api-verifier`; it verifies SillyTavern only.

## Acceptance
- [x] Every aligned history entry's identity is the string form of its envelope entry's `id`; no `#`-suffixed hash id appears anywhere in `janitor/` or in a stored state.
- [x] `messageIdentity` and `assignIdentities` no longer exist; `fnv1a32` has exactly one caller, `prefixIdentity`.
- [x] Two byte-identical user messages with different envelope ids receive different identities; compiling the first leaves the second in the derived frontier.
- [x] A compiled message edited in place is reported in `editedCompiledIndexes` and is absent from the derived frontier; the same message unedited is reported by neither.
- [x] The watermark message is found by id after an edit to its tail, and by `prefixHash` when its id is not in the request; a head edit yields `-1`.
- [x] A regenerate fixture (trailing assistant message replaced, new envelope id) leaves no compiled text re-sent and no uncompiled text dropped.
- [x] Three consecutive transforms over a fixture whose canonical state does not change produce a byte-identical `[final, control]` prefix.
- [x] A stored state with no `janitorFormat`, and one with a wrong `janitorFormat`, each yield a fresh state and exactly one `console.warn`; `src/constants.js` is byte-identical.
- [x] `npm run build:janitor` regenerates `dist/janitor-manuscript-dissolve.user.js`, the committed file matches a fresh build, and it parses via `new Function`.
- [x] `npm run check` passes
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/janitor-adapter.md` — new `## Envelope-id identity {#envelope-id-identity}`: identity is the envelope entry's database `id` as a string; why that is available now (the 2026-09-14 capture retired the positional claim the earlier rejection rested on); that the id is read off the entry alignment already chose and is never used to align; what an id-less entry means (`''`, never frozen, never the watermark, and the freeze gate refuses the request's compile rather than store an empty id); and that the duplicate-collision cost the old scheme accepted is gone because two identical texts have two database ids.
- `docs/modules/janitor-adapter.md` — keep `## Content-hash identity (superseded) {#content-hash-identity}` as a two-line stub pointing at `#envelope-id-identity`, **solely** so the link in decision 0007's brief-0032 section (which this brief may not edit) still resolves under `tools/check-docs.mjs`. Do not leave the old rationale standing in it.
- `docs/modules/janitor-adapter.md#prefix-hash-watermark` — amend: the watermark now carries `{messageId (envelope id string), offset, prefixHash}`; rule 1 is an id match and is the normal case; `prefixHash` is what survives a message whose id left the request or was replaced by a regenerate; `src/state.js` is still unmodified and the caller still writes `prefixHash`.
- `docs/modules/janitor-adapter.md#drift` — amend: the test is now exact rather than positional — a `frozenIds` member whose text is no longer a substring of the compiled corpus, plus the watermark message whose compiled head no longer hashes to `prefixHash`; state the one residual false negative (edited text that happens to occur elsewhere in the corpus) and why storing a per-message hash to close it is refused; still reporting only, and exclusion from the frontier is `frozenIds` doing its existing job.
- `docs/modules/janitor-adapter.md#stored-state` — amend: `janitorFormat` and why it is the adapter's own version rather than a bump of `STATE_VERSION`; that pre-existing hash-keyed state is discarded with one warn and no migration; `boundaries` holds envelope id strings; `watermarkText` unchanged and why.
- `docs/modules/janitor-adapter.md#envelope-diff` — amend: entries now carry `messageId` from the aligned envelope entry, while alignment itself is still by content and order; replace the bullet that explains *why* ids are not used for alignment with the accurate reason (the order of the conversation is what both sides agree on; the ids are a key, not a sequence) and link `#envelope-id-identity`.
- `docs/modules/janitor-adapter.md#inv-10` — rewrite the argument for the new scheme: a stored database id records *that* a message with that server key was compiled, not where in the exchange it sat; it is not derived from position and does not renumber; `fromStShape` still emits `{role, content}` only, so no id, offset or hash can reach the model; and the header line of the file ("ids and hashes stay in private state") is updated to match.
- `docs/modules/janitor-adapter.md#request-pipeline` — step 5's links repointed to `#envelope-id-identity`; `#request-report` amended for the drift field's new meaning.
- `docs/modules/janitor-transport.md#envelope-record` — amend the `chatMessages` table row to `[{position, id, isMain, isBot, message}]` and say in one sentence that `id` is the database id the adapter layer stores as message identity (`docs/api/janitor.md#envelope-message-entries-carry-database-ids`).
- `docs/decisions/0007-janitor-host-deviations.md` — **append** one section, "Envelope database ids as message identity (revises the content-hash decision)": that the 2026-09-13 "positional ids" premise was wrong, so the rejection recorded in the brief-0032 section no longer stands on its own reasons; why a database id is not the index-derived id decision 0004 rejected (it encodes no position, survives deletion of any other message, and renumbers nothing); the INV-10 statement for the new scheme; what the change costs (an id that only exists while Janitor sends the envelope, and a stored state discarded once at the format bump) and what it buys (exact drift detection, no occurrence index, no duplicate collision, identity that survives an edit). Give its alternatives heading the distinct suffix `### Alternatives rejected (envelope-id identity)` and cover: keeping content hashes as a fallback identity when the id is missing (two schemes, two failure modes, one store); storing `created_at` or `position` beside the id (topology, INV-10, and nothing reads it); and migrating the hash-keyed store instead of discarding it. Do not edit or restate the earlier sections.
