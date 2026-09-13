# Brief 0023 — Optional §22 "take stock" prompt entry, shipped disabled
Status: done
Complexity: high
PLAN sections: §22 (reasoning should reconstruct current fictional state — who is where, what each knows, active motives, earlier causes still propagating, unresolved consequences, who has reason to act — and propagate forward from causes, not backward from a desired outcome); §13 (continuation control is a reconstructed user turn, byte-identical, not preset material — this brief must not disturb it)
Invariants touched: INV-5 (the continuation seam must stay the last thing in the request and stay byte-identical), INV-9 (semantics live in prompt text, not code)

## Goal
The reference chat-completion preset carries a second `prompts[]` entry, `uidTakeStock`, holding one pinned paragraph that asks for PLAN §22's state-reconstruction-then-forward-propagation, written in the user's prompt register with no mechanics vocabulary. It is standing guidance placed immediately after `main`, and it ships **disabled**, so importing the preset changes nothing until the user enables it in the prompt manager; it exists as the heavier-handed alternative to the light touch of the system prompt alone (user decision, 2026-09-13: "it is an option to change for sure, the thinking. I think it is a more, stronger prompt mode compared to the lighter hand."). The text lives as a constant in `src/prompt.js` and reaches `presets/` only through `buildPresets()`, so there is exactly one source for it.

## In scope
- `src/prompt.js`: add `export const TAKE_STOCK_PROMPT` — a single string, exactly these bytes:

  > Before the next stretch, take stock of the room: who is where, what each of them knows and does not know, what is still in motion from earlier, and who has a reason to move now. Let what comes next grow out of that, not out of where the story ought to end up.

  Do not reword during implementation. A user-requested change goes through the pinned-string lane (`docs/workflow/workflow.md#pinned-string-lane`) as an amendment to this brief. The constant gets one pointer comment (`// take-stock: … → docs/modules/prompt.md#take-stock`).
- `tests/prompt.test.js`: byte-for-byte expectation for `TAKE_STOCK_PROMPT`; run the **same** forbidden-word lists the system prompt uses against it (lift the existing `WHOLE_WORDS` and `SUBSTRINGS` arrays into shared consts in that file and apply both to both texts — no new list, no new words, and no `continue` exemption for this text); assert it names no character, contains no `{{`, is a single line, and equals its own `trim()`; update the "exports exactly three constants" assertion to four.
- `src/preset-template.js`: import `TAKE_STOCK_PROMPT` and add a second `prompts[]` entry — exactly `{ identifier: 'uidTakeStock', name: 'Take stock (thinking models)', role: 'system', content: TAKE_STOCK_PROMPT }`. That four-field set is the verified minimum (`docs/api/sillytavern.md#preset-custom-entry`); add no other field — leaving `injection_position` unset is what keeps the entry relative, i.e. ordered by `prompt_order`.
- `src/preset-template.js`: insert `{ identifier: 'uidTakeStock', enabled: false }` into `order` **immediately after `main`**, giving `main, uidTakeStock, worldInfoBefore, personaDescription, charDescription, charPersonality, scenario, enhanceDefinitions, nsfw, worldInfoAfter, dialogueExamples, chatHistory, jailbreak`. Rationale to record in the docs: a relative entry ranked after `chatHistory` lands after **all** history messages including the injected continuation user turn, which would both displace the continuation seam from the edge (INV-5) and leave the transcript ending on a system-role message, which breaks backends that require a trailing user turn (same anchor). This text is standing guidance, not an edge instruction, so it sits with `main`.
- Regenerate `presets/` with `npm run build:preset`. No hand edits to JSON.
- `tests/preset.test.js`: the openai preset has exactly two `prompts[]` entries, the second being the four-field `uidTakeStock` entry with `content === TAKE_STOCK_PROMPT` and `role === 'system'`; `order` has 13 identifiers in the sequence above; `uidTakeStock` is at index 1 (immediately after `main`) with `enabled: false`; `enhanceDefinitions` is the only other disabled entry and every other entry is `enabled: true`; deep-equality and 2-space/trailing-newline assertions still pass; `CONTINUATION_CONTROL` still appears in no generated file and is imported by neither the generator nor the template.
- `tests/ui-settings.test.js`: touch **only** if the byte-identity assertion needs the new entry; it currently compares `buildPresets()` output against the committed file generically, so no change is expected.
- `README.md`: one sentence under `## Import the reference preset` saying the preset carries a disabled "Take stock (thinking models)" entry for reasoning-capable models and that it is turned on by enabling that entry in the prompt manager's prompt list.
- `docs/modules/prompt.md`: new `## Take stock {#take-stock}` heading — what §22 asks for, why this is a separate opt-in text rather than a paragraph in `MANUSCRIPT_SYSTEM_PROMPT`, why it ships disabled, why it sits after `main` and never after `chatHistory`, that the same forbidden-word lists bind it, and that it is a pinned string.
- `docs/modules/prompt.md#says-nothing-of-mechanics`: scope the existing sentence ("no instruction about how to spend reasoning. §22's forward-propagating causality is demonstrated by the seed, not asserted by a paragraph") to `MANUSCRIPT_SYSTEM_PROMPT`, the always-on text, and cross-link `#take-stock` as the opt-in exception. Brief 0003's ruling is narrowed, not reversed: the always-on text still says nothing about reasoning.
- `docs/modules/preset.md#template-fields`: the preset now ships two `prompts[]` entries and a 13-entry order; record the four-field custom-entry shape with its API anchor, the placement rationale above, and why the entry is explicitly disabled rather than omitted.

## Out of scope (explicit)
- Any settings toggle, drawer control, or extension code that enables/disables the entry. Enabling is the user's action in SillyTavern's own prompt manager; the extension never touches it.
- Any runtime injection of `TAKE_STOCK_PROMPT` — no `setExtensionPrompt`, no frontier/continuation involvement, no per-request assembly. It is preset material only, and the continuation control remains the opposite case (`docs/modules/preset.md#not-the-continuation-string`).
- `injection_position` / `injection_depth` / `system_prompt` / `marker` / `forbid_overrides` on the new entry, and any attempt to place it near the active edge.
- Adding the text to `manuscript-protocol.sysprompt.json` or any text-completion path.
- Changing `MANUSCRIPT_SYSTEM_PROMPT`, `CONTINUATION_CONTROL`, or `SOLO_CONTINUATION_CONTROL` by one byte.
- Reasoning-effort, thinking-budget, or any sampler/connection key in the preset.
- A second variant, a shorter variant, or making the wording depend on anything.
- Editing `presets/*.json` by hand, or changing the generator's write loop.

## Files
- allowed to create/modify: `src/prompt.js`, `src/preset-template.js`, `presets/*.json` (regenerated only), `tests/prompt.test.js`, `tests/preset.test.js`, `tests/ui-settings.test.js` (only if the byte-identity assertion breaks), `docs/modules/prompt.md`, `docs/modules/preset.md`, `README.md`
- must not touch: `tools/build-preset.mjs`, `index.js`, `src/ui/`, `src/frontier.js`, `src/continuation*`, `src/solo.js`, everything else under `src/`, `docs/protocol/`, `docs/api/sillytavern.md`

## ST APIs used
- Custom prompt-manager entry: minimal `{identifier, name, role, content}`, unset `injection_position` = relative, placement after `chatHistory` trails the whole history, `enabled:false` keeps it out of the request but toggleable — docs/api/sillytavern.md#preset-custom-entry (status: verified)
- prompts[] entry shape and prompt_order shape; live `character_id` sentinel 100001 — docs/api/sillytavern.md#preset-openai-prompt-entry-shape (status: verified)
- Omitting a marker from prompt_order does not omit it; only explicit `enabled: false` suppresses — docs/api/sillytavern.md#preset-openai-prompt-order-markers (status: verified-negative)
- Minimal openai preset fields are optional at apply time — docs/api/sillytavern.md#preset-openai-minimal-fields (status: verified)
- Openai import route names the preset from the filename — docs/api/sillytavern.md#preset-openai-import-route (status: verified)

## Verification needed
- (empty)

## Acceptance
- [x] `TAKE_STOCK_PROMPT` matches the pinned text byte-for-byte in `src/prompt.js` and in every generated preset file.
- [x] `TAKE_STOCK_PROMPT` passes the same whole-word and substring forbidden lists as `MANUSCRIPT_SYSTEM_PROMPT`, with no exemption.
- [x] `buildPresets()['Manuscript Protocol.json'].prompts` has exactly two entries; the second is `{identifier:'uidTakeStock', name:'Take stock (thinking models)', role:'system', content: TAKE_STOCK_PROMPT}` and nothing more.
- [x] `prompt_order[0].order` has 13 entries; `order[1]` is `uidTakeStock` with `enabled: false`; `enhanceDefinitions` is the only other disabled entry; `chatHistory` and `jailbreak` keep their stock trailing positions.
- [x] Committed `presets/*.json` are byte-identical to the generator output (existing deep-equal and serialise-twice tests still pass).
- [x] `CONTINUATION_CONTROL` still appears in no generated file, in whole or by sentence, and is imported by neither the generator nor the template.
- [x] `README.md` states the entry exists, is off by default, and is enabled in the prompt manager.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- docs/modules/prompt.md#take-stock — what §22 asks of reasoning; why an opt-in second text instead of a paragraph in the always-on prompt; why disabled by default; why it is ranked after `main` and must never trail `chatHistory` (INV-5 and the trailing-user-turn requirement); the shared forbidden-word lists; pinned-string status and the lane for rewording.
- docs/modules/prompt.md#says-nothing-of-mechanics — narrow the reasoning sentence to the always-on system prompt and link `#take-stock`.
- docs/modules/preset.md#template-fields — two `prompts[]` entries, the four-field custom-entry shape with its API anchor, the 13-entry order, the placement rationale, and why the new entry is explicitly disabled (omission would not disable it).
