# Brief 0037 — Janitor derivation-time rollback and boundary records
Status: done
Complexity: high  (owns INV-8 on this host, adds a state field to the format brief 0036 pins, changes the order of the request pipeline and touches three `janitor/` modules plus the report line)
PLAN sections: §14 (four termination outcomes; an incomplete trailing block is transport debris and is rolled back to the last complete block, while a deliberate handoff at the reserved literal is not), §8 (the reserved literal is bare and a boundary is an occurrence at a block start — the trim keys on that and nothing else), §10 (manuscript-wide editing inside the mutable frontier: the trim is applied on every derivation, so the text the frontier sees is always the trimmed text), §23 (this host cannot edit stored history, so every repair the ST host performs at receipt happens at the next request build), §27 (transport debris must never become a fictional event, and nothing about the trim may reach the model as narration)
Invariants touched: INV-8 (this is the Janitor host's implementation of it), INV-2 (the derivation-time literal trim is the last line of defence when no stop string was honoured and no stream cut happened)

Depends on: **brief 0036** (envelope-id identity), which pins the contract this brief builds on and must be merged first — identity is the envelope database `id` as a string, the watermark is `{messageId, offset, prefixHash}`, `boundaries[]` holds envelope ids, and `JANITOR_STATE_FORMAT = 2`. None of those decisions is re-opened here. This brief is phase 5 of `TamperContainment/PLAN-janitor.md` split in two; **brief 0038** (SSE rewriter, stop-rejection learning, and the writer of the pending marker) follows it and must not be started first.

Scope source: `TamperContainment/PLAN-janitor.md` — "Per-generation pipeline" response side (the INV-8 bullet: rollback happens at the next derivation on both transports, the human-visible log keeps the debris, no hold-back buffering) and "Deviations from the ST implementation" ("Boundary trim and rollback at stream time or derivation time, not post-receipt edits"). `docs/protocol/host-mapping.md` describes the SillyTavern host and does not apply here.

## Goal
Every request the Janitor script builds derives from text that PLAN §14 says should survive. Before identities, the watermark or the frontier are computed, each assistant-role history message is trimmed: first at a block-start occurrence of the reserved literal, then back to the last complete block — unless its envelope id is in `state.boundaries`, in which case the message stopped deliberately and is left alone. The trimmed text is the only text the rest of the pipeline sees, so the watermark's `prefixHash` is computed over it and stays consistent from request to request. Because the id of a message that a generation has just produced does not exist until Janitor has saved it and the next envelope arrives, state carries one pending marker, `pendingBoundaryAfter`, naming the last aligned message of the request that produced the generation; the next derivation resolves it into `boundaries[]` when the message directly after that id is assistant-role, and discards it otherwise, so a regenerate can never attach a boundary to a replacement draft. The one `console.info` report gains a `boundary` and a `rollback` count. Nothing under `src/` changes, and nothing response-side is wired in this brief: the pending marker is read and resolved here, and written in brief 0038.

## In scope

**`janitor/rollback.js`** (new, pure; no storage, no `window`, no `src/` host code):
- `rollbackHistory(entries, literal, boundaryIds)` → `{ entries, rollbacks }`. `entries` are the aligned history entries of `janitor/history.js` (`{index, role, content, messageId}` after brief 0036). For each entry with `role === 'assistant'`:
  - skip entirely when its `messageId` is non-empty and present in `boundaryIds` (a `Set` built by the caller) — a boundary stop is deliberate and is never rolled back (`docs/modules/recovery.md#boundary-not-rolled-back`);
  - otherwise apply, in this order: (a) `trimAtBoundary(content, literal)` (`src/boundary.js`) when `literal` is non-empty, which removes everything from a block-start occurrence of the bare literal onward; (b) `truncateToLastCompleteBlock` of the result (`src/grammar.js`) when `isTrailingBlockComplete` of it is false.
  - An entry whose content is unchanged by both steps is returned as the same object; an entry that changed is returned as a new object with the new `content` and counts once towards `rollbacks`. `index`, `role` and `messageId` are never changed.
- User-role entries and injections are never touched: the human's text is not a generation and INV-8 has nothing to say about it.
- `src/recovery.js` is **not** imported — `classifyOutcome` is unavailable on this host because `src/recovery.js` collides with `src/boundary.js` on a top-level name in the bundler (brief 0033, `docs/modules/janitor-build.md#supported-module-syntax`). The two-step trim above is the whole classification: there is no `'empty'`/`'complete'`/`'incomplete'`/`'boundary'` enum here, and none is invented. If the four pure functions named above turn out not to expose what the two steps need, that is a `SCOPE_GAP` — `src/` may not be edited.

**`janitor/storage.js`**
- `freshState()` gains `pendingBoundaryAfter: ''`.
- Nothing else changes: no format bump (brief 0036's `JANITOR_STATE_FORMAT = 2` stands), no migration branch. A state written by brief 0036 has no such field, and the reader in `janitor/transform.js` treats a missing or non-string value as `''`. That is the one place the absence is handled.

**`janitor/transform.js`** — the pipeline order changes and two steps are added; every other step keeps brief 0033's behaviour and brief 0036's call sites.
- New step **4b, boundary resolution**, after the sentinel drop and before identity: read `state.pendingBoundaryAfter`. When it is a non-empty string, find the kept entry whose `messageId` equals it; when that entry exists, the entry **directly after it** exists, has `role === 'assistant'` and a non-empty `messageId`, append that `messageId` to `state.boundaries` (no duplicates) and clear the marker. In every other case — the id is absent from the request, it is the last entry, the next entry is a user turn, or the next entry has no id — clear the marker and append nothing. Clearing is `''`.
- New step **4c, rollback**: `rollbackHistory(kept, literal, new Set(state.boundaries))`, whose returned entries replace `kept` for the remainder of the pipeline. `literal` is `` `${context.personaName}:` ``, so it must be computed before this step rather than at brief 0033's step 7; moving that one assignment upwards is the only re-ordering allowed.
- Consequently `matchWatermark`, `classifyDrift`, `toStShape`, `deriveFrontier`, `compileUnit` and the post-freeze `prefixIdentity`/`watermarkText` write all operate on the **trimmed** entries. State this in the doc: the prefix hash is a hash of trimmed text, the trim is deterministic and runs on every request, so the same message hashes the same way on every request as long as Janitor sends the same bytes.
- Persistence: the resolution step mutates state on requests where no freeze happens. Track one dirty flag; when the freeze branch did not already `saveJanitorState`, and the resolution changed `boundaries` or `pendingBoundaryAfter`, save once before the body is dispatched. Exactly one save per request at most.
- **Report**: the `console.info` line gains two fields — `boundary <state.boundaries.length>` (after resolution) and `rollback <rollbacks>` (entries whose text this request's trim changed). It stays one line with the same prefix.

**Tests — `tests/janitor/`** (new file(s) for the rollback unit tests; the transform tests extend the existing fixtures; recorded bodies live under `tests/janitor/fixtures/`):
- an assistant message ending in an incomplete trailing block is trimmed back to the last complete block before derivation, and the dispatched body contains neither the debris nor any trace of it;
- the same message with its `messageId` in `state.boundaries` is dispatched verbatim — no trim of any kind;
- an assistant message containing the bare literal at a block start loses everything from the literal onward, and a mid-paragraph occurrence of the literal is left alone (`docs/modules/boundary.md#block-start-only`);
- a message that both carries a block-start literal and ends incomplete gets step (a) then step (b), in that order;
- user turns are never trimmed, including one whose text ends mid-sentence and one that contains the literal;
- pending → resolved: state seeded with `pendingBoundaryAfter` naming message *n* of the fixture, whose successor is assistant, leaves `boundaries` containing the successor's id, `pendingBoundaryAfter === ''`, and the state saved without a freeze;
- regenerate discards: the same state against a body where the successor is absent (regenerate, `docs/api/janitor.md#regenerate-drops-the-replaced-assistant-message`) or is a user turn leaves `boundaries` unchanged and the marker cleared;
- the watermark's `prefixHash` is computed over trimmed text: a fixture whose watermark message carries trailing debris freezes, and the next request re-finds the watermark by `prefixHash` after its id is removed from the body;
- three consecutive transforms across a boundary stop (state seeded with a boundary id) still produce a byte-identical `[final, control]` prefix;
- the report line carries both new counts.

**`dist/janitor-manuscript-dissolve.user.js`** — regenerated with `npm run build:janitor` and committed. Never hand-edited.

### Decisions this brief takes (do not re-open during implementation)
- **The trim has two steps and no classifier.** Literal-first, then incomplete-trailing-block. There is no outcome enum, no `boundaryMarked` argument, no empty-message special case (`truncateToLastCompleteBlock('')` is `''` and nothing else needs saying).
- **`boundaries[]` exempts a message from both steps**, not only from step (b). A message recorded as a boundary stop already had its literal removed on the way in, and re-running the trim on it could only remove text the model meant to keep.
- **The pending marker names the *predecessor*, not the message itself.** The generated message has no id until Janitor has saved it and a new envelope carries it, which is the whole reason the marker exists.
- **The human-visible Janitor log keeps the debris.** Nothing in this brief edits, deletes or re-saves a Janitor message; the two views differ already (persona headers, sentinels) and that is accepted.

## Out of scope (explicit)
- Any `src/` change, including importing `src/recovery.js`, adding a Janitor branch to `classifyOutcome`, or exporting a new helper from `src/grammar.js`. If the listed pure functions do not suffice, report a `SCOPE_GAP`.
- Everything in brief 0038: the SSE rewriter, terminal-frame synthesis, upstream cancel, the non-streaming JSON body, per-route `stop`-rejection learning, and the **writing** of `pendingBoundaryAfter` from a response. Nothing in this brief observes a response.
- Hold-back buffering of a block during streaming, any live edit of a Janitor message, any POST to a Janitor endpoint, any repair of the human-visible log.
- Re-keying, deleting or recompiling compiled spans because a message was trimmed. `classifyDrift` keeps brief 0036's reporting-only role.
- The panel, Export/Import, Recompile, the cross-tab `storage` listener, the Anthropic adapter, XHR anything.
- Any setting, toggle or storage-format option; a second state format bump; a new dependency.
- Editing the sections of `docs/decisions/0007-janitor-host-deviations.md` written by briefs 0031, 0032, 0033 and 0036, or any file under `TamperContainment/`, `PLAN.txt` or `docs/protocol/`.

## Files
- allowed to create: `janitor/rollback.js`, `tests/janitor/rollback.test.js`, `tests/janitor/fixtures/*.js`
- allowed to modify: `janitor/transform.js`, `janitor/storage.js` (the `freshState` field only), `tests/janitor/**`, `docs/modules/janitor-adapter.md`, `docs/decisions/0007-janitor-host-deviations.md` (append one section), `dist/janitor-manuscript-dissolve.user.js` (regenerated), `docs/README.md` (only if a new doc file is added — none is expected)
- must not touch: `src/**`, `janitor/shell.js`, `janitor/envelope.js`, `janitor/shape.js`, `janitor/xhr-warning.js`, `janitor/main.js`, `janitor/identity.js`, `janitor/history.js`, `janitor/constants.js`, `tools/**`, `package.json`, `eslint.config.js`, `index.js`, `manifest.json`, `presets/**`, `tests/*.test.js`, `PLAN.txt`, `TamperContainment/**`, `docs/protocol/**`, `docs/api/janitor.md`, `docs/modules/janitor-transport.md`

## ST APIs used
- none. This host is janitorai.com; `globalThis.SillyTavern` must not be referenced in `janitor/` or `tests/janitor/`. `trimAtBoundary`/`findBoundary` (`src/boundary.js`) and `isTrailingBlockComplete`/`truncateToLastCompleteBlock` (`src/grammar.js`) are pure imports that reach no host object, permitted by `tests/janitor/isolation.test.js` since brief 0034.

## Verification needed
- (empty) The Janitor facts used are answered in `docs/api/janitor.md`: a regenerate drops the replaced assistant message and an edited message is re-sent with its new text (2026-09-13); `/generateAlpha` precedes every model invocation (2026-09-13); envelope entries carry database ids (2026-09-14); an empty completion is stored as an empty message (2026-09-13). Still-open ledger items that touch this area — the behaviour of a completion that ends at a stop sequence, and an early stream close with no terminal frames — belong to brief 0038 and block nothing here: this brief only reads a marker that brief 0038 writes. Do not launch `st-api-verifier`; it verifies SillyTavern only.

## Acceptance
- [x] An assistant history message with an incomplete trailing block reaches the derivation truncated to its last complete block; the same message whose id is in `state.boundaries` reaches it byte-identical.
- [x] A block-start occurrence of the bare literal in an assistant message is removed together with everything after it; a mid-paragraph occurrence is untouched; a user message is untouched in both cases.
- [x] The watermark's `prefixHash` written after a freeze equals `prefixIdentity(trimmedContent, offset)`, and a following request whose body no longer carries that message's id re-finds the watermark by that hash.
- [x] A seeded `pendingBoundaryAfter` whose successor is assistant appends exactly that successor's id to `boundaries`, clears the marker, and saves state on a request with no freeze; a body where the successor is missing or is a user turn appends nothing and clears the marker.
- [x] `state.boundaries` never gains a duplicate id and never gains `''`.
- [x] Three consecutive transforms across a seeded boundary produce a byte-identical `[final, control]` prefix.
- [x] Exactly one `console.info` per transformed request, now naming finals, units, frontier words, freeze, drift, `boundary` and `rollback`.
- [x] `src/**` is byte-identical; no file under `janitor/` imports `src/recovery.js` or references `SillyTavern`.
- [x] `npm run build:janitor` regenerates `dist/janitor-manuscript-dissolve.user.js`, the committed file matches a fresh build, and it parses via `new Function`.
- [x] `npm run check` passes
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/janitor-adapter.md` — new `## Derivation-time rollback {#derivation-rollback}`: that this host has no receipt hook, so PLAN §14's repair happens at the next request build on the text Janitor re-sends; the two steps and their order; why `src/recovery.js` and `classifyOutcome` are unavailable here (the bundler name collision, brief 0033) and why the two pure functions are the whole rule; that only assistant-role entries are trimmed; that the trim runs on every request and is therefore idempotent and hash-stable; and that the human-visible Janitor log keeps the debris while the model never sees it (§27).
- `docs/modules/janitor-adapter.md` — new `## Boundary records {#boundary-records}`: why the generated message's id is unknown at the moment of generation; the `pendingBoundaryAfter` lifecycle (written by the response side in brief 0038, resolved or discarded at the next derivation, never carried across two derivations); the exact resolution rule and the regenerate case it exists for; that `boundaries[]` holds envelope ids per brief 0036 and grows append-only; and what a lost marker costs (one rollback of a deliberate stop, recorded in the log, never a protocol violation).
- `docs/modules/janitor-adapter.md#request-pipeline` — amend: the two new steps in their positions, and one sentence on why the order is load-bearing (alignment reads the envelope's untrimmed text, so the trim must come after alignment and before identity, the watermark and the derivation).
- `docs/modules/janitor-adapter.md#prefix-hash-watermark` — amend: the hash is over trimmed text, and the consistency argument for that.
- `docs/modules/janitor-adapter.md#stored-state` — amend: `pendingBoundaryAfter`, its type and its empty value; that a state written before this brief simply lacks it; and that a boundary resolution alone is enough to trigger a save.
- `docs/modules/janitor-adapter.md#request-report` — amend for the two new counts.
- `docs/decisions/0007-janitor-host-deviations.md` — **append** one section, "Boundary trim and rollback at derivation time": that INV-8's ST implementation edits the received message and this host cannot, so the same guarantee is met by trimming what the next request derives; that the model-visible result is identical while the human-visible log differs; the two-step rule and the `boundaries[]` exemption; and the residual cost when a boundary stop is not recorded. Give its alternatives heading the distinct suffix `### Alternatives rejected (derivation-time rollback)` and cover: porting `classifyOutcome` (blocked by the bundler name collision, and a duplicated classifier would be a second definition of completeness — `docs/modules/grammar.md#block-completeness`); writing the trimmed text back to Janitor through its save endpoint (unverified endpoint, and it would edit the human's own log); and one-block hold-back buffering during the stream (stalls Janitor's token-by-token UI and no invariant requires it). Note in one line that the stream-time half of the plan's deviation is recorded by brief 0038 under its own heading. Do not edit or restate the earlier sections.
