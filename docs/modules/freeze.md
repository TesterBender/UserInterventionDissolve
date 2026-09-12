# freeze
Owns: INV-6 (cut point), INV-7 (cut selection), INV-10 (with frontier) (docs/protocol/invariants.md)
PLAN: §16, §17, §18
Depends on: grammar, constants

`src/freeze.js` answers one question: given the current mutable frontier text and the reserved external literal, where — if anywhere — may a span be cut off the front and promoted into immutable history? `selectCut` decides and `maybeFreeze` applies, mapping the chosen offset back onto the message the cut fell in (see [Watermark mapping](#watermark-mapping)). The selection half reads no SillyTavern context, no clock, no `chat[]` and no canonical state; the apply half reads and mutates canonical state through `src/state.js`, and one small notice function reads the live context (see [Frozen-edit notice](#frozen-edit-notice)).

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

A frontier of fewer than two blocks therefore has no candidate at all, and neither does a frontier that has not yet reached `min`; both return `null`, which means "do not freeze" and is a normal outcome.

`maybeFreeze(state, derived, literal, opts)` is the apply step. `derived` is the `{ text, segments }` object the derivation just produced (`docs/modules/derive.md#derivation-rule`); the function runs `selectCut` over `derived.text`, and a `null` cut means "do not freeze" and is returned as `null`. Otherwise the frozen prefix `derived.text.slice(0, cut.frozenEnd)` is offered to `pushFrozen` (`docs/modules/state.md#append-only`) and, if accepted, the cut offset is translated into a watermark by [Watermark mapping](#watermark-mapping). The remaining frontier is not stored anywhere: it is whatever the *next* derivation produces from the updated state, which is why nothing here assigns a remainder. The return value is `{ frozenIndex, words, target, overrun, blockIndex, watermark }` — reporting only, for tests and for the caller's decision to save metadata.

The chosen cut reports two offsets into the frontier text. `frozenEnd` is `blocks[i].end` — the end of the last frozen block, with the trailing whitespace `parseManuscript` already trimmed off. `index` is `blocks[i + 1].start` — where the remaining frontier begins. Everything between them is the inter-block delimiter, which is a separator and belongs to neither side, so it is dropped. Both sides are otherwise taken **verbatim**: `text = frontier.slice(0, frozenEnd)` and `rest = frontier.slice(index)`, with no re-joining, no normalisation, no delimiter repair and no trimming beyond those offsets. Rolling back an incomplete trailing block is `recovery`'s job (INV-8); this module only declines to cut at one.

## Salience heuristics {#salience-heuristics}

PLAN §17 asks that transport cuts correlate with low-salience structure. Four mechanical rules implement the detectable subset, in priority order. (a) and (b) are **hard rules** — a boundary they reject is never returned. (c) and (d) are **preferences** — they only reorder the survivors.

- **(a) Adjacency.** Reject boundary `i` when block `i` or block `i + 1` starts with the reserved literal. §17: never cut immediately before or immediately after the external character.
- **(b) Dense run.** Reject boundary `i` when any block `j` with `i - (FREEZE_DENSE_RADIUS - 1) <= j <= i + FREEZE_DENSE_RADIUS` starts with the reserved literal — with the radius at 2, blocks `i-1` and `i` on the near side, `i+1` and `i+2` on the far side. §17: avoid dense external-character runs. (a) is a subset of (b), and is kept as its own named check so it can be asserted and tuned separately.
- **(c) Prefer a buffer next.** Prefer boundary `i` where `blocks[i + 1].kind === 'buffer'` — §17's "mid-passage buffer boundaries", an ordinary non-climactic transition.
- **(d) Avoid a scene seam.** Avoid boundary `i` where block `i` ends on a closed sentence (`SENTENCE_FINAL`) *and* block `i + 1` reads as a scene opening — §17's "scene closures / scene openings" pair, the place a reader most expects a break and would therefore read the transport cut as narrative punctuation.

(c) outranks (d): the survivor set is the first non-empty of `(c) && !(d)`, `(c)`, `!(d)`, and everything in budget. Within that set the candidate closest to the jittered target wins, ties going to the lower word count and then the lower block index.

"Scene opening" is a deliberately shallow, mechanical test on the following block's first line, trimmed. A `SCENE_SEPARATOR` line — three or more `*` or `-`, spaces allowed between them — is always one. Otherwise a tag block never is (a tag header is a commitment, not a scene marker), and neither is a block of more than six words. What remains is short and untagged, and counts as a scene opening when its first line is all caps (at least two letters, equal to its own upper case) or Title Case (every whitespace-separated word whose first character is a letter has that character already uppercase) — `THE NEXT MORNING`, `Later That Evening`.

These are avowed heuristics, admitted under `docs/protocol/invariants.md#inv-7` ("low-salience only") and the mechanical-subset rule in `docs/protocol/invariants.md#enforcement-model`. They are not semantic judgements: nothing here scores sentiment, matches keywords or asks a model. A false positive costs only a different, equally safe cut, and a false negative costs a cut that is merely ordinary rather than ideal — neither can produce an unsafe span, because safety is (a) and (b) alone.

Two implementation facts belong here. `SENTENCE_FINAL` is a deliberate copy of grammar's private `TERMINAL` (`src/grammar.js:8`): grammar exports no sentence-closure helper and is import-only for this brief, so the pattern is duplicated rather than exported. And a block counts as reserved only when `findTagLiteral` reports an occurrence of the literal with `atBlockStart === true` and that index equals `blocks[j].start` (`docs/modules/grammar.md#tag-literal-lookup`). Matching never goes through the parsed `block.actor` or `classifyActor`, because the broadened tag-header rule makes strings like `She rose. Mara` a legal actor (carry-forward from `docs/briefs/0004-tag-header-rule.md`); block-start literal identity is the only test that means what INV-7 needs it to mean. A literal that is absent, empty or bare `':'` simply reserves nothing, and selection proceeds on the remaining rules.

## Overrun and refusal {#overrun}

PLAN §16 makes the ceiling advisory: the compiler "may overrun it to reach a better block boundary". When every safe candidate is past `FREEZE_MAX_WORDS`, `selectCut` returns the **first** safe boundary past the ceiling with `overrun: true` and does not look further. The preferences (c) and (d) are not applied to an overrun choice — overrunning is licensed to *reach* a safe boundary, not to shop for a nicer one, and searching on would let a dense external-character passage stretch the span arbitrarily.

A refusal is not an error. `selectCut` returns `null` when no boundary survives (a) and (b) at all: the manuscript is simply not ready to be cut, and the frontier keeps growing until it is. The other refusal belongs to the apply step, wherever it lives — `pushFrozen` can decline a span (`docs/modules/state.md#append-only`), and a declined span must leave the watermark exactly where it was, because the mutable region is never shortened without a corresponding frozen span.

## Word counting {#word-counting}

`countWords(text)` is `(String(text ?? '').match(/\S+/g) ?? []).length`, and `/\S+/g` appears exactly once in the module. It is the same rule `pushFrozen` uses to fill `span.words` when the caller omits it (`src/state.js:63`), so a span frozen here carries the count it would have been given anyway and the two paths can never disagree.

The letters-only regex in `tests/prompt.test.js` (`/[A-Za-z'’]+/g`) is deliberately not reused: it counts a fixed English prompt asset, and would undercount manuscript prose containing digits or non-Latin script.

## Purity and INV-10 {#purity}

`selectCut`'s inputs are the frontier text, the reserved literal and an options object — nothing else. No host context, no `chat[]`, no clock, no randomness, no module-level mutable state; `src/freeze.js` contains no occurrence of `SillyTavern`, `Date.now`, `Math.random` or `performance`. `maybeFreeze` adds no impurity of its own: it is a function of `(state, derived, literal, opts)` that mutates only the state object it was handed, and `createdAt` is deliberately left for `pushFrozen` to fill, which keeps `Date.now()` out of this module entirely. `noticeFrozenEdit` is the single exception, and it only reads.

That is what makes INV-10 testable here: two live interaction histories that normalise to the same frontier string produce byte-identical frozen span text and the same remaining frontier. Whether a passage arrived in one generation or six, whether the human intervened or not, cannot influence the cut, because none of that is an input.

The other half of the story is `docs/protocol/host-mapping.md#s16-freeze`: "compiled once, remembered". Once a span is pushed it is never recompiled from `chat[]` and never revisited, so a later edit, deletion or swipe of the messages it came from changes the visible log only. Re-cutting, merging, splitting and removing frozen spans are all forbidden by INV-6, and this module exports no such operation.

## Watermark mapping {#watermark-mapping}

`selectCut` reports `frozenEnd`, a character offset into the **derived** text. Canonical state records instead which messages have been fully consumed and how far into one partially consumed message the cut went (`docs/modules/state.md#shape`), so the offset has to be mapped back onto `chat[]`. `derived.segments` is what makes that possible: each entry carries the block's `start`/`end` in the derived text, the message `id` it came from, and `sourceStart`, the offset inside that message's `mes` that corresponds to `start` (`docs/modules/derive.md#derivation-rule`).

The cut lands in the one segment `s` with `s.start <= frozenEnd <= s.end`, and there are exactly two cases.

- **Fully consumed** — `frozenEnd === s.end`. The cut fell on a block boundary that is also a message boundary, so every segment ending at or before it has been compiled in full: their ids go into `frozenIds` and the watermark becomes `{ messageId: null, offset: 0 }`. No message is partially consumed.
- **Partially consumed** — `frozenEnd` strictly inside `s`. One message was cut through: the segments ending at or before `s.start` are fully consumed, and the watermark becomes `{ messageId: s.id, offset: s.sourceStart + (frozenEnd - s.start) }`, so the next derivation takes `mes.slice(offset)` and resumes exactly where the frozen span ended.

A partial cut is **refused** — `maybeFreeze` returns `null` and pushes nothing — when `s.sourceStart` is `null` or `s.id` is `null`. `sourceStart` is `null` precisely when the block is not a verbatim slice of `mes`: a user turn that gained a tag-header prefix at derive time has derived offsets that do not line up with the message text, so no honest `(messageId, offset)` exists for a point inside it. Cutting anyway would either duplicate or drop characters on the next derivation. This is the INV-6 rule "never freeze through the middle of a block" extended from blocks to message transforms, and refusing costs nothing: freezing is attempted again after the next receipt (`docs/modules/recovery.md#freeze-hookup`), by which time the frontier is longer and the jittered target picks a different boundary. There is no retry loop, no approximation and no second scan inside one call.

A segment whose `id` is `null` is dropped by `advanceWatermark`'s non-empty-string check (`docs/modules/state.md#advance-watermark`), so a message that never got an id is never marked consumed. Recovery assigns ids before freezing, so in the live path this does not arise.

A `pushFrozen` refusal short-circuits everything: no span, no watermark move, state byte-identical. The mutable region is never shortened without a corresponding frozen span.

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
- **No persistence.** No `saveMetadata` and no `save()` call: `maybeFreeze` mutates the state object and reports that it did, and the caller decides whether to persist (`docs/modules/recovery.md#freeze-hookup`).
- **No schedule.** Deciding *when* a freeze is attempted is the caller's: once per receipt, nowhere else. This module has no timer, no on-load path and no manual command.
- **No seeding, no token targets, no settings.** §19's seed span has no privileged meaning here, the target is counted in words rather than tokens, and none of the target, jitter or radius is readable or writable from `extensionSettings` or any UI.
