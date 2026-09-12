# preset
Owns: INV-5, INV-9 (docs/protocol/invariants.md)
PLAN: §13
Depends on: prompt

`tools/build-preset.mjs` turns `MANUSCRIPT_SYSTEM_PROMPT` (`src/prompt.js`) into the checked-in files under `presets/`: a chat-completion preset for SillyTavern's openai path and a system-prompt template for the text-completion path. It is a build tool, not a module of the extension — nothing in it runs inside SillyTavern, it makes no API call, and the extension does not read `presets/` at runtime.

## Why a preset

The protocol's semantics live entirely in prompt text (INV-9, `docs/protocol/invariants.md#enforcement-model`), so the only question for delivery is which vehicle carries that text. A downloadable preset was chosen over a runtime injection because it is inspectable: the author, and anyone tinkering with the protocol, can read the exact bytes that will be sent, edit a copy, and compare variants without running the extension at all. A preset is also ordinary SillyTavern furniture — it imports through the stock UI, appears in the stock dropdown, and survives the extension being uninstalled (user decision, 2026-09-12).

Programmatic installation — a button that calls `getPresetManager('openai').savePreset(...)` (`docs/api/sillytavern.md#preset-programmatic-save`) — is deliberately deferred to brief 0006, so UI work cannot block shipping the files themselves.

## Single source of truth

The JSON under `presets/` is generated, never hand-edited. Editing it by hand would fork the prompt: the same paragraphs would exist as a JavaScript string constant and as a JSON string literal, and the two would drift the first time either is touched. `src/prompt.js` is the source; `presets/` is output.

Regenerate after any change to `MANUSCRIPT_SYSTEM_PROMPT`:

```
npm run build:preset
```

`tests/preset.test.js` deep-equals every committed file against `buildPresets()`, so a change to the constant without a regeneration fails the test suite rather than shipping a stale preset. The generator writes `JSON.stringify(obj, null, 2) + '\n'` and is idempotent: running it twice leaves the working tree unchanged.

## Not the continuation string

`CONTINUATION_CONTROL` is absent from every generated file, and the generator does not import it. It is not preset material. Per PLAN §13 and `docs/protocol/host-mapping.md#s13-continuation` the continuation control is a reconstructed **user turn at the active edge**, emitted on every request by the `frontier`/`continuation` modules; the intended reading of the request is `[manuscript] + CONTINUE`, not a standing instruction in the system prompt. Placing it in a preset would give it a second source that the user can edit independently, so the two copies would stop being byte-identical and INV-5 would break. The test asserts the string does not appear in any generated file.

## Template fields

The openai preset ships exactly two top-level keys, `prompts` and `prompt_order`.

- `prompts` — one entry, the `main` prompt, carrying the system prompt verbatim. `{identifier, name, role, content}` plus `system_prompt: true` is the verified minimum for a plain text prompt (`docs/api/sillytavern.md#preset-openai-prompt-entry-shape`).
- `prompt_order` — one `{character_id, order}` list. `character_id` is the number `100001`, the `dummyId` of the live openai `promptManagerModule`. A preset shipping only `100000` (the base `PromptManager` default, also present in ST's own `Default.json`) imports without error and then renders an **empty** prompt order — the prompt silently does nothing (same anchor).

Nothing else is shipped. Missing keys cost nothing: `onSettingsPresetChange` applies each `settingsToUpdate` key only `if (preset[key] !== undefined)` and skips the rest (`docs/api/sillytavern.md#preset-openai-minimal-fields`). Extra keys are the opposite — every sampler value, token limit, or connection setting in the file would overwrite the user's own configuration on import, for no protocol benefit. The preset changes the prompt and leaves everything else alone.

## Default order and markers

The `order` array is ST's stock `Default.json` sequence for `character_id: 100001`, verbatim, with `enhanceDefinitions` the single disabled entry. It is written out in full even though a shorter list would behave identically: omitting an identifier from `order` does **not** disable it — `isPromptDisabledForActiveCharacter` returns `false` when there is no entry at all, so only an explicit `enabled: false` suppresses anything (`docs/api/sillytavern.md#preset-openai-prompt-order-markers`). Writing the stock semantics out explicitly means a user reading the file sees exactly what will be sent, instead of having to know that absence means "included".

The marker prompt objects (`chatHistory`, `dialogueExamples`, `worldInfoBefore`, …) are referenced in `order` but not shipped in `prompts[]`. `checkForMissingPrompts` auto-fills any entry of `chatCompletionDefaultPrompts` that the preset does not carry (same anchor), so shipping them would duplicate ST's own defaults and freeze them at the version this file was generated against.

## Filename is the preset name

The chat-completion file is named `Manuscript Protocol.json`, spaces included, because the openai import route takes the preset name from the **filename** with the extension stripped and never reads a top-level `name` field (`docs/api/sillytavern.md#preset-openai-import-route`). The generator therefore emits no `name` key for that file, and renaming the file renames the preset in the dropdown.

The sysprompt file is the opposite case: it is imported through the master-import route, which auto-detects the shape from `name` + `content` and saves under `data.name` (`docs/api/sillytavern.md#preset-master-import`). Its filename is free, so it uses the repository's kebab-case convention, and the display name lives inside the file.

## Shared template module {#shared-template}

The frozen template and `buildPresets()` live in `src/preset-template.js`, not in the generator, because three consumers need the same object: the Node generator that writes `presets/*.json`, the staleness test that deep-equals the committed files against it, and the in-browser "Install reference preset" button that hands it to `savePreset` (`docs/modules/ui-settings.md#install-preset`). `tools/build-preset.mjs` is now the writer only — shebang, `node:fs`/`node:path`/`node:url`, the entry-module guard and the write loop — and re-exports `buildPresets` so importers keep working.

That split imposes a rule on the module: it must be loadable by a browser as an ES module straight from disk. It imports only `MANUSCRIPT_SYSTEM_PROMPT` from `src/prompt.js`, imports nothing from `node:*`, touches no `process`, and has no top-level side effect. A single `node:fs` import would make the extension fail to load in SillyTavern, and the failure would be a module-resolution error at install time, far from the line that caused it.

`PRESET_NAME` (`'Manuscript Protocol'`) and `OPENAI_PRESET_FILE` (`'Manuscript Protocol.json'`) are exported as a pair because the two import routes name the preset differently: the manual route takes the name from the filename with the extension stripped (`docs/api/sillytavern.md#preset-openai-import-route`), while `savePreset(name, settings)` takes it as an argument (`docs/api/sillytavern.md#preset-programmatic-save`). If the button and the file ever drifted, the same protocol would appear twice in the dropdown under two names, and the README's manual instructions would no longer describe what the button produces.
