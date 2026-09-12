# state
Owns: INV-6 (append-only frozen list) (docs/protocol/invariants.md)
PLAN: §4, §11, §12, §16, §19
Depends on: host, constants, grammar, derive

`src/state.js` is the only module that reads or writes the extension's per-chat protocol state. Everything the protocol persists lives in one object under one key in `chatMetadata`: the append-only list of frozen spans and the watermark that says how much of the visible chat those spans have already consumed. The mutable frontier is **not** stored — it is derived from `chat[]` on every request (`docs/modules/derive.md#derivation-rule`). The module is pure apart from `getState` (which may materialise or migrate state on the context) and `save` (which calls `saveMetadata`), and it never names the ST global — it reaches the host only through `getCtx` (`docs/modules/host.md#single-door`).

## Shape

The stored structure is

```js
{ version: 2, frozen: [{ text, words, createdAt }…], frozenIds: […], watermark: { messageId, offset } }
```

assigned to `chatMetadata[METADATA_KEY]` (`docs/modules/host.md#metadata-namespace`).

- `frozen` — the append-only list of compiled spans, unchanged since v1.
- `frozenIds` — the ids (`docs/modules/derive.md#message-ids`) of the messages whose text has been **fully** consumed by a frozen span. Order carries no meaning; membership is the only query anyone makes. It is an array rather than a `Set` because the structure is JSON.
- `watermark` — the single **partially** consumed message, `{ messageId, offset }`, where `offset` is a character offset into that message's `mes`. `messageId: null` means no message is partially consumed, which is the state after every freeze that happened to cut on a message boundary and the state of a chat that has never been frozen.

Together those two fields are the whole record of what has been compiled. Everything above them is mutable and is re-read from the chat the collaborator is looking at, which is what makes PLAN §12's "reconstruct every request" literal rather than approximate (`docs/protocol/host-mapping.md#s12-frontier`).

Span bodies live **inline** in `chatMetadata` rather than in a localforage store. Metadata travels with the chat file, so a chat export carries its own frozen history and an import restores a chat the model can be conditioned on; a side store would leave the exported chat without the only history the model ever sees. The cost is chat-file size, and moving span bodies out is a documented later option, not a day-one dependency (`docs/protocol/host-mapping.md#s16-freeze`, storage-size paragraph).

Because the structure is serialised into the chat file and read back by `JSON.parse`, it must stay JSON-plain: a plain object, plain arrays, strings and finite numbers. No class instances, no getters, no `Object.freeze`, no `Map`/`Set`, no `undefined` fields — anything that does not survive a `JSON.stringify`/`JSON.parse` round trip unchanged would be silently different after a reload, and the reloaded value is the one the model gets conditioned on.

A frozen span's `text` is one string, not a list of turns, because §16 freezes a prefix of manuscript text by character cut; a turn list would reintroduce the interaction topology the protocol exists to discard (INV-10).

## Lazy init

State is created on first *read*, not at install time and not on a migration pass. `getState` materialises `createState()` when the key is absent — it assigns the new object onto `ctx.chatMetadata` and returns it, but never calls `saveMetadata`. The first real write (a capture, a receipt, a freeze) is what persists it, via `save`.

The materialised object is empty: no frozen spans, no consumed ids, no watermark message. It does not read `chat[]` and does not seed anything, because nothing needs seeding — the whole visible chat is above the watermark and therefore already the frontier (`docs/modules/derive.md#derivation-rule`).

This keeps installation inert: opening a chat and doing nothing leaves the chat file byte-identical, and a user who installs and uninstalls the extension without interacting leaves no residue. It also means there is exactly one code path that produces state, so the "chat that existed before the extension" and the "chat created after" cases cannot diverge.

## Migration from v1 {#migration-v1}

Version 1 stored `{ version: 1, frozen: […], frontier: '' }`, where `frontier` was an accumulated second copy of the text the collaborator could see (`docs/decisions/0004-derived-frontier.md`). `migrateV1(state, chat)` converts that object in place, once, the first time `getState` reads it; the object reference stays the one in `chatMetadata`, and nothing is saved here — the first `save()` from whatever caller triggered the read persists it.

A `frozen` that is not an array is not a v1 structure at all, whatever its `version` says: the object is left untouched, one warning is emitted, and `migrateV1` returns `false`. That is [Unknown version](#unknown-version)'s refuse-to-repair rule, reached by a different route.

Two cases, both deterministic:

- **`frozen` is empty.** `frontier` is deleted, `frozenIds` becomes `[]` and `watermark` becomes `{ messageId: null, offset: 0 }`. The v1 frontier text is discarded without loss, because derivation rebuilds it from the same chat it was seeded from.
- **`frozen` is non-empty.** The v1 frontier has no message-level provenance — it is compiled text with no record of which `chat[]` entries produced it — so it cannot be handed back to the mutable region. It is preserved as history instead: `truncateToLastCompleteBlock(state.frontier)` and, if anything remains, `pushFrozen`. Then every non-system message currently in `chat` is given an id and **all** of them are listed in `frozenIds`, so the derived frontier starts empty rather than repeating text the new span already carries.

The second case is a **documented approximation**. The model's view stays byte-continuous across the upgrade, but the pre-migration tail becomes uneditable (it is a frozen span now), and a trailing *incomplete* block in it is dropped by the truncation. Nothing in `chat[]` is altered beyond the id assignment, and no `saveChat` happens here; the handler that next writes a marker performs it (`docs/modules/capture.md#capture-marker`).

A one-time bump is allowed here while [Unknown version](#unknown-version) still refuses everything else because this codebase wrote v1 and understands its shape exactly, the alternative is a permanently wrong frontier on every existing chat, and the only installation is the author's. An unknown version is a shape nobody here has seen; v1 is not.

## Mutation is storage

`getState` returns the stored object itself, not a copy. `migrateV1` and `pushFrozen` mutate that object in place, so a mutation is immediately visible at `chatMetadata[METADATA_KEY]` with no write-back step; persisting it to disk is a separate `save()` call. This is intentional: one object, one owner, no reconciliation between a working copy and a stored copy, and no window in which the two disagree. Callers must not hold a state object across a chat change — `getState()` is cheap and is called fresh where it is needed.

## Append only

`frozen` is append-only (INV-6, PLAN §16). There is no `popFrozen`, no `replaceFrozen`, no re-cut path, and the module exports no function capable of removing or replacing an entry. Old spans are not re-cut because re-cutting disturbs the demonstrations the earlier text carries, invalidates provider cache prefixes built on the unchanged head, and rewrites the transport statistics later freeze decisions are calibrated against.

`pushFrozen` can therefore only *refuse*. It returns `false` and leaves `frozen` untouched when `text` is missing, not a string, or whitespace-only, and when `isTrailingBlockComplete(text)` is false — a span may never end mid-block, because the next span would then begin mid-block and the seam would be visible as a broken sentence in the model's history (§16, INV-6). A refusal is a caller error the caller must handle by choosing a different cut, not something this module repairs by trimming.

A pushed span is **compiled once and remembered** (`docs/protocol/host-mapping.md#s16-freeze`): from then on the `chat[]` messages it was compiled from are no longer inputs, and their ids sit in `frozenIds` so derivation skips them. Editing, deleting or swiping *those* messages changes the visible log only. Everything above the watermark is the opposite: it is re-read on every request.

## Advance watermark {#advance-watermark}

`advanceWatermark(state, { messageId, offset, consumedIds })` is the **only** writer of `frozenIds` and `watermark`, and `freeze`'s apply step is its only caller (`docs/modules/freeze.md#watermark-mapping`). It mutates in place and returns nothing: every id in `consumedIds` that is a non-empty string and not already listed is appended to `frozenIds`, and `watermark` is replaced by `{ messageId: messageId ?? null, offset: <finite offset, else 0> }`.

It is append-only in the same sense `pushFrozen` is: there is no removal path, no un-consume, no way to walk the watermark backwards to an earlier message, and no sorting or re-indexing of `frozenIds` — order there carries no meaning, membership is the only query. A `null` id is skipped rather than stored, because a message with no id cannot be named by a later derivation and a `null` entry would match nothing.

The two writes belong in one function because they are one event: a freeze consumes whole messages *and* leaves at most one message half-consumed, and a state that recorded only one of the two would send text twice or lose it. Nothing else in the codebase may move them independently.

## Unknown version

A stored structure whose `version` is neither `STATE_VERSION` nor the migratable `1` (including a missing `version`) is returned **unchanged**: not repaired, not overwritten, not normalised, not migrated. One `console.warn` naming the unknown version is emitted, at most once per state object — a module-level `WeakSet` of already-warned objects keeps a per-request caller from filling the console.

Refusing to repair is safer than guessing. The structure is the model's entire conditioning surface and the only copy of the user's frozen history; a wrong guess about a shape written by a different version would silently corrupt history that cannot be reconstructed. Leaving it intact means a downgrade is reversible by reinstalling the matching version, and the warning tells the user which version wrote it.

## Save

`save(ctx)` awaits `ctx.saveMetadata()` and does nothing else. Only metadata changes in this module, so `saveChat` is not called. Intercede's real-install sequence saves chat then metadata (`docs/api/sillytavern.md#chat-metadata`), and the `saveChat` leg belongs to the modules that edit `chat[]` messages — `capture` and `recovery`. There is no debounced variant here: the protocol's writes are request-scoped, not keystroke-scoped, and a debounced save could lose a freeze to a reload.
