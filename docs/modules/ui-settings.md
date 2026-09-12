# ui-settings
Owns: —
PLAN: §8, §23
Depends on: host, boundary, preset-template, constants

`src/ui/settings.js` builds the extension's one entry in SillyTavern's Extensions panel. It renders a drawer, installs the reference preset on demand, and reports the reserved tag literal. It stores nothing, configures nothing, and reads no protocol state.

## Five element groups, no settings {#four-elements}

The drawer holds exactly five groups: a two-sentence description of what the extension does, a hint naming the manual preset-import route, one "Install reference preset" button, a read-only status line showing the reserved tag literal, and the [starter reformatter](#starter-group). There is no toggle, checkbox, select, slider or persisted text field, and nothing here writes `extensionSettings`.

That is not minimalism for its own sake. PLAN §23's host requirements are behaviours — "enforce a hard external-character boundary", "merge external text into manuscript-bearing context" — not options; the protocol names no choice the host may hand to the collaborator, so there is nothing to configure. The extension behaves identically whether or not this drawer was ever opened (decision `docs/decisions/0002-structure-from-intercede.md`, user ruling: one surface, aesthetic reference only). The bar for another element is a PLAN section that requires it, not a feature that would be convenient.

The starter reformatter is the one group that cleared that bar: PLAN §19 asks for a prepared seed at cold start, and the group exists to produce one. It is still not settings creep, because it configures nothing and stores nothing — its two textareas are never read from or written to `extensionSettings`, `chatMetadata` or `localStorage`, nothing about it survives a re-render, and the extension behaves identically whether or not it was ever used.

## Where the drawer attaches {#container}

The container lookup is `document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings')`. Both ids exist unconditionally in 1.18.0 and the two columns are not structurally distinguished, so preferring the second column and degrading to the first is the documented-safe order (`docs/api/sillytavern.md#settings-container`). When neither exists, `renderSettings` appends nothing and returns `null` — a theoretical case on this version, kept because the alternative is a throw inside `init()`.

`renderSettings` is idempotent: if an element with id `uid_settings` is already in the document it is returned as-is, nothing is built and nothing is appended. That matters because the only caller is `init()`, which can run more than once after a failed capability gate, and because a second root would mean a second click listener on a second button.

The `inline-drawer` / `inline-drawer-toggle inline-drawer-header` / `inline-drawer-icon` / `inline-drawer-content` skeleton is SillyTavern's own reusable drawer markup. Its open/close is wired by one globally delegated `$(document).on('click', '.inline-drawer-toggle', …)` handler, so emitting the class markup is the whole integration: this module registers no listener on the toggle, animates nothing, and persists no open/closed state (`docs/api/sillytavern.md#inline-drawer`). Host class names (`inline-drawer*`, `menu_button`) are used verbatim; every class this module authors is `uid-`prefixed.

## Plain DOM, no jQuery {#plain-dom}

The drawer is built with `document.createElement`, `textContent` and `append`. jQuery is present on a real install and ST's own extensions use it freely, but nothing here needs it: depending on a page global for element creation would make the module untestable in jsdom without a shim, for no gain. There is no `innerHTML`, no markup template string, and no `data-i18n` attribute — all text is assigned with `textContent`, so nothing the extension renders can be parsed as HTML.

## Installing the reference preset {#install-preset}

`installReferencePreset(ctx)` calls `ctx.getPresetManager('openai')` and then `await manager.savePreset(PRESET_NAME, buildPresets()[OPENAI_PRESET_FILE])` — exactly two arguments, no options object (`docs/api/sillytavern.md#preset-programmatic-save`). The object is the shared template (`docs/modules/preset.md#shared-template`), deep-equal to the committed `presets/Manuscript Protocol.json`: it is never fetched over HTTP and never edited before saving — no persona substitution, no injected literal, no extra prompt entry. A preset the collaborator can read in the repository and a preset the button writes must be the same bytes, or the file stops being the inspectable source of truth.

Saving creates the file and refreshes the preset dropdown; it does **not** activate the preset. Selecting **Manuscript Protocol** in **Chat Completion Presets** stays the collaborator's act, and the success toast says so. The slash-command route that could activate it exists (`docs/api/sillytavern.md#preset-slash-commands`) and is deliberately unused: silently replacing the active preset is a change to the user's configuration that nobody asked for.

Failure is a toast and a `false` return, never a throw. A missing `getPresetManager`, a manager without `savePreset`, and a rejected save all end the same way, so the click listener has nothing to handle; the reject path also logs once through `console.error` with `LOG_PREFIX` so the underlying error is recoverable from the console.

## Reserved-literal status line {#status-line}

`refreshReservedLiteral(ctx)` writes `Reserved tag: <literal>` into `#uid_reserved_literal`, where the literal comes from `reservedLiteral(ctx)` (`docs/modules/boundary.md#reserved-literal`). It is a report, not a control: the drawer shows which tag generation will stop before, so the collaborator can see the boundary is armed and against which name. Nothing in this module may set, override or store the literal — INV-2 belongs to `boundary`, which derives it from the persona, and a second writable copy would be a second source of truth (`docs/protocol/invariants.md`).

When `reservedLiteral` returns `''` there is no persona name, so the line reads a fixed sentence saying no persona name is set and no tag is reserved. It never renders a bare `:`, which would look like a configured-but-empty boundary.

The literal is recomputed per call and never cached, because the persona can change with the chat and `getContext()` reads live values at call time (`docs/api/sillytavern.md#getcontext`). That is why the refresh hangs off CHAT_CHANGED (`docs/modules/bootstrap.md#settings-drawer-wiring`) rather than off a stored value. Calling it before any drawer has been rendered is a silent no-op — the element is simply absent.

## Notifications {#notifications}

One module-local helper calls `globalThis.toastr?.[kind](message, title, options)`. The verified call form is `toastr.<success|error|info|warning>(message, title, options)` with both trailing arguments optional, and `toastr` is a page global loaded by a plain `<script>` tag, so on a real install it is always there (`docs/api/sillytavern.md#toastr`). The optional-chained guard and the `console` fallback are kept anyway: a jsdom test renders the drawer with no page globals at all, and a notification helper that throws would turn a cosmetic absence into a failed install.

## Starter reformatter {#starter-group}

The fifth group is five controls: a `textarea` for a starter written in ordinary prose, a **Restructure** button, a **Copy** button, a `readOnly` `textarea` holding the result, and a one-line hint reading `Paste into the character's Alternate Greetings.` The output is a textarea rather than a rendered block so the text stays selectable and scrollable; it is assigned with `.value` and never parsed as HTML, and it stays `hidden` until a rewrite returns something.

Enablement is recomputed in one place, `updateStarterControls()`, and nowhere else. **Restructure** is `disabled` while the input is empty or whitespace and while a rewrite is in flight — only `disabled` changes, the label never does, so the button does not flicker between two words. **Copy** is `disabled` while the output is empty. The only triggers are the `input` event on the input textarea and the completion of a rewrite; there is no CHAT_CHANGED wiring and no event subscription for this group.

Both handlers are thin wrappers over `src/starter.js` (`docs/modules/starter.md#rewrite-request`). Restructure disables, awaits `restructureStarter(input.value, ctx)`, fills and unhides the output on a non-empty result, notifies an error on an empty one, and re-enables in a `finally`. Copy calls `navigator.clipboard.writeText` — a browser API, not an ST API — and when the clipboard is absent or rejects, falls back to selecting the output text and saying so, so the collaborator can always finish the copy by hand.

Nothing in this group persists. The input textarea is empty every time the drawer is built; that is the specification, not an omission, and `renderSettings` stays idempotent because of it. The extension also never writes the greeting itself: no `merge-attributes` call, no `characters` read, no `CHARACTER_EDITED` emit. The verified alternate-greetings write path exists and is deliberately unused (user ruling, 2026-09-12) — moving the text is the collaborator's own act in SillyTavern's character editor.
