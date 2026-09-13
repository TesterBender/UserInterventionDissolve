# Brief 0031 — `selectCut` last-message clamp (option)
Status: implemented
Complexity: high  (touches INV-6 and INV-7 in the module that owns them; one `src/` module, but every existing cut-selection test is downstream of it)
PLAN sections: §16 (freezing is append-only, old spans are not re-cut; the target is advisory and belongs to the compiler — a clamp that only *withholds* candidates is inside what §16 licenses), §17 (cut selection: hard safety rules first, preferences after; the clamp is a new hard rule and therefore goes in the hard-rule loop, never into the preference tiers)
Invariants touched: INV-6 (cut point — the clamp narrows where a cut may land, never widens it), INV-7 (cut selection — the clamp must not be expressible as a preference, or a dense-external-character frontier could cut through the protected region anyway)

Depends on: nothing. This is the first of the three phase-3/4 briefs and the only one that touches `src/`. Briefs 0032 and 0033 depend on it.

Scope source: `TamperContainment/PLAN-janitor.md` — "Per-generation pipeline" request side step 6 ("Freeze at request build … under one extra rule: **no cut may consume any part of the last non-sentinel message**. `selectCut` alone protects only the last *block* (`SRC/freeze.js:108`)") and "Deviations from the ST implementation" ("Last-message clamp on `selectCut` (an option, not a fork of the function)"). The SillyTavern host mapping does not apply to the host that will use this option, but the option lives in shared `src/` and must leave the ST host byte-identical.

## Goal
`selectCut(frontierText, literal, opts)` accepts one new option that caps how far into the derived frontier text a cut may reach, and rejects every candidate boundary past that cap as a **hard rule**, alongside the existing completeness, minimum-words and reserved-span rules. With the option absent or not a finite number, `selectCut` and `compileUnit` behave exactly as they do today, byte for byte, and every existing test passes unchanged. `compileUnit` already forwards `opts` to `selectCut`, so it needs no edit.

## In scope
- `src/freeze.js`, `selectCut` only:
  - Destructure one new option from `opts`. Name it `maxFrozenEnd` — a character offset into `frontierText`.
  - In the hard-rule loop (currently `src/freeze.js:108–114`), reject boundary `i` when `Number.isFinite(maxFrozenEnd)` and `blocks[i].end > maxFrozenEnd`. Placement: with the other hard rules, before `safe.push(i)`; never in `preferred()` and never as a tier.
  - No other behaviour changes: the jitter seed, the target, the overrun path (`inBudget.length === 0 ? safe[0] : …`) and the return shape stay as they are. An overrun choice is drawn from the already-clamped `safe` list, so the clamp survives overrun.
  - Nothing is clamped by default: `opts = {}` yields today's `safe` list exactly.
- One pointer comment on the new rule, targeting the new `docs/modules/freeze.md` heading.
- `tests/freeze.test.js`: new cases only, no existing case rewritten.
- `docs/modules/freeze.md`: one new heading, plus one sentence in [Candidates](docs/modules/freeze.md#candidates) naming the option as a fourth hard requirement.
- `docs/decisions/0007-janitor-host-deviations.md`: **create** it with two sections — "Freeze at request build, not at receipt" and "Last-message clamp on `selectCut`". Briefs 0032 and 0033 append their own sections to the same record; do not write theirs.

## Out of scope (explicit)
- Any caller. Nothing in `src/` starts passing `maxFrozenEnd`; the ST host keeps freezing at receipt with no clamp, and this brief changes no behaviour there. Wiring it up is brief 0033.
- Computing the clamp value from messages, segments or a sentinel. `selectCut` receives a number and knows nothing about messages (`docs/modules/freeze.md#purity`); deriving that number from `derived.segments` is brief 0033's job.
- A second option, a "protect the last N messages" count, a percentage, a words-based cap, or a clamp on `compileUnit`'s seal policy.
- Touching `preferred()`, the tier list, `FREEZE_*`/`FINAL_*` constants, `compileUnit`, `sealUnits`, `noticeFrozenEdit`, or `src/recovery.js`'s freeze hookup.
- Any settings surface for the clamp.

## Files
- allowed to modify: `src/freeze.js`, `tests/freeze.test.js`, `docs/modules/freeze.md`
- allowed to create: `docs/decisions/0007-janitor-host-deviations.md`
- must not touch: everything else — in particular `src/constants.js`, `src/recovery.js`, `src/state.js`, `janitor/**`, `tests/janitor/**`, `dist/**`, `index.js`, `PLAN.txt`, `TamperContainment/**`

## ST APIs used
- none. `selectCut` is pure and reads no host context (`docs/modules/freeze.md#purity`).

## Verification needed
- (empty) No SillyTavern API and no Janitor runtime fact is involved. The Janitor behaviour that motivates the clamp — a regenerate restarts from the latest user message with the replaced assistant message absent — is an answered ledger item (`docs/api/janitor.md#regenerate-drops-the-replaced-assistant-message`, 2026-09-13). Do not launch `st-api-verifier`.

## Acceptance
- [x] With no `maxFrozenEnd`, `selectCut` returns exactly what it returns today for a corpus of at least three frontier texts, including one that triggers the overrun path; asserted on the full returned object.
- [x] With `maxFrozenEnd` set to the start offset of the final block of a long frontier, no returned cut has `frozenEnd > maxFrozenEnd`, and the chosen boundary is a legal one below the cap.
- [x] With `maxFrozenEnd` set below `FREEZE_MIN_WORDS`' worth of text, `selectCut` returns `null` (refusal is normal, `docs/modules/freeze.md#overrun`).
- [x] The clamp survives overrun: with a frontier whose only safe boundaries are past `FREEZE_MAX_WORDS`, and a `maxFrozenEnd` below the first of them, the result is `null` rather than an overrun cut past the cap.
- [x] The clamp is a hard rule, not a preference: a frontier where the only neutral-span-start boundary sits past the cap yields a cut below the cap (a lower tier wins), not the preferred one.
- [x] `compileUnit(state, derived, literal, { maxFrozenEnd })` forwards the option with no edit to `compileUnit`, and a clamped-to-`null` cut leaves the state byte-identical.
- [x] A non-finite `maxFrozenEnd` (`undefined`, `null`, `NaN`, `'120'`) is ignored rather than treated as `0`.
- [x] `npm run check` passes
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/freeze.md#candidates` — add `maxFrozenEnd` to the three hard requirements as a fourth, conditional one, in the same voice.
- `docs/modules/freeze.md` — new heading `## Last-message clamp {#last-message-clamp}`: what the option is (a character offset into the frontier text, not a message count), why it is a hard rule and not a preference, why it must apply to the overrun path too, that it is off by default and the SillyTavern host never sets it, and the host reason it exists — on a host where the provider request is the only view of history, a regenerate can replace the trailing assistant message after its head was compiled, leaving a compiled head plus a fresh full message; with the clamp, a message is compiled only once the human has sent a turn past it, which is also the moment that host can no longer regenerate it.
- `docs/decisions/0007-janitor-host-deviations.md` — new record, `Date: 2026-09-13`, `Brief: docs/briefs/0031-selectcut-last-message-clamp.md`, `PLAN: §16, §17`. Two sections for now: **Freeze at request build** (INV-6/INV-7 constrain *where* a cut may fall, not *when* the compiler runs; `docs/modules/freeze.md#not-decided` leaves the schedule to the caller and §16 says nothing about timing; request-build freezing is idempotent — a failed request re-derives the same result from the same inputs) and **Last-message clamp** (an option, not a fork; alternatives rejected: a `freeze.js` fork for the second host, and doing the protection in the caller by truncating the frontier text before `selectCut`, which would corrupt `derived.segments` offsets and hence the watermark). State that the record is extended by briefs 0032 and 0033 and list the remaining deviations as "recorded in later sections of this file" without describing them.
