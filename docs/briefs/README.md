# Briefs

Scope contracts produced by the `brief-writer` agent and consumed by `implementer` and `scope-auditor`. Template and rules live in `.claude/agents/brief-writer.md`. Status values: `draft`, `implemented`, `partial`, `done`, `superseded by NNNN`.

## Trivial 0027 — remove classifyActor

`classifyActor` (and its private helper `normalise`) had no in-tree consumer outside tests and doc prose (flagged as a scope gap in `docs/decisions/0005-agency-spans.md`). Deleted from `src/grammar.js` along with its tests in `tests/grammar.test.js`, its `## Actor classification` section in `docs/modules/grammar.md`, and the `classifyActor` mentions in `docs/modules/boundary.md` and `docs/modules/freeze.md` (reworded to name the actor string instead).

