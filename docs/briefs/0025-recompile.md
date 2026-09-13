# Brief 0025 — Recompile: reset canonical state and re-freeze under current rules
Status: done
Complexity: high
PLAN sections: §10 (editorial authority is manuscript-wide inside the mutable frontier and is distinct from the capture path — a deliberate rebuild is the collaborator exercising it); §16 (freezing is append-only and old spans "are not *normally* re-cut" — the reasons given are cache prefixes, historical demonstrations and transport statistics, all of which a deliberate, whole-chat rebuild resets together rather than disturbing piecemeal); §17 (cut selection rules, applied unchanged by the re-freeze loop).
Invariants touched: INV-6, INV-7, INV-10

## Goal
The collaborator can run one command, or press one button, and have the extension throw away the chat's stored compile bookkeeping and rebuild it from `chat[]` as it stands right now, under the rules currently in the code. This makes an old chat — one compiled before a rule change, or one whose spans were cut under a different grammar — indistinguishable from a chat compiled today, and gives a new chat with pre-existing history a way to acquire frozen spans without waiting for receipts. The visible chat is not modified in any way. When it is done, `/uidrecompile` and a **Recompile** button in the drawer both run the same pure-over-`ctx` function and report one line: how many spans exist and how many words are frozen.

## Protocol note (for the auditor)
A recompile is not a re-cut of a frozen span. INV-6 forbids freezing through the middle of a block and forbids re-cutting old spans in the course of ordinary operation; it is satisfied here per span, because every span the loop produces comes from `maybeFreeze`/`pushFrozen` under the existing complete-block rule, and no stored span is ever edited, split, or merged. The whole compiled region is discarded and rebuilt from the same source text in one deliberate, collaborator-initiated act — editorial authority under §10, applied to bookkeeping rather than to prose. Concealment is unaffected (INV-10): the model sees only the new cuts, and the new cuts are a pure function of the current `chat[]` plus the current rules, so two different live histories that reduce to the same `chat[]` still reduce to the same manuscript. Cache-prefix loss is the known and accepted cost, and it is the collaborator's to choose; the operation runs only on explicit request, never on load, never on CHAT_CHANGED, never on receipt.

## In scope
- **`src/recompile.js`**, new module, exporting `recompile(ctx = getCtx())`:
  - **Reset.** Assign `ctx.chatMetadata[METADATA_KEY] = createState()` (imported from `src/state.js`, not reimplemented). This replaces `frozen`, `frozenIds` and `watermark` wholesale. Assume `ctx.chatMetadata` exists, exactly as `getState` does — no defensive branch.
  - **Message markers are left alone.** Existing `message.extra[METADATA_KEY].id` values are not cleared, rewritten or renumbered. After the reset they are inert: `frozenIds` is empty and `watermark.messageId` is `null`, so `deriveFrontier`'s per-message gate treats every id as unknown-and-therefore-mutable (`docs/modules/derive.md#per-message`). The re-freeze loop then re-consumes the same ids, which is why keeping them is cheaper and safer than reassigning them.
  - **Missing ids are filled once.** Call `assignIds(ctx.chat)` (imported from `src/derive.js`) before the loop; if it returns `true`, `await ctx.saveChat()` once. Rationale to record in the doc: an id-less message can never be recorded in `frozenIds`, so the loop would re-freeze the same text every iteration. This adds ids, it does not change existing ones.
  - **Loop.** Repeat: `derived = deriveFrontier(ctx.chat, state, literal)` with `literal = reservedLiteral(ctx)` (`src/boundary.js`); `result = maybeFreeze(state, derived, literal, {})` — same empty options object `recovery` passes, so the default target, jitter seed and salience rules apply unchanged. Stop when `result === null`.
  - **Termination.** The loop terminates on its own because each accepted freeze consumes at least `FREEZE_MIN_WORDS` from a finite frontier and always advances `frozenIds` or the watermark offset. A hard cap of 1000 iterations is nevertheless the loop bound, so the function cannot hang on any input; hitting the cap ends the loop quietly and the result is reported normally.
  - **Persist.** `await save(ctx)` exactly once, after the loop, whether or not any span was pushed — the reset itself must be persisted.
  - **Degenerate inputs.** If `ctx.chat` is empty/absent, or the first derivation yields empty text, the function resets and saves and returns `{ spans: 0, words: 0 }`. No special-casing beyond what falls out of `deriveFrontier` returning `{ text: '', segments: [] }` and `maybeFreeze` returning `null`.
  - **Return** `{ spans, words }` — `spans = state.frozen.length`, `words` = sum of `span.words`.
  - **No UI in this module.** No toast, no DOM, no console output on the success path.
- **`formatRecompileSummary({ spans, words })`** exported from the same module: returns the single reported line. Two consumers (slash callback, drawer button), so it is not a one-consumer abstraction.
  - Pinned string, exact form: `Recompiled: 2 spans, 7,940 words frozen`. Singular when the count is 1 (`1 span`, `1 word`). Thousands are grouped with `,` using a locale-independent rule (`String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')`) so tests are deterministic on any host locale. Zero is reported plainly: `Recompiled: 0 spans, 0 words frozen`. Do not reword during implementation. A user-requested change goes through the pinned-string lane (`docs/workflow/workflow.md#pinned-string-lane`) as an amendment to this brief.
- **`index.js`:** register `/uidrecompile` inside the existing guarded slash-command block, in the same `SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))` form as `/uidsolo`, under the same availability guard (the guard's `ctx.generate === undefined` clause stays as it is for `/uidsolo`; do not add a second guard shape). `helpString`: `Rebuild the compiled history from the chat as it is now.` `returns: 'a one-line summary'`. Callback: `await recompile()` — no cached ctx — then `notify`-equivalent toast of the summary via the drawer's guarded helper, and `return` the same summary string. Update the existing "slash commands unavailable" warning text to name both commands.
  - The toast must go through `src/ui/settings.js`'s guarded `notify` helper (`docs/modules/ui-settings.md#notifications`), which means exporting it; do not add a second toastr call site.
- **`src/ui/settings.js`:** one `<button>` (`id="uid_recompile"`, class `menu_button uid-recompile`, label `Recompile`) appended to the existing `uid-settings-actions` row next to Install reference preset, plus one `uid-settings-note` under that row with the hint text `Rebuilds the compiled history from the chat as it is now.` (pinned; same lane clause as above). Handler calls the same shared callback path as the slash command — `recompile()` with no argument so the context is read fresh — and reports through `notify('success', …)`. Export `notify` for `index.js`.
- **Docs and mapping** as listed under *Docs to write/update*.

## Out of scope (explicit)
- Any change to `freeze.js`, `state.js`, `derive.js` or `recovery.js`. No new export, no new option, no signature change in those modules. `recompile` composes what already exists.
- A confirmation dialog, `Popup`, or "are you sure" step. The operation does not alter the visible chat and is repeatable; the hint text carries the explanation.
- Disabling the button (or refusing the command) while a generation is in progress. Not required by this brief: ST exposes no `isGenerating` (`docs/api/sillytavern.md#context-keys-absent`), and inventing a proxy for it is out of scope. Leave the button always enabled.
- A progress indicator, spinner, per-span toast, or console log of the cut positions.
- Any settings, toggle, or stored preference — including "recompile automatically", a target-size control, or remembering the last recompile.
- Reassigning, clearing, or renumbering `message.extra` ids; deleting `extra` markers; touching `mes`, `swipes`, `swipe_id` or message order.
- Backing up the old spans, diffing old vs new cuts, or offering an undo.
- Running recompile on load, on CHAT_CHANGED, on version mismatch, or as part of the v1/v2 migration path.
- Recompiling "all chats" — the operation is per open chat only, matching `chatMetadata` scope.
- Touching `frontier.js`, the interceptor, or the prompt; recompile changes stored state only, and the next request picks it up through the normal path.

## Files
- allowed to create/modify: `src/recompile.js`, `index.js`, `src/ui/settings.js`, `style.css` (only if the existing `.uid-settings-actions` rule does not already lay out a second button; no new rule is expected), `tests/recompile.test.js`, `tests/bootstrap.test.js`, `tests/ui-settings.test.js`, `docs/modules/recompile.md`, `docs/modules/ui-settings.md`, `docs/modules/bootstrap.md`, `docs/protocol/host-mapping.md`
- must not touch: `src/freeze.js`, `src/state.js`, `src/derive.js`, `src/recovery.js`, `src/boundary.js`, `src/frontier.js`, `src/grammar.js`, `src/prompt.js`, `src/constants.js`, `PLAN.txt`, `docs/protocol/invariants.md`, `docs/api/sillytavern.md`, `presets/`

## ST APIs used
- `getContext()` sole access path — docs/api/sillytavern.md#getcontext (status: verified) — never cache the returned object
- `chatMetadata`, `chat`, `saveMetadata`, `saveChat`, `SlashCommandParser`, `SlashCommand` — docs/api/sillytavern.md#context-keys (status: verified)
- Per-chat persistence via `saveMetadata` — docs/api/sillytavern.md#chat-metadata (status: verified)
- Slash command registration (`addCommandObject` / `SlashCommand.fromProps`, callback may return a string) — docs/api/sillytavern.md#slash-command-registration (status: verified)
- `toastr.<kind>(message, title)` as a page global, guarded — docs/api/sillytavern.md#toastr (status: verified)
- Absent: `isGenerating` — docs/api/sillytavern.md#context-keys-absent (status: absent) — cited only to justify the out-of-scope item

## Verification needed
- (none)

## Acceptance
- [x] After `recompile()` on a chat with existing spans, `ctx.chatMetadata[METADATA_KEY]` deep-equals `createState()` except for spans the loop itself pushed: `version` is the current `STATE_VERSION`, and with an empty `chat` the whole object deep-equals `createState()` (`frozen: []`, `frozenIds: []`, `watermark: { messageId: null, offset: 0 }`).
- [x] An ~8,000-word synthetic chat recompiles into ≥ 2 frozen spans and the loop terminates; `state.frozen.length` equals the returned `spans`, and the returned `words` equals the sum of the spans' `words`.
- [x] Idempotent: running `recompile()` twice on an unchanged chat yields identical `{ spans, words }` and byte-identical span texts.
- [x] `save(ctx)` (i.e. `ctx.saveMetadata`) is called exactly once per `recompile()` call, including the empty-chat case.
- [x] The visible chat is untouched: every `chat[i].mes`, `is_user`, `swipes` and message order is byte/reference-identical before and after, and no existing `extra[METADATA_KEY].id` value changes. Messages that had no id gain one, and `ctx.saveChat` is called once in exactly that case and not otherwise.
- [x] A chat where every derived cut candidate is refused (too short) resets, freezes nothing, saves once, and returns `{ spans: 0, words: 0 }`.
- [x] `formatRecompileSummary` produces `Recompiled: 2 spans, 7,940 words frozen`, the singular forms, and the zero form, independent of host locale.
- [x] `init()` registers a command named `uidrecompile` alongside `uidsolo` (assert by inclusion, not by array position or length); its callback returns the summary string and raises one toast with the same text.
- [x] The drawer renders exactly one `#uid_recompile` button inside the existing actions row, with the pinned label and the pinned hint text present; clicking it calls `recompile` and reports through `notify`.
- [x] `npm run check` passes
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/recompile.md` — new file with anchors for every pointer comment the module needs. Must explain: what a recompile is and is not (reset + rebuild, never a re-cut of a surviving span); why the message ids survive the reset and why that makes them inert rather than stale; why missing ids are filled first and why that is the one write to `chat[]`; the loop and its termination argument (monotone consumption, plus the 1000-iteration bound as a hard stop); why `{}` options are passed so the live cut rules apply; why `save` runs once even when nothing froze; the protocol note above (§10 authority, INV-6 per span, cache-prefix loss as the accepted, user-chosen cost); and the pinned summary string with the lane clause.
- `docs/modules/ui-settings.md#recompile-button` — one heading: the button's place in the actions row, the pinned label and hint, why there is no confirm step and no disabled state.
- `docs/modules/bootstrap.md#slash-commands` — extend the existing heading with `/uidrecompile`: same guarded registration block, callback returns the summary, toast via the shared `notify`.
- `docs/protocol/host-mapping.md#s16-freeze` — one sentence: a deliberate whole-chat recompile discards the stored cut bookkeeping and rebuilds it from `chat[]` under the current rules; it is collaborator-initiated only and re-cuts nothing that survives.
