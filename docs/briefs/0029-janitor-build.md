# Brief 0029 — Janitor userscript build (`tools/build-janitor.mjs`)
Status: implemented
Complexity: high  (touches `tools/`, `package.json`, a new committed build product and a new doc; flattening an ESM graph into one IIFE without a bundler is where the errors hide)
PLAN sections: §23 (host requirements are behavioural, so a userscript is a legitimate host; the build only decides how that host receives the code), §27 (final criterion — the build adds nothing model-visible; its only protocol duty is that model-facing strings lifted from `src/` reach the bundle byte-identical)
Invariants touched: none directly. INV-5's byte-identical continuation control depends on the bundle not rewriting string literals from `src/`; the acceptance list pins that.

Depends on: **brief 0028** (the build entry `janitor/main.js` and the rest of `janitor/` must exist). Do not start until 0028 is merged.

Scope source: `TamperContainment/PLAN-janitor.md#layout-and-build` — source tracked at `janitor/`, importing pure modules from `src/` directly so the two hosts cannot drift; `tools/build-janitor.mjs` with no dependency concatenates the module graph into one IIFE at `dist/janitor-manuscript-dissolve.user.js` with the Tampermonkey header; the userscript is a build product like `presets/`, never hand-edited; `npm run build:janitor`.

## Goal
`npm run build:janitor` runs plain Node with no dependency, walks the static import graph from `janitor/main.js` across `janitor/` and `src/`, flattens it into one `(function () { 'use strict'; … })();` preceded by a Tampermonkey metadata block, and writes `dist/janitor-manuscript-dissolve.user.js`, which is committed to the repo so the user can paste it into Tampermonkey. The tool refuses, loudly and with a non-zero exit, anything it cannot flatten correctly rather than emitting a subtly wrong bundle.

## In scope
- **`tools/build-janitor.mjs`**, Node built-ins only (`node:fs`, `node:path`, `node:url`):
  - Entry `janitor/main.js`. Resolve only **relative** specifiers (`./x.js`, `../src/x.js`) against the importing file; every resolved path must sit under `janitor/` or `src/`.
  - Depth-first post-order walk producing a deterministic dependency-before-dependent order; detect and reject an import cycle.
  - Per module: strip `import` statements entirely and strip the `export ` keyword from `export function`/`export const`/`export let`/`export class`; concatenate the remaining source verbatim (no minification, no transformation of any literal).
  - **Fail with a clear message and exit code 1** on: a bare or absolute specifier, a path outside `janitor/`/`src/`, a default export, `export *`, `export { … }` (list form), `import … as …`, `import` without braces, dynamic `import(`, a top-level name declared by two modules, or a cycle. Each failure names the file and the offending line.
  - Emit the Tampermonkey header as a single literal block in the tool: `@name Janitor Manuscript Dissolve`, `@namespace`, `@version` read from `package.json`, `@description` one line, `@match https://janitorai.com/*` and `@match https://*.janitorai.com/*`, `@grant none`, `@run-at document-start`, `@sandbox raw` (matching the optimizer's own header, `TamperContainment/TamperMonkeyJanAI.txt` L1–12, since the same injection timing is required).
  - Emit a generated-file banner line under the header naming `npm run build:janitor` and forbidding hand edits.
  - Export `buildJanitorBundle()` returning the bundle string, and write the file only when run as the entry module, so tests can build without touching the filesystem.
- **`package.json`**: add `"build:janitor": "node tools/build-janitor.mjs"`. Nothing else.
- **`dist/` is committed**, not ignored — the same status as `presets/`: a generated artefact the user needs as a file. `.gitignore` gains nothing; `eslint.config.js` `ignores` gains `dist/**` (the bundle is generated code and must not be linted).
- **`tests/janitor/build.test.js`**: builds via `buildJanitorBundle()` and asserts the header lines are present and in order, the banner is present, the output contains no remaining `import `/`export ` statement, the body is wrapped in exactly one IIFE with `'use strict'`, `new Function(bundle)` parses without throwing, and the build is byte-stable across two consecutive calls. Plus fixture-driven failure tests for at least: duplicate top-level name, default export, cycle, and a bare specifier — each throwing with the offending file named. Fixtures live under `tests/janitor/fixtures/build/` as tiny module files and the tool accepts an entry path parameter so they can be built.

## Out of scope (explicit)
- Any bundler, transpiler, minifier, sourcemap, watch mode, or npm dependency of any kind.
- A general-purpose module resolver: `node_modules`, `package.json` exports maps, JSON imports, CSS imports, import maps, tree-shaking, dead-code elimination.
- Wiring `build:janitor` into `npm run check` or any CI step, or a "bundle is up to date" check. The user rebuilds when they want a paste-ready file, exactly as with `build:preset`.
- Changing `tools/build-preset.mjs`, `tools/check-comments.mjs`, `tools/check-docs.mjs`, or the `check` script.
- Editing any file under `janitor/` or `src/` to make them easier to bundle. If a module's syntax defeats the tool, that is a `SCOPE_GAP`, not a licence to rewrite the module.
- Publishing, versioning schemes, `@updateURL`/`@downloadURL`, or a release doc.

## Files
- allowed to create: `tools/build-janitor.mjs`, `dist/janitor-manuscript-dissolve.user.js` (generated), `tests/janitor/build.test.js`, `tests/janitor/fixtures/build/**`, `docs/modules/janitor-build.md`
- allowed to modify: `package.json` (add `build:janitor` only), `eslint.config.js` (add `dist/**` to `ignores` only), `docs/README.md` (index line for the new doc)
- must not touch: `janitor/**`, `src/**`, `index.js`, `manifest.json`, `presets/**`, `tools/build-preset.mjs`, `tools/check-*.mjs`, `vitest.config.js`, `.gitignore`, `PLAN.txt`, `TamperContainment/**`

## ST APIs used
- none. The build tool runs in Node; the bundle targets janitorai.com, where no SillyTavern API exists.

## Verification needed
- (empty) No Janitor runtime fact is involved. The only external fact used is the Tampermonkey header shape, read directly from `TamperContainment/TamperMonkeyJanAI.txt` L1–12.

## Acceptance
- [x] `npm run build:janitor` writes `dist/janitor-manuscript-dissolve.user.js` and exits 0 on the tree as it stands after brief 0028.
- [x] The written file begins with `// ==UserScript==` … `// ==/UserScript==` including `@match https://janitorai.com/*`, `@grant none`, `@run-at document-start`, `@sandbox raw`, followed by the generated-file banner and one IIFE.
- [x] Every string literal from a bundled `src/` module appears in the bundle byte-identical to the source (asserted on at least one literal from a bundled module, or on the whole stripped module body).
- [x] Two consecutive builds produce identical bytes.
- [x] Duplicate top-level names, a default export, an import cycle, and a bare specifier each fail the build with a message naming the file; none of them silently produces a bundle.
- [x] `new Function(bundle)` parses the output.
- [x] `dist/` is tracked by git and absent from `.gitignore`; eslint ignores it.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/janitor-build.md` — new. Headings for the pointer comments: `## Why a hand-written concatenator` (no dependency, the graph is small and fully controlled; plan `#layout-and-build`); `## Supported module syntax` (the exact subset, and that anything else is a hard failure rather than a best effort); `## Bundle shape` (header block, banner, single IIFE, `'use strict'`); `## dist is a build product` (committed like `presets/`, never hand-edited, rebuilt with `npm run build:janitor`); `## What the build must never do` (rewrite literals — the byte-identical model-facing strings that keep both hosts cache-compatible, plan Architecture layer 2).
- `docs/README.md` — index line for the new doc.
