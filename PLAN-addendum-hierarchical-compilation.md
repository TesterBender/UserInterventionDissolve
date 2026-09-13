# Addendum: Hierarchical Compilation and Cache-Stable Frozen Spans

**Status:** Follow-up implementation note to V3 (received 2026-09-13)
**Purpose:** Restore the intended hierarchical compilation system and clarify how it interacts with caching.

The existing protocol already establishes the important behavioral goal: many tiny live model/collaborator interactions are normalized so the persistent model-visible history does not reveal the collaborator's true intervention cadence.

The goal is not to flatten the entire manuscript into one indefinitely growing assistant message.

The goal is:

> **Many small live interactions should progressively collapse into larger compiled manuscript spans, with final frozen spans remaining bounded in size, cache-stable, and separated only by sparse generic continuation turns.**

## 1. Preserve the distinction between live interaction and persistent history

During live use, the system may temporarily experience sequences such as:

```text
model generates ~220 words
→ external-character stop
→ collaborator supplies Mara block
→ model generates ~340 words
→ external-character stop
→ collaborator supplies Mara block
→ model generates ~110 words
→ ...
```

These are transient interaction events.

They must not survive permanently as:

```text
ASSISTANT
[220 words]

USER
[Mara]

ASSISTANT
[340 words]

USER
[Mara]
```

Instead, the resulting manuscript material is progressively compiled into larger continuous manuscript spans.

The model should eventually see those interactions only as ordinary manuscript content.

## 2. Use hierarchical compilation tiers

Introduce multiple compilation stages rather than one direct jump from live frontier to final historical chunk.

Conceptually:

```text
LIVE MICRO-INTERACTIONS
        ↓
HOT FRONTIER
        ↓
COMPILED FRONTIER UNIT
        ↓
LARGER COMPILED / SEALED SPAN
        ↓
FINAL FROZEN SPAN
```

Exact intermediate sizes are implementation policy rather than protocol invariants.

The important properties are:

* early material can stabilize before final freezing;
* multiple smaller compiled units may combine into a larger span;
* compilation proceeds hierarchically;
* final frozen spans remain bounded;
* historical frozen spans are not repeatedly rewritten.

## 3. Recommended size behavior

The existing V3 nominal transport target of approximately 3,000–4,200 words remains useful as an **initial compilation target**, not necessarily as the final permanent span size.

A reasonable conceptual ladder is:

```text
Tier 0 — Hot frontier
hundreds to a few thousand words
highly mutable

Tier 1 — Compiled unit
approximately 3–4k words
stable enough to participate in promotion

Tier 2 — Larger compiled span
approximately 5–8k words
increasingly stable

Tier 3 — Final frozen span
may grow further through promotion
HARD PRACTICAL MAXIMUM ≈ 10,000 words
```

The exact boundaries should remain flexible and may use jitter.

Do not force cuts simply because a numeric target has been reached.

Prefer low-salience complete-block boundaries as already specified in V3.

## 4. The ~10k limit is a ceiling, not a target

Do not aim to make every final span exactly 10,000 words.

Instead:

> **A final frozen assistant manuscript span may grow through hierarchical promotion but should never exceed approximately 10,000 words.**

A span may finalize earlier if:

* the next safe promotion would exceed the ceiling;
* a better low-salience boundary occurs earlier;
* further combination would make cache or editing behavior unnecessarily awkward;
* host/provider constraints make an earlier boundary preferable.

Example final sizes may naturally look like:

```text
8.7k
7.9k
9.6k
6.8k
9.1k
```

That is acceptable.

## 5. Final historical backend shape

After substantial use, the backend model-visible history should resemble:

```text
SYSTEM:
[stable manuscript rules]

ASSISTANT:
[final frozen manuscript span A — e.g. 8.9k words]

USER:
[canonical neutral continuation]

ASSISTANT:
[final frozen manuscript span B — e.g. 7.6k words]

USER:
[canonical neutral continuation]

ASSISTANT:
[final frozen manuscript span C — e.g. 9.4k words]

USER:
[canonical neutral continuation]

ASSISTANT:
[current tiered frontier]
```

Each frozen assistant span may represent many dozens of actual live:

```text
model → Mara → model → Mara
```

interactions.

Those tiny collaboration boundaries must no longer be visible.

## 6. Generic continuation turns are retained only between final historical spans

The neutral continuation message is intentionally allowed to remain between final compiled/frozen assistant spans.

For example:

```text
ASSISTANT:
[Frozen A]

USER:
Continue the manuscript directly from the current endpoint.

ASSISTANT:
[Frozen B]
```

This is acceptable.

Do not treat these sparse transport seams as equivalent to the original high-frequency collaborator interaction topology.

Their important properties are:

* they are generic;
* they are identical or canonically stable;
* they are relatively rare;
* they are unrelated to Mara;
* they do not reveal how frequently the collaborator actually intervened;
* they are not deliberately aligned with major narrative events.

Do not attempt to eliminate these historical continuation turns merely for aesthetic purity.

The existing V3 requirement that continuation wording be neutral and non-evaluative remains in force.

## 7. Do not flatten historical frozen spans

Once a final span has been created, preserve it as its own stable assistant message.

Do not later turn:

```text
ASSISTANT
[Frozen A]

USER
continue

ASSISTANT
[Frozen B]
```

into:

```text
ASSISTANT
[Frozen A + Frozen B]
```

Doing so unnecessarily changes already-stable historical request structure and may reduce prompt-cache reuse.

Historical compiled spans should therefore become append-only request structure.

## 8. Only the newest frontier should undergo repeated recompilation

At any point, request state should conceptually resemble:

```text
[stable system]

[Frozen A]
continue
[Frozen B]
continue
[Frozen C]
continue

[current frontier]
```

The stable prefix:

```text
System
Frozen A
continue
Frozen B
continue
Frozen C
continue
```

should remain unchanged across subsequent calls.

Only:

```text
[current frontier]
```

continues to evolve.

When the current frontier accumulates enough material:

```text
current frontier
        ↓
Tier 1
        ↓
Tier 2
        ↓
final frozen D
```

then request history becomes:

```text
[Frozen A]
continue
[Frozen B]
continue
[Frozen C]
continue
[Frozen D]
continue
[new frontier]
```

The stable provider-visible prefix therefore grows monotonically.

## 9. Preserve compiled units internally during promotion

Internally, smaller compiled units may remain distinct objects.

For example:

```text
C41
C42
C43
```

may together form:

```text
FrozenSpan D = [C41, C42, C43]
```

There is no requirement to destructively concatenate and delete the underlying units.

However, this internal representation must not introduce additional model-visible conversational turns.

Internal tiering and backend chat-message structure are different concepts.

## 10. Do not create user continuation turns between internal tiers

This is important.

If several internal units eventually form one final frozen span:

```text
C41
C42
C43
```

the model-visible result should be one assistant manuscript span:

```text
ASSISTANT:
[C41 content]
[C42 content]
[C43 content]
```

not:

```text
ASSISTANT:
[C41]

USER:
continue

ASSISTANT:
[C42]

USER:
continue

ASSISTANT:
[C43]
```

Only final persistent compiled spans receive the sparse historical neutral continuation separators.

Internal compilation tiers must remain invisible as chat topology.

## 11. Cache-oriented invariant

The caching objective should remain simple:

> **Once a final frozen span and its following canonical continuation turn have entered persistent history, preserve their provider-visible serialization exactly whenever possible.**

Do not reorder them.

Do not merge them with later spans.

Do not rewrite their continuation wording.

Do not alter formatting unnecessarily.

Do not rebuild previous spans merely because newer material was compiled.

This produces a naturally growing stable prefix:

```text
Call N:

SYSTEM
A
continue
B
continue
HOT

Call N+1:

SYSTEM
A
continue
B
continue
C
continue
HOT

Call N+2:

SYSTEM
A
continue
B
continue
C
continue
D
continue
HOT
```

This layout is intentionally favorable to exact-prefix prompt caching.

Provider-specific cache-control features may still be used by adapters where available, but the canonical history itself should already be cache-friendly without depending on them.

## 12. Do not over-optimize sparse transport boundaries

Do not redesign the manuscript protocol merely to remove the occasional:

```text
USER:
Continue.
```

between very large frozen spans.

The protocol's main concealment target is the relationship between Mara and real collaboration boundaries, not the fact that a long manuscript required occasional continuation requests.

A handful of generic continuation turns across tens of thousands of words is acceptable so long as those boundaries remain:

* low frequency;
* semantically boring;
* unrelated to Mara;
* unrelated to collaborator frequency;
* decorrelated from high-salience narrative structure.

## 13. Frontend behavior is outside this addendum

This specification concerns **backend canonical/model-visible request history**.

Do not infer or implement a frontend presentation transformation unless one is separately specified.

The frontend may choose to present the manuscript continuously to the human collaborator even if backend request history contains final frozen assistant spans separated by neutral continuation messages.

Backend compilation and frontend visualization are separate concerns.

## 14. Preserve V3's independent horizons

The existing distinction between:

* generation horizon;
* authorship horizon;
* transport horizon;

must remain.

The tiering system adds internal compilation stages but must not cause those horizons to become correlated.

In particular:

* many Mara interventions may occur inside one eventual frozen span;
* one generation may produce only a small part of a compiled unit;
* one final frozen span may contain multiple intermediate compilation units;
* the ~10k maximum must not become a narrative pacing target.

## 15. Correct conceptual example

A long real session might have produced:

```text
220 words
Mara
480 words
Mara
95 words
Mara
640 words
Mara
...
```

Internally this may gradually become:

```text
Tier 1:
3.5k

Tier 1:
3.8k

promotion:
7.3k

additional compatible unit:
→ final span 9.2k
```

Persistent backend history then contains only:

```text
ASSISTANT:
[9.2k continuous manuscript]

USER:
[neutral continue]
```

The original dozens of interaction seams are gone.

That is the intended result.

## 16. Core invariants to implement

1. **Tiny live collaborator/model boundaries are temporary transport artifacts.**
2. **Live manuscript material is progressively compiled through multiple internal tiers.**
3. **The existing ~3–4k size is an early compilation scale, not necessarily the final historical span size.**
4. **Final frozen assistant spans may grow through promotion but should remain below an approximate 10k-word hard ceiling.**
5. **Final frozen spans remain distinct historical assistant messages.**
6. **Sparse canonical neutral continuation turns remain between final frozen assistant spans.**
7. **Internal tier boundaries do not create additional model-visible user/assistant turns.**
8. **Historical frozen spans are append-only and should not later be flattened together.**
9. **Only the newest frontier remains subject to repeated normalization and promotion.**
10. **The resulting provider-visible stable prefix should grow monotonically for prompt-cache reuse.**
11. **Compilation boundaries remain decorrelated from Mara and high-salience narrative structure.**
12. **No frontend presentation behavior should be inferred from backend compilation behavior.**

## Final criterion

The implementation should eventually transform an interaction history that physically occurred as:

```text
model
Mara
model
Mara
model
Mara
model
Mara
...
```

into persistent backend history that looks approximately like:

```text
SYSTEM
[rules]

ASSISTANT
[large frozen manuscript span]

USER
[neutral continuation]

ASSISTANT
[large frozen manuscript span]

USER
[neutral continuation]

ASSISTANT
[current frontier]
```

while ensuring that:

* each final frozen span may contain many hidden live interventions;
* frozen spans never grow indefinitely;
* approximately 10k words is the practical maximum for one final span;
* previously frozen spans remain structurally unchanged;
* and the newest frontier alone absorbs and compiles new live interaction.
