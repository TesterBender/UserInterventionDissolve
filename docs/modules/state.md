# state
Owns: INV-6 (append-only frozen list) (docs/protocol/invariants.md)
PLAN: §4, §11, §12, §16, §19
Depends on: host, constants, grammar

`src/state.js` is the only module that reads or writes the extension's per-chat protocol state. Everything the protocol persists lives in one object under one key in `chatMetadata`: the append-only list of frozen spans and the watermark that says how much of the visible chat those spans have already consumed. The mutable frontier is **not** stored — it is derived from `chat[]` on every request (`docs/modules/derive.md#derivation-rule`). The module is pure apart from `getState` (which may materialise or discard state on the context) and `save` (which calls `saveMetadata`), and it never names the ST global — it reaches the host only through `getCtx` (`docs/modules/host.md#single-door`).

## Shape

The stored structure is

```js
{ version: 3, frozen: [{ text, words, createdAt }…], units: [{ text, words, createdAt }…], frozenIds: […], watermark: { messageId, offset } }
```

assigned to `chatMetadata[METADATA_KEY]` (`docs/modules/host.md#metadata-namespace`).

Compilation is two-tier (`PLAN-addendum-hierarchical-compilation.md` §2, `docs/decisions/0006-hierarchical-compilation.md`). A cut at the 3,000–4,200-word transport target produces a **Tier-1 unit**, not a permanent historical span; units accumulate in `units` and are **sealed** into one entry of `frozen` when the next unit could no longer fit under the final ceiling (`docs/modules/freeze.md#seal-policy`).

- `frozen` — the append-only list of **final** spans. A final span is one model-visible assistant message and is never merged, re-cut or rewritten.
- `units` — the compiled units that have not been sealed yet. They are canonical state (their text has already been consumed off `chat[]`), but they are not yet a final span; the reconstruction concatenates them into the current frontier message and gives them no turn of their own (`docs/modules/frontier.md#shape`).
- `frozenIds` — the ids (`docs/modules/derive.md#message-ids`) of the messages whose text has been **fully** consumed by a frozen span. Order carries no meaning; membership is the only query anyone makes. It is an array rather than a `Set` because the structure is JSON.
- `watermark` — the single **partially** consumed message, `{ messageId, offset }`, where `offset` is a character offset into that message's `mes`. `messageId: null` means no message is partially consumed, which is the state after every freeze that happened to cut on a message boundary and the state of a chat that has never been frozen.

Together those two fields are the whole record of what has been compiled. Everything above them is mutable and is re-read from the chat the collaborator is looking at, which is what makes PLAN §12's "reconstruct every request" literal rather than approximate (`docs/protocol/host-mapping.md#s12-frontier`).

Span bodies live **inline** in `chatMetadata` rather than in a localforage store. Metadata travels with the chat file, so a chat export carries its own frozen history and an import restores a chat the model can be conditioned on; a side store would leave the exported chat without the only history the model ever sees. The cost is chat-file size, and moving span bodies out is a documented later option, not a day-one dependency (`docs/protocol/host-mapping.md#s16-freeze`, storage-size paragraph).

Because the structure is serialised into the chat file and read back by `JSON.parse`, it must stay JSON-plain: a plain object, plain arrays, strings and finite numbers. No class instances, no getters, no `Object.freeze`, no `Map`/`Set`, no `undefined` fields — anything that does not survive a `JSON.stringify`/`JSON.parse` round trip unchanged would be silently different after a reload, and the reloaded value is the one the model gets conditioned on.

A frozen span's `text` is one string, not a list of turns, because §16 freezes a prefix of manuscript text by character cut; a turn list would reintroduce the interaction topology the protocol exists to discard (INV-10).

## Lazy init

State is created on first *read*, not at install time and not on a migration pass. `getState` materialises `createState()` when the key is absent — it assigns the new object onto `ctx.chatMetadata` and returns it, but never calls `saveMetadata`. The first real write (a receipt, a freeze) is what persists it, via `save`.

The materialised object is empty: no frozen spans, no consumed ids, no watermark message. It does not read `chat[]` and does not seed anything, because nothing needs seeding — the whole visible chat is above the watermark and therefore already the frontier (`docs/modules/derive.md#derivation-rule`).

This keeps installation inert: opening a chat and doing nothing leaves the chat file byte-identical, and a user who installs and uninstalls the extension without interacting leaves no residue. It also means there is exactly one code path that produces state, so the "chat that existed before the extension" and the "chat created after" cases cannot diverge.

## Mutation is storage

`getState` returns the stored object itself, not a copy. `pushFrozen` and `advanceWatermark` mutate that object in place, so a mutation is immediately visible at `chatMetadata[METADATA_KEY]` with no write-back step; persisting it to disk is a separate `save()` call. This is intentional: one object, one owner, no reconciliation between a working copy and a stored copy, and no window in which the two disagree. Callers must not hold a state object across a chat change — `getState()` is cheap and is called fresh where it is needed.

## canPushSpan {#can-push-span}

`canPushSpan(text)` is the accept test — `typeof text === 'string' && text.trim() !== '' && isTrailingBlockComplete(text)` — factored out so it has exactly two consumers: the push paths below, and `freeze`'s pre-check, which runs it *before* mutating anything so that a span which would be refused cannot leave a seal behind it (`docs/modules/freeze.md#seal-policy`). It is a test, not a repair: nothing here trims a span into acceptability.

## pushUnit {#push-unit}

`pushUnit(state, unit)` has the same contract as `pushFrozen` — refuse a missing, non-string, blank or mid-block `text`, otherwise fill `words` (`/\S+/g`) and `createdAt` (`Date.now()`) and append `{ text, words, createdAt }` — but it appends to `state.units`. Both run the same accept test, [canPushSpan](#can-push-span), so the two tiers cannot disagree about when a span is acceptable.

## sealUnits {#seal-units}

`sealUnits(state)` promotes the whole unsealed tier into one final span: it returns `null` when `units` is empty, and otherwise joins the unit texts with `BLOCK_DELIMITER` (`docs/modules/grammar.md#block-delimiter`), sums their `words` and offers the result to `pushFrozen`. On acceptance it clears `units` in place (`state.units.length = 0`) and returns the new `frozen` index.

It honours `pushFrozen`'s boolean: a refused push returns `false` and leaves `units` untouched, so a seal can never lose the text it was going to promote and can never report a `frozen` entry that does not exist. In ordinary operation the refusal cannot happen — every unit passed `canPushSpan` on the way in, and joining complete blocks with a blank line leaves the trailing block complete — but the guard is what makes "no text loss" a property of this function rather than of its callers' inputs. `sealUnits` still decides nothing about *when* to seal; that policy lives in `freeze` (`docs/modules/freeze.md#seal-policy`). The units are cleared rather than kept as a back-reference: the addendum (§9) permits either, and a retained copy would duplicate the span bytes in `chatMetadata` with no consumer (`docs/decisions/0006-hierarchical-compilation.md`).

## Append only

`frozen` is append-only (INV-6, PLAN §16). There is no `popFrozen`, no `replaceFrozen`, no re-cut path, and the module exports no function capable of removing or replacing an entry. Old spans are not re-cut because re-cutting disturbs the demonstrations the earlier text carries, invalidates provider cache prefixes built on the unchanged head, and rewrites the transport statistics later freeze decisions are calibrated against.

`pushFrozen` can therefore only *refuse*. It returns `false` and leaves `frozen` untouched when `text` is missing, not a string, or whitespace-only, and when `isTrailingBlockComplete(text)` is false — a span may never end mid-block, because the next span would then begin mid-block and the seam would be visible as a broken sentence in the model's history (§16, INV-6). A refusal is a caller error the caller must handle by choosing a different cut, not something this module repairs by trimming.

A pushed span is **compiled once and remembered** (`docs/protocol/host-mapping.md#s16-freeze`): from then on the `chat[]` messages it was compiled from are no longer inputs, and their ids sit in `frozenIds` so derivation skips them. Editing, deleting or swiping *those* messages changes the visible log only. Everything above the watermark is the opposite: it is re-read on every request.

## Advance watermark {#advance-watermark}

`advanceWatermark(state, { messageId, offset, consumedIds })` is the **only** writer of `frozenIds` and `watermark`, and `freeze`'s apply step is its only caller (`docs/modules/freeze.md#watermark-mapping`). It mutates in place and returns nothing: every id in `consumedIds` that is a non-empty string and not already listed is appended to `frozenIds`, and `watermark` is replaced by `{ messageId: messageId ?? null, offset: <finite offset, else 0> }`.

It is append-only in the same sense `pushFrozen` is: there is no removal path, no un-consume, no way to walk the watermark backwards to an earlier message, and no sorting or re-indexing of `frozenIds` — order there carries no meaning, membership is the only query. A `null` id is skipped rather than stored, because a message with no id cannot be named by a later derivation and a `null` entry would match nothing.

The two writes belong in one function because they are one event: a freeze consumes whole messages *and* leaves at most one message half-consumed, and a state that recorded only one of the two would send text twice or lose it. Nothing else in the codebase may move them independently.

## Unknown version {#unknown-version}

A stored `version: 2` structure is the one exception: it is **upgraded in place**. `getState` sets `units = []`, sets `version` to `3` and returns the same object, so the identity the caller already holds stays valid and the mutation is persisted by the next ordinary `saveMetadata` exactly like the lazy init (see [Lazy init](#lazy-init)) — `getState` still saves nothing itself. The v2 body is not validated, because it is our own former write. Its `frozen` entries stay **final** and byte-identical: they are already model-visible assistant messages, and merging them into larger finals would rewrite stable history that the addendum (§7, §11) and INV-6 make append-only.

A stored structure whose `version` is neither `STATE_VERSION` nor `2` (including a missing `version`, `1`, or any other value) is treated as **absent**: `getState` discards it, assigns a fresh `createState()` to `chatMetadata[METADATA_KEY]`, and returns that new object. One `console.warn` naming the unknown version is emitted, at most once per state object — a module-level `WeakSet` of already-warned objects keeps a per-request caller from filling the console. Nothing is saved by `getState` itself; the first real write persists the fresh object, exactly as for the ordinary absent-key case.

Discarding rather than migrating is safer than guessing, and simpler than carrying a migration path forward indefinitely. The structure is the model's entire conditioning surface, but a shape this codebase cannot read is not usable as one: a wrong guess about a shape written by a different version would silently corrupt history that cannot be reconstructed, and the only value migration ever bought (`docs/decisions/0004-derived-frontier.md#status`) was continuity for the author's own v1 test chats, which are inconsequential to lose. The warning tells the user which version wrote the discarded structure.

## Save

`save(ctx)` awaits `ctx.saveMetadata()` and does nothing else. Only metadata changes in this module, so `saveChat` is not called. Intercede's real-install sequence saves chat then metadata (`docs/api/sillytavern.md#chat-metadata`), and the `saveChat` leg belongs to the module that edits `chat[]` messages — `recovery`. There is no debounced variant here: the protocol's writes are request-scoped, not keystroke-scoped, and a debounced save could lose a freeze to a reload.
