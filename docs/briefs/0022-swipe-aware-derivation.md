# Brief 0022 — Swipe/regenerate-aware derivation
Status: draft
Complexity: high
PLAN sections: §12 (normalisation happens every request; the frontier is reconstructed so only the single continuation seam currently needed at the edge remains), §11 (the live cycle is manuscript → continuation control → generation; a regeneration replaces the last model output rather than following it)
Invariants touched: INV-4, INV-10

## Goal
When the collaborator swipes or regenerates, the reconstruction sent to the model must not contain the message being regenerated. Today `interceptGeneration` derives the frontier from the live `getCtx().chat`, which on a swipe/regenerate still holds the previous attempt, so the model receives its own last output as manuscript and writes a *continuation* of it instead of an *alternative* to it. After this brief, derivation takes an explicit scope option, `interceptGeneration` sets that option from the generation type, and a swipe or regenerate sees exactly the manuscript that preceded the message under regeneration — the same text a `normal` request would have seen one step earlier. Nothing else about derivation, freezing, or recovery changes.

## Chosen rule, and why
**Type rule, not coreChat inspection.** `deriveFrontier` gains a fourth argument `options` with one field, `excludeLastAssistant`. `interceptGeneration` sets it to `type === 'swipe' || type === 'regenerate'` (`docs/api/sillytavern.md#generation-types`, verified) and derivation drops the **last** message that would otherwise be considered, but only when that message is not a user message.

The alternative — deriving from the per-request `chat` copy the interceptor receives, on the theory that ST already excluded the regenerated message from `coreChat` — is rejected for this brief. `coreChat` is built as new objects from `chat.filter(...)` (`docs/api/sillytavern.md#generate-interceptor`, verified), and whether those objects carry `extra` (and therefore the ids `frozenIds` and `watermark` are expressed in) is not verified; ST's prompt-manager entries are already known to drop `extra` (`#prompt-ready-extra-survival`). Without ids the copy cannot be mapped onto canonical state at all, so derivation must keep reading `ctx.chat`. The type rule needs no such mapping and is a pure function of `(chat, state, literal, options)`, which is what keeps INV-10 testable.

The rule is safe under either answer to the open `#swipe-scope` questions: if ST has already blanked the swiped message's `mes` at interceptor time, derivation was dropping it anyway (an empty block contributes nothing) and the option is a no-op; if it has not, the option is what removes it. See **Verification needed** — those questions are informational, not blocking.

**Freeze is untouched.** `recovery.onMessageReceived` re-derives with no options (`src/recovery.js:69`), which is correct and must stay that way: by receipt time the swiped message holds the *new* text, and that text belongs in the frontier that freezing measures.

## In scope
- `src/derive.js`: `deriveFrontier(chat, state, literal, options = {})`. When `options.excludeLastAssistant === true`, identify the last element of `chat` that passes the existing considered-message gate (object, non-null, `typeof mes === 'string'`, `is_system !== true`) and, if that message's `is_user` is not `true`, skip it entirely — no text, no delimiter, no segment. If the last considered message *is* a user message, exclude nothing. Any other `options` value, or none, behaves exactly as today.
- The exclusion is decided before the `frozenIds` / watermark logic and is independent of it: a last message that is already frozen is skipped by the existing rule regardless, and the excluded message contributes no segment, so `segments` offsets stay consistent with `text` (PLAN §12 / `docs/modules/freeze.md#watermark-mapping` consumers see no difference).
- `src/frontier.js`: one exported predicate, `regeneratesLastMessage(type)`, returning `type === 'swipe' || type === 'regenerate'`; `interceptGeneration` passes `{ excludeLastAssistant: regeneratesLastMessage(type) }` as the fourth argument to `deriveFrontier`. `'continue'`, `'normal'`, `undefined` and every other reconstructed type pass `false`.
- Pointer comments for both new behaviours, resolving to the new doc headings below.
- Tests per **Acceptance**.

## Out of scope (explicit)
- Deriving from the interceptor's `chat` copy, reading `coreChat` contents, or any attempt to map the copy back to live messages.
- Special handling of `'continue'`: it keeps the whole frontier including the last assistant message, because ST appends the model's output to that message. Do not add a partial-message or trailing-block variant for it.
- Any change to `shouldReconstruct` or the skipped-type list (`quiet`, `impersonate`).
- Any change to `src/recovery.js`, including the post-receipt freeze derivation, and any change to `src/freeze.js`, `src/boundary.js`, `src/solo.js`, `src/state.js`.
- Subscribing to `MESSAGE_SWIPED` or any other lifecycle event; this brief adds no event wiring.
- Handling `'append'` / `'appendFinal'` (those are `saveReply` types, never interceptor types).
- Excluding more than one message, excluding a trailing *user* message, or making the exclusion count configurable.
- Settings, toggles, or a user-visible notice about swipe scope.

## Files
- allowed to create/modify: `src/derive.js`, `src/frontier.js`, `tests/derive.test.js`, `tests/frontier.test.js`, `docs/modules/derive.md`, `docs/modules/frontier.md`
- must not touch: `src/recovery.js`, `src/freeze.js`, `src/boundary.js`, `src/state.js`, `src/solo.js`, `src/prompt.js`, `src/constants.js`, `index.js`, `PLAN.txt`, `docs/api/sillytavern.md`, `docs/protocol/*`, `presets/`

## ST APIs used
- `generate_interceptor` (signature `(chat, contextSize, abort, type)`, per-request copy, skipped in dryRun) — docs/api/sillytavern.md#generate-interceptor (status: verified)
- Generation type strings `'normal' | 'continue' | 'regenerate' | 'swipe' | 'quiet' | 'impersonate'` — docs/api/sillytavern.md#generation-types (status: verified)
- `MESSAGE_RECEIVED (index, type)` — docs/api/sillytavern.md#message-received (status: verified) — cited only to state that the post-receipt freeze derivation stays type-less
- Message shape (`mes`, `is_user`, `is_system`, `extra`) — docs/api/sillytavern.md#message-shape (status: verified)

## Verification needed
- `#swipe-scope` (being verified concurrently; **not blocking** — the chosen rule is correct under either answer, and the implementer must not wait for it): (a) does ST's `coreChat` exclude the message being regenerated on `type === 'swipe'` / `'regenerate'`? (b) is that message's `mes` already empty in the live `chat[]` at interceptor time? If the answer to (b) is yes, add one sentence to `docs/modules/derive.md#regeneration-scope` saying the option is then a no-op and is kept as the explicit guarantee; do not remove the option.

## Acceptance
- [ ] `deriveFrontier(chat, state, literal, { excludeLastAssistant: true })` on a chat ending in an assistant message omits that message's text from `text` and its entry from `segments`, and is byte-identical to `deriveFrontier` over the same chat with that message removed.
- [ ] The same call on a chat ending in a **user** message excludes nothing (output identical to the no-options call).
- [ ] The same call on a chat whose last considered message is preceded by trailing `is_system` messages still excludes the last *considered* (non-system) message, not a system one.
- [ ] `deriveFrontier` with no fourth argument, with `{}`, and with `{ excludeLastAssistant: false }` produces output identical to the current implementation for every existing derive test.
- [ ] `interceptGeneration` with `type === 'swipe'` and with `type === 'regenerate'` builds a history whose frontier turn omits the last assistant message; with `'continue'`, `'normal'` and `undefined` it includes it.
- [ ] `regeneratesLastMessage` returns `true` only for `'swipe'` and `'regenerate'`.
- [ ] INV-10 test extended: two different live histories that end in the same visible chat still yield the same reconstruction under `type === 'swipe'`.
- [ ] `deriveFrontier` remains pure with the option set: neither `chat` nor `state` is mutated, no id assigned.
- [ ] `npm run check` passes
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/derive.md#regeneration-scope` (new heading) — what `options.excludeLastAssistant` means, the exact "last considered message, only if not a user message" rule, why the exclusion carries no segment, and why the option exists rather than derivation inspecting the chat copy.
- `docs/modules/derive.md#derivation-rule` — update the signature line to the four-argument form and point to `#regeneration-scope`.
- `docs/modules/frontier.md#interceptor-body` — a note that the generation type now selects derivation scope: `swipe`/`regenerate` exclude the message under regeneration, `continue` deliberately does not, and the post-receipt freeze derivation in `recovery` is type-less by design.
