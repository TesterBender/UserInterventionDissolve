# Brief 0002 — Remove the universal-tag detector from `grammar`
Status: done
Complexity: low
PLAN sections: §5 (manuscript is atomic blocks, each tag or buffer; no lint duty stated), §7 (aggregate tags may not bypass individual ownership; universal tags such as `Everyone:` are "discouraged or forbidden" — a convention stated in prose, with no enforcement mechanism assigned to code)
Invariants touched: INV-9 (already restated in docs/protocol/invariants.md#inv-9 as prompt+seed convention, not code), INV-1 (unchanged; named only because it is `grammar`'s other owned invariant)

## Goal
`src/grammar.js` no longer contains a universal-tag blocklist or a detector built on it. After this brief, `grammar` parses structure and classifies an actor as `individual` or `aggregate` against a caller-supplied set, and nothing in the codebase encodes the opinion that `Everyone:` is forbidden — that opinion lives in the system prompt and the seed span (docs/decisions/0001-prompt-level-grammar.md, docs/protocol/invariants.md#enforcement-model). Tests, module doc and pointer comments match the reduced surface, and `npm run check` passes.

## In scope
- Delete the `FORBIDDEN_UNIVERSAL_TAGS` export and its `Object.freeze([...])` initialiser from `src/grammar.js`.
- Delete the `findForbiddenUniversalTags` export from `src/grammar.js`.
- Delete the `universal` branch from `classifyActor`, so its return type becomes `'individual' | 'aggregate'`. **`classifyActor` itself stays.** Its purpose is not the detector: the individual/aggregate distinction is PLAN §7's own distinction (an aggregate commits only currently unindividuated members), it is why membership is a caller argument, and docs/decisions/0001-prompt-level-grammar.md#consequences explicitly retains it. It has no in-tree consumer yet because `grammar` is the first module landed; removing the blocklist leaves a coherent two-way classifier, so it is kept rather than deleted. A name like `Everyone` now classifies as `aggregate`, which is exactly what INV-9 says an aggregate is.
- Move the `// actor-classification:` pointer comment from the deleted constant to `classifyActor`, and reword it so it describes the surviving behaviour (individual vs aggregate against a caller-supplied set) rather than forbidden tags.
- In `tests/grammar.test.js`: drop `FORBIDDEN_UNIVERSAL_TAGS` and `findForbiddenUniversalTags` from the import list; delete the `describe('findForbiddenUniversalTags', ...)` block and the `'exposes exactly the three forbidden universal tags, frozen'` case; rewrite the surviving `classifyActor` case so it asserts `individual` (case-insensitive, array and `Set` both accepted), `aggregate` for an unlisted name, and `aggregate` for `'Everyone'` when it is not in the supplied set.
- In `docs/modules/grammar.md`: rewrite the `## Actor classification` section to two outcomes, delete the `FORBIDDEN_UNIVERSAL_TAGS` / `findForbiddenUniversalTags` / "detection surface `lint` uses" prose, and state in one sentence that universal tags are not a code concern, citing docs/decisions/0001-prompt-level-grammar.md. Adjust the header line (`Owns: INV-1, INV-9`) and the intro paragraph's reference to `lint` only as far as needed to stop claiming code enforcement of INV-9; keep the heading anchor `#actor-classification` intact so pointer comments still resolve.

## Out of scope (explicit)
- Do not replace the detector with a "soft" or "advisory" variant, a warning list, a severity field, or a `lint` module. The decision rejected the whole category.
- Do not add a setting, option or configurable list for universal tags.
- Do not touch `parseManuscript`, `parseTagHeader`, `findTagLiteral`, `isBlockComplete`, `isTrailingBlockComplete`, `lastCompleteBoundary`, `truncateToLastCompleteBlock`, the regex constants, or their tests and doc sections.
- Do not edit docs/protocol/invariants.md or docs/decisions/0001-prompt-level-grammar.md — both already describe the post-removal state.
- Do not rewrite brief 0001; its `## Withdrawn` note already points here.
- Do not write the prompt asset or seed span that now carry INV-9; those are separate briefs.
- Do not rename `classifyActor` or change its parameter names.

## Files
- allowed to create/modify: `src/grammar.js`, `tests/grammar.test.js`, `docs/modules/grammar.md`
- must not touch: `PLAN.txt`, `docs/protocol/*`, `docs/decisions/*`, `docs/briefs/0001-grammar-module.md`, `docs/api/sillytavern.md`, `tools/*`, any other file under `src/` or `tests/`

## ST APIs used
- none — `grammar` is pure (string in, plain data out) and calls no SillyTavern API.

## Verification needed
- (empty)

## Acceptance
- [x] `import { FORBIDDEN_UNIVERSAL_TAGS } from '../src/grammar.js'` and `import { findForbiddenUniversalTags } ...` both resolve to `undefined`; neither identifier appears anywhere in `src/`, `tests/` or `docs/modules/`.
- [x] `classifyActor('Everyone', ['Anton'])` returns `'aggregate'`; `classifyActor('anton', ['Anton'])` and `classifyActor('Anton', new Set(['Anton']))` return `'individual'`; no input returns `'universal'`.
- [x] `grep -r universal src/` returns nothing.
- [x] `docs/modules/grammar.md` still has a `## Actor classification` heading (anchor `#actor-classification`) and its text names only `individual` and `aggregate`.
- [x] All pre-existing `grammar` tests unrelated to universal tags still pass unmodified.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/grammar.md#actor-classification` — must explain the two outcomes, why the individuated set is a caller argument and never module state (a stale set mis-classifies), and that universal tags are flavor text regulated by the system prompt and seed rather than by code (link docs/decisions/0001-prompt-level-grammar.md and docs/protocol/invariants.md#enforcement-model).
- `docs/modules/grammar.md` header/intro — `grammar` owns INV-1; INV-9 is prompt-level, so the module must no longer claim to own or detect it.
