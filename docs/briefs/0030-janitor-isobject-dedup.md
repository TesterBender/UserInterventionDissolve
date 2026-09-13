# Brief 0030 — Deduplicate `isObject` across `janitor/shape.js` and `janitor/envelope.js`
Status: draft
Complexity: low  (two files in `janitor/`, one new export, no behaviour change; the build tool and its failure rule already exist)
PLAN sections: §23 (host requirements are behavioural; a userscript host is legitimate — this change only keeps that host buildable), §27 (the final criterion — this change is invisible to the model; nothing model-facing moves)
Invariants touched: none. No protocol logic, no model-visible string, no transport behaviour changes.

Scope source: `TamperContainment/PLAN-janitor.md#layout-and-build` (source tracked at `janitor/`; `tools/build-janitor.mjs` concatenates the module graph into one IIFE at `dist/janitor-manuscript-dissolve.user.js`; the userscript is a build product like `presets/`, never hand-edited). Brief 0029 line 19 makes "a top-level name declared by two modules" a hard build failure with exit code 1; brief 0029's audit ruled out a byte-identical-duplicate exception in the tool, so the duplicate in the source tree is the work.

Depends on: briefs 0028 (merged) and 0029 (the build tool). `npm run build:janitor` must exist before the dist rebuild step of this brief can be done.

## Goal
`janitor/` declares the helper `isObject` exactly once. `janitor/shape.js` exports it; `janitor/envelope.js` imports it from `./shape.js` and drops its own copy. `npm run build:janitor` exits 0 on the `janitor/` tree instead of failing the duplicate-top-level-name rule, `dist/janitor-manuscript-dissolve.user.js` is regenerated from that passing build and committed, and a second consecutive build produces byte-identical output. No runtime behaviour, no test expectation and no model-facing string changes.

## In scope
- `janitor/shape.js`: add the `export ` keyword to the existing `function isObject(value)` declaration at line 1. The body is unchanged.
- `janitor/envelope.js`: delete the local `function isObject(value)` declaration (currently lines 15–17) and add `import { isObject } from './shape.js';` to the existing top-of-file import region. All existing call sites in `envelope.js` stay as written.
- Regenerate `dist/janitor-manuscript-dissolve.user.js` by running `npm run build:janitor` once the two source edits are in. The file is a committed build product (brief 0029 line 24) and is never hand-edited — if the emitted bytes look wrong, that is a `SCOPE_GAP` against brief 0029's tool, not a licence to edit `dist/`.

Notes that bound the work:
- `janitor/shape.js` imports nothing, so `envelope.js → shape.js` introduces no cycle and the build's dependency-before-dependent order already places `shape.js` first.
- The build tool strips the `export ` keyword from `export function`, so the flattened bundle sees one plain `function isObject`.

## Out of scope (explicit)
- Any new module (`janitor/util.js`, `janitor/shared.js`, or similar). The single declaration lives in `janitor/shape.js`.
- Moving, renaming, re-exporting or re-homing any other helper — in particular `hasOwn`, `token`, `normalizedRoutePath`. They are declared once each; a "while we're here" sweep is creep.
- Changing `tools/build-janitor.mjs`, including adding or softening any duplicate-name exception. Brief 0029's audit already ruled that out.
- Changing the direction of the dependency (importing `isObject` from `envelope.js` into `shape.js`), which would create the cycle the build rejects.
- Any change to `isObject`'s semantics, such as excluding arrays or functions. It stays `typeof value === 'object' && value !== null`.
- Adding `build:janitor` to `npm run check`, or any "dist is up to date" check.
- Touching `src/`, the ST extension, or `docs/protocol/*`.

## Files
- allowed to modify: `janitor/shape.js`, `janitor/envelope.js`
- allowed to regenerate (never hand-edit): `dist/janitor-manuscript-dissolve.user.js`
- allowed to modify only if an existing test genuinely breaks: `tests/janitor/**` (none is expected to; both helpers are private today and no test imports `isObject`)
- allowed to modify only if a pointer comment is added on the moved declaration: `docs/modules/janitor-transport.md`. A comment is not required here; prefer none. If one is added, it must resolve to a heading that exists or that this brief creates, and nothing else in that doc changes.
- must not touch: `tools/**`, `src/**`, `janitor/shell.js`, `janitor/main.js`, `janitor/xhr-warning.js`, `package.json`, `eslint.config.js`, `.gitignore`, `PLAN.txt`, `TamperContainment/**`, `presets/**`

## ST APIs used
- none. This host is janitorai.com; `globalThis.SillyTavern` does not exist here and must not be referenced in `janitor/`.

## Verification needed
- (empty) No SillyTavern API and no Janitor runtime fact is involved. Do not launch `st-api-verifier`.

## Acceptance
- [ ] `isObject` is declared exactly once under `janitor/` (`grep -n "function isObject" janitor/` returns one line, in `shape.js`, carrying `export`).
- [ ] `janitor/envelope.js` imports `isObject` from `./shape.js` and contains no local declaration of it.
- [ ] `npm run build:janitor` exits 0 on the `janitor/` tree and writes `dist/janitor-manuscript-dissolve.user.js`; the duplicate-top-level-name failure no longer fires.
- [ ] The rebuilt `dist/janitor-manuscript-dissolve.user.js` is byte-identical when `npm run build:janitor` is run a second time with no source change.
- [ ] The bundle contains exactly one `function isObject` and no `import `/`export ` statement, and `new Function(bundle)` parses.
- [ ] All existing `tests/janitor/**` tests pass unmodified; if any test file was changed, the diff is reported and justified line by line.
- [ ] `npm run check` passes.
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- none expected. Only if a pointer comment is added on the exported `isObject`: `docs/modules/janitor-transport.md#chat-shape-adapter` gains one sentence saying `shape.js` owns the shared `isObject` predicate for the `janitor/` tree because a top-level name declared twice is a hard build failure (`docs/modules/janitor-build.md#supported-module-syntax`).
