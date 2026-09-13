# 0005 — agency spans in code
Date: 2026-09-13
Brief: docs/briefs/0024-agency-spans.md
PLAN: §5, §9, §17 (with `PLAN-addendum-agency-spans.md`)

## Decision

Three things move into code, and only three. `grammar` gains `groupSpans`, which folds parsed blocks into the spans their headers open — the own-line form, the legacy inline form, and the neutral header `∅:` — and reports nothing but where those headers are (`docs/modules/grammar.md#spans`). `derive` writes the collaborator's tag as an own-line header, so a multi-paragraph contribution is one contribution under one owner (`docs/modules/derive.md#own-line-header`). `freeze` computes its ownership-safety rules and its cut preference over spans instead of blocks, so a cut never lands inside or beside the external character's span however long it runs, and prefers a span start — neutral first — when one is in budget (`docs/modules/freeze.md#salience-heuristics`).

Everything else about spans stays prompt-level, as `docs/decisions/0001-prompt-level-grammar.md` and `docs/protocol/invariants.md#enforcement-model` already require: when a span should open, when a neutral passage is warranted, whether a `∅:` passage has been misused to commit a character, and how long a character should hold the floor are writing judgements the prompt elicits and the model performs. Code never inserts, suggests, repairs or removes a header, and makes no judgement about what any prose means.

## Alternatives rejected

- **An owner state machine** — a module tracking "who currently owns the manuscript" and deciding when narration enters and leaves neutral scope. Addendum §14 forbids it explicitly, and it would have to guess on exactly the ambiguous prose the addendum says must not require adjudication. `groupSpans` is a pure function over already-parsed blocks and keeps no state at all.
- **A neutral-buffer lint** — flagging `∅:` passages that appear to commit a character. Addendum §10 keeps linting advisory, and this codebase has no lint at all; an advisory flag with no consumer is an abstraction with no consumer.
- **Making span boundaries the transport unit** — cutting only at headers. Addendum §12: transport must not become aligned with every agency transition, or the model is shown a history in which each message begins with a new owner. Spans reject and rank block boundaries; they never become boundaries.
- **Deleting `classifyActor`** — after this brief its only consumers are tests and doc prose. Removing it needs edits to `docs/modules/boundary.md`, which brief 0024 does not allow, so it is reported as a scope gap and left in place.

## Consequences

- PLAN §17's "avoid dense external-character runs" is **deliberately not implemented**: once adjacency counted spans, the old `FREEZE_DENSE_RADIUS` rule starved freezing entirely on manuscripts where the external character takes the floor every few spans, contradicting PLAN §18, and the user's decision was to delete the rule rather than tune it (`docs/modules/freeze.md#no-dense-run`).
- `∅:` is a pinned literal in `src/grammar.js` (`NEUTRAL_HEADER`). Changing it is a pinned-string-lane amendment, not an implementation choice.
- Cuts can no longer land inside a long external-character span, so freezing is postponed more often on manuscripts where the external character appears frequently. A postponed freeze is a normal outcome: the frontier keeps growing until a safe boundary exists.
- The reserved literal opens a span whether or not `TAG_HEADER` can parse it, so ownership protection does not depend on the persona name being spellable by the tag pattern (`docs/modules/grammar.md#reserved-spans`).
- Old chats keep parsing unchanged, because the legacy inline header form still opens a span and `TAG_HEADER` is untouched.
- Teaching the model the own-line header and `∅:` is prompt and seed work, which this decision does not do; until that lands, `∅:` simply never appears and the ladder falls through to its lower tiers.

## Transition note

Until the prompt and seed teach own-line headers and `∅:`, manuscripts are written in the old paragraph-per-commitment style, and unheaded model narration that follows the external character's block joins *that* span rather than standing on its own. Those paragraphs are therefore unavailable as cut points, and freezing will postpone more often in old-style chats than it did before this change. This is expected, not a defect: the frontier simply grows until a boundary outside the external character's span exists, and the effect resolves as the prompt lands and headers start appearing where the ownership actually changes.
