# Brief 0005 — reference preset bundle: ship the system prompt as an importable SillyTavern preset
Status: implemented
Complexity: high
PLAN sections: §13 (continuation control is a separate, semantically boring, byte-identical message authorizing more manuscript; the intended reading is `[manuscript] + CONTINUE`, not submit→judge→installment — this is why the continuation string is *not* preset material)
Invariants touched: INV-5 (the continuation seam is a reconstructed turn, not a preset field), INV-9 / `docs/protocol/invariants.md#enforcement-model` (all semantic grammar is carried by prompt text, so the delivery vehicle for that text is protocol-relevant)

## Goal
The repository ships a checked-in, human-readable SillyTavern preset bundle under `presets/` whose main prompt is byte-identical to `MANUSCRIPT_SYSTEM_PROMPT` from `src/prompt.js` (brief 0003), together with a generator (`tools/build-preset.mjs`, `npm run build:preset`) that produces those files from the constant and a test that fails if the committed files drift from it. A user — the author or anyone tinkering with the protocol — can download the JSON from the repository and import it through SillyTavern's ordinary preset-import UI; the preset carries the prompt's literary register, and the extension does not need to be running for the preset to be useful. No extension code, no UI, and no runtime SillyTavern call is added by this brief.

## In scope
- Create `presets/Manuscript Protocol.json` — the chat-completion (`apiId: openai`) preset. **The filename is the preset name**: openai import strips the extension and ignores any top-level `name` field (`docs/api/sillytavern.md#preset-openai-import-route`), so the file is named with the exact display name wanted in the dropdown, spaces included, and the generator does **not** emit a top-level `name`.
- The generator's openai template is exactly this and nothing more (every key traced below; no sampler values, no connection settings, no other prompt entries):
  ```json
  {
    "prompts": [
      { "identifier": "main", "name": "Main Prompt", "role": "system", "system_prompt": true, "content": "<MANUSCRIPT_SYSTEM_PROMPT>" }
    ],
    "prompt_order": [
      {
        "character_id": 100001,
        "order": [
          { "identifier": "main", "enabled": true },
          { "identifier": "worldInfoBefore", "enabled": true },
          { "identifier": "personaDescription", "enabled": true },
          { "identifier": "charDescription", "enabled": true },
          { "identifier": "charPersonality", "enabled": true },
          { "identifier": "scenario", "enabled": true },
          { "identifier": "enhanceDefinitions", "enabled": false },
          { "identifier": "nsfw", "enabled": true },
          { "identifier": "worldInfoAfter", "enabled": true },
          { "identifier": "dialogueExamples", "enabled": true },
          { "identifier": "chatHistory", "enabled": true },
          { "identifier": "jailbreak", "enabled": true }
        ]
      }
    ]
  }
  ```
  Justification: no key is required at apply time — `onSettingsPresetChange` applies each key only `if (preset[key] !== undefined)` and skips the rest, so a minimal file imports and applies cleanly while leaving the user's other settings untouched (`#preset-openai-minimal-fields`). The `prompts[]` entry fields are the verified minimum for a plain text prompt (`#preset-openai-prompt-entry-shape`). `character_id` **must** be `100001`, the live openai `promptManagerModule` `dummyId`; a preset shipping only `100000` imports without error and renders an empty prompt order (same anchor).
  - `prompts[]` contains **only** the `main` entry. The marker prompt objects (`chatHistory`, `dialogueExamples`, …) are auto-filled from `chatCompletionDefaultPrompts` by `checkForMissingPrompts`; do not ship them (`#preset-openai-prompt-order-markers`).
  - The full default `order` sequence above is emitted even though omitting an identifier would not disable it (a missing order entry counts as enabled, same anchor): the shipped preset states stock semantics explicitly, so a user reading or tinkering with the file sees exactly what will be sent. The sequence and the single `enhanceDefinitions: false` flag are Default.json's `character_id: 100001` order verbatim.
- Create `presets/manuscript-protocol.sysprompt.json` — a system-prompt template for the text-completion path, shape `{ name: "Manuscript Protocol", content: <MANUSCRIPT_SYSTEM_PROMPT> }`. Here the name *is* read from `data.name` by the master-import route, so the filename is free.
  **Recommendation, justified:** ship it. Its shape is fully verified (`isPossiblySystemPromptData` checks `name` + `content`, `#preset-master-import`), it is two fields generated from the same constant, and it gives text-completion users the identical register without a second brief; it adds no unverified surface.
- Create `tools/build-preset.mjs`: exports a pure `buildPresets()` returning `{ '<filename>': <object> }` built from the imported constant plus a module-local frozen `TEMPLATE` object, and, when run as the entry module, writes each file to `presets/` with `JSON.stringify(obj, null, 2) + '\n'`. No CLI flags, no arguments, no network, no `node_modules` additions.
- Add exactly one line to `package.json` `scripts`: `"build:preset": "node tools/build-preset.mjs"`. Do not change any other script, dependency, or field.
- Create `tests/preset.test.js` (vitest): compares each committed file in `presets/` against `buildPresets()` by deep equality (the staleness test) and asserts the properties under Acceptance.
- Create `docs/modules/preset.md` with the header shape from `docs/modules/README.md` and one heading per pointer comment written in `tools/build-preset.mjs`.
- Create `README.md` with a section **"Import the reference preset"**. Required wording for the chat-completion steps (labels verified, `#preset-openai-import-ui-path`):
  > Open **AI Response Configuration**, find the **Chat Completion Presets** section, click **Import preset** (the file-import button next to the preset dropdown) and choose `presets/Manuscript Protocol.json`. The preset appears in the dropdown under the file's name. The extension does not need to be installed for the preset to work.

  Plus one line for `presets/manuscript-protocol.sysprompt.json`: it is a system-prompt template for the text-completion path, imported through the AI Response Formatting import control, and takes its name from inside the file.

## Out of scope (explicit)
- **`CONTINUATION_CONTROL` must not appear in any preset file, in any form.** It is not a preset field, not a jailbreak/last-output-prefix entry, and not a prompt-manager entry. Per PLAN §13 and `docs/protocol/host-mapping.md#s13-continuation` it is a reconstructed **user turn at the active edge**, emitted by the `frontier`/`continuation` modules on every request; putting it in the preset would give it a second, non-byte-identical source and break INV-5. The generator must not import it and the test must assert it is absent from every generated file.
- The one-click "Install reference preset" button and any call to `getPresetManager('openai').savePreset(...)`. That is **brief 0006**, deliberately separated so UI work cannot block this one.
- Any runtime code: no `index.js` change, no `manifest.json` change, no event subscription, no `setExtensionPrompt`, no slash command, no `/preset` switching.
- Any settings, toggle, or configurability; any second preset variant (per-model, "lite", "strict"); any per-character or per-chat preset.
- Sampler values, `temperature`, token limits, streaming/connection keys, or any other `settingsToUpdate` key beyond `prompts` and `prompt_order`. Adding them would silently overwrite the user's own settings on import for no protocol benefit (`#preset-openai-minimal-fields`).
- Shipping marker prompt objects in `prompts[]`, editing the default order sequence, reordering it to suit the protocol, or disabling any entry other than the stock `enhanceDefinitions: false`.
- A `character_id: 100000` compatibility entry, or any second `prompt_order` entry.
- Editing, rewording, wrapping, or appending to `MANUSCRIPT_SYSTEM_PROMPT`. The preset carries the register by carrying that text verbatim — no extra "style", "tone", or "author note" prose is added anywhere in the preset.
- Context-template (`story_string`) and instruct-template files. Not needed to carry the prompt text; a later brief may add them if a text-completion user needs them.
- Touching `src/prompt.js` (owned by brief 0003, in flight), or reading it for the purpose of copying its text into JSON by hand.
- New dependencies; changes to `eslint.config.js`, `vitest.config.js`, or any `package.json` field other than the one script line.

## Files
- allowed to create/modify: `presets/Manuscript Protocol.json`, `presets/manuscript-protocol.sysprompt.json`, `tools/build-preset.mjs`, `tests/preset.test.js`, `docs/modules/preset.md`, `README.md`, `package.json` (the single `build:preset` script line only), and this brief's Status line
- must not touch: `src/*` (incl. `src/prompt.js`), `index.js`, `manifest.json`, `style.css`, `PLAN.txt`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, other `docs/briefs/*`, `tools/check-comments.mjs`, `tools/check-docs.mjs`, `eslint.config.js`, `vitest.config.js`

## ST APIs used
- Preset storage and payload shape (`prompts`, `prompt_order`; `openai` folder) — docs/api/sillytavern.md#preset-storage (status: verified)
- openai import route; filename becomes the preset name, top-level `name` ignored — docs/api/sillytavern.md#preset-openai-import-route (status: verified-negative on `performMasterImport`, verified on the `#import_oai_preset` route)
- Every `settingsToUpdate` key optional at apply time — docs/api/sillytavern.md#preset-openai-minimal-fields (status: verified)
- `prompts[]` main-entry fields and `prompt_order` shape; `character_id` sentinel 100001 — docs/api/sillytavern.md#preset-openai-prompt-entry-shape (status: verified)
- Marker auto-fill and the Default.json order sequence — docs/api/sillytavern.md#preset-openai-prompt-order-markers (status: verified-negative on suppression; the order sequence is verified)
- Import UI labels ("AI Response Configuration" → "Chat Completion Presets" → "Import preset") — docs/api/sillytavern.md#preset-openai-import-ui-path (status: verified)
- sysprompt auto-detection (`name` + `content`) and naming from `data.name` — docs/api/sillytavern.md#preset-master-import (status: verified)
- No API is *called* by this brief's code; the generator and tests run in Node with no SillyTavern present.

## Verification needed
- (empty — all items resolved.)

## Acceptance
- [x] `npm run build:preset` is idempotent: running it twice in a row leaves the working tree unchanged.
- [x] Every file in `presets/` parses as JSON and is 2-space-indented with a single trailing newline.
- [x] `presets/Manuscript Protocol.json` contains `MANUSCRIPT_SYSTEM_PROMPT` verbatim as the `content` of exactly one `prompts[]` entry, and `prompts` has length 1 with that entry equal to `{identifier:"main", name:"Main Prompt", role:"system", system_prompt:true, content}`.
- [x] `prompt_order` has exactly one element and `prompt_order[0].character_id === 100001` (strictly the number, not the string).
- [x] `prompt_order[0].order.map(e => e.identifier)` deep-equals exactly `["main","worldInfoBefore","personaDescription","charDescription","charPersonality","scenario","enhanceDefinitions","nsfw","worldInfoAfter","dialogueExamples","chatHistory","jailbreak"]`, and every entry has `enabled === true` except `enhanceDefinitions`, which has `enabled === false`.
- [x] `presets/Manuscript Protocol.json` has no top-level `name` key and no key other than `prompts` and `prompt_order` (assert the top-level key set exactly).
- [x] The openai file's basename without extension equals the intended preset name, and `README.md` names that same string.
- [x] `presets/manuscript-protocol.sysprompt.json` deep-equals `{ name: "Manuscript Protocol", content: MANUSCRIPT_SYSTEM_PROMPT }`.
- [x] Staleness test: `tests/preset.test.js` deep-equals each committed `presets/*.json` against the corresponding `buildPresets()` output and fails if the constant is edited without regenerating.
- [x] No generated file contains `CONTINUATION_CONTROL`'s text or any substring of it; `tools/build-preset.mjs` does not import `CONTINUATION_CONTROL`.
- [x] `tools/build-preset.mjs` writes no file when imported (write happens only under the entry-module guard), so the test can import it safely.
- [x] `README.md` contains a section titled "Import the reference preset" with the three verified UI labels above and both filenames.
- [x] `package.json` differs from its previous contents by exactly the one `build:preset` script line.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/preset.md#single-source-of-truth` — why the JSON is generated, never hand-edited; what the staleness test guarantees; the exact command to regenerate after `src/prompt.js` changes.
- `docs/modules/preset.md#why-a-preset` — why delivery is a downloadable reference preset rather than a runtime injection: the register lives in the prompt text, and a preset is inspectable and tinkerable by the user and other authors (user decision, 2026-09-12); programmatic install is deferred to brief 0006.
- `docs/modules/preset.md#not-the-continuation-string` — that `CONTINUATION_CONTROL` is deliberately absent, because it is the reconstructed user turn at the active edge (PLAN §13, `docs/protocol/host-mapping.md#s13-continuation`, INV-5) and must have exactly one byte-identical source in `frontier`/`continuation`.
- `docs/modules/preset.md#template-fields` — each shipped key traced to its `docs/api/sillytavern.md` anchor; why nothing else is shipped (missing keys are skipped, extra keys would overwrite the user's settings); why `character_id` is `100001` and what breaks if it is `100000`.
- `docs/modules/preset.md#default-order-and-markers` — why the full stock order is written out although omission would not disable anything, and why the marker prompt objects are left to ST's auto-fill (`#preset-openai-prompt-order-markers`).
- `docs/modules/preset.md#filename-is-the-preset-name` — the openai import route takes the name from the filename and ignores top-level `name`, so renaming the file renames the preset; the sysprompt file is the opposite case.
- `README.md#import-the-reference-preset` — the verified UI steps and the note that the extension need not be installed to use the preset.
