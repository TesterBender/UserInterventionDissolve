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

### CHAT_COMPLETION_PROMPT_READY element shape {#prompt-ready-entry-shape}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/openai.js:4025-4032` — `const message = { role: item.role, content: item.content, ...(item.name ? { name: item.name } : {}), ...(item.tool_calls ? {...} : {}), ...(item.role === 'tool' ? { tool_call_id: item.identifier } : {}), ...(item.signature ? {...} : {}), ...(item.reasoning ? {...} : {}) };`
notes: `getChat()` builds a fresh plain object per `Message` instance. Own keys: `role`, `content` always; `name`, `tool_calls`, `tool_call_id`, `signature`, `reasoning` only if truthy. **No `identifier` key** — stripped even though `Message.identifier` exists internally (`:3422`, `:3444`, set to e.g. `chatHistory-${n}` at `:945`). No `extra`, no back-reference to the ST chat message or the `Message` instance; every element is a brand-new object on every call. `role` ∈ {system, user, assistant, tool}.

### CHAT_COMPLETION_PROMPT_READY chat-history slice {#prompt-ready-history-slice}
status: verified-negative
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/openai.js:881` — `chatCompletion.add(new MessageCollection('chatHistory'), prompts.index('chatHistory'));`; `:3907-3911` — `if (null !== position && -1 !== position) { this.messages.collection[position] = collection; } else { this.messages.collection.push(collection); }`
notes: `chatHistory` and `dialogueExamples` (`:1097`) each occupy one slot of `chatCompletion.messages.collection`, keyed by `prompts.index(id)` — the **preset's `prompt_order`**, not code call order (`populateDialogueExamples` can run before or after `populateChatHistory`, `:1328-1333`, and still land at its own fixed slot). `getChat()` (`:4021-4037`) flattens slots in array order but emits no slot boundary or identifier — no element in the flat `chat` array ties back to `chatHistory` (see #prompt-ready-entry-shape). **No reliable rule exists from the flat array alone.** The slice's start depends on chatHistory's rank in `prompt_order` plus the variable entry-count contributed by every preceding *enabled* section (world info, persona, description, scenario, dialogueExamples if earlier) — none derivable from `{role,content,...}` elements. The only usable signal inside an extension is content-matching: the contiguous run whose `content` equals (post name-prefix substitution, `:586-602`) the live `getContext().chat` message text, in order — fragile, not a marker.

### coreChat `extra` does not survive into prompt-manager entries {#prompt-ready-extra-survival}
status: verified-negative
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:635` — `messages[i] = { 'role': role, 'content': content, name: name, 'media': media, 'mediaDisplay': mediaDisplay, 'mediaIndex': mediaIndex, 'invocations': invocations, 'signature': signature, 'reasoning': reasoning };` — `setOpenAIMessages(chat)`, called with `coreChat` at `:4775`.
notes: `coreChat`'s `.extra` object is never copied wholesale; `setOpenAIMessages` cherry-picks only `extra.media`, `extra.tool_invocations`, `extra.reasoning_signature`, `extra.reasoning` (`openai.js` via `script.js:609-621`) into a brand-new object with no reference to the source message. Of those, only `signature`/`reasoning`/derived `tool_calls` reach the final `CHAT_COMPLETION_PROMPT_READY` element (#prompt-ready-entry-shape); `extra` itself, and any custom `extra` field an extension sets, does not exist anywhere past `setOpenAIMessages`. Confirms marker-based idempotence via `extra` is unavailable — content-based comparison is the only option.

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

### GENERATE_BEFORE_COMBINE_PROMPTS history field {#before-combine-history-field}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:5086` — `let finalMesSend = structuredClone(mesSend);`; `:5123-5126` — `const combine = () => { mesSendString = finalMesSend.map((e) => \`${e.extensionPrompts.join('')}${e.message}\`).join(''); ... }`; `:5151-5172` — `let data = { ..., mesSendString, finalMesSend, ... }`; `:5178` — `return !data.combinedPrompt ? combine() : data.combinedPrompt;`
notes: `data.finalMesSend` is the **same array object** as the closure variable `finalMesSend` (shorthand property, not a copy); elements are `{message: string, extensionPrompts: string[]}`, one per chat-history line (built at `:4950`). `combine()` closes over `finalMesSend`/`mesSendString` and **recomputes `mesSendString` fresh from `finalMesSend` at call time, after the event** — so mutating `data.finalMesSend[i].message` in place **is honored**; mutating/setting `data.mesSendString` **is not** (combine() overwrites its own outer variable and never reads `data.mesSendString`). Setting `data.combinedPrompt` bypasses `combine()` entirely (whole-prompt override incl. storyString/mesExmString/generatedPromptCache). Text-completion path only (`main_api !== 'openai'`). This overturns brief 0012's assumption that only `combinedPrompt` is honored: in-place `finalMesSend[i].message` edits work too.

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

### generateRaw {#generateraw}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:4063` — `export async function generateRaw({ prompt = '', api = null, instructOverride = false, quietToLoud = false, systemPrompt = '', responseLength = null, trimNames = true, prefill = '', jsonSchema = null } = {})`; `:3866-3904 createRawPrompt` builds the array from only `prompt`/`systemPrompt`, no chat/card/WI; `:4009-4010` openai branch — `generateData = prompt; … sendOpenAIRequest('quiet', generateData, …)`.
notes: Returns a cleaned string (or extracted JSON string if `jsonSchema` set, via `generateRawData`). Uses `main_api`'s **connection settings** (temperature, model, preset — read by `sendOpenAIRequest`/`getKoboldGenerationData`/etc. from `oai_settings`/`kai_settings`) but the prompt/system-prompt content is **entirely replaced** by the args — no character card, WI, persona, or chat history is injected (`createRawPrompt`, `:3865-3904`). Fires `GENERATE_AFTER_COMBINE_PROMPTS` (text) or `CHAT_COMPLETION_PROMPT_READY` (chat, array form) at `:3970-3980`, and honors in-place mutation of that event's payload the same as the main path (see #chat-completion-prompt-ready). Does **not** fire `GENERATION_STARTED`/`CHAT_COMPLETION_SETTINGS_READY`, and `runGenerationInterceptors` (`generate_interceptor`) is never called for it — that only runs inside `Generate()` (`public/script.js:4505`). This is the right call for "rewrite this text under this system prompt, nothing else in context."

### generateQuietPrompt {#generatequietprompt}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:3025` — `export async function generateQuietPrompt({ quietPrompt = '', quietToLoud = false, skipWIAN = false, quietImage = null, quietName = null, responseLength = null, forceChId = null, jsonSchema = null, removeReasoning = true, trimToSentence = false } = {})`; `:3049` — `let result = await Generate('quiet', generateOptions);`.
notes: `quietPrompt` is injected as an extra instruction inside the **full normal pipeline** — chat history, character card, world info, persona, extension prompts, `generate_interceptor`, and all prompt-manager events all run (same path as a normal send, type `'quiet'`), unlike `generateRaw` which replaces context wholesale. Wrong choice for "nothing else in context"; use `generateRaw` for that.

## Data {#data}

### Alternate greetings write path {#alternate-greetings}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: field lives at `public/script.js:586` `alternate_greetings: []` and is read at `:7653` `characters[this_chid]?.data?.alternate_greetings`; write endpoint `src/endpoints/characters.js:1326` `router.post('/merge-attributes', …)` → single mode calls `mergeCharacterUpdate` (`:1274-1302`) which does `character = deepMerge(character, update)`; `src/util.js:489-491` `isObject` — `typeof item === 'object' && !Array.isArray(item)` — so arrays are **not** recursively merged, they are wholesale-replaced (`util.js:503-505 Object.assign(output, {[key]: source[key]})`).
notes: No context-exposed helper covers this — `writeExtensionField`/`writeExtensionFieldBulk` (`st-context.js:81-82,206-207`) are hardcoded to `data.extensions.<key>` only (`extensions.js:2068`), not top-level `data.alternate_greetings`. Extension must `fetch('/api/characters/merge-attributes', { headers: getRequestHeaders(), body: JSON.stringify({ avatar: character.avatar, data: { alternate_greetings: [...existing, newGreeting] } }) })` (pattern per `extensions.js:2093-2105`, `slash-commands.js:5412-5419`) — **must send the full array**, since replace-not-merge means omitting existing entries deletes them. No automatic UI refresh or `CHARACTER_EDITED` emit on merge-attributes response; caller must update the local `characters[chid]` object itself (or call the context-exposed `getOneCharacter(avatar)`, `st-context.js:69,230`) and, if UI sync is wanted, emit `event_types.CHARACTER_EDITED` manually (pattern: `slash-commands.js:5432-5436`).

### Message object shape {#message-shape}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: user `public/script.js:5818-5827` — `{ name, is_user: true, is_system: false, send_date: getMessageTimeStamp(), mes, extra: { isSmallSys } }`; assistant `:6684-6694` — `extra: {}`, `name: name2`, `is_user: false`, `extra.api/model/reasoning/reasoning_duration/reasoning_signature`; `swipes = []`, `swipe_info = []` (`:6729, 6742`), `swipe_id` (`:6610-6612`); `swipe_info[i] = { send_date, gen_started, gen_finished, extra }` (`:3707-3712`).
notes: Prompt exclusion is `chat.filter(x => !x.is_system || (canUseTools && Array.isArray(x.extra?.tool_invocations)))` (`:4437`). No `extra.type` filtering on that path. When editing an assistant message in place, also set `message.swipes[message.swipe_id]` (`Intercede:src/transaction.js:454-458`).

### updateMessageBlock {#updatemessageblock}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:1974-1985` — `export function updateMessageBlock(messageId, message, { rerenderMessage = true } = {}) { const messageElement = chatElement.find([mesid="${messageId}"]); if (rerenderMessage) { const text = message?.extra?.display_text ?? message.mes; messageElement.find('.mes_text').html(messageFormatting(text, …)); } … addCopyToCodeBlocks(messageElement); appendMediaToMessage(message, messageElement); }`
notes: Sync, not async; no return value. Uses the **passed `message` object** for text/media, not a re-read of `chat[messageId]` — caller must pass `chat[messageId]` itself (or a same-shape object) after editing `.mes` in place. `rerenderMessage: false` skips the `.mes_text` HTML rewrite but still runs reasoning UI update, code-block copy buttons, and media re-append. No `swipes` handling — swipe array/UI are untouched. Emits **no event** (no MESSAGE_UPDATED). If `[mesid="…"]` matches no DOM node (message not rendered, e.g. off-screen not-yet-attached or wrong id), `messageElement` is an empty jQuery set — every call is a silent no-op, no error.

### Edit-on-receipt ordering {#edit-on-receipt}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: non-streaming `public/script.js:6628-6632` (also `:6656-6657, 6678-6679, 6721-6722`) — `!fromStreaming && await eventSource.emit(event_types.MESSAGE_RECEIVED, chat_id, type); addOneMessage(chat[chat_id]); !fromStreaming && await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, chat_id, type);`; streaming `public/script.js:3691-3740` `finalizeIntermediaryMessage()` calls `onProgressStreaming()` (writes `formattedText` into `this.messageTextDom.innerHTML`, `:3665-3669`) **before** `await eventSource.emit(event_types.MESSAGE_RECEIVED, …)` at `:3740`; `saveReply(..., fromStreaming: true)` is called after, and its own `MESSAGE_RECEIVED`/`addOneMessage` are skipped by the `!fromStreaming` guard.
notes: **Non-streaming path** (`script.js:6632` etc.): MESSAGE_RECEIVED fires *before* `addOneMessage()` — the `.mes` DOM node doesn't exist yet, so editing `chat[messageId].mes` in the listener is enough; `addOneMessage` renders the edited text. No refresh call needed. **Streaming path** (`:3740`): the DOM is already painted with the streamed text via `onProgressStreaming` *before* MESSAGE_RECEIVED fires, and `CHARACTER_MESSAGE_RENDERED` fires right after (`:3741`). Editing `message.mes` here does nothing visible unless the listener also calls `getContext().updateMessageBlock(messageId, chat[messageId])` to force the `.mes_text` re-render.

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
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/script.js:4361-4366` — `let textareaText; if (type !== 'regenerate' ... ) { textareaText = String($('#send_textarea').val()); $('#send_textarea').val('')...}`; `public/script.js:4392-4400` — `if ((textareaText != '' || (hasPendingFileAttachment() && ...)) && ...) { ... sendMessageAsUser(...) } else if (textareaText == '' && ... main_api == 'openai' && oai_settings.send_if_empty.trim().length > 0 ...) { sendMessageAsUser(oai_settings.send_if_empty...) }`.
notes: `sendTextareaMessage()` (`script.js:1705`) sets `generateType='normal'` and calls `Generate('normal')` unless `power_user.continue_on_send` (default `false`, `power-user.js:207`) is true AND textarea is empty AND last message is not user/system — only then does type become `'continue'`. With defaults, Send/Enter on an empty box → `Generate('normal')`, and inside `Generate()` the empty-string branch skips `sendMessageAsUser` entirely (no push, no bias, `type` stays `'normal'`, not coerced to `'continue'`, `force_name2` unaffected) — model continues straight from existing history. Exception: chat-completion (`main_api=='openai'`) with `oai_settings.send_if_empty` (default `''`, `openai.js:418`) set to a non-empty string injects that string as a synthetic user message instead — this is the only backend-specific quirk.

### Trigger generation via slash command {#slash-trigger}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/slash-commands.js:4986-5010` — `triggerGenerationCallback`: clears `#send_textarea`, then `outerResolve(new Promise(innerResolve => setTimeout(() => innerResolve(Generate('normal', { force_chid: chid })), 100)))`.
notes: `/trigger [group-member] [await=true]` is the slash-command equivalent of an empty Send: it clears the composer then calls `Generate('normal', {force_chid})` directly, so `Generate()` sees empty `textareaText` and skips `sendMessageAsUser` — no new user message, same as §empty-send. Contrast: `/continue` (`slash-commands.js:1489`, `Generate('continue', ...)`) appends to/extends the last message instead of starting a new turn; `/send` only pushes a user message without generating; `/gen` runs an out-of-band quiet-prompt generation not written to chat as a normal turn. Recommended programmatic call for "continue with no new user message": `Generate('normal')` (or via context: `ctx.generate('normal')`, since `st-context.js:142` aliases `generate` to `Generate`) — equivalent to what `/trigger` does; do not use `executeSlashCommandsWithOptions('/trigger')` unless group-member targeting or slash-command queuing semantics are specifically needed.

### Group chats {#group-chats}
status: unverified
notes: `groupId` exists (`st-context.js:123`) but the group generation loop is not covered above. Intercede refused group chats outright (`Intercede:src/transaction.js:213`). Treat as out of scope until a brief needs it.

## UI {#ui}

### Extension settings container {#settings-container}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/index.html:5760` — `<div id="extensions_settings" class="flex1 wide50p">`; `public/index.html:5778` — `<div id="extensions_settings2" class="flex1 wide50p">`.
notes: Both are the two flex columns of the Extensions drawer, pre-populated only with built-in `<div id="*_container">` slots (assets, TTS, RVC, websearch, QR, caption, translate, idle, summarize, etc.) — no source-tree evidence of a documented "third-party appends to column 2" convention, but nothing distinguishes the columns structurally/CSS-wise beyond visual balancing, so either is a valid append target. `extensions_settings2 ?? extensions_settings` (`Intercede:src/ui/settings.js:143`) is a safe fallback order: prefers the (usually less full) second column, degrades to the first if ST ever ships without it, and both exist unconditionally in 1.18.0's markup so the null case is theoretical on this version.

### Inline drawer markup {#inline-drawer}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/extensions/caption/settings.html:1-7` —
```html
<div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b data-i18n="Image Captioning">Image Captioning</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
```
notes: `.inline-drawer` / `.inline-drawer-toggle.inline-drawer-header` / `.inline-drawer-icon` / `.inline-drawer-content` is ST's own reusable drawer skeleton (used by built-ins, not Intercede-local styling). Toggle behaviour is wired globally and delegated: `public/script.js:12131` — `$(document).on('click', '.inline-drawer-toggle', async function (e) {` — toggles the icon classes (`down`/`up`, `fa-circle-chevron-down`/`-up`) and `slideToggle()`s the sibling `.inline-drawer-content`. A third-party extension only needs to emit this exact class markup; no per-instance JS registration required.

### toastr {#toastr}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/index.html:8195` — `<script src="lib/toastr.min.js"></script>` (plain `<script>` tag, not a module import) — `public/scripts/extensions/assets/index.js:107` — `toastr.error('Go to the characters menu to delete a character.', 'Character deletion not supported');` — `:305` — `toastr.info('Click the flashing button...', 'Trying to install a custom extension?', { timeOut: 10_000 });`.
notes: Loaded as a page global (`lib/toastr.min.js` via `<script>`, not bundled per-module), so `globalThis.toastr`/`window.toastr` is available to any third-party extension script without an import. Call form used throughout ST: `toastr.<success|error|info|warning>(message, title, options)` — `title` and `options` optional; `options` is a plain object (e.g. `{ timeOut: 10000 }`). Matches the guarded-fallback shape in `Intercede:src/utils.js:85-92` (`globalThis.toastr?.[kind](message, TOAST_TITLE, { timeOut, ...options })` with a `console` fallback when the global is missing).

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

### Chat-completion (openai) preset import does not go through performMasterImport {#preset-openai-import-route}
status: verified-negative
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/openai.js:4654,4732` — `onImportPresetClick(){ $('#openai_preset_import_file').trigger('click'); }` … `const name = file.name.replace(/\.[^/.]+$/, ''); … presetBody = JSON.parse(importedFile); … fetch('/api/presets/save', {...body: JSON.stringify({apiId:'openai', name, preset: presetBody})})`.
notes: `performMasterImport` (`preset-manager.js:249-279`) has no chat-completion/openai branch and is bound only to `#af_master_import_file` (AI Response Formatting's combined instruct+context+sysprompt+textcompletion+reasoning bundle import), not to any openai control. The dedicated `#import_oai_preset` button in the "Chat Completion Presets" panel (`public/index.html:185,202`) parses the file directly with no `isPossibly*` auto-detection at all — top-level `name` is NOT read; the preset name is taken from the **filename** (extension stripped). An openai preset fed into `performMasterImport` instead would match none of the five legacy predicates (`Default.json` has `temperature`/`repetition_penalty`, not `temp`/`rep_pen`, so `isPossiblyTextCompletionData` fails) nor any `masterSections[key]` (those check nested `data.instruct`/`data.context`/etc., absent from a flat openai preset) — result: "No valid sections found in imported data", not a misdetection.

### Minimal openai preset: every settingsToUpdate key is optional at apply-time {#preset-openai-minimal-fields}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/openai.js:4922-4934` — `for (const [key, [selector, setting, isCheckbox, isConnection]] of Object.entries(settingsToUpdate)) { … if (preset[key] !== undefined) { … oai_settings[setting] = preset[key]; } }`
notes: `onSettingsPresetChange()` (bound to `#settings_preset_openai` change) applies each field in the `settingsToUpdate` map (`openai.js:298-370`, ~70 keys incl. `prompts:['', 'prompts', …]` and `prompt_order:['', 'prompt_order', …]`) only `if (preset[key] !== undefined)`; missing keys are silently skipped and whatever was already loaded stays in effect — no key throws and no key has a documented required-default fallback inside this loop. Save (`/api/presets/save`) itself only requires valid JSON + `apiId`+`name` in the request wrapper (`openai.js:4710-4717`), not any specific key inside `preset`. Practical minimal file for this brief's purpose (to actually change the visible main prompt, not just avoid an error) is `{prompts, prompt_order}`; a bare `{}` imports and "applies" with zero visible effect.

### prompts[] main entry and prompt_order shape; live character_id sentinel is 100001, not 100000 {#preset-openai-prompt-entry-shape}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `default/content/presets/openai/Default.json` main entry — `{"name":"Main Prompt","system_prompt":true,"role":"system","content":"Write {{char}}'s next reply…","identifier":"main"}`; `public/scripts/openai.js:688-690` — `promptOrder: { strategy: 'global', dummyId: 100001 }`.
notes: A `prompts[]` entry needs only `identifier`, `name`, `role`, `content` (+`system_prompt:true` for main/system-role entries — optional fields like `marker`, `injection_position`, `injection_depth`, `forbid_overrides` are used by other entry kinds, e.g. `marker:true` placeholder entries like `chatHistory`, and are not required on a plain text prompt). `prompt_order` is `[{character_id, order:[{identifier, enabled}, …]}]`. `PromptManager.js:438` sets `activeCharacter = {id: dummyId}` for `strategy:'global'`; `getPromptOrderForCharacter` (`PromptManager.js:1208`) does `.find(list => String(list.character_id) === String(character.id)) ?? []` — **no match returns an empty order (silently renders nothing, no error)**. The openai-panel `promptManagerModule` (`openai.js:686-690`) sets `dummyId: 100001`, but the base `PromptManager` constructor default (`PromptManager.js:336`) is `100000` — `Default.json` ships **both** `character_id: 100000` and `character_id: 100001` entries (verified non-identical), and only the `100001` entry is the one actually read by the live openai instance. A preset shipping only `character_id: 100000` would import without error but render an empty prompt order.

### Import UI path/labels for chat-completion presets, 1.18.0 {#preset-openai-import-ui-path}
status: verified
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/index.html:176,185,202` — `<span data-i18n="openaipresets">Chat Completion Presets</span>` … `<div id="import_oai_preset" class="margin0 menu_button menu_button_icon" title="Import preset" data-i18n="[title]Import preset">` … `<input id="openai_preset_import_file" type="file" accept=".json,.settings" hidden />`.
notes: Panel is "AI Response Configuration" → "Chat Completion Presets" section → the "Import preset" button (file-import icon) next to the preset dropdown; confirms the brief's README paraphrase ("AI Response Configuration, use the preset import control") without needing the third-party README as sole evidence.

### Omitting a marker from prompt_order does NOT omit it from the request {#preset-openai-prompt-order-markers}
status: verified-negative
checked: 1.18.0 @ 8172dcd on 2026-09-12
evidence: `public/scripts/PromptManager.js:949-952` — `isPromptDisabledForActiveCharacter(identifier){ const e = this.getPromptOrderEntry(...); if (e) return !e.enabled; return false; }`; `PromptManager.js:1044-1055` `checkForMissingPrompts` pushes any `chatCompletionDefaultPrompts.prompts` entry missing from `serviceSettings.prompts` (runs from `sanitizeServiceSettings`, itself called on `OAI_PRESET_CHANGED_AFTER`, `PromptManager.js:817-819`).
notes: `populateChatCompletion` (`openai.js:1176-1250`) calls fixed `addToChatCompletion('worldInfoBefore'|'main'|'worldInfoAfter'|'charDescription'|'charPersonality'|'scenario'|'personaDescription')` unconditionally, gated only by `prompts.has(id)` (true once `checkForMissingPrompts` auto-fills it) and `isPromptDisabledForActiveCharacter`, which is **false (= included) whenever the identifier has no entry in `order` at all** — omission is not disablement. `chatHistory`/`dialogueExamples` are similarly auto-included via `prompts.has()` (`openai.js:877,1093`), independent of `order`. The only way to actually suppress a marker is an explicit `{identifier, enabled:false}` entry (Default.json does this for `enhanceDefinitions`). So `order:[{identifier:'main'}]` still sends chat history, dialogue examples, character card, persona, and world info (using auto-injected default content for any prompt not shipped in `prompts[]`) — nothing is omitted from the request by a short `order` array.
Default.json `character_id:100001` order (identifiers only, all `enabled:true` except `enhanceDefinitions:false`): `main, worldInfoBefore, personaDescription, charDescription, charPersonality, scenario, enhanceDefinitions, nsfw, worldInfoAfter, dialogueExamples, chatHistory, jailbreak`.

### Context availability at extension load {#context-at-load}
- status: verified
- checked: 1.18.0 @ 8172dcd on 2026-09-12
- `globalThis.SillyTavern = { libs, getContext }` is a top-level assignment (`public/script.js:292-295`), executed the instant `script.js` module-evaluates — before `firstLoadInit()` runs (`script.js:12529`, jQuery-ready) and before extensions load via `loadExtensionSettings` → `activateExtensions()` → `import(url)` of manifest script (`public/scripts/extensions.js:438,813`). So `SillyTavern.getContext` is always a valid function reference by the time a third-party `index.js` executes; matches `Intercede:../Test Probe Extension/index.js:1-5` top-level `SillyTavern.getContext()` call working in practice.
- Caveat: `getContext()` (`public/scripts/st-context.js`) reads live vars (`chat` inited `[]` at `script.js:410`, `characterId`/`name1`) at *call* time, not module-load time — these are only populated after character/chat load later in `firstLoadInit`/`APP_READY`/`CHAT_CHANGED`. Calling `getContext()` synchronously at extension top level gets a real object but with empty/default `chat`/`characterId`/`name1` if no chat is open yet; extensions needing real chat data must defer to an event handler (`APP_READY` or `CHAT_CHANGED`), not rely on top-level call values.
