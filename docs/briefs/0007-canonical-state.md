# Brief 0007 — canonical state: per-chat frozen spans + mutable frontier
Status: draft
Complexity: high
PLAN sections: §4 (the "canonical history" layer — the persistent conditioning surface actually shown to the model, which must preserve fiction and agency while discarding collaboration topology; this brief builds the container for it), §11 (the live cycle names "canonical history" and "mutable frontier" as the two things every later step reads and writes), §12 (normalization happens every request, freezing only when the frontier reaches its transport target — so the frontier must be a single mutable string, not a list of turns), §16 first half (freezing is append-only; old frozen spans are not re-cut, because re-cutting disturbs demonstrations, invalidates cache prefixes and rewrites transport statistics)
Invariants touched: INV-4 (this brief provides the single mutable frontier that §12 reconstruction reads), INV-6 (append-only frozen list, refusal to append a span that ends mid-block), INV-10 (the stored structure is the only model-visible input, so live interaction topology has no representation in it)

## Goal
Every chat has one persistent structure — `chatMetadata[METADATA_KEY] = { version: 1, frozen: [{ text, words, createdAt }…], frontier: '' }` — that is created on demand, read and mutated through a small pure API in `src/state.js`, and persisted with `saveMetadata()`. A chat that existed before the extension was installed gets a usable initial frontier built from its own non-system messages, so the extension works on day one without a migration step. Nothing is frozen at initialisation. When this is done, `capture`, `frontier`, `freeze` and `recovery` each have exactly one place to read and write protocol state, and no other module ever touches `chatMetadata` directly.

## In scope
- **`src/constants.js`** — add exactly two literals, nothing else:
  - `STATE_VERSION = 1` — the `version` field of the stored structure (`docs/decisions/0002-structure-from-intercede.md`, "Per-chat state").
  - `BLOCK_DELIMITER = '\n\n'` — the string used to *join* blocks when writing manuscript text. It is the write-side counterpart of the read-side rule in `docs/modules/grammar.md#block-delimiter` (a blank line is the only block separator). `src/grammar.js` keeps its own parsing regex; this constant does not replace it and grammar is not modified.
- **`src/state.js`** — a new module, pure except for two functions. It imports `getCtx` from `src/host.js`, `METADATA_KEY`/`STATE_VERSION`/`BLOCK_DELIMITER`/`LOG_PREFIX` from `src/constants.js`, and `isTrailingBlockComplete` from `src/grammar.js` (import only — `src/grammar.js` is not edited). It must not contain the identifier `SillyTavern` (`docs/modules/host.md#single-door`). Exports, and no others:
  - `createState()` → a fresh plain object `{ version: STATE_VERSION, frozen: [], frontier: '' }`. No class, no getters, no freezing of the object — it must survive `JSON.stringify`/`JSON.parse` through the chat file unchanged.
  - `initialiseFromChat(chat)` → pure; takes the `chat` array (`docs/api/sillytavern.md#message-shape`), returns a new state whose `frozen` is `[]` and whose `frontier` is the `mes` text of every message with `is_system !== true`, in order, each trimmed of surrounding whitespace, blank/whitespace-only entries skipped, joined with `BLOCK_DELIMITER`. User and assistant messages are treated identically and their text is taken **as-is** — no tag header is added, no rewriting, no truncation. Non-array or empty input yields the same object `createState()` would. The `is_system` test matches ST's own prompt-exclusion filter (`docs/api/sillytavern.md#message-shape`, `script.js:4437`); the tool-invocation exception in that filter is deliberately not reproduced (this extension registers no tools).
  - `getState(ctx = getCtx())` → reads `ctx.chatMetadata?.[METADATA_KEY]`.
    - Present with `version === STATE_VERSION`: return it unchanged.
    - Present with any other `version` (including missing): return it unchanged, do not repair it, do not overwrite it, and emit one `console.warn` with `LOG_PREFIX` naming the unknown version. Warn at most once per state object (a module-level `WeakSet` of already-warned objects) so a per-request caller cannot spam the console. No migration code of any kind.
    - Absent: build `initialiseFromChat(ctx.chat)`, assign it to `ctx.chatMetadata[METADATA_KEY]`, return it. Assignment only — `getState` never calls `saveMetadata`.
    - The returned object **is** the stored object; mutating it through the helpers below mutates `chatMetadata` in place. That is intentional and must be documented, not defended against with copies.
  - `setFrontier(state, text)` → mutates `state.frontier = String(text)`; returns nothing.
  - `appendToFrontier(state, block)` → mutates; no-op when `block` is nullish or whitespace-only. Otherwise appends `block.trim()`, preceded by `BLOCK_DELIMITER` only when the existing frontier is non-empty (the existing frontier's trailing whitespace is stripped first, so exactly one delimiter separates the two). Returns nothing.
  - `pushFrozen(state, span)` → append-only. Takes `{ text, words?, createdAt? }`. **Refuses** (returns `false`, leaves `state.frozen` untouched) when `text` is missing, not a string, whitespace-only, or when `isTrailingBlockComplete(text)` is `false` — a span may never end mid-block (INV-6, PLAN §16). On acceptance it pushes `{ text, words, createdAt }` where `words` is the caller's value if a finite number, otherwise the count of whitespace-separated runs in `text`, and `createdAt` is the caller's value if a finite number, otherwise `Date.now()`; returns `true`. There is no `popFrozen`, no `replaceFrozen`, no re-cut path.
  - `save(ctx = getCtx())` → `await ctx.saveMetadata()` and nothing else. Only metadata changes in this brief, so `saveChat` is **not** called; Intercede's real-install sequence saves chat then metadata (`docs/api/sillytavern.md#chat-metadata`, `Intercede:src/stcontext.js:63-69`) and the brief that first edits a `chat[]` message (`recovery`) is the one that adds the `saveChat` leg.
  - Defaulted-`ctx` parameter form per `docs/decisions/0002-structure-from-intercede.md` ("Injectable host"); `getState` and `save` are the only functions that touch `ctx`.
- **`index.js`** — one addition, inside `init()` after `ready = true`, and nothing more:
  - If `EVENT(ctx).CHAT_CHANGED` is defined, `ctx.eventSource.on(EVENT(ctx).CHAT_CHANGED, handler)` where the handler calls `getState()` (fresh context, no captured `ctx`) and returns. Event name and payload (`getCurrentChatId()`) per `docs/api/sillytavern.md#message-lifecycle-events`; the handler ignores the payload except to return early when it is nullish (no chat open). Listener errors are swallowed by the emitter (`docs/api/sillytavern.md#events`), so no try/catch and no extra logging.
  - Because a chat may already be open when the extension loads and `CHAT_CHANGED` will not fire again for it, `init()` also calls `getState()` once if `Array.isArray(ctx.chat) && ctx.chat.length > 0`. The guard exists because `getContext()` values are read live at call time and `chat` is `[]` before any chat loads (`docs/api/sillytavern.md#context-at-load`); materialising state against a not-yet-loaded chat would write an empty structure into the wrong metadata object.
  - No other subscription, no interceptor change, no extra log line.
- **`tests/state.test.js`** — the Acceptance list below, vitest, `installFakeContext`/`uninstall` from the existing helper.
- **`tests/helpers/fake-context.js`** — may gain one exported factory for building `chat[]` entries with `#message-shape` defaults (`{ name, is_user, is_system, mes, extra }`), and only if the test file would otherwise repeat the literal three or more times. No failure-injection hooks, no storage fake.

## Out of scope (explicit)
- Any freeze policy: word targets, jitter, cut selection, salience rules, calling `pushFrozen` from anywhere. PLAN §16's target size and §17's cut rules belong to the `freeze` brief; this brief only guarantees the list is append-only and boundary-clean.
- Any frontier reconstruction, interceptor body, `CHAT_COMPLETION_PROMPT_READY` parity, continuation string, or assistant/user turn mapping (`docs/protocol/host-mapping.md#s12-frontier` — the `frontier` brief).
- Any capture: no `MESSAGE_SENT` subscription, no tag-header synthesis for collaborator text, no `extra.<ext>.captured` marking (`#s9-capture` — the `capture` brief). `initialiseFromChat` copies existing user text verbatim precisely because transforming it is capture's job for *new* messages only.
- Any recovery: no truncation to the last complete block, no `lastCompleteBoundary`/`truncateToLastCompleteBlock` use, no editing of `chat[]` messages or swipes.
- Seeding (§19): no seed span is written, `frozen` starts empty on every chat including new ones.
- localforage or any external store; span bodies live inline in `chatMetadata` (`docs/protocol/host-mapping.md#s16-freeze`, storage-size paragraph). Migrating them out is a documented *later* option, not this brief.
- Migration, repair, or normalisation of an unknown-version structure; version negotiation; a `version: 2`.
- Any setting, toggle, threshold, or UI surface; no settings panel, no editor, no `extensionSettings` read or write.
- Debouncing, caching, or memoising the state object; no `saveMetadataDebounced`; no `saveChat`.
- Group-chat handling (`docs/api/sillytavern.md#group-chats` is unverified) — the code must not branch on `groupId`.
- New dependencies; changes to `package.json`, `vitest.config.js`, `eslint.config.js`, `manifest.json`, `tools/`.

## Files
- allowed to create/modify: `src/state.js`, `src/constants.js` (two added literals only), `index.js` (the one subscription and the one load-time `getState()` call), `tests/state.test.js`, `tests/helpers/fake-context.js` (message factory only, if needed), `docs/modules/state.md`, `docs/modules/bootstrap.md` (one added heading), and this brief's Status line
- must not touch: `src/grammar.js` (import only), `src/prompt.js`, `src/host.js`, `tests/grammar.test.js`, `tests/prompt.test.js`, `tests/preset.test.js`, `tests/bootstrap.test.js`, `presets/`, `tools/`, `manifest.json`, `style.css`, `package.json`, `eslint.config.js`, `vitest.config.js`, `PLAN.txt`, `CLAUDE.md`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, other `docs/briefs/*`

## ST APIs used
- `SillyTavern.getContext()` (via `src/host.js` only) — docs/api/sillytavern.md#getcontext (status: verified)
- `chatMetadata` + `saveMetadata()` per-chat persistence, namespaced under one key — docs/api/sillytavern.md#chat-metadata (status: verified)
- Context keys `chat`, `chatMetadata`, `eventSource`, `eventTypes`/`event_types`, `saveMetadata` — docs/api/sillytavern.md#context-keys (status: verified)
- Message object shape (`mes`, `is_user`, `is_system`) and ST's own `!x.is_system` prompt-exclusion filter — docs/api/sillytavern.md#message-shape (status: verified)
- `CHAT_CHANGED` event name and `getCurrentChatId()` payload — docs/api/sillytavern.md#message-lifecycle-events (status: verified)
- Emitter semantics (async, sequential, listener errors swallowed) — docs/api/sillytavern.md#events (status: verified)
- Context values are read live at call time; `chat` is empty before a chat loads — docs/api/sillytavern.md#context-at-load (status: verified)

## Verification needed
- (empty — nothing is blocked.)

## Acceptance
- [ ] `createState()` returns `{ version: 1, frozen: [], frontier: '' }` and survives a `JSON.parse(JSON.stringify(…))` round trip deep-equal.
- [ ] `initialiseFromChat([])` and `initialiseFromChat(undefined)` both deep-equal `createState()`.
- [ ] `initialiseFromChat` over a chat of user, assistant, system and blank messages produces a frontier containing every non-system non-blank `mes` in order, verbatim, separated by exactly one blank line, with no system message text present and no leading/trailing whitespace.
- [ ] `getState(ctx)` on a context whose `chatMetadata` has no `METADATA_KEY` materialises the initialised state at `ctx.chatMetadata[METADATA_KEY]`, and `ctx.saveMetadata` is **not** called.
- [ ] `getState(ctx)` is idempotent: two calls return the **same object reference**, the second does not recompute from `chat` (mutate `frontier` between calls and assert the mutation survives, and that a `chat` change between calls has no effect).
- [ ] Mutating the returned state via `setFrontier`/`appendToFrontier`/`pushFrozen` is visible at `ctx.chatMetadata[METADATA_KEY]` without any further call.
- [ ] `appendToFrontier` on an empty frontier produces the block alone; on a non-empty one, exactly one blank line separates old and new; a blank, whitespace-only, `null` or `undefined` block leaves the frontier byte-identical.
- [ ] `pushFrozen` refuses (returns `false`, `frozen.length` unchanged) for: missing `text`, non-string `text`, `''`, whitespace-only, and a text whose trailing block is incomplete per `isTrailingBlockComplete` (e.g. `'Anton: he reaches for the'`). It accepts a complete-trailing-block text, returns `true`, appends one entry, and fills `words` (number) and `createdAt` (number) when the caller omits them, preserving caller-supplied finite values.
- [ ] Order is preserved and nothing is ever removed: three successive `pushFrozen` calls yield `frozen` of length 3 in call order; the module exports no function capable of removing or replacing an entry (assert on the module's export names).
- [ ] `await save(ctx)` calls `ctx.saveMetadata` exactly once and `ctx.saveChat` zero times.
- [ ] A context whose stored state has `version: 99` is returned unchanged (same reference, fields untouched, `frozen`/`frontier` not added or reset), a `console.warn` naming the version is emitted once, and a second `getState` call emits no further warning.
- [ ] With a fake context whose `chat` is non-empty, importing `index.js` materialises `chatMetadata[METADATA_KEY]` exactly once at load; with an empty `chat` it does not.
- [ ] Emitting `CHAT_CHANGED` with a chat id materialises state for the current context; emitting it with a nullish payload does not write to `chatMetadata`.
- [ ] The existing bootstrap leak test still passes: `src/state.js` contains no occurrence of the identifier `SillyTavern`.
- [ ] `npm run check` passes.
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/state.md` — new file with the header `Owns: INV-4 (frontier container), INV-6 (append-only frozen list) (docs/protocol/invariants.md)` / `PLAN: §4, §11, §12, §16` / `Depends on: host, constants, grammar`, then one heading per pointer comment written in `src/state.js`, at least:
  - `## Shape` — the stored object and why it lives inline in `chatMetadata` rather than localforage (`docs/protocol/host-mapping.md#s16-freeze`), and why it must stay JSON-plain.
  - `## Lazy init` — state is created on first read, not on install; `getState` assigns but never saves, and the first real write is what persists it.
  - `## Initialise from chat` — the pre-existing-chat default: non-system messages verbatim, joined by a blank line, nothing frozen; why user text is *not* transformed here (that is capture's job, for new messages only).
  - `## Mutation is storage` — the returned object is the stored object; helpers mutate in place and no copy is made.
  - `## Append only` — why `pushFrozen` can refuse and why there is no removal path (INV-6, PLAN §16: old spans are not re-cut — it would disturb demonstrations, invalidate cache prefixes, and rewrite transport statistics); the mid-block refusal rule and the `docs/protocol/host-mapping.md#s16-freeze` "compiled once, remembered" consequence that frozen spans no longer track `chat[]`.
  - `## Unknown version` — leave untouched, warn once, never migrate; why refusing to repair is safer than guessing.
  - `## Save` — `saveMetadata` alone, why `saveChat` is not called here and which brief adds it (`docs/api/sillytavern.md#chat-metadata`).
- `docs/modules/bootstrap.md` — add one heading, `## State materialisation`, explaining the single `CHAT_CHANGED` subscription plus the one load-time call, the `chat.length > 0` guard and its `docs/api/sillytavern.md#context-at-load` reason, and that `index.js` still implements no protocol behaviour.
