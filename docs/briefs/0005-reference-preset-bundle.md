# Brief 0005 — reference preset bundle: ship the system prompt as an importable SillyTavern preset
Status: draft (blocked — see Verification needed)
Complexity: high
PLAN sections: §13 (continuation control is a separate, semantically boring, byte-identical message authorizing more manuscript; the intended reading is `[manuscript] + CONTINUE`, not submit→judge→installment — this is why the continuation string is *not* preset material)
Invariants touched: INV-5 (the continuation seam is a reconstructed turn, not a preset field), INV-9 / `docs/protocol/invariants.md#enforcement-model` (all semantic grammar is carried by prompt text, so the delivery vehicle for that text is protocol-relevant)

## Goal
The repository ships a checked-in, human-readable SillyTavern preset bundle under `presets/` whose main prompt is byte-identical to `MANUSCRIPT_SYSTEM_PROMPT` from `src/prompt.js` (brief 0003), together with a generator (`tools/build-preset.mjs`, `npm run build:preset`) that produces those files from the constant and a test that fails if the committed files drift from it. A user — the author or anyone tinkering with the protocol — can download the JSON from the repository and import it through SillyTavern's ordinary preset-import UI; the preset carries the prompt's literary register, and the extension does not need to be running for the preset to be useful. No extension code, no UI, and no runtime SillyTavern call is added by this brief.

## In scope
- Create `presets/manuscript-protocol.openai.json` — a chat-completion (`apiId: openai`) preset object. Its `prompts` array carries one entry whose content is exactly `MANUSCRIPT_SYSTEM_PROMPT`, and `prompt_order` is an array of `{character_id, order: [{identifier, enabled}]}` enabling that entry (field names per `docs/api/sillytavern.md#preset-storage`). Every other field comes from the generator's checked-in template object: minimal, SillyTavern defaults where the default is known, nothing invented. Exact entry fields and the required top-level field set are **blocked on V2/V3 below.**
- Create `presets/manuscript-protocol.sysprompt.json` — a system-prompt template for the text-completion path, shape `{name, content}` with `content` exactly `MANUSCRIPT_SYSTEM_PROMPT`.
  **Recommendation, justified:** ship it. Its shape is fully verified (`isPossiblySystemPromptData` checks `name` + `content`, `docs/api/sillytavern.md#preset-master-import`), it is two fields generated from the same constant, and it gives text-completion users the identical register without a second brief; it adds no unverified surface.
- Create `tools/build-preset.mjs`: exports a pure `buildPresets()` returning `{ '<filename>': <object> }` built from the imported constant plus a module-local frozen `TEMPLATE` object, and, when run as the entry module, writes each file to `presets/` with `JSON.stringify(obj, null, 2) + '\n'`. No CLI flags, no arguments, no network, no `node_modules` additions.
- Add exactly one line to `package.json` `scripts`: `"build:preset": "node tools/build-preset.mjs"`. Do not change any other script, dependency, or field.
- Create `tests/preset.test.js` (vitest): compares each committed file in `presets/` against `buildPresets()` by deep equality (the staleness test) and asserts the constant appears verbatim at the documented location in each file.
- Create `docs/modules/preset.md` with the header shape from `docs/modules/README.md` and one heading per pointer comment written in `tools/build-preset.mjs`.
- Create `README.md` with a section **"Import the reference preset"** giving the manual import steps at the level the evidence supports (`docs/api/sillytavern.md#preset-third-party-prior-art`: open SillyTavern, go to AI Response Configuration, use the preset import control, select the downloaded JSON), and stating that the import is manual and the extension need not be installed.

## Out of scope (explicit)
- **`CONTINUATION_CONTROL` must not appear in any preset file, in any form.** It is not a preset field, not a jailbreak/last-output-prefix entry, and not a prompt-manager entry. Per PLAN §13 and `docs/protocol/host-mapping.md#s13-continuation` it is a reconstructed **user turn at the active edge**, emitted by the `frontier`/`continuation` modules on every request; putting it in the preset would give it a second, non-byte-identical source and break INV-5. The generator must not import it and the test must assert it is absent from every generated file.
- The one-click "Install reference preset" button and any call to `getPresetManager('openai').savePreset(...)`. That is **brief 0006**, deliberately separated so UI work cannot block this one.
- Any runtime code: no `index.js` change, no `manifest.json` change, no event subscription, no `setExtensionPrompt`, no slash command, no `/preset` switching.
- Any settings, toggle, or configurability; any second preset variant (per-model, "lite", "strict"); any per-character or per-chat preset.
- Editing, rewording, wrapping, or appending to `MANUSCRIPT_SYSTEM_PROMPT`. The preset carries the register by carrying that text verbatim — no extra "style", "tone", or "author note" prose is added anywhere in the preset.
- Context-template (`story_string`) and instruct-template files. Not needed to carry the prompt text; a later brief may add them if a text-completion user needs them.
- Sampler tuning as a deliverable: the generator's template holds whatever minimal values are required for a valid file, never values chosen to "improve output".
- Touching `src/prompt.js` (owned by brief 0003, in flight), or reading it for the purpose of copying its text into JSON by hand.
- New dependencies; changes to `eslint.config.js`, `vitest.config.js`, or any `package.json` field other than the one script line.

## Files
- allowed to create/modify: `presets/manuscript-protocol.openai.json`, `presets/manuscript-protocol.sysprompt.json`, `tools/build-preset.mjs`, `tests/preset.test.js`, `docs/modules/preset.md`, `README.md`, `package.json` (the single `build:preset` script line only), and this brief's Status line
- must not touch: `src/*` (incl. `src/prompt.js`), `index.js`, `manifest.json`, `style.css`, `PLAN.txt`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, other `docs/briefs/*`, `tools/check-comments.mjs`, `tools/check-docs.mjs`, `eslint.config.js`, `vitest.config.js`

## ST APIs used
- Preset storage and payload shape (`prompts`, `prompt_order` field names; `openai` preset folder) — docs/api/sillytavern.md#preset-storage (status: verified)
- Master import / auto-detection of preset type (`isPossiblySystemPromptData` = `name` + `content`; drag-and-drop/file-picker import route) — docs/api/sillytavern.md#preset-master-import (status: verified)
- Third-party prior art for bundled-JSON manual import (source of the README's import steps) — docs/api/sillytavern.md#preset-third-party-prior-art (status: verified)
- No API is *called* by this brief's code; the generator and tests run in Node with no SillyTavern present.

## Verification needed
Implementation of `presets/manuscript-protocol.openai.json` may not begin until **V2 and V3** are answered by `st-api-verifier`. The sysprompt file, the generator skeleton, the test harness and the docs are unblocked.
- **V1** — How `PresetManager.performMasterImport` routes a **chat-completion (openai)** preset JSON. `#preset-master-import` enumerates instruct/context/sysprompt/text-completion/reasoning detectors but names no chat-completion detector or fallback branch; also needed: whether a top-level `name` field is required for the import to name the preset, and whether an openai preset can be misdetected as another kind by the existing predicates.
- **V2** — The minimal set of top-level fields an openai preset JSON must contain for ST to import **and then apply** it without error (which keys are read unconditionally when the preset is selected).
- **V3** — The exact field set of a single prompt entry inside `prompts` for a main/system prompt (e.g. `identifier`, `name`, `role`, `content`, `system_prompt`, `marker`, `injection_position`, `injection_depth`), and the exact `prompt_order` entry shape including which `character_id` value a shipped preset should use.
- **V4** — The literal SillyTavern UI label/path for importing a chat-completion preset in 1.18.0 (the README currently paraphrases a third-party README). If unanswered, the README section must use the paraphrase and say the label may differ by version.

## Acceptance
- [ ] `npm run build:preset` is idempotent: running it twice in a row leaves the working tree unchanged.
- [ ] Every file in `presets/` parses as JSON and is 2-space-indented with a single trailing newline.
- [ ] `presets/manuscript-protocol.openai.json` contains `MANUSCRIPT_SYSTEM_PROMPT` verbatim as the `content` of exactly one entry in `prompts`, and that entry's identifier appears exactly once in `prompt_order[].order` with `enabled: true`.
- [ ] `presets/manuscript-protocol.sysprompt.json` deep-equals `{ name: <preset name>, content: MANUSCRIPT_SYSTEM_PROMPT }`.
- [ ] Staleness test: `tests/preset.test.js` deep-equals each committed `presets/*.json` against the corresponding `buildPresets()` output and fails if the constant is edited without regenerating.
- [ ] No generated file contains `CONTINUATION_CONTROL`'s text or any substring of it; `tools/build-preset.mjs` does not import `CONTINUATION_CONTROL`.
- [ ] `tools/build-preset.mjs` writes no file when imported (write happens only under the entry-module guard), so the test can import it safely.
- [ ] `README.md` contains a section titled "Import the reference preset" naming both shipped files and stating the import is manual.
- [ ] `package.json` differs from its previous contents by exactly the one `build:preset` script line.
- [ ] `npm run check` passes.
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/preset.md#single-source-of-truth` — why the JSON is generated, never hand-edited; what the staleness test guarantees; the exact command to regenerate after `src/prompt.js` changes.
- `docs/modules/preset.md#why-a-preset` — why delivery is a downloadable reference preset rather than a runtime injection: the register lives in the prompt text, and a preset is inspectable and tinkerable by the user and other authors (user decision, 2026-09-12); programmatic install is deferred to brief 0006.
- `docs/modules/preset.md#not-the-continuation-string` — that `CONTINUATION_CONTROL` is deliberately absent, because it is the reconstructed user turn at the active edge (PLAN §13, `docs/protocol/host-mapping.md#s13-continuation`, INV-5) and must have exactly one byte-identical source in `frontier`/`continuation`.
- `docs/modules/preset.md#template-fields` — which template fields are required for import versus defaults carried for completeness, each traced to the `docs/api/sillytavern.md` anchor that verifies it; anything still unverified is named here rather than guessed.
- `README.md#import-the-reference-preset` — the manual import steps and the note that the extension need not be installed to use the preset.
