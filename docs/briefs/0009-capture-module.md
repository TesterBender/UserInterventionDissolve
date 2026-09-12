# Brief 0009 — `capture`: composer input → manuscript block on the frontier
Status: partial
Complexity: high
PLAN sections: §9 (the collaborator's real input must not survive as a model-visible user turn containing the external character's action: capture it, transform it into manuscript text, merge it into the current manuscript immediately after the model-generated material), §10 (capture is character-specific — ordinary composer input after a stop produces the external character's tag block and nothing else; manuscript-wide editing of the frontier is a *separate* authority that does not go through the composer, and is not built here), §15 (barge-in: the collaborator may insert the external character at any valid block boundary without waiting for the model; once inserted the block is normalised exactly as if the stop had been reached, and after reconstruction the two cases must be indistinguishable)
Invariants touched: INV-3 (this module is its owner), INV-4 (it writes to the frontier through `state`'s API only; it does not reconstruct anything)

## Goal
When the collaborator sends a message in the normal composer, the text they wrote is appended to the canonical frontier as an ordinary manuscript block carrying the external character's tag, the visible `chat[]` message keeps their text verbatim, and the message is marked so it is never captured twice. Barge-in needs no separate path: any send at any time is a capture, and nothing records whether a stop preceded it. INV-3 holds not because the user turn is hidden or rewritten, but because model-visible history is rebuilt from canonical state and never from `chat[]` (`docs/protocol/host-mapping.md#s9-capture`, path 1 — the approved decision).

## In scope
- **`src/capture.js`** (new). Imports `getCtx` from `src/host.js`, `METADATA_KEY` from `src/constants.js`, `parseTagHeader` from `src/grammar.js` (import only, that file is not edited), `reservedLiteral` from `src/boundary.js` (import only, brief 0008), and `getState` / `appendToFrontier` / `save` from `src/state.js` (import only, brief 0007 — rely on the signatures those briefs specify). It must not contain the identifier `SillyTavern` (`docs/modules/host.md#single-door`; `tests/bootstrap.test.js` asserts this). Exports exactly two functions:
  - `toManuscriptBlock(text, literal)` → string. Pure: no host access, no module state.
    - `text` not a string, or `text.trim() === ''` ⇒ return `''` (the caller treats that as "nothing to capture").
    - Let `trimmed = text.trim()`. If `literal` is not a non-empty string ⇒ return `trimmed` untagged. An empty persona name is legal (`reservedLiteral` returns `''` for it, brief 0008) and a bare `': '` prefix must never be written.
    - Let `actor = literal.replace(/:$/, '').trim()`. Call `parseTagHeader(trimmed)`; if it returns a header whose `actor`, compared after `trim().toLowerCase()`, equals `actor` compared the same way ⇒ return `trimmed` unchanged (the collaborator already wrote the tag; never double it).
    - Otherwise return `` `${literal} ${trimmed}` ``.
    - Multi-block input falls out of this rule for free: the tag header regex is anchored at the start (`src/grammar.js` `TAG_HEADER`), so prefixing the whole trimmed string prefixes exactly the first block and every later blank-line-separated block is carried through byte-identical. No re-tagging, re-wrapping, re-punctuating, or block splitting of the remainder.
  - `captureMessage(index, ctx = getCtx())` → `Promise<boolean>` (`true` only when a block was appended). Defaulted-`ctx` parameter form per `docs/decisions/0002-structure-from-intercede.md` ("Injectable host"); never cache `ctx` in module scope (`docs/api/sillytavern.md#getcontext`). Steps, in order, each returning `false` with no write and no save:
    1. `const message = ctx.chat?.[index]` — return unless it is a non-null object.
    2. Return unless `message.is_user === true` and `message.is_system !== true`. Assistant, system and narrator messages are not capture input (`docs/api/sillytavern.md#message-shape`).
    3. Return when `message.extra?.[METADATA_KEY]?.captured === true` (idempotence: re-emitted or replayed MESSAGE_SENT must not append twice).
    4. `const block = toManuscriptBlock(message.mes, reservedLiteral(ctx))` — return when it is `''`.
    5. `appendToFrontier(getState(ctx), block)`.
    6. Mark: `message.extra = message.extra ?? {}`; `message.extra[METADATA_KEY] = { ...(message.extra[METADATA_KEY] ?? {}), captured: true }`. The spread preserves any sibling flag another module owns in that namespace (`extra[METADATA_KEY].boundary`, brief 0008).
    7. `await save(ctx)` (which is `saveMetadata`, per brief 0007) **and** `await ctx.saveChat()` — the frontier lives in metadata, the `captured` marker lives on the message, so both legs are required here. This is the brief brief 0007 named as the one that adds the `saveChat` leg. Return `true`.
    - `message.mes` is never read-modified-written. The visible log stays exactly what the collaborator typed.
- **`index.js`** — one addition and nothing else: inside `init()`, after `ready = true`, subscribe to `MESSAGE_SENT` guarded by presence on `EVENT(ctx)`, with a handler that calls `captureMessage(index)` (no captured context, no payload assumptions beyond the index — `docs/api/sillytavern.md#message-sent`). If brief 0008's guarded-subscription loop has already landed, add the event name to it; otherwise write the same guarded shape standalone. Do not refactor `init()`, do not introduce a subscription registry, do not touch the interceptor placeholder or brief 0007's `CHAT_CHANGED` subscription. Listener errors are swallowed by the emitter (`docs/api/sillytavern.md#events`), so no try/catch.
- **`tests/capture.test.js`** (new) — the Acceptance list below, vitest, `installFakeContext`/`uninstall`.
- **`tests/helpers/fake-context.js`** — add a user-message builder (e.g. `makeUserMessage({ mes, extra })` returning `{ name, is_user: true, is_system: false, mes, extra }` per `#message-shape`) **only if** briefs 0007/0008 have not already added an equivalent; reuse theirs if present. Do not add or rename any key in `eventTypes` (`tests/bootstrap.test.js` asserts an exact key count and that file is not in this brief's allowed set; `MESSAGE_SENT` is already there).
- **Docs** per "Docs to write/update".

## Out of scope (explicit)
- **The editing UI (§10).** No editor panel, no textarea, no "edit the frontier" command, no re-capture of an edited message, no MESSAGE_EDITED/MESSAGE_UPDATED/MESSAGE_DELETED/MESSAGE_SWIPED subscription. Manuscript-wide editing authority is a separate brief; capture is character-specific and composer-only.
- Removing, hiding, deleting, rewriting, styling, or re-rendering the collaborator's `chat[]` message. `updateMessageBlock`, `deleteMessage`, `addOneMessage` and the DOM are untouched. Concealment happens at prompt-build time in `frontier`, nowhere else (`docs/protocol/host-mapping.md#architecture`).
- Any frontier reconstruction, interceptor body, prompt-ready parity, or continuation string (`#s12-frontier`, `#s13-continuation`).
- Any barge-in affordance: no button, no gate, no check that a boundary stop preceded the send, no reading of `extra[METADATA_KEY].boundary`, no "floor" bookkeeping, no distinction recorded anywhere between a stop-triggered and a barge-in capture. §15 requires that the two be indistinguishable after reconstruction; the cheapest way to guarantee that is to record nothing.
- Any handling of the empty send. Pressing Send on an empty composer emits **no** MESSAGE_SENT — `Generate()` skips `sendMessageAsUser` entirely and pushes no message (`docs/api/sillytavern.md#empty-send`), so no code is needed and none may be written. The chat-completion `send_if_empty` quirk in that entry is `frontier`'s to drop, not capture's to detect.
- Any own input surface (host-mapping path 2), extension-owned composer, or mirroring of captured text into `chat[]` as an assistant message.
- Validating, linting, correcting, punctuating, splitting, merging or otherwise policing what the collaborator wrote — including the case where their first block carries a *different* character's tag (`Anton: …`). Capture is character-specific (§10): that input is prefixed like any other. The manuscript grammar is upheld by the collaborator, not enforced in code (`docs/protocol/invariants.md#enforcement-model`).
- Scanning past the first block: no `findTagLiteral` sweep, no per-block header inspection, no `classifyActor`, no aggregate rules (§7 / INV-9 are not code).
- Freezing, word counting, cut selection, `pushFrozen` (§16/§17 — the `freeze` brief); rollback or outcome classification (§14 — `recovery`).
- Writing to `chatMetadata` directly, adding a state field, or adding a `version`. All state access goes through `src/state.js`'s exported API.
- Any setting, toggle, threshold, tag-prefix template, or `extensionSettings` read/write; any `REQUIRED_KEYS` change; any new dependency; group-chat branching (`docs/api/sillytavern.md#group-chats` is unverified).

## Files
- allowed to create/modify: `src/capture.js`, `index.js` (the one guarded MESSAGE_SENT subscription only), `tests/capture.test.js`, `tests/helpers/fake-context.js` (user-message builder only, only if absent), `docs/modules/capture.md`, `docs/modules/bootstrap.md` (one added heading), and this brief's Status line.
- must not touch: `src/grammar.js`, `src/state.js`, `src/boundary.js`, `src/host.js`, `src/constants.js`, `src/prompt.js`, `src/preset.js` (all import-only), `tests/bootstrap.test.js`, `tests/grammar.test.js`, `tests/state.test.js`, `tests/boundary.test.js`, `tests/prompt.test.js`, `tests/preset.test.js`, `manifest.json`, `style.css`, `package.json`, `eslint.config.js`, `vitest.config.js`, `tools/*`, `presets/`, `PLAN.txt`, `CLAUDE.md`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, other `docs/briefs/*`.

## ST APIs used
- `SillyTavern.getContext()` (via `src/host.js` only) — docs/api/sillytavern.md#getcontext (status: verified) — called fresh per invocation, never cached.
- MESSAGE_SENT — docs/api/sillytavern.md#message-sent (status: verified) — payload is the message **index**; fires after the message is already in `chat[]` and after ST's own `saveChatConditional()`, before `addOneMessage`, so the marker written in the handler is present before render and is persisted by this module's own `saveChat()`. Also emitted by slash commands (e.g. `/send`), which this module treats identically.
- Message object shape (`mes`, `is_user`, `is_system`, `extra`) — docs/api/sillytavern.md#message-shape (status: verified).
- Context keys `chat`, `chatMetadata`, `eventSource`, `eventTypes`/`event_types`, `saveChat`, `saveMetadata`, `substituteParams`, `name1` — docs/api/sillytavern.md#context-keys (status: verified).
- Per-chat persistence (`chatMetadata` + `saveMetadata`, one namespace key) — docs/api/sillytavern.md#chat-metadata (status: verified) — reached only through `src/state.js`.
- Emitter semantics (async, sequential, listener errors swallowed) — docs/api/sillytavern.md#events (status: verified).
- Pre-send transform/cancel hook — docs/api/sillytavern.md#pre-send-hook (status: **absent**) — cited as the reason capture runs after the push rather than before it; no code depends on it.
- Sending with an empty textarea — docs/api/sillytavern.md#empty-send (status: verified) — cited as the reason the continuation trigger needs no capture code.
- `substituteParams('{{user}}')` / `name1` as the reserved literal source — docs/api/sillytavern.md#context-keys (status: verified) — consumed only through `reservedLiteral` from `src/boundary.js`.

## Verification needed
- (empty — nothing is blocked.)

## Acceptance
- [x] `toManuscriptBlock('sets the cup down. "No."', 'Mara:')` === `'Mara: sets the cup down. "No."'`.
- [x] `toManuscriptBlock('Mara: sets the cup down.', 'Mara:')` is byte-identical to its input (no doubled tag), and the same holds for the case/space variants `'mara: …'` and `'Mara : …'`.
- [x] A two-block input (`'Mara: she stands.\n\nThe room settles.'`) is returned with the tag untouched and the second block byte-identical; an untagged two-block input gets exactly one prefix, on the first block only, with the blank-line separator and the second block preserved.
- [x] `toManuscriptBlock` returns `''` for `''`, `'   \n '`, `undefined` and a non-string; and returns the trimmed text untagged when `literal` is `''`.
- [x] `captureMessage` on a user message appends the transformed block to `getState(ctx).frontier` (exactly one blank line after any existing frontier text), sets `chat[index].extra[METADATA_KEY].captured === true`, and calls `ctx.saveMetadata` once and `ctx.saveChat` once; it returns `true`.
- [x] `chat[index].mes` is byte-identical before and after `captureMessage`, and `chat.length` is unchanged.
- [x] An assistant message (`is_user: false`), a system message (`is_system: true`), an out-of-range index, and a non-object entry each leave the frontier unchanged and call neither save; each returns `false`.
- [x] A message already carrying `extra[METADATA_KEY].captured === true` leaves the frontier unchanged and calls neither save; calling `captureMessage` twice on the same fresh message appends exactly one block.
- [x] A user message whose `mes` is `''` or whitespace-only leaves the frontier unchanged and calls neither save.
- [x] The marker write preserves a pre-existing sibling flag in the same namespace (`extra[METADATA_KEY] = { boundary: true }` ⇒ afterwards both `boundary` and `captured` are `true`).
- [x] Emitting `MESSAGE_SENT` with the index of a user message through the fake event source produces exactly the same effects as calling `captureMessage` directly (the `index.js` subscription is wired and guarded by presence on `EVENT(ctx)`).
- [x] `src/capture.js` contains no occurrence of the identifier `SillyTavern` and no hard-coded character name.
- [ ] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/capture.md` (new; header block `Owns: INV-3 (docs/protocol/invariants.md)` / `PLAN: §9, §10, §15` / `Depends on: host, constants, grammar, boundary, state`), one heading per pointer comment written in `src/capture.js`, at least:
  - `## Composer path {#composer-path}` — why capture runs *after* the message is in `chat[]`: no pre-send hook exists (`docs/api/sillytavern.md#pre-send-hook`), and the approved path is host-mapping path 1. The visible log stays a faithful record; INV-3 holds because reconstruction is total and never reads `chat[]` (`docs/protocol/host-mapping.md#architecture`).
  - `## Transformation rule {#transformation-rule}` — tag the first block with the reserved literal unless it already carries it; everything else is passed through verbatim, multi-block included. State plainly that a first block tagged with some *other* actor is still prefixed, and why that is the character-specific reading of §10 rather than a bug.
  - `## The reserved literal is borrowed {#reserved-literal}` — capture does not compute the persona name itself; it calls `boundary`'s `reservedLiteral(ctx)` so the stop string and the capture tag can never disagree, and the empty-name case writes no tag at all.
  - `## Capture marker {#capture-marker}` — `extra[METADATA_KEY].captured` is a message-local idempotence flag, not canonical state; why it is spread-merged with `boundary`; why the marker needs `saveChat` while the frontier needs `saveMetadata`.
  - `## Barge-in is the same path {#barge-in}` — §15: any send at any time is a capture; no stop is required, nothing distinguishes the two cases in storage, which is what makes them indistinguishable after reconstruction.
  - `## Empty send is not a capture {#empty-send}` — pressing Send on an empty composer emits no MESSAGE_SENT at all (`docs/api/sillytavern.md#empty-send`); it is the continuation trigger and this module deliberately contains no code for it.
  - `## Editing is not capture {#editing-is-not-capture}` — §10's second half: manuscript-wide editing of the frontier is a distinct authority that does not go through the composer and is not implemented here; a later edit of the visible message does not re-enter the frontier.
- `docs/modules/bootstrap.md` — add one heading, `## Capture subscription {#capture-subscription}`: the single guarded `MESSAGE_SENT` subscription, that the handler passes only the index and takes a fresh context, and that `index.js` still holds wiring only — every decision lives in `src/capture.js`.
