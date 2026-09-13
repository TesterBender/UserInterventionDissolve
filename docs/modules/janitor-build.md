# Janitor userscript build (`tools/build-janitor.mjs`)

`npm run build:janitor` flattens the static import graph rooted at `janitor/main.js` into a single
Tampermonkey userscript at `dist/janitor-manuscript-dissolve.user.js`. Source of the layout decision:
`TamperContainment/PLAN-janitor.md` ("Layout and build", 2026-09-13).

## Why a hand-written concatenator

The janitor host needs one pasteable file, but the repository has no bundler and adding one would be a
new dependency for a graph of a dozen modules whose syntax we control completely. The tool is therefore
plain Node built-ins (`node:fs`, `node:path`, `node:url`), the same weight class as
`tools/build-preset.mjs`. Source stays tracked at `janitor/` and imports the pure modules from `src/`
directly, so "lifted verbatim" stays true and the two hosts cannot drift.

## Supported module syntax

The tool understands exactly one dialect, the one `janitor/` and `src/` already use:

- `import { a, b } from './rel.js';` — braces only, relative specifier only, resolved against the
  importing file and required to land under `janitor/`, `src/`, or the entry's own directory (that last
  root exists so the build fixtures under `tests/janitor/fixtures/build/` can be built).
- `export function f`, `export const x`, `export let x`, `export class C` — the `export ` keyword is
  stripped and the declaration is kept verbatim.

Everything else is a **hard failure with exit code 1**, never a best-effort bundle: bare or absolute
specifiers, paths outside the allowed roots, `export default`, `export *`, the list form `export { … }`,
`import … as …`, a default or side-effect import, dynamic `import(`, an import cycle, and a top-level
name declared by two modules (concatenation would silently redeclare it). Every message names the file
and the offending line. The duplicate-name rule is unconditional — two top-level declarations of the
same name collide even when their text is byte-identical, and the build names the second file — because
the modules are emitted into one shared scope and the tool never drops or renames a declaration.
A module whose syntax defeats the tool is a scope gap to be reported, not a licence to rewrite the
module.

## Bundle shape

Output order is fixed: the Tampermonkey metadata block (`// ==UserScript==` … `// ==/UserScript==`,
carrying `@match https://janitorai.com/*`, `@grant none`, `@run-at document-start`, `@sandbox raw` —
the optimizer's own header, because the same injection timing is required), then the generated-file
banner, then exactly one `(function () { 'use strict'; … })();` containing the stripped module bodies in
dependency-before-dependent (post-order) order, each preceded by a one-line file marker. Bodies are
copied byte-for-byte, so two consecutive builds of an unchanged tree produce identical bytes.

## dist is a build product

`dist/janitor-manuscript-dissolve.user.js` is committed and tracked, exactly like `presets/`: the user
needs the file itself to paste into Tampermonkey. It is never hand-edited; regenerate it with
`npm run build:janitor` after any change under `janitor/` or the `src/` modules it pulls in. It is
excluded from eslint (`eslint.config.js` `ignores`) because it is generated code.

## What the build must never do

No minification, no transpilation, no rewriting of any literal. The model-facing strings lifted from
`src/` — the continuation control, the system prompt, the reserved literals — must reach the bundle
byte-identical to the SillyTavern host's copy, or the two hosts stop being cache-compatible and the
protocol's own byte-equality expectations (PLAN §27; plan Architecture layer 2) break. Stripping
`import`/`export` keywords and concatenating is the whole of the permitted transformation.
