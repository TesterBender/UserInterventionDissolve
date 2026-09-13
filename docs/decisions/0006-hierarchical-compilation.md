# 0006 — Hierarchical compilation: units, sealing and the final ceiling
Date: 2026-09-13
Brief: docs/briefs/0026-hierarchical-compilation.md
PLAN: §12, §13, §16, §17 (and `PLAN-addendum-hierarchical-compilation.md`)

## Decision

Compilation is two-tier. A cut at the existing 3,000–4,200-word target (jittered, salience-preferring, unchanged) produces a **Tier-1 unit** in `state.units` rather than a permanent historical span. Units accumulate and are **sealed** into one entry of `state.frozen` — a final span — by two clauses in `compileUnit`, using `FINAL_MIN_WORDS = 6000` and `FINAL_MAX_WORDS = 10000`:

- a **ceiling guard** before the push, sealing what is already held when the incoming unit would carry the combination past `FINAL_MAX_WORDS`;
- a **seal policy** after the push, sealing when the held units are at least `FINAL_MIN_WORDS` and one more unit of `FREEZE_MAX_WORDS` could no longer fit under the ceiling.

The model-visible history becomes `[final span, canonical continuation] × n`, then one assistant message carrying the unsealed units plus the derived frontier, then the live edge turn. Existing final spans are never merged, re-cut or rewritten, and a stored v2 state is upgraded in place with its spans left final.

### The arithmetic

A unit is normally 3,000–4,200 words. Two units are therefore at least 6,000 and satisfy both clauses at once, so finals normally land at 6.0k–8.4k; a third unit is never combined on top, because 7.3k + 4.2k is past the ceiling. The `FINAL_MIN_WORDS` clause is not redundant: a single **overrun** unit of 6,000 words or more seals alone, and a single overrun unit below 6,000 waits for the ceiling guard instead of producing a 10.1k final.

## Alternatives rejected

- **Jitter on `FINAL_MIN_WORDS`.** Delaying a seal by jitter can only be paid for by admitting one more unit, which can carry the combination past the 10,000-word ceiling the addendum (§4) makes hard. Unit-level jitter already decorrelates compilation boundaries from narrative structure (INV-7, addendum invariant 11), and the model sees far fewer final seams than unit seams, so a second jittered threshold buys no concealment and costs the only hard bound in the system.
- **Keeping sealed units as a back-reference array.** The addendum (§9) explicitly permits retaining the underlying units after promotion. We clear them: a retained copy duplicates every span byte in `chatMetadata` — which travels inside the chat file — with no consumer, no model-visible effect and no test that could observe it. `sealUnits` concatenating and clearing is the smaller state with identical behaviour.
- **Merging v2 spans into larger finals on upgrade.** A migration that re-cut or combined existing spans would rewrite history that is already stable in the provider's cache prefix and already model-visible, which §7 and §11 of the addendum and INV-6 forbid. The upgrade adds `units: []` and nothing else.
- **A post-loop seal in `recompile`.** Units still held when the loop ends are below the seal thresholds by construction; sealing them would manufacture a final span the live path would never have produced.

## Consequences

- A continuation turn now follows **every** final span, not only the last one. Before this change the reconstruction emitted back-to-back assistant messages for consecutive frozen spans and relied on the host to keep them distinct; the addendum (§6) makes the sparse canonical seam between finals part of the intended shape, and it is byte-identical `CONTINUATION_CONTROL` by reference (INV-5). The one-shot solo variant applies to the live edge turn only.
- The provider-visible prefix grows monotonically: the first `2n` messages are a function of `state.frozen` alone and are unchanged by anything happening at the frontier (addendum §8, §11). No provider cache-control header is used; the layout is cache-friendly on its own.
- `recompile`'s `{ spans, words }` and its pinned summary line keep their present meaning — final spans only. A chat that compiles into units without reaching a seal reports zero spans.
