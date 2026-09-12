# Comment policy

Code files contain no explanatory prose. Every comment is a one-line pointer into `docs/`, where the explanation lives. This keeps implementation files small, keeps reasoning reviewable in one place, and stops "why" text from drifting away from the code it describes without anyone noticing.

## Rule

- Code (`.js`, `.mjs`, `.cjs`, `.ts`, `.css`) may contain only **pointer comments** (see [Shape](#shape)).
- No multi-line block comments. No JSDoc. No trailing comments after code on the same line.
- Allowed non-pointer exceptions: `// eslint-…`, `/* eslint-… */`, `/* global … */`, `// @ts-…`, and a shebang.
- The pointer's target file **must exist** and the anchor **must be a heading** in that file.
- Enforced by `tools/check-comments.mjs`, which runs automatically after every `Write`/`Edit` (see `.claude/settings.json`) and blocks the edit with the violation list until fixed. Run it by hand with `node tools/check-comments.mjs <files…>` or over the tree with `npm run check:comments`.

## Shape

```
// <slug>: <shorthand, ≤ 80 chars> → docs/<path>.md#<anchor>
```

- `slug` — lowercase kebab-case identifier for the concept (`mara-stop`, `frontier-rebuild`). Reuse the same slug everywhere the same concept is touched so it can be grepped.
- `shorthand` — a terse reminder, not an explanation. If you need a second line, the second line belongs in the doc.
- `→` — the literal arrow (U+2192). `->` is also accepted.
- `docs/<path>.md#<anchor>` — repo-relative path; anchor is the GitHub-style slug of a heading in that file (lowercase, spaces→`-`, punctuation dropped), or an explicit `{#anchor}` suffix on the heading.

Example:

```js
// mara-stop: reserved tag literal, no leading newline → docs/modules/boundary.md#stop-sequence
```

## Where explanations go

| Kind of explanation | Location |
|---|---|
| How a module works, its invariants, its edge cases | `docs/modules/<module>.md` |
| Why a design choice was made over alternatives | `docs/decisions/NNNN-<slug>.md` |
| A SillyTavern API fact (signature, event payload, caveat) | `docs/api/sillytavern.md` |
| Mapping from a PLAN.txt section to code | `docs/protocol/host-mapping.md` |

## Writing a pointer while implementing

1. Write the code.
2. Where you would have written a comment, write the explanation as a heading + paragraph in the appropriate doc.
3. Put one pointer line in the code that names the heading.
4. The hook verifies the heading exists. If it blocks you, the doc is missing, not the code.
