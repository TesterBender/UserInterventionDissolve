# recompile
Owns: —
PLAN: §10, §16, §17
Depends on: host, constants, boundary, derive, state, freeze

`src/recompile.js` — one deliberate, collaborator-initiated rebuild of the chat's compile bookkeeping. It composes `state.js`, `derive.js` and `freeze.js`; it owns no cut rule of its own.

## What a recompile is, and is not {#what-it-is}

A recompile throws away the stored compiled region of the open chat and builds a new one from `chat[]` as it stands right now, under the freeze rules currently in the code. It is a **reset plus rebuild**, never a re-cut of a surviving span: no stored span is edited, split or merged, because no stored span survives the reset. Every span the rebuild produces comes out of `compileUnit`/`pushFrozen` under the same complete-block rule as an ordinary freeze, so INV-6 holds span by span.

This is editorial authority under PLAN §10 applied to bookkeeping rather than to prose. §16's "old spans are not *normally* re-cut" guards cache prefixes, historical demonstrations and transport statistics; a whole-chat rebuild resets all three together rather than disturbing them piecemeal, which is the only reason it is allowed at all. Losing the provider's cache prefix is the known cost, and it is the collaborator's to choose: the function runs only on explicit request — never on load, never on `CHAT_CHANGED`, never on receipt.

Concealment (INV-10) is unaffected. The model sees only the new cuts, and the new cuts are a pure function of the current `chat[]` plus the current rules, so two different live histories that reduce to the same `chat[]` still reduce to the same manuscript.

The visible chat is not modified. The one exception is described under [Filling missing ids](#missing-ids), and it adds ids only.

## Reset {#reset}

`ctx.chatMetadata[METADATA_KEY]` is assigned a fresh `createState()`, which replaces `frozen`, `frozenIds` and `watermark` wholesale and stamps the current `STATE_VERSION`. `chatMetadata` is assumed to exist, exactly as `getState` assumes it; there is no defensive branch.

## Message ids survive the reset {#ids-survive}

Existing `message.extra[METADATA_KEY].id` values are not cleared, rewritten or renumbered. After the reset they are **inert, not stale**: `frozenIds` is empty and `watermark.messageId` is `null`, so `deriveFrontier`'s per-message gate (`docs/modules/derive.md#per-message`) treats every id as unknown and therefore mutable. The rebuild then re-consumes the very same ids. Keeping them is cheaper than reassigning them and cannot desynchronise anything, whereas renumbering would write to every message in the chat for no gain.

## Filling missing ids {#missing-ids}

`assignIds(ctx.chat)` runs once before the loop, and `ctx.saveChat()` is awaited once if — and only if — it reports that it assigned something. An id-less message can never be recorded in `frozenIds`, so without this pass the loop would re-derive and re-freeze the same text on every iteration. This adds ids to messages that lack them; it never changes an existing id, and it is the only write this module makes to `chat[]`.

## The loop and why it terminates {#loop}

Each iteration derives the frontier afresh — `deriveFrontier(ctx.chat, state, literal)` with `literal = reservedLiteral(ctx)` — and offers it to `compileUnit(state, derived, literal, {})`. The loop stops when `compileUnit` returns `null`, which is what it returns when no cut is available or a cut is refused.

Termination follows from the state: an accepted freeze consumes at least `FREEZE_MIN_WORDS` of a finite frontier and always advances `frozenIds` or the watermark offset, so the next derivation is strictly shorter. A hard cap of 1,000 iterations is nevertheless the loop bound, so the function cannot hang on any input; reaching the cap simply ends the loop, and the result is reported in the usual way.

There is **no post-loop seal step**. The loop ends when `compileUnit` returns `null`, and any units still unsealed at that point are either below the seal policy's thresholds or held by a stalled seal (docs/modules/freeze.md#seal-policy) (`docs/modules/freeze.md#seal-policy`) — sealing them anyway would manufacture a final span the live path would never have produced, and the next receipt that does compile a unit will seal them under the ordinary rule.

The options object is `{}` — the same empty object `recovery` passes — so the live default target, jitter seed and salience rules apply unchanged. Recompiling under the current rules is the entire point; a frozen or captured set of options would defeat it.

## Saving {#save}

`save(ctx)` runs exactly once, after the loop, whether or not any span was pushed. The reset itself is a change to canonical state and has to be persisted even when the rebuild freezes nothing.

Degenerate inputs need no special case: an empty or absent `chat` makes `deriveFrontier` return `{ text: '', segments: [] }`, `compileUnit` returns `null` on the first pass, and the function resets, saves and returns `{ spans: 0, words: 0 }`.

## Summary line {#summary}

`spans` and `words` count **final** spans only — `state.frozen` after the loop — which is what they counted before compilation became two-tier. Trailing unsealed units are not reported, because reporting them would change a pinned string.

`formatRecompileSummary({ spans, words })` builds the one line both callers report — the slash command and the drawer button — which is why it is shared rather than inlined.

Pinned string, exact form:

```
Recompiled: 2 spans, 7,940 words frozen
```

Singular when a count is 1 (`1 span`, `1 word`); zero is reported plainly (`Recompiled: 0 spans, 0 words frozen`). Thousands are grouped with `,` by a locale-independent regex rather than `toLocaleString`, so the output is identical on every host. Do not reword this string during implementation; a user-requested change goes through the pinned-string lane (`docs/workflow/workflow.md#pinned-string-lane`) as an amendment to the brief that pinned it.

## No UI here {#no-ui}

The module raises no toast, touches no DOM and logs nothing on the success path. Reporting belongs to its two callers (`docs/modules/bootstrap.md#slash-commands`, `docs/modules/ui-settings.md#recompile-button`).
