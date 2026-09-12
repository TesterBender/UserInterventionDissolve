# Task workflow

The orchestrator (the main Claude Code session) keeps a thin context and delegates. Subagents get fresh contexts, a narrow tool set, and one file-path input each. Facts flow through files in `docs/`, not through conversation.

## Why {#why}

Two failure modes this guards against:

- **Context leak** — the orchestrator accumulates PLAN.txt, ST source, sibling projects, and half-read implementation files, and its later decisions are shaped by whatever happened to be in view. Subagents read what they need and return ≤ 40 lines.
- **Context bloat → scope bloat** — a long session drifts into "while I'm here" additions: options, abstractions, defensive branches, renamed helpers. The brief is a scope contract; the auditor is literal about it; the hook makes prose comments impossible so reasoning is forced into reviewable docs.

## Pipeline {#pipeline}

```
/task <request>
   │
   ├─ size it (orchestrator, no file reads)
   │     trivial  → implementer directly with an inline 3-line brief, then verifier
   │     normal   → full pipeline below
   │     large    → brief-writer splits into N briefs with disjoint file sets; implementers run in parallel
   │
   ├─ brief-writer     → docs/briefs/NNNN-<slug>.md          (reads PLAN.txt + docs; returns path)
   ├─ st-api-verifier  → docs/api/sillytavern.md             (only if brief lists Verification needed)
   ├─ implementer      → code + tests + docs headings        (input: brief path only)
   ├─ scope-auditor    → VERDICT clean|creep|violation       (input: brief path + files)
   │     creep     → orchestrator reverts the untraceable hunks or asks the user; re-audit
   │     violation → stop, report to user
   └─ verifier         → LINT/TESTS/POINTERS/DOCS/ACCEPTANCE
         fail      → implementer with the failure lines (same brief), then re-verify
         pass      → brief Status: done; report to user
```

## Sizing rules {#sizing}

- **trivial**: one file, no new export, no ST API use, no protocol invariant touched. Examples: typo, rename local var, adjust a test expectation with a known cause.
- **pinned-string**: a user-requested change to a model-facing constant. Takes the [pinned-string lane](#pinned-string-lane): amendment in the owning brief, in-place Sonnet implementer, verifier only.
- **normal**: anything touching `src/` behaviour or an ST API.
- **large**: more than one module, or any change to `frontier`/`freeze` (INV-4…INV-7 are coupled).

## Pinned-string lane {#pinned-string-lane}

Model-facing constants (`MANUSCRIPT_SYSTEM_PROMPT`, `CONTINUATION_CONTROL`, `REWRITE_INSTRUCTION`, and any later one) are pinned: their briefs say the string may not be reworded during implementation. That pin exists to stop an implementer changing model-facing text on its own initiative. It does not apply when the **user** asks for the change. For a user-requested edit to a pinned string:

1. The orchestrator appends a dated `## Amendment N` section to the brief that owns the constant: the user's request (quoted), the new text verbatim in a fenced block, and the files allowed (the constant's file, its test file, its module doc).
2. A Sonnet `implementer` runs **in place** (no worktree) with the amendment as its brief. It changes the constant, the verbatim assertion, any forbidden-word cases the amendment names, and the doc heading that quotes the string. Nothing else.
3. `verifier` runs. No `scope-auditor`: the diff is a constant plus the tests and doc that quote it, and the verifier's pointer and test checks cover it.
4. The orchestrator commits on main.

Anything beyond that set of files, or any change to the sanitiser/tests that read the string, is a normal brief.

## Orchestrator context rules {#orchestrator-context-rules}

- Do not `Read` files under `src/` or `tests/`. Ask an agent.
- Do not read PLAN.txt in full after the first session; `docs/protocol/invariants.md` is the working summary. Read a single PLAN section only to settle a dispute.
- Pass paths, not contents, to agents. Never paste a diff into a prompt.
- Keep agent outputs; discard agent transcripts. If an agent returns more than ~40 lines, the agent prompt is wrong — fix the agent file.
- When two agents disagree, the docs win; if the docs are silent, the user decides.

## Anti-bloat rules (apply to every agent) {#anti-bloat}

1. Every added line traces to a brief bullet, and every brief bullet traces to a PLAN section or an existing doc heading.
2. No settings, toggles, environment switches, or "configurable later" hooks unless PLAN.txt names the choice as host-selectable (e.g. §16 transport target, §13 continuation text).
3. No new dependency without a brief line naming it and a decision record in `docs/decisions/`.
4. No abstraction with one consumer. No defensive branch for a state `docs/api/sillytavern.md` says cannot occur.
5. Discovered work is reported (`SCOPE_GAP`), never done.
6. A change that "obviously improves" adjacent code is creep. File a separate task.

## Model tiering {#model-tiering}

Model is chosen by the kind of judgment a step needs, not by prestige. Set in each agent's frontmatter; the orchestrator overrides per launch with the Agent tool's `model` field.

| Step | Default model | Why | Override |
|---|---|---|---|
| Orchestrator (main session) | Fable | Holds the whole plan; every routing decision is a scope decision | — |
| `brief-writer` | Opus | Interprets PLAN.txt into a contract; errors here propagate to every later step | — |
| `st-api-verifier` | Sonnet | Grep-and-cite against source; correctness comes from evidence, not reasoning | Opus if the question is "does mutation X survive to the request body" (a trace, not a lookup) |
| `implementer` | Opus | Default for `Complexity: high` | Sonnet for `Complexity: low` and trivial tasks; escalate to Opus on the second verify loop |
| `scope-auditor` | Opus | Invariant risk is a judgment call; false "clean" is the expensive error | — |
| `verifier` | Sonnet | Runs commands, filters output | — |

Never override upward "just to be safe" on mechanical steps, and never override downward on the auditor.

## Brief lifecycle {#brief-lifecycle}

`draft` → `implemented` | `partial` → `done`. Briefs are never deleted; a superseded brief gets `Status: superseded by NNNN`.

## Git {#git}

The repo is not git-initialised yet. Run `git init` before the first implementation task: the scope-auditor and `isolation: "worktree"` for parallel implementers both need it.
