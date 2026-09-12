---
name: task
description: Run one implementation task through the project's subagent pipeline (brief → verify APIs → implement → scope audit → verify). Use for any change to the extension; `/task <what to do>`.
---

You are the orchestrator. Follow `docs/workflow/workflow.md` exactly. Your own context stays thin: you do not read `src/`, `tests/`, or PLAN.txt in full.

Request: $ARGUMENTS

1. **Size** the request per `docs/workflow/workflow.md#sizing` from the request text alone. State the size in one line.

2. **Brief.**
   - trivial: write a 3-line inline brief (goal, one allowed file, one acceptance line) and skip to step 4.
   - normal/large: launch `brief-writer` with the request. Receive the brief path(s) and the Verification-needed list.

3. **Verify APIs.** If Verification-needed is non-empty, launch `st-api-verifier` with that list. If any item comes back `absent` or `verified-negative`, relaunch `brief-writer` with the verifier's result so the brief is rewritten around what actually exists. Do not proceed with an unverified API.

4. **Implement.** First `git add` and commit the brief on main (a worktree branches from HEAD; an uncommitted brief causes an add/add conflict at merge). Then launch `implementer` with only the brief path. Pick the model from the brief's Complexity line per `docs/workflow/workflow.md#model-tiering`: `high` → leave the agent default (Opus); `low` or trivial → pass `model: "sonnet"`. For large tasks, launch one implementer per brief in the same message; if the repo is git-initialised, use `isolation: "worktree"` for each.
   - `BLOCKED` → back to step 3.
   - `SCOPE_GAP` → tell the user; do not expand the brief yourself unless the gap is a one-line clarification that the PLAN section already settles.

5. **Audit.** Launch `scope-auditor` with the brief path and the changed-file list (or git range).
   - `creep` → have `implementer` revert the listed hunks (give it the audit lines verbatim), then re-audit.
   - `violation` → stop and report the INVARIANT-RISK lines to the user.

6. **Verify.** Launch `verifier` with the brief path. On failure, hand the FAILURES lines to `implementer` (same brief, same model as before; escalate low→Opus on the second loop) and re-verify; at most two loops, then report.

7. **Report** to the user in ≤ 12 lines: brief path, files changed, verifier summary line, open SCOPE_GAPs. No diffs.

Never skip the audit for normal/large tasks. Never run `implementer` without a brief path or inline brief.
