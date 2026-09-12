# 0001 — Grammar semantics are prompt-level; the external tag is `{{user}}`
Date: 2026-09-12
Brief: docs/briefs/0001-grammar-module.md (amended by 0002)
PLAN: §5, §7, §8, §19, §20

## Decision
Code parses manuscript **structure** only: block delimiters, tag headers, trailing-block completeness. All **semantic** grammar (buffer contents, cross-character commitment, aggregate ownership, universal tags such as `Everyone:`) is regulated through the system prompt and reinforced by consistent chat — the seed span and the collaborator's own contributions. The collaborator shares responsibility for upholding the grammar. The externally owned character is not configured; it is whatever the `{{user}}` macro resolves to (`name1`), read at request time.

## Alternatives rejected
- Code-enforced universal-tag blocklist (`findForbiddenUniversalTags`) — enforces a convention that is flavor text, not a rule; a blocklist also cannot express the actual purpose of tags (identifying a discrete entity or action-aligned group).
- Extension setting for the external character's name — redundant with the persona and creates a second source of truth that can drift from `{{user}}`.
- Hard lint gate before freeze — contradicts PLAN §20's own caveat that the grammar exists to preserve agency, not to flatten prose into legalese; any lint is advisory to the editor.

## Consequences
- `grammar` keeps `parseManuscript`, `parseTagHeader`, `classifyActor`, `findTagLiteral`, completeness/boundary helpers; drops `FORBIDDEN_UNIVERSAL_TAGS` and `findForbiddenUniversalTags`.
- The INV-9 carry-forward in brief 0001 (lowercase `everyone:` blind spot) is withdrawn.
- A `prompt` text asset (system-prompt wording for the grammar) becomes a first-class deliverable with its own brief; the seed span is its companion.
- `boundary` derives the stop literal from `substituteParams('{{user}}')` on every request.
