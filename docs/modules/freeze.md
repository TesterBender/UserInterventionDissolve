# freeze
Owns: INV-6 (cut point), INV-7 (cut selection), INV-10 (with frontier) (docs/protocol/invariants.md)
PLAN: §16, §17, §18
Depends on: grammar, constants, state (apply step), host (notice only)

`src/freeze.js` answers one question: given the current mutable frontier text and the reserved external literal, where — if anywhere — may a span be cut off the front and promoted into immutable history? `selectCut` decides and `compileUnit` applies, mapping the chosen offset back onto the message the cut fell in (see [Watermark mapping](#watermark-mapping)). The selection half reads no SillyTavern context, no clock, no `chat[]` and no canonical state; the apply half reads and mutates canonical state through `src/state.js`, and one small notice function reads the live context (see [Frozen-edit notice](#frozen-edit-notice)).

## Target and jitter {#target-jitter}

PLAN §16 states the transport target as "approximately 3,000–4,200 words with modest jitter". That window lives in `src/constants.js` as `FREEZE_MIN_WORDS` and `FREEZE_MAX_WORDS`, and it is a compiler-side number only: it never appears in the model-visible prompt, is never mentioned to the model, and is not a setting — tuning it means editing the constant. `FREEZE_MIN_WORDS` is a floor on the *cumulative* words of the frozen prefix, so no boundary below it is even a candidate; `FREEZE_MAX_WORDS` is advisory, see [Overrun and refusal](#overrun).

Jitter exists so consecutive spans are not all the same length, which would make the transport rhythm itself legible. The draw is:

```js
function jitterOffset(seed, span) {
  if (!(span > 0)) return 0;
  let x = (Number.isFinite(seed) ? Math.trunc(seed) : 0) >>> 0;
  x = (x + 0x9e3779b9) >>> 0;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;  x >>>= 0;
  return x % (span + 1);
}
```

It is drawn **once per `selectCut` call**, giving `target = min + jitterOffset(seed, max - min)`, and the target is only a scoring preference — the chosen candidate is the safe boundary whose cumulative word count is closest to it, not the first one past it. The seed is `opts.jitterSeed` when that is a finite number and otherwise `countWords(frontierText)`: a default derived from the input, never from `Date.now()` or `Math.random()`. That is what keeps `selectCut` a pure function of `(frontierText, literal, opts)` (see [Purity and INV-10](#purity)).

## Candidates {#candidates}

A boundary is the gap between two blocks — the blank line that PLAN §5 makes the only block separator (`docs/modules/grammar.md#block-delimiter`). Boundary `i` sits between block `i` and block `i + 1` as `parseManuscript` reports them. Three hard requirements make it a candidate:

- `i <= blocks.length - 2`. The last block is never a cut point: the frontier must retain at least one block, and the trailing block is the only one that may still be in progress.
- `blocks[i].complete === true`. INV-6 and PLAN §5: "the compiler never freezes through the middle of a complete block". Only the trailing block can ever be incomplete, so in practice this is belt and braces — but it is the check that makes the invariant local to this module instead of an argument about the parser.
- cumulative words up to `blocks[i].end` are at least `min`.
- when the caller passes a finite `maxFrozenEnd`, `blocks[i].end` is at or below it. This fourth requirement is conditional — absent the option there is no cap and nothing is withheld — but wherever it applies it is as hard as the other three and never a preference: see [Last-message clamp](#last-message-clamp).

A frontier of fewer than two blocks therefore has no candidate at all, and neither does a frontier that has not yet reached `min`; both return `null`, which means "do not freeze" and is a normal outcome.

`compileUnit(state, derived, literal, opts)` is the apply step. `derived` is the `{ text, segments }` object the derivation just produced (`docs/modules/derive.md#derivation-rule`); the function runs `selectCut` over `derived.text`, and a `null` cut means "do not freeze" and is returned as `null`. Otherwise the prefix `derived.text.slice(0, cut.frozenEnd)` is pre-checked with `canPushSpan` (`docs/modules/state.md#can-push-span`) — `compileUnit` no longer calls `pushFrozen` at all — pushed as a Tier-1 **unit** with `pushUnit` (`docs/modules/state.md#push-unit`), and the cut offset is translated into a watermark by [Watermark mapping](#watermark-mapping). The pre-check runs before any mutation, so a prefix that would be refused cannot leave a seal behind it. Sealing units into a final span happens around the push, per [Seal policy](#seal-policy). The remaining frontier is not stored anywhere: it is whatever the *next* derivation produces from the updated state, which is why nothing here assigns a remainder. The return value is `{ unitIndex, words, target, overrun, blockIndex, watermark, seals }` — reporting only, for tests and for the caller's decision to save metadata. A non-`null` return means "state changed", which is all any caller tests.

The chosen cut reports two offsets into the frontier text. `frozenEnd` is `blocks[i].end` — the end of the last frozen block, with the trailing whitespace `parseManuscript` already trimmed off. `index` is `blocks[i + 1].start` — where the remaining frontier begins. Everything between them is the inter-block delimiter, which is a separator and belongs to neither side, so it is dropped. Both sides are otherwise taken **verbatim**: `text = frontier.slice(0, frozenEnd)` and `rest = frontier.slice(index)`, with no re-joining, no normalisation, no delimiter repair and no trimming beyond those offsets. Rolling back an incomplete trailing block is `recovery`'s job (INV-8); this module only declines to cut at one.

## Salience heuristics {#salience-heuristics}

PLAN §17 asks that transport cuts correlate with low-salience structure. Three mechanical rules implement the detectable subset, in priority order. (a) is the one **hard rule** — a boundary it rejects is never returned. (c) and (d) are **preferences** — they only reorder the survivors. There is no rule (b): see [No dense-run rule](#no-dense-run).

The unit (a) and (c) reason over is the **agency span**, not the block: `groupSpans` (`docs/modules/grammar.md#spans`) folds the parsed blocks into the spans their headers open, and every block index is mapped to the index of the span containing it. Blocks remain the transport unit — a cut is still the gap between block `i` and block `i + 1`, and INV-6 is unchanged. Spans only reject and rank those gaps.

- **(a) Adjacency.** Reject boundary `i` when the span containing block `i`, or the span containing block `i + 1`, is reserved. §17: never cut immediately before or immediately after the external character — and because the external character's passage may run for many paragraphs under one header, "immediately" means the whole span, not one block of it. A cut can therefore never land inside the external character's span however long it runs.
- **(c) Prefer a span start, neutral first.** Prefer boundary `i` where block `i + 1` is the **first block of its span**, and among those prefer a span whose header is `∅:` — §17's "mid-passage buffer boundaries", now read as the addendum reads them: the place where the world takes the floor between two character passages is the lowest-salience transition the manuscript offers.
- **(d) Avoid a scene seam.** Avoid boundary `i` where block `i` ends on a closed sentence (`SENTENCE_FINAL`) *and* block `i + 1` reads as a scene opening — §17's "scene closures / scene openings" pair, the place a reader most expects a break and would therefore read the transport cut as narrative punctuation.

The survivor set is the first non-empty of six tiers:

1. neutral span start and not a scene seam;
2. neutral span start;
3. span start and not a scene seam;
4. span start;
5. not a scene seam;
6. everything in budget.

Within the chosen tier the candidate closest to the jittered target wins, ties going to the lower word count and then the lower block index.

Tiers 5 and 6 are load-bearing, not a fallback. Addendum §12 asks that transport not become aligned with every agency transition: if a cut always landed on a header, the model would be shown a history in which each assistant message begins with a new owner, and the transport grammar would become legible inside the fiction. Because spans routinely run several paragraphs, most in-budget windows contain no span start at all, and the cut falls at an ordinary paragraph gap **inside** a non-external span — which is a perfectly good low-salience boundary and stays a full candidate. Span starts are a preference, never a requirement, and a span boundary is never manufactured to obtain one.

"Scene opening" is a deliberately shallow, mechanical test on the following block's first line, trimmed. A `SCENE_SEPARATOR` line — three or more `*` or `-`, spaces allowed between them — is always one. Otherwise a block that **opens a span** never is — a header is a commitment or a handover of the floor, not a scene marker — and neither is a block of more than six words. The span-opener exclusion covers both header forms: a bare `∅:` first line contains no letters at all, so the Title-Case test would pass it vacuously and rule (d) would fight rule (c) over the same boundary. What remains is short and header-less, and counts as a scene opening when its first line is all caps (at least two letters, equal to its own upper case) or Title Case (every whitespace-separated word whose first character is a letter has that character already uppercase) — `THE NEXT MORNING`, `Later That Evening`.

## No dense-run rule {#no-dense-run}

PLAN §17 also names "dense external-character runs" as something to avoid, and brief 0011 implemented it as a second hard rule (b) with a `FREEZE_DENSE_RADIUS` of 2. Once (a) counted spans rather than blocks, (b) counted spans too — and a manuscript in which the collaborator's character takes the floor every few spans then had no legal boundary anywhere: a probe with the reserved header on every third block produced no cut at any length, and every fourth block produced its first cut only past 7,000 words. That is a direct contradiction of PLAN §18, which requires that dense external-character activity move or postpone a cut but never prevent one, and which forbids the transport horizon from being keyed to how often the external character appears.

The rule is therefore **deleted**, by the user's decision: too heavy-handed for what it buys, and not important for steering generation. `FREEZE_DENSE_RADIUS` is gone from `src/constants.js` and there is no radius, no window and no second hard rule to tune. Safety is rule (a) alone, which is what INV-7 actually requires — a cut is never inside, immediately before or immediately after the external character's span — and density is left to the preference ladder, which still steers cuts toward span starts away from the reserved header when any are in budget.

These are avowed heuristics, admitted under `docs/protocol/invariants.md#inv-7` ("low-salience only") and the mechanical-subset rule in `docs/protocol/invariants.md#enforcement-model`. They are not semantic judgements: nothing here scores sentiment, matches keywords or asks a model. A false positive costs only a different, equally safe cut, and a false negative costs a cut that is merely ordinary rather than ideal — neither can produce an unsafe span, because safety is rule (a) alone.

Two implementation facts belong here. `SENTENCE_FINAL` is a deliberate copy of grammar's private `TERMINAL` (`src/grammar.js:8`): grammar exports no sentence-closure helper and is import-only for this brief, so the pattern is duplicated rather than exported. And a **span** counts as reserved exactly when `groupSpans` marks it `reserved` (`docs/modules/grammar.md#reserved-spans`): this module hands grammar the actor name — the literal minus its trailing colon — and grammar opens a span, marked reserved, at every block whose start carries that literal according to `findTagLiteral` (`docs/modules/grammar.md#tag-literal-lookup`). The reserved literal therefore opens a span **even when `TAG_HEADER` cannot parse it**, which is what stops a persona named `Anton_S`, or one with a name longer than forty characters, from having its block silently absorbed into the previous span and a cut landing immediately before it. Matching never goes through `span.header` or the parsed `block.actor`, because the broadened tag-header rule makes strings like `She rose. Mara` a legal actor (carry-forward from `docs/briefs/0004-tag-header-rule.md`); block-start literal identity is the only test that means what INV-7 needs it to mean. A literal that is absent, empty or bare `':'` simply reserves nothing, and selection proceeds on the remaining rules.

## Overrun and refusal {#overrun}

PLAN §16 makes the ceiling advisory: the compiler "may overrun it to reach a better block boundary". When every safe candidate is past `FREEZE_MAX_WORDS`, `selectCut` returns the **first** safe boundary past the ceiling with `overrun: true` and does not look further. The preferences (c) and (d) are not applied to an overrun choice — overrunning is licensed to *reach* a safe boundary, not to shop for a nicer one, and searching on would let a dense external-character passage stretch the span arbitrarily.

A refusal is not an error. `selectCut` returns `null` when no boundary survives rule (a) at all: the manuscript is simply not ready to be cut, and the frontier keeps growing until it is. The other refusal belongs to the apply step, wherever it lives — `canPushSpan` can decline a span (`docs/modules/state.md#can-push-span`), and a declined span must leave the watermark exactly where it was, because the mutable region is never shortened without a corresponding compiled unit. `compileUnit` runs that test *before* any mutation, so a declined span leaves the whole state byte-identical: no unit, no watermark move and no seal.

## Last-message clamp {#last-message-clamp}

`maxFrozenEnd` is an optional character offset into `frontierText` — into the derived frontier the call was given, not a message index and not a message count. `selectCut` knows nothing about messages ([Purity and INV-10](#purity)), so the caller that owns the message list computes the offset and passes a plain number; deriving it from `derived.segments` is that caller's job. The option is off by default: when it is absent, `null`, `NaN` or a string, `Number.isFinite` rejects it and the candidate list is exactly what it was before the option existed. The SillyTavern host never sets it, so its behaviour is unchanged.

It is a **hard rule**, tested in the same loop as completeness, `min` and the reserved-span test, and never a preference tier. A preference can be overridden by the tier below it: were the clamp expressed as "prefer boundaries under the cap", a frontier with no preferred candidate under the cap — a dense external-character passage, say — would fall through to a lower tier and cut straight through the protected region, which is the one thing the clamp exists to prevent. As a hard rule it only ever *withholds* candidates, so it narrows where a cut may land and never widens it (INV-6, INV-7).

It applies to the overrun path too. [Overrun and refusal](#overrun) draws its choice from `safe[0]`, and `safe` is already clamped, so an overrun cut cannot reach past the cap either. If no boundary under the cap survives the other rules, the result is `null` — a refusal, which is a normal outcome: the frontier keeps growing until a legal boundary appears below the cap.

The host reason it exists: on a host where the provider request is the only view of history, a regenerate can replace the trailing assistant message *after* its head was already compiled, leaving a compiled head in the frozen record plus a fresh full message in the next request — the same passage twice, from two different drafts. With the cap set to the start of the last non-sentinel message, a message is compiled only once the human has sent a turn past it, which is also the moment that host can no longer regenerate it. `selectCut` on its own protects only the last *block*, which is not the same boundary. The deviation is recorded in `docs/decisions/0007-janitor-host-deviations.md`.

## Seal policy {#seal-policy}

`selectCut` is untouched by the tiering: the target stays 3,000–4,200 words with jitter (see [Target and jitter](#target-jitter)), and every §17 salience rule keeps its only implementation there. What changed is what a cut *produces*: a Tier-1 unit in `state.units`, not a final span. `compileUnit` then applies two clauses, with `FINAL_MIN_WORDS = 6000` and `FINAL_MAX_WORDS = 10000` in `src/constants.js`:

- **Ceiling guard**, before the push: if `units` is non-empty and `unitsWords(state) + cut.words > FINAL_MAX_WORDS`, seal what is already there. A combination above the ceiling is therefore never created, not even transiently — see [the stall rule](#seal-policy) below for what happens when that seal is refused.
- **Seal policy**, after the push: if `unitsWords(state) >= FINAL_MIN_WORDS` **and** `unitsWords(state) + FREEZE_MAX_WORDS > FINAL_MAX_WORDS`, seal. That is "one more unit could no longer fit", which is the addendum's rule (§4): a final span may grow through promotion but must stay under the ceiling.

The arithmetic: a unit is normally 3,000–4,200 words, so two units are at least 6,000 and satisfy both clauses at once; finals therefore normally land at 6.0k–8.4k, and a third unit is never combined on top because 7.3k + 4.2k is past 10k. The `FINAL_MIN_WORDS` clause is not redundant — a single **overrun** unit of 6,000 words or more seals alone, and a single overrun unit below 6,000 waits for the ceiling guard rather than producing a 10.1k final.

There is **no jitter on `FINAL_MIN_WORDS`.** Delaying a seal by jitter can only be paid for by admitting one more unit, which can carry the combination past the ceiling; unit-level jitter already decorrelates the boundaries the model can see from narrative structure (INV-7, addendum invariant 11), so a second jittered threshold buys nothing and costs the ceiling (`docs/decisions/0006-hierarchical-compilation.md`).

**The stall rule.** A seal whose push `sealUnits` refuses (`docs/modules/state.md#seal-units`) adds no entry and loses no units. When that happens at the **ceiling guard**, `compileUnit` stops: it does not push the new unit, does not advance the watermark, returns `null` and leaves the state byte-identical, and warns once per state object (`LOG_PREFIX`, a `WeakSet` of already-warned states) that compilation is stalled. Pushing anyway would build exactly the over-ceiling combination the guard exists to prevent, and the post-push clause would then seal it as one oversized final — so the ceiling holds under *any* state, including a unit set that cannot be promoted (INV-6, addendum §16.4). Compilation resumes by itself once the unsealable unit set can be pushed; nothing repairs or discards it here, because trimming compiled text is not this module's to do.

Seals are reported in the return value as `seals: [{ frozenIndex, words }…]` — length 0 normally, 1 at a seal, and 2 in the overrun case where the ceiling guard and the seal policy both fire in one call. Nothing here rewrites an existing final: sealing only ever appends (`docs/modules/state.md#seal-units`), and `compileUnit` never touches `state.frozen[i]` for an `i` it did not just create.

## Word counting {#word-counting}

`countWords(text)` is `(String(text ?? '').match(/\S+/g) ?? []).length`, and `/\S+/g` appears exactly once in the module. It is the same rule `pushFrozen` and `pushUnit` use to fill `span.words` when the caller omits it, so a span compiled here carries the count it would have been given anyway and the two paths can never disagree.

The letters-only regex in `tests/prompt.test.js` (`/[A-Za-z'’]+/g`) is deliberately not reused: it counts a fixed English prompt asset, and would undercount manuscript prose containing digits or non-Latin script.

## Purity and INV-10 {#purity}

`selectCut`'s inputs are the frontier text, the reserved literal and an options object — nothing else. No host context, no `chat[]`, no clock, no randomness, no module-level mutable state; `src/freeze.js` contains no occurrence of `SillyTavern`, `Date.now`, `Math.random` or `performance`. `compileUnit` adds no impurity of its own: it is a function of `(state, derived, literal, opts)` that mutates only the state object it was handed, and `createdAt` is deliberately left for `pushUnit` to fill, which keeps `Date.now()` out of this module entirely. `noticeFrozenEdit` is the single exception, and it only reads.

That is what makes INV-10 testable here: two live interaction histories that normalise to the same frontier string produce byte-identical frozen span text and the same remaining frontier. Whether a passage arrived in one generation or six, whether the human intervened or not, cannot influence the cut, because none of that is an input.

The other half of the story is `docs/protocol/host-mapping.md#s16-freeze`: "compiled once, remembered". Once a span is pushed it is never recompiled from `chat[]` and never revisited, so a later edit, deletion or swipe of the messages it came from changes the visible log only. Re-cutting, merging, splitting and removing frozen spans are all forbidden by INV-6, and this module exports no such operation.

## Watermark mapping {#watermark-mapping}

`selectCut` reports `frozenEnd`, a character offset into the **derived** text. Canonical state records instead which messages have been fully consumed and how far into one partially consumed message the cut went (`docs/modules/state.md#shape`), so the offset has to be mapped back onto `chat[]`. `derived.segments` is what makes that possible: each entry carries the block's `start`/`end` in the derived text, the message `id` it came from, and `sourceStart`, the offset inside that message's `mes` that corresponds to `start` (`docs/modules/derive.md#derivation-rule`).

The cut lands in the one segment `s` with `s.start <= frozenEnd <= s.end`, and there are exactly two cases.

- **Fully consumed** — `frozenEnd === s.end`. The cut fell on a block boundary that is also a message boundary, so every segment ending at or before it has been compiled in full: their ids go into `frozenIds` and the watermark becomes `{ messageId: null, offset: 0 }`. No message is partially consumed.
- **Partially consumed** — `frozenEnd` strictly inside `s`. One message was cut through: the segments ending at or before `s.start` are fully consumed, and the watermark becomes `{ messageId: s.id, offset: s.sourceStart + (frozenEnd - s.start) }`, so the next derivation takes `mes.slice(offset)` and resumes exactly where the frozen span ended.

A partial cut is **refused** — `compileUnit` returns `null` and pushes nothing — when `s.sourceStart` is `null` or `s.id` is `null`. `sourceStart` is `null` precisely when the block is not a verbatim slice of `mes`: a user turn that gained a tag-header prefix at derive time has derived offsets that do not line up with the message text, so no honest `(messageId, offset)` exists for a point inside it. Cutting anyway would either duplicate or drop characters on the next derivation. This is the INV-6 rule "never freeze through the middle of a block" extended from blocks to message transforms, and refusing costs nothing: freezing is attempted again after the next receipt (`docs/modules/recovery.md#freeze-hookup`), by which time the frontier is longer and the jittered target picks a different boundary. There is no retry loop, no approximation and no second scan inside one call.

A segment whose `id` is `null` is dropped by `advanceWatermark`'s non-empty-string check (`docs/modules/state.md#advance-watermark`), so a message that never got an id is never marked consumed. Recovery assigns ids before freezing, so in the live path this does not arise.

A `canPushSpan` refusal short-circuits everything: no unit, no watermark move, no seal, state byte-identical. The mutable region is never shortened without a corresponding compiled unit.

## Frozen-edit notice {#frozen-edit-notice}

`noticeFrozenEdit(index, ctx)` is the one impure function in this module and the only user-visible surface in the whole freeze path. It reads `ctx.chat[index]`, and if that message's id is listed in `state.frozenIds` it shows one toast:

> That part of the manuscript is already frozen; this edit stays in the log only.

and returns `true`. For anything else — no such message, no id, an id that is not frozen — it returns `false` and shows nothing. It writes nothing, saves nothing and changes no message.

The **watermark message is deliberately excluded**. Only its head has been compiled; editing its tail re-derives correctly on the next request, which is ordinary authorial editing under §10, not a log-only edit. Telling the collaborator otherwise would be wrong.

`toastr` is a page global in SillyTavern, not an import (`docs/api/sillytavern.md#toastr`), so the call is `globalThis.toastr?.info(...)`: message only, no title, no options, and no console fallback — a host without the global simply shows nothing, which is the correct failure mode for an advisory notice.

## Three horizons {#three-horizons}

PLAN §18 keeps three lengths independent: how long a single generation runs, how long the human's authorship turn is, and how much manuscript one transport span carries. This module owns the transport horizon only, and it is keyed to nothing but frontier text. It counts no generations, no external-character appearances and no elapsed time, and it has no "freeze after N turns" path.

The consequence §18 asks for follows directly: dense external-character activity cannot produce short historical chunks (it can only move the cut to a different boundary, or postpone it), and a long absence of the external character cannot lengthen them (the target and the ceiling are unchanged by who has been speaking).

## What freeze does not decide {#not-decided}

- **No pre-freeze lint.** §20's own closing caveat and `docs/decisions/0001-prompt-level-grammar.md` make lint advisory to the editor and never a gate on promotion (`docs/protocol/invariants.md#enforcement-model`). There is no warning, flag, report object or "would be rejected" field here, and no lint anywhere yet.
- **No semantic salience.** §17 also names emotional peaks, chapter-like resolutions, POV resets and obvious handoffs. Those are not mechanically detectable and are not attempted — no sentiment scoring, no keyword lists, no model call.
- **No persistence.** No `saveMetadata` and no `save()` call: `compileUnit` mutates the state object and reports that it did, and the caller decides whether to persist (`docs/modules/recovery.md#freeze-hookup`).
- **No schedule.** Deciding *when* a freeze is attempted is the caller's: once per receipt, nowhere else. This module has no timer, no on-load path and no manual command.
- **No seeding, no token targets, no settings.** §19's seed span has no privileged meaning here, the target is counted in words rather than tokens, and none of the target, jitter or radius is readable or writable from `extensionSettings` or any UI.
