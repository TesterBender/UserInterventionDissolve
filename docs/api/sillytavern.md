# SillyTavern API inventory

The only place a SillyTavern API fact may be stated. Written only by the `st-api-verifier` agent. Code may rely only on entries marked `status: verified`.

Entry format:

```
### <name> {#anchor}
status: verified | verified-negative | absent | unverified
checked: <ST version> @ <commit> on <date>   (or "Intercede:<file>:<line>" for real-install evidence)
evidence: <path:line> — ≤3-line verbatim quote
notes: signature, payload shape, mutability, backend quirks, limits
```

Paths are relative to the checkout at `%TEMP%\st-src`. Current baseline: **ST 1.18.0 @ 8172dcd (release), checked 2026-09-12.**

## Presets and prompt delivery {#presets}

### Preset storage and payload shape {#preset-storage}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `src/endpoints/presets.js:14-36` — `getPresetSettingsByAPI` maps `apiId` → `{folder, extension}` for `kobold|novel|textgenerationwebui|openai|instruct|context|sysprompt|reasoning`; user files land in `data/<user>/OpenAI Settings/*.json` (openai), `data/<user>/context/*.json`, `data/<user>/instruct/*.json`, etc.
notes: OpenAI/chat-completion preset JSON is a flat object; the prompt-manager fields are `prompts` and `prompt_order` (confirmed live in `default/content/presets/openai/Default.json` — `prompt_order` is an array of `{character_id, order:[{identifier, enabled}]}`; `prompts` holds the actual prompt text objects incl. `main`/jailbreak/system-prompt-equivalent entries). Context template JSON carries `story_string` (Handlebars-style template) + formatting flags (`default/content/presets/context/Default.json`). Instruct template JSON carries `input_sequence`/`output_sequence`/`system_sequence`/etc. (`default/content/presets/instruct/Alpaca.json`).

### Default preset registration is core-only, not extension-usable {#preset-default-registration}
status: verified-negative
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `src/endpoints/content-manager.js:86-101` — `getDefaultPresets` reads `getContentIndex(CONTENT_SCOPE.USER)` (driven by `default/content/index.json`) and filters `type.endsWith('_preset')` or `type in [instruct, context, sysprompt, reasoning]`; files live under `default/content/presets/<kind>/*.json`.
notes: This is ST's own bundled-content seeding mechanism (first-run copy into user data dirs), gated by `default/content/index.json` inside the ST install itself. A third-party extension cannot add entries here — it ships in `public/scripts/extensions/third-party/<name>/`, not `default/content/`, so there is no programmatic "register as a default preset" hook for extensions.

### PresetManager exposed via getContext() {#preset-manager-context}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/st-context.js:92,286` — `import { getPresetManager } from './preset-manager.js';` … context object includes `getPresetManager`.
notes: `getPresetManager(apiId)` (`public/scripts/preset-manager.js:83-95`) returns a `PresetManager` keyed by `apiId` ∈ `instruct|context|sysprompt|textgenerationwebui|reasoning|openai|kobold|novel` (only if a `<select data-preset-manager-for="...">` for that apiId exists in the DOM — it is populated by `registerPresetManagers()` at startup, so all standard apiIds are present once ST has booted).

### Extension can programmatically save a preset {#preset-programmatic-save}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/preset-manager.js:466-486` — `async savePreset(name, settings, {skipUpdate}) { … const preset = settings ?? this.getPresetSettings(name); const response = await fetch('/api/presets/save', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ preset, name, apiId: this.apiId }) }); … this.updateList(name, preset); }`
notes: Server side `src/endpoints/presets.js:41-55` (`POST /api/presets/save`) sanitizes `name`, resolves folder/extension by `apiId`, and `writeFileAtomicSync`s the JSON — no schema validation, so any object is accepted. `getRequestHeaders()` (`public/scripts/utils.js:10` importer; defined `public/script.js`) attaches the CSRF token fetched from `/csrf-token` (`public/script.js:694`) as header `X-CSRF-Token` — required on all POSTs. An extension calling `getContext().getPresetManager('openai').savePreset('MyExtPreset', presetObject)` (or `('context')`/`('instruct')`) programmatically creates/overwrites a named preset file on disk and updates the `<select>` dropdown (`skipUpdate:false` path calls `updateList`), making it selectable like any user-saved preset. This is real preset creation, not just an injected system prompt.

### Master import / auto-detection of preset type {#preset-master-import}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/preset-manager.js:249-279` — `PresetManager.performMasterImport(data, fileName)` checks `isPossiblyInstructData` (`name`,`input_sequence`,`output_sequence`), `isPossiblyContextData` (`name`,`story_string`), `isPossiblySystemPromptData` (`name`,`content`), `isPossiblyTextCompletionData` (`temp`,`top_k`,`top_p`,`rep_pen`), `isPossiblyReasoningData`, and routes to the matching `getPresetManager(<kind>).savePreset(data.name, data)`.
notes: This is the code path behind ST's generic drag-and-drop/file-picker preset import (single "import" button auto-detects preset kind from JSON shape). An extension shipping a bundled preset JSON that matches one of these shapes will import correctly through the normal UI without any extra glue code — this is the lowest-friction "ship a JSON, user imports it" path.

### Slash commands for preset/template switching {#preset-slash-commands}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `/preset` — `public/scripts/preset-manager.js:988`; `/instruct` — `public/scripts/slash-commands.js:519`; `/context` — `public/scripts/slash-commands.js:610`; `/sysprompt` — `public/scripts/sysprompt.js:197`.
notes: All four exist and select-by-name (fuzzy match, `preset-manager.js:912-965`) among already-saved presets/templates — they do not import new ones. An extension can call these via `SlashCommandParser`/`executeSlashCommandsWithOptions` (exposed on context) to switch to a preset it just saved programmatically (see `#preset-programmatic-save`).

### Third-party extension prior art for prompt delivery {#preset-third-party-prior-art}
status: verified
checked: 2026-09-12 (GitHub, current default branches)
evidence: Samueras/Guided-Generations README (raw.githubusercontent.com) — `"Open SillyTavern, go to AI Response Configuartion … and import the GGSytemPrompt.json files."`; kaldigo/SillyTavern-Tracker `src/generation.js` — `generateRaw(requestPrompt, null, false, false, systemPrompt, responseLength)`; cierru/st-stepped-thinking README — per-character "Prompts for thinking" textarea list, no preset file.
notes: Guided-Generations (github.com/Samueras/Guided-Generations) ships a bundled `GGSytemPrompt.json` the user manually imports via the preset-import UI — the "ship a JSON, user imports it" path. SillyTavern-Tracker (github.com/kaldigo/SillyTavern-Tracker) does not touch presets at all — it builds a system prompt from its own settings/template and calls `generateRaw()` directly (extension-owned generation call, bypassing the main preset/prompt-manager pipeline entirely). st-stepped-thinking (github.com/cierru/st-stepped-thinking) uses a per-character settings textarea for user-authored "thinking" prompts, no preset JSON. None of the three examples found programmatically calls `/api/presets/save` — bundled-JSON-for-manual-import is the observed convention, even though the code path in `#preset-programmatic-save` would support programmatic creation.

## Access {#access}

### SillyTavern.getContext() {#getcontext}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:292-295` — `globalThis.SillyTavern = { libs, getContext }`; `public/scripts/st-context.js:114-307` defines the object.
notes: The extension uses only this global; never import ST modules (Intercede did the same on a real install: `Intercede:src/stcontext.js:9`). `chat`, `name1`, `name2`, `characterId`, `mainApi`, `onlineStatus`, `streamingProcessor` are captured **by value at call time** (`st-context.js:117-136`) — call `getContext()` fresh every time, never cache it.

### Context keys present {#context-keys}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/st-context.js` — line numbers per key below.
notes: `chat` 117 · `chatMetadata` 134 · `eventSource` 137 · `eventTypes` 138 (legacy alias `event_types` 222) · `generate` 142 (= `Generate`) · `generateRaw` 204 · `generateQuietPrompt` 203 · `stopGeneration` 145 · `saveChat` 154 (= `saveChatConditional`) · `saveMetadata` 157 · `saveMetadataDebounced` 135 · `saveSettingsDebounced` 131 · `extensionSettings` 200 · `setExtensionPrompt` 152 · `addOneMessage` 139 · `updateMessageBlock` 237 · `deleteMessage` 141 · `deleteLastMessage` 140 · `substituteParams` 162 · `mainApi` 199 · `onlineStatus` 132 · `streamingProcessor` 136 · `getTokenCountAsync` 150 (`getTokenCount` 149 deprecated) · `name1` 120 · `name2` 121 · `characterId` 122 · `groupId` 123 · `SlashCommandParser` 164 · `Popup` 223 · `callGenericPopup` 194 · `powerUserSettings` 228 · `chatCompletionSettings` 226 · `textCompletionSettings` 227 · `registerFunctionTool` 182 · `getRequestHeaders` 128.

### Context keys absent {#context-keys-absent}
status: absent
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:5815` exports `sendMessageAsUser` but `st-context.js` does not include it; no `isGenerating` export exists (`is_send_press` at `script.js:602` is not in context); the key is `chatMetadata`, not `chat_metadata`.
notes: Intercede treated `sendMessageAsUser` and `isGenerating` as optional and fell back (`Intercede:src/stcontext.js:123-134, 230`). Do not depend on them.

## Events {#events}

Emitter semantics — `public/lib/eventemitter.js:129-157`: `emit` is async and awaits listeners sequentially, swallowing listener errors to `console.error`. All events below are `await eventSource.emit(...)` unless noted.

### CHAT_COMPLETION_PROMPT_READY {#chat-completion-prompt-ready}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/openai.js:1607-1612` — `const chat = chatCompletion.getChat(); const eventData = { chat, dryRun }; await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, eventData); … return [chat, …]`
notes: Payload `{ chat, dryRun }`. `chat` is a fresh array of fresh message objects (`openai.js:4025-4037`). **In-place mutation (splice/push/edit) is honored; replacing `eventData.chat` is NOT** — the local `chat` is returned and becomes `generate_data.prompt` (`script.js:5244`) → `sendOpenAIRequest` (`script.js:6059, 6095`) → `generate_data.messages` (`openai.js:2744`). Second emit site in `generateRaw` (`script.js:3976-3980`) does honor replacement. Chat-completion API only.

### CHAT_COMPLETION_SETTINGS_READY {#chat-completion-settings-ready}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/openai.js:3052-3060` — `await eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, generate_data); … fetch('/api/backends/chat-completions/generate', { body: JSON.stringify(generate_data) })`
notes: Last hook before fetch. `generate_data` is the final request body: `messages`, `model`, `stream`, `max_tokens`, `stop` (`:2753`). Mutations to `stop` and `messages` here are sent as-is. `stop` is deleted if empty at `:2779-2781` (before this event, so re-adding is fine).

### TEXT_COMPLETION_SETTINGS_READY {#text-completion-settings-ready}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/textgen-settings.js:1844-1849` — `await eventSource.emit(event_types.TEXT_COMPLETION_SETTINGS_READY, params); return params;`
notes: Mutable text-completion request body; carries both `stopping_strings` and `stop` (`:1639-1640`).

### GENERATE_BEFORE_COMBINE_PROMPTS {#generate-before-combine-prompts}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:5175-5178` — emit with `data`; `return !data.combinedPrompt ? combine() : data.combinedPrompt;`
notes: Text-completion path only (`main_api !== 'openai'`). Setting `data.combinedPrompt` replaces the entire text prompt. `data` fields at `:5151-5172` (`storyString, mesExmString, mesSendString, finalMesSend, main, jailbreak, …`).

### GENERATE_AFTER_COMBINE_PROMPTS {#generate-after-combine-prompts}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:5183-5185` — `eventData = { prompt: finalPrompt, dryRun }; emit; finalPrompt = eventData.prompt;`
notes: Replacing `eventData.prompt` is honored. Also in `generateRaw` (`script.js:3970-3973`).

### GENERATE_AFTER_DATA {#generate-after-data}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:5259` — `await eventSource.emit(event_types.GENERATE_AFTER_DATA, generate_data, dryRun)`
notes: Fired for all APIs; `generate_data` mutable; for chat completion `generate_data.prompt` is the messages array (`:5244`). In `dryRun`, `Generate` returns right after this (`:5261-5263`) without sending.

### STREAM_TOKEN_RECEIVED {#stream-token-received}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:3836` — `await eventSource.emit(event_types.STREAM_TOKEN_RECEIVED, text)` inside `for await (const { text } of this.generator())`
notes: `text` is the **cumulative full text so far** (`openai.js:3071, 3088`; `script.js:3830 this.result = text`), a string, not mutable. Abort check at `:3826-3828` runs *before* this emit for the current chunk, so `stopGeneration()` called from a listener takes effect on the next chunk.

### GENERATION_STARTED / GENERATION_AFTER_COMMANDS {#generation-started}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:4240` and `:4262` — `emit(…, type, { automatic_trigger, force_name2, quiet_prompt, quietToLoud, skipWIAN, force_chid, signal, quietImage }, dryRun)`
notes: Same args for both; AFTER_COMMANDS fires after slash-command processing. Intercede observed that a composer slash command may emit STARTED without AFTER_COMMANDS or ENDED (`Intercede:docs/KNOWN-ISSUES.md:65-68`).

### GENERATION_STOPPED / GENERATION_ENDED {#generation-stopped}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:5559` — `eventSource.emit(event_types.GENERATION_STOPPED)` (no args, not awaited); `:3477` — `eventSource.emit(event_types.GENERATION_ENDED, chat.length)` inside `hideStopButton()` (not awaited).
notes: ENDED's payload is `chat.length`, not a type or reason. ST emits fewer ENDED than STARTED (`Intercede:docs/KNOWN-ISSUES.md:65-68`); never count on pairing.

### MESSAGE_SENT {#message-sent}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:5849-5859` — `chat.push(message); await saveChatConditional(); await eventSource.emit(event_types.MESSAGE_SENT, index); … addOneMessage(message)`
notes: Payload is the message index. Fires **after** the user message is already in `chat[]` and saved, before render. Also emitted by slash commands (`slash-commands.js:6057-6148`).

### MESSAGE_RECEIVED {#message-received}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:6632, 6657, 6679, 6722` — `emit(MESSAGE_RECEIVED, chat_id, type)`; streaming finish `:3740` — `emit(MESSAGE_RECEIVED, this.messageId, this.type)`.
notes: `(index, type)`. Streaming error path `:3769` emits without await. Type may be `'first_message'` (`:7646, :9856`) or `'command'` (`slash-commands.js:6005`); do not discard unknown types (`Intercede:docs/KNOWN-ISSUES.md:113`).

### MESSAGE_EDITED / MESSAGE_UPDATED / MESSAGE_DELETED / MESSAGE_SWIPED / CHAT_CHANGED / APP_READY {#message-lifecycle-events}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `script.js:8345` EDITED `(id)` then `:8371` UPDATED `(id)`; DELETED `:1609, 1672, 4352, 11672` with `chat.length` (new length, not the deleted index); SWIPED `:10255` `(mesId)`; CHAT_CHANGED `:1696, 7641, 10700, 10853` and `group-chats.js:318` with `getCurrentChatId()`; APP_READY `:788`, auto-fires for late subscribers (`events.js:113`).
notes: —

### Pre-send transform/cancel hook {#pre-send-hook}
status: absent
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:4341-4342` textarea read and cleared; `:4394` `sendMessageAsUser(textareaText, messageBias)`; no event carries the text with a mutable or cancel argument.
notes: No event lets an extension rewrite or cancel the user's text before it becomes a chat message. `generate_interceptor` runs at `:4505`, after the push at `:4394`. Consequence for §9: capture must either use its own input surface or accept the message into `chat[]` and remove it at prompt-build time (see `docs/protocol/host-mapping.md#s9-capture`).

## Generation control {#generation-control}

### generate_interceptor (manifest key) {#generate-interceptor}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/extensions.js:2015-2040` — `runGenerationInterceptors(chat, contextSize, type)`; `await globalThis[interceptorKey](chat, contextSize, abort, type)` (`:2028`); `public/script.js:4503-4514` — `if (!dryRun) { const aborted = await runGenerationInterceptors(coreChat, this_max_context, type); if (aborted) { unblockGeneration(type); return; } }`
notes: Manifest `"generate_interceptor": "<globalFunctionName>"`; called in `loading_order` (`:49`). `chat` is `coreChat` — new objects built from `chat.filter(x => !x.is_system || …)` (`:4437-4442`) — so mutating it (splice/push/edit `mes`) changes **only the current request** for both chat- and text-completion paths, never stored history. `abort(true)` cancels the generation. **Skipped in dryRun** (token-count preview) — the prompt-ready events must apply the same reconstruction so dry runs reflect reality.

### Stop strings — chat completion {#stop-chat-completion}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/openai.js:2753` — `'stop': getCustomStoppingStrings(openai_max_stop_strings)` with `openai_max_stop_strings = 4` (`:142`); `:2814` — `generate_data.stop = getCustomStoppingStrings(); // Claude shouldn't have limits`; server `src/endpoints/backends/chat-completions.js:243-253` copies `request.body.stop` → `stop_sequences` (Claude, no cap); generic handler `:2522-2524` `bodyParams['stop'] = request.body.stop` (no cap).
notes: Programmatic path: set `generate_data.stop` in CHAT_COMPLETION_SETTINGS_READY (runs after the 4-cap and after the empty-delete at `:2779-2781`). `stop` is deleted for GPT vision models (`:2802-2806`) — re-adding in the event still sends it. Provider-side limits (e.g. OpenAI's 4) are enforced by the provider, not ST.

### Stop strings — text completion {#stop-text-completion}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/textgen-settings.js:1639-1640` — `stopping_strings` and `stop` both = `getStoppingStrings(…)`; server `src/endpoints/backends/text-completions.js:357` — only for `GENERIC` api_type: `request.body.stop = request.body.stop.slice(0, 4)`.
notes: Mutate both fields in TEXT_COMPLETION_SETTINGS_READY. `getStoppingStrings` (`script.js:2966-3006`) adds names/instruct sequences for non-openai APIs; ephemeral strings exist but are module-private (`power-user.js:3005-3025`).

### Provider stop/finish reason {#finish-reason}
status: absent
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `grep finish_reason|stop_reason|finishReason|stopReason` over `public/script.js`, `public/scripts/**`, `src/` → zero hits.
notes: ST never surfaces why a generation ended. §14 outcome classification (boundary hit / natural completion / max-output) must be inferred from the text itself: ends exactly at the reserved tag ⇒ boundary; trailing incomplete block ⇒ treat as max-output/abnormal and roll back (INV-8).

### stopGeneration and partial text {#stopgeneration}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:5548-5561` — `streamingProcessor.onStopStreaming()` (`:3788-3791`: `abortController.abort(); isFinished = true`), emits GENERATION_STOPPED; `:5349` `isStreamFinished = !isStopped && isFinished` → `:5380-5382` `onFinishStreaming` → `:3756` `saveChatConditional()`, `:3740` MESSAGE_RECEIVED.
notes: A stop from a STREAM_TOKEN_RECEIVED listener **keeps the partial text as the message** (`isStopped` is only set by the error path `:3763`). Text received in the chunk that contained the reserved tag is included, so the tag must be trimmed from the message afterwards. `generateRaw` aborts via its own controller on GENERATION_STOPPED (`:3956-3959, 3983`).

### Generation type strings {#generation-types}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:4249, 4341, 4380-4386, 5376` — `'normal' | 'continue' | 'regenerate' | 'swipe' | 'quiet' | 'impersonate'`; `saveReply` also handles `'append'`, `'appendFinal'` (`:6587`).
notes: `noAttachTypes` list at `:4381-4387`.

### Chat-completion body assembly and dryRun {#body-assembly}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/openai.js:3043` `sendOpenAIRequest(type, messages, signal, { jsonSchema })`; `:2742-2766` builds `generate_data` (`messages` at `:2744`); prompt manager `:1597-1604`, `squash_system_messages` applied only when `dryRun == false` (`:1599`).
notes: Hook order for chat completion: `generate_interceptor` (skipped in dryRun) → CHAT_COMPLETION_PROMPT_READY → GENERATE_AFTER_DATA → [dryRun returns] → CHAT_COMPLETION_SETTINGS_READY → fetch.

## Data {#data}

### Message object shape {#message-shape}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: user `public/script.js:5818-5827` — `{ name, is_user: true, is_system: false, send_date: getMessageTimeStamp(), mes, extra: { isSmallSys } }`; assistant `:6684-6694` — `extra: {}`, `name: name2`, `is_user: false`, `extra.api/model/reasoning/reasoning_duration/reasoning_signature`; `swipes = []`, `swipe_info = []` (`:6729, 6742`), `swipe_id` (`:6610-6612`); `swipe_info[i] = { send_date, gen_started, gen_finished, extra }` (`:3707-3712`).
notes: Prompt exclusion is `chat.filter(x => !x.is_system || (canUseTools && Array.isArray(x.extra?.tool_invocations)))` (`:4437`). No `extra.type` filtering on that path. When editing an assistant message in place, also set `message.swipes[message.swipe_id]` (`Intercede:src/transaction.js:454-458`).

### Per-chat persistence {#chat-metadata}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12; Intercede real-install
evidence: `st-context.js:134, 157` `chatMetadata`, `saveMetadata`; `Intercede:src/stcontext.js:63-69` saves chat then metadata once each.
notes: Namespace under one key (`chatMetadata.<ext>`). Large payloads: Intercede kept them out of chat metadata in a localforage store (`Intercede:src/vault.js:27-29`, via `SillyTavern.libs.localforage`); decide per brief whether frozen spans live in metadata (simple, saved with the chat file) or localforage (smaller chat files, but not exported with the chat).

### Extension settings {#extension-settings}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12; Intercede real-install
evidence: `st-context.js:200, 131`; `Intercede:src/stcontext.js:97-112`.
notes: `extensionSettings.<ext> = {…}` then `saveSettingsDebounced()`.

## Extension packaging {#packaging}

### manifest.json {#manifest}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/extensions.js:543` fetches `/scripts/extensions/${name}/manifest.json`; keys honored: `js` (`:429, 814`), `css` (`:782`), `display_name` (`:581`), `version` (`:918`), `loading_order` (`:49-50`), `minimum_client_version` (`:580, 586-590`), `requires` (`:578, 596-600`), `dependencies` (`:579, 622`), `optional` (`:972`), `i18n` (`:850-855`), `generate_interceptor` (`:2024`), `auto_update`/`homePage` (UI, `:917-1068`).
notes: Install locations (`src/endpoints/extensions.js:489-511`): per-user `<userDir>/extensions/<name>` (served as `third-party/<name>`, wins on conflict) or global `public/scripts/extensions/third-party/<name>`. Intercede shipped `loading_order: 50`, `minimum_client_version: "1.18.0"` (`Intercede:manifest.json:1-13`).

## Unverified — do not use until checked {#unverified}

### Sending with an empty textarea {#empty-send}
status: unverified
notes: Whether pressing send with an empty composer runs `Generate('normal')` without pushing a user message (candidate trigger for the neutral continuation seam, §13). Verify at `public/script.js` around `:4341-4394` before relying on it; alternative is a registered slash command that calls `generate('normal')` or `generateRaw`.

### Group chats {#group-chats}
status: unverified
notes: `groupId` exists (`st-context.js:123`) but the group generation loop is not covered above. Intercede refused group chats outright (`Intercede:src/transaction.js:213`). Treat as out of scope until a brief needs it.
