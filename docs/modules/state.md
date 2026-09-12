# state
Owns: INV-4 (frontier container), INV-6 (append-only frozen list) (docs/protocol/invariants.md)
PLAN: §4, §11, §12, §16
Depends on: host, constants, grammar

`src/state.js` is the only module that reads or writes the extension's per-chat protocol state. Everything the protocol persists lives in one object under one key in `chatMetadata`: the append-only list of frozen spans and the single mutable frontier string. `capture`, `frontier`, `freeze` and `recovery` all go through this module; no other module touches `chatMetadata`. The module is pure apart from `getState` (which may materialise state on the context) and `save` (which calls `saveMetadata`), and it never names the ST global — it reaches the host only through `getCtx` (`docs/modules/host.md#single-door`).

## Shape

The stored structure is `{ version: 1, frozen: [{ text, words, createdAt }…], frontier: '' }`, assigned to `chatMetadata[METADATA_KEY]` (`docs/modules/host.md#metadata-namespace`).

Span bodies live **inline** in `chatMetadata` rather than in a localforage store. Metadata travels with the chat file, so a chat export carries its own frozen history and an import restores a chat the model can be conditioned on; a side store would leave the exported chat without the only history the model ever sees. The cost is chat-file size, and moving span bodies out is a documented later option, not a day-one dependency (`docs/protocol/host-mapping.md#s16-freeze`, storage-size paragraph).

Because the structure is serialised into the chat file and read back by `JSON.parse`, it must stay JSON-plain: a plain object, plain arrays, strings and finite numbers. No class instances, no getters, no `Object.freeze`, no `Map`/`Set`, no `undefined` fields — anything that does not survive a `JSON.stringify`/`JSON.parse` round trip unchanged would be silently different after a reload, and the reloaded value is the one the model gets conditioned on.

The frontier is one string, not a list of turns, because §12 rebuilds it as manuscript text on every request and §16 freezes a prefix of it by character cut; a turn list would reintroduce the interaction topology the protocol exists to discard (INV-10).

## Lazy init

State is created on first *read*, not at install time and not on a migration pass. `getState` materialises the structure when the key is absent — it assigns the new object onto `ctx.chatMetadata` and returns it, but never calls `saveMetadata`. The first real write (a capture, a freeze, a frontier update) is what persists it, via `save`.

This keeps installation inert: opening a chat and doing nothing leaves the chat file byte-identical, and a user who installs and uninstalls the extension without interacting leaves no residue. It also means there is exactly one code path that produces state, so the "chat that existed before the extension" and the "chat created after" cases cannot diverge.

## Initialise from chat

A chat that predates the extension needs a usable frontier on day one, without a migration step. `initialiseFromChat(chat)` builds it from the chat's own messages: every message with `is_system !== true`, in order, trimmed, blank entries skipped, joined with a blank line — the block delimiter (`docs/modules/grammar.md#block-delimiter`). The `is_system` test is ST's own prompt-exclusion filter (`docs/api/sillytavern.md#message-shape`); the tool-invocation exception in that filter is deliberately not reproduced, because this extension registers no tools. Nothing is frozen: `frozen` starts empty on every chat, and seeding (§19) is a separate concern.

User and assistant text is copied **verbatim** — no tag header is synthesised, no rewriting, no truncation. Transforming collaborator text into tagged manuscript blocks is `capture`'s job and applies to *new* messages only (`docs/protocol/host-mapping.md#s9-capture`). Rewriting pre-existing history here would invent authorship for lines whose speaker the extension never observed, and would change text the user already saw in their log.

## Mutation is storage

`getState` returns the stored object itself, not a copy. `setFrontier`, `appendToFrontier` and `pushFrozen` mutate that object in place, so a mutation is immediately visible at `chatMetadata[METADATA_KEY]` with no write-back step; persisting it to disk is a separate `save()` call. This is intentional: one object, one owner, no reconciliation between a working copy and a stored copy, and no window in which the two disagree. Callers must not hold a state object across a chat change — `getState()` is cheap and is called fresh where it is needed.

## Append only

`frozen` is append-only (INV-6, PLAN §16). There is no `popFrozen`, no `replaceFrozen`, no re-cut path, and the module exports no function capable of removing or replacing an entry. Old spans are not re-cut because re-cutting disturbs the demonstrations the earlier text carries, invalidates provider cache prefixes built on the unchanged head, and rewrites the transport statistics later freeze decisions are calibrated against.

`pushFrozen` can therefore only *refuse*. It returns `false` and leaves `frozen` untouched when `text` is missing, not a string, or whitespace-only, and when `isTrailingBlockComplete(text)` is false — a span may never end mid-block, because the next span would then begin mid-block and the seam would be visible as a broken sentence in the model's history (§16, INV-6). A refusal is a caller error the caller must handle by choosing a different cut, not something this module repairs by trimming.

A pushed span is **compiled once and remembered** (`docs/protocol/host-mapping.md#s16-freeze`): from then on the `chat[]` messages it was compiled from are no longer inputs. Editing, deleting or swiping them changes the visible log only, never what the model sees.

## Unknown version

A stored structure whose `version` is anything other than `STATE_VERSION` (including a missing `version`) is returned **unchanged**: not repaired, not overwritten, not normalised, not migrated. One `console.warn` naming the unknown version is emitted, at most once per state object — a module-level `WeakSet` of already-warned objects keeps a per-request caller from filling the console.

Refusing to repair is safer than guessing. The structure is the model's entire conditioning surface and the only copy of the user's frozen history; a wrong guess about a shape written by a different version would silently corrupt history that cannot be reconstructed. Leaving it intact means a downgrade is reversible by reinstalling the matching version, and the warning tells the user which version wrote it. Version negotiation, if it is ever needed, arrives with the brief that introduces a `version: 2`.

## Save

`save(ctx)` awaits `ctx.saveMetadata()` and does nothing else. Only metadata changes in this module, so `saveChat` is not called. Intercede's real-install sequence saves chat then metadata (`docs/api/sillytavern.md#chat-metadata`), and the `saveChat` leg belongs to the first module that edits a `chat[]` message — `recovery`. There is no debounced variant here: the protocol's writes are request-scoped, not keystroke-scoped, and a debounced save could lose a freeze to a reload.
