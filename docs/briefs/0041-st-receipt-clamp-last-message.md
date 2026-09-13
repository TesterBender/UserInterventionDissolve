# Brief 0041 — Clamp the receipt-time compile to the start of the just-received message
Status: done
Complexity: high
PLAN sections: §12 (normalisation happens every request; freezing only when the frontier reaches its transport target — the two must not be conflated, and an old draft must not survive into the next request), §14 (a receipt is classified and rolled back at MESSAGE_RECEIVED; the receipt is the only scheduled moment recovery acts), §16 (freezing is append-only and compiled text is never re-cut, so a compile of text that is about to be replaced cannot be undone), §17 (cut selection is hard rules first; a withholding rule only narrows where a cut may land)
Invariants touched: INV-4, INV-6, INV-10

## Goal
On the SillyTavern host, a swipe of the newest assistant message must never send that message's previous draft to the model, in any form. Today `src/recovery.js:69` runs `compileUnit(state, deriveFrontier(ctx.chat, state, literal), literal, {})` on every MESSAGE_RECEIVED over a derivation that *includes* the message just received, with no clamp; once the frontier is past `FREEZE_MIN_WORDS` a cut can land inside that message, compiling its head into `state.units`/`frozenIds` and, for a partial cut, setting `watermark.messageId` to it. On the next swipe `regeneratesLastMessage('swipe')` → `excludeLastAssistant` correctly drops the chat message from the derivation (`src/derive.js:53-60, 78`), but `buildHistory` (`src/frontier.js:13-38`) still replays `state.frozen` + `state.units`, so the old draft's compiled head reaches the model, and a stale watermark makes `src/derive.js:86` slice the *new* draft at an offset computed from the old one. After this brief, the receipt-time compile passes `maxFrozenEnd` equal to the start of the trailing derivation segment, so the newest message can never be compiled until a later message exists past it — matching the clamp the Janitor host already applies at request build (`janitor/transform.js:138-142`).

## In scope
- `src/recovery.js`: hold the derivation in a local, and compile only when it has at least two segments, passing the clamp:
  ```js
  const state = getState(ctx);
  const derived = deriveFrontier(ctx.chat, state, literal);
  // last-message-clamp: the trailing segment's start, so a swipe cannot resend a compiled draft → docs/modules/freeze.md#last-message-clamp
  const result = derived.segments.length < 2
    ? null
    : compileUnit(state, derived, literal, { maxFrozenEnd: derived.segments.at(-1).start });
  ```
  Exactly one `compileUnit(` call site remains in the file (`tests/recovery.test.js:448` asserts this). `derived.segments.at(-1).start` is the same quantity `janitor/transform.js:141` and `janitor/recompile.js:35` compute; the fewer-than-two-segments skip mirrors `janitor/transform.js:138` / `janitor/recompile.js:33`. The clamp is unconditional — not keyed to the generation `type`, not keyed to whether the trailing segment is the received message — because a clamp that only *withholds* candidates is safe on every receipt (`docs/modules/freeze.md#last-message-clamp`, hard-rule argument).
- `tests/recovery.test.js`: regression test — a receipt whose derived frontier is far past `FREEZE_MIN_WORDS` must leave the trailing message uncompiled: its id is not in `state.frozenIds`, `state.watermark.messageId` is not that message's id, and no pushed unit or sealed final contains that message's text. Assert against the compiled corpus (`state.units` + `state.frozen` text joined), not against a word count.
- `tests/frontier.test.js`: regression test — seed a state whose `units` contain the head text of the last assistant message in `chat[]` (the shape the old bug produced: that message's id in `frozenIds`, or a `watermark` naming it with a non-zero `offset`), then run `interceptGeneration(chat, …, 'swipe', ctx)`; the dispatched history must not contain that head text, and the frontier turn must not be a mid-word/mid-block slice of the new draft. Write it as a statement about the *dispatched array* (the existing `interceptGeneration` tests at `tests/frontier.test.js:176-418` are the pattern), not about internals.
- `tests/freeze.test.js`: touch **only** if an existing expectation is falsified. `src/freeze.js` is unchanged by this brief, so no `selectCut`/`compileUnit` expectation should move; if one does, that is evidence the change leaked and the implementer reports `SCOPE_GAP` instead of editing.
- Existing recovery freeze-hookup expectations (`tests/recovery.test.js:283-353`): the permitted change is narrow — the trailing message's id and words may have to leave a `frozenIds`/word-count expectation, because that message is now withheld from the cut. Any expectation change must be named in the implementer's report with the reason. Changing an assertion because it is now inconvenient is out of scope.
- `docs/decisions/0008-st-host-receipt-clamp.md` (new, template in `docs/decisions/README.md`) and its entry in `docs/decisions/README.md#records`.

## Out of scope (explicit)
- Any edit to `src/freeze.js` — `selectCut`'s candidate loop, the hard-rule ordering, the overrun path and `compileUnit`'s watermark mapping all stay exactly as they are. The clamp option already exists (`src/freeze.js:110-111`); this brief only supplies it from a second caller.
- Any edit to `src/frontier.js` / `src/frontier-host.js` — no filtering of `state.units` by message id at reconstruction, no swipe-aware `buildHistory`. That approach is rejected in decision 0008: it hides the text but leaves the watermark corruption.
- Any rollback of canonical state on GENERATION_STARTED, MESSAGE_SWIPED or MESSAGE_DELETED. `src/recovery.js` subscribes to no lifecycle event (`docs/modules/recovery.md#abnormal`) and `tests/recovery.test.js:430-434` asserts it names none; a second mutation path is rejected in decision 0008 on decision 0004's grounds.
- Any edit to `src/derive.js` — `excludeLastAssistant` is correct as written and stays the swipe-side half.
- `src/recompile.js`, `janitor/**`, `src/constants.js`, `src/state.js`: untouched. Whether the whole-chat recompile should clamp the same way is a separate question; report it as `SCOPE_GAP` if it looks wrong, do not fix it here.
- No new constant, option, setting or toggle. The clamp is not configurable and has no off switch on this host.
- No retry, timer, or second compile attempt to recover the deferred unit. The next receipt compiles it.

## Files
- allowed to create/modify: `src/recovery.js`, `tests/recovery.test.js`, `tests/frontier.test.js`, `tests/freeze.test.js` (only under the condition above), `docs/modules/freeze.md`, `docs/modules/recovery.md`, `docs/modules/frontier.md`, `docs/modules/derive.md`, `docs/decisions/0008-st-host-receipt-clamp.md`, `docs/decisions/README.md`
- must not touch: `src/freeze.js`, `src/frontier.js`, `src/frontier-host.js`, `src/derive.js`, `src/recompile.js`, `src/state.js`, `src/constants.js`, `janitor/**`, `index.js`, `PLAN.txt`, `docs/protocol/**`, `presets/**`

## ST APIs used
- MESSAGE_RECEIVED — docs/api/sillytavern.md#message-received (status: verified) — `(index, type)`, the only trigger for the receipt-time compile.
- Prompt scope for swipe, regenerate, continue — docs/api/sillytavern.md#swipe-scope (status: verified) — on `'swipe'` the previous draft stays in `chat[mesId].mes` (`clearMessageData` strips `extra` and timers, not `mes`), which is what makes the stale compiled head reachable.
- generate_interceptor — docs/api/sillytavern.md#generate-interceptor (status: verified) — the request-side path the regression test in `tests/frontier.test.js` exercises through `interceptGeneration`.

## Verification needed
- (empty — no new ST fact is required; the change is entirely inside extension code.)

## Acceptance
- [x] `src/recovery.js` contains exactly one `compileUnit(` call, and it passes `{ maxFrozenEnd: derived.segments.at(-1).start }`; a derivation with fewer than two segments compiles nothing.
- [x] `tests/recovery.test.js`: a receipt over a frontier well past `FREEZE_MIN_WORDS` never puts the received message's id in `frozenIds`, never sets `watermark.messageId` to it, and never pushes its text into `state.units` or `state.frozen`.
- [x] `tests/frontier.test.js`: from a state whose `units` hold the last assistant message's head, a `'swipe'` reconstruction dispatches a history containing none of that head text and a frontier turn that is not sliced at a stale watermark offset.
- [x] A normal (non-swipe) sequence still compiles: the message withheld at one receipt is compiled at a later one, proved by a test that drives two receipts.
- [x] `docs/decisions/0008-st-host-receipt-clamp.md` exists, follows the `docs/decisions/README.md` template, and is listed in `docs/decisions/README.md#records`.
- [x] No file outside the allowlist is modified; `src/freeze.js` and `src/frontier.js` are byte-identical to `main`.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/freeze.md#last-message-clamp` — delete the "off by default and the SillyTavern host never sets it, so that host's behaviour is unchanged" claim (line 86) and generalise the host-reason paragraph (line 92): both hosts now clamp, Janitor at request build and SillyTavern at receipt, for the same reason — the trailing assistant message can still be replaced by a different draft (swipe on ST, regenerate on Janitor). Keep the hard-rule argument and the "the caller that owns the message list computes the offset" split unchanged.
- `docs/modules/freeze.md#not-decided` — the "No schedule" bullet must still say the schedule is the caller's, and must now also say the *clamp offset* is the caller's; no wording that implies this module knows about messages.
- `docs/modules/recovery.md#freeze-hookup` — replace the quoted code block with the clamped form and explain the two consequences in one paragraph each: (a) the newest message is never compiled at its own receipt, so compilation of it is deferred until a later receipt sees a segment past it; (b) this is what makes the swipe path safe, because `excludeLastAssistant` alone cannot un-compile what was already compiled. Cross-link `docs/modules/freeze.md#last-message-clamp` and `docs/decisions/0008-st-host-receipt-clamp.md`.
- `docs/modules/derive.md#regeneration-scope` — one sentence: the exclusion is only the request-side half of swipe safety; the receipt-side half is the clamp, because the derivation cannot retract text that has already been compiled. Do not restate the clamp's rules here.
- `docs/modules/frontier.md#interceptor-body` — one sentence at the same point: `buildHistory` always replays `state.frozen` and `state.units` and has no swipe-aware path by design; the safety comes from nothing having been compiled from the message under regeneration.
- `docs/decisions/0008-st-host-receipt-clamp.md` — decision: the SillyTavern host now sets `maxFrozenEnd` at receipt. Why: swipe/regenerate safety (the concrete failure traced 2026-09-14: compiled head replayed, and `watermark.messageId` slicing the new draft at the old draft's offset), and parity with the Janitor host's request-build clamp (`docs/decisions/0007-janitor-host-deviations.md`, "Last-message clamp on `selectCut`"). Cost: compilation of the newest message is deferred by one receipt, so the frontier runs slightly longer than the 3,000–4,200-word target before a cut lands — advisory under PLAN §16 and invisible to the model. Alternatives rejected: (1) excluding units by message id at reconstruction — hides the text but leaves `watermark.messageId` pointing into a replaced draft, so the next derivation still slices the new text at a stale offset; (2) rolling canonical state back on GENERATION_STARTED for swipe — a second mutation path over compiled state, which decision 0004 rejected and which INV-6 forbids for anything already sealed. Consequences: both hosts now clamp, and `maxFrozenEnd` has no caller that leaves it unset.
