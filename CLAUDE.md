# UserInterventionDissolve — SillyTavern extension

Implements PLAN.txt (Collaborative Manuscript Protocol with Hidden Interaction Boundaries) as a third-party SillyTavern extension. One character is authored by the human; the model must never commit that character's tag, and the model-visible history must never reveal where the human intervened.

## What binds every session

1. **Scope is the brief.** Work is done through `/task <request>`, which runs the pipeline in `docs/workflow/workflow.md`. No implementation without a brief in `docs/briefs/`. Discovered work is reported as `SCOPE_GAP`, never done in passing.
2. **ST API facts come from one file.** `docs/api/sillytavern.md` is the only source of truth for what SillyTavern exposes; entries carry file:line evidence from a real checkout and are written only by the `st-api-verifier` agent. Code may use only `status: verified` entries. Never write an ST call from memory. Access is exclusively `globalThis.SillyTavern.getContext()`; never import from ST's own modules.
3. **No prose comments in code.** A comment is one line: `// slug: shorthand → docs/<file>.md#anchor`. The explanation lives at that heading. Enforced by a PostToolUse hook (`tools/check-comments.mjs`) that blocks the edit until the pointer resolves. Policy: `docs/workflow/comment-policy.md`.
4. **Protocol invariants are non-negotiable.** `docs/protocol/invariants.md` (INV-1…INV-10). Any change the scope-auditor marks `violation` stops the task. Features are judged by PLAN.txt §27: does it make the model perceive a continuous fictional world, and does it discard transport information?
5. **Orchestrator context stays thin.** The main session does not read `src/`, `tests/`, or PLAN.txt in full; it passes paths to agents and keeps only their ≤ 40-line reports. Rules: `docs/workflow/workflow.md#orchestrator-context-rules`.

## Agents (`.claude/agents/`)

| Agent | Model | Purpose | Writes |
|---|---|---|---|
| `brief-writer` | Opus | request → `docs/briefs/NNNN-<slug>.md` scope contract, rates Complexity | briefs only |
| `st-api-verifier` | Sonnet | verify an ST API against source, record evidence | `docs/api/sillytavern.md` only |
| `implementer` | Opus / Sonnet | one brief → code + tests + doc headings; Sonnet when the brief says `Complexity: low` | brief's file allowlist |
| `scope-auditor` | Opus | diff vs brief → `clean / creep / violation` | nothing |
| `verifier` | Sonnet | lint, tests, pointer and doc-link checks | nothing |

The main session (Fable) orchestrates only. Tiering rationale and override rules: `docs/workflow/workflow.md#model-tiering`. Skills: `/task <request>` runs the pipeline; `/verify-api <question>` runs the verifier alone.

## Anti-bloat (short form; full list in `docs/workflow/workflow.md#anti-bloat`)

No settings/toggles unless PLAN.txt names the choice as host-selectable. No new dependency without a brief line and a decision record. No abstraction with one consumer. No defensive branch for a state the API inventory rules out. No TODOs (lint forbids them). "Obviously useful" adjacent changes are creep; file another task.

## Layout

```
manifest.json, index.js, style.css   extension entry (SillyTavern loads these)
src/                                  grammar, prompt, host, constants, state, boundary, frontier, freeze, recovery, preset-template, ui/settings
presets/                              generated reference preset (npm run build:preset; never hand-edited)
tests/                                vitest; ST faked as globalThis.SillyTavern only
tools/check-comments.mjs              comment-pointer enforcement (hook + npm run check:comments)
tools/check-docs.mjs                  dangling doc-link check
docs/                                 index in docs/README.md
```

## Commands

```
npm install
npm run check          # lint + tests + comment pointers + doc links (what "done" means)
npm test               # vitest --run
```

## Ground truth for the protocol

`PLAN.txt` is the spec. `docs/protocol/host-mapping.md` says which SillyTavern mechanism implements each PLAN section and which module owns it. When PLAN.txt and a doc disagree, PLAN.txt wins and the doc gets fixed in a task; when PLAN.txt and SillyTavern's real behaviour disagree, record it in `docs/decisions/` and implement the closest behaviour that preserves the invariant.
