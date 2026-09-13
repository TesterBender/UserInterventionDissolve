# Documentation index

All explanatory text for this extension lives here. Code contains only one-line pointers into these files (see `workflow/comment-policy.md`).

| Directory | Holds | Written by |
|---|---|---|
| `protocol/` | The protocol as it binds this implementation: `invariants.md` (PLAN.txt §26 condensed, stable anchors), `host-mapping.md` (PLAN section → SillyTavern mechanism → module). | brief-writer, orchestrator |
| `api/` | `sillytavern.md` — the only place a SillyTavern API fact may be stated. Every entry carries file:line evidence and a checked version. `janitor.md` — the dated capture ledger for janitorai.com, which has no source to read; written by hand, never by the verifier. | st-api-verifier only (`janitor.md`: implementer, orchestrator) |
| `modules/` | One file per `src/` module: what it does, its invariants, edge cases. Targets of most pointer comments. `janitor-transport.md` covers the `janitor/` fetch shell instead, `janitor-adapter.md` the `janitor/` identity, storage and ST-shape layer, `janitor-build.md` the userscript bundler (`tools/build-janitor.mjs`), and `janitor-panel.md` the `janitor/` shadow-DOM panel, the script's only human surface. | implementer |
| `decisions/` | `NNNN-<slug>.md` records for choices with rejected alternatives (new dependency, deviation from PLAN.txt, backend-specific workaround). | implementer, orchestrator |
| `briefs/` | `NNNN-<slug>.md` scope contracts. Never deleted. | brief-writer |
| `workflow/` | How work is done: `workflow.md` (pipeline, sizing, anti-bloat rules), `comment-policy.md`. | orchestrator |

Conventions: headings are anchors; keep them stable once a pointer references them. `node tools/check-docs.mjs` fails on any dangling `file.md#anchor` reference inside docs, and `tools/check-comments.mjs` fails on any dangling pointer from code.
