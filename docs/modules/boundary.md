# boundary
Owns: INV-2 (docs/protocol/invariants.md)
PLAN: §8, §14, §15
Depends on: host, grammar, constants

`src/boundary.js` is the owner of INV-2: the model must never commit the externally owned character's tag. It enforces that at three points of one generation — the outgoing request body (stop strings), the incoming token stream (a stop from `STREAM_TOKEN_RECEIVED` for backends that ignore stop strings), and the received message (a trim back to the character before the reserved literal). The first of those, the outgoing request body, can be suspended for the length of one off-path call ([Suspension](#suspension)); the stream stop and the receipt-side trim never are. The four helpers at the top of the file are pure; the five handlers below them read the host only through `getCtx` (`docs/modules/host.md#single-door`) and hold three fields of per-generation state plus the suspension counter.

## Reserved literal {#reserved-literal}

The reserved literal is the collaborator persona's name followed by a colon, bare: `Mara:`, never `\n\nMara:`. PLAN §8 rejects the whitespace-prefixed form explicitly, because the persona's name may be the very first token sequence of a generation — a stop string that requires a preceding blank line would not fire there, and the model would commit the externally owned tag in the position where it matters most.

The name is read from the live context on every use: `ctx.substituteParams('{{user}}')`, trimmed. If `substituteParams` is missing, throws, returns a non-string, returns `''`, or hands back the unexpanded macro text `'{{user}}'` (which means nothing substituted it), the fallback is `String(ctx.name1 ?? '').trim()`. The result is never cached, never written to `src/constants.js`, never stored in metadata, and never exposed as a setting: `getContext()` captures `name1` by value at call time (`docs/api/sillytavern.md#getcontext`), so a persona switch between two requests must change the literal between those two requests, and any stored copy would install the previous persona's stop string on the next generation.

An empty persona name is legal — `name1: ''` passes the capability gate (`docs/modules/bootstrap.md#capability-gate`) — and yields the literal `''`. Every consumer treats `''` as "no boundary exists this generation": no stop string is installed, no stream stop fires, no message is trimmed. A bare `':'` must never be installed or matched, since it would terminate ordinary prose at the first colon.

## Why first in the stop array {#why-first-in-stop-array}

`applyStopStrings` always places the literal at index 0 and removes any earlier copy of itself first, so the array holds exactly one instance and the order of the strings ST put there is otherwise untouched.

Index 0 is the position that survives truncation. ST's own cap of four stop strings runs *before* `CHAT_COMPLETION_SETTINGS_READY` fires, and the empty-`stop` delete runs before it too, so nothing we add is trimmed or dropped client-side (`docs/api/sillytavern.md#stop-chat-completion`, `docs/api/sillytavern.md#chat-completion-settings-ready`). Providers, however, cap server-side — OpenAI accepts four — and a provider that truncates the tail of the array would silently discard our literal if it were appended. Putting it first makes the only stop string INV-2 depends on the last one a provider would drop.

The module never dedupes or reorders anything else in those arrays. Strings ST assembled (character names, instruct sequences) keep their relative order; only exact duplicates of our own literal are removed.

## Stop fields per API {#stop-fields}

Chat completion carries one field, `stop` (`docs/api/sillytavern.md#stop-chat-completion`). Text completion carries two, `stopping_strings` *and* `stop`, both populated by ST from the same source, and both are sent (`docs/api/sillytavern.md#stop-text-completion`); the module writes both, because which one the backend honours depends on the api type.

A field that is not an array is replaced with `[]` before the literal is unshifted, which covers the chat-completion case where `stop` was deleted for an empty value or for a vision model — re-adding it in the event still sends it. The operation is idempotent: applying it twice, or to a body that already contains the literal somewhere in the middle, leaves one copy at index 0 and the array length unchanged.

## Generation types this module skips {#skipped-generation-types}

The known types are `'normal' | 'continue' | 'regenerate' | 'swipe' | 'quiet' | 'impersonate'` (`docs/api/sillytavern.md#generation-types`). All three injection points act on every type except two:

- `'quiet'` — an out-of-band prompt whose output never becomes a manuscript block. PLAN §8 constrains what the model may *commit in the manuscript*, so INV-2 has nothing to protect here, and a persona-named stop string would silently truncate unrelated utility output (summaries, classifications) at the first mention of the persona.
- `'impersonate'` — ST writing the collaborator's own turn. That output is *supposed* to be the persona's text; our literal would terminate it at once. ST's own stopping strings already carry the names on that path (`docs/api/sillytavern.md#stop-text-completion`).

`MESSAGE_RECEIVED` additionally skips `'first_message'`: the character's greeting is not a generation this extension constrained, and it is written once at chat start.

Every other value fails **closed**: an unknown type, and a missing type (no `GENERATION_STARTED` observed — ST can emit `GENERATION_STARTED` without the follow-up events, `docs/api/sillytavern.md#generation-started`), are treated as in scope. A missed injection is an INV-2 violation; a spurious one costs a stop string on a generation that would never have produced the literal anyway. `'append'` and `'appendFinal'` are `saveReply` types, not `Generate` types, and need no rule.

The type is tracked from `GENERATION_STARTED` because neither settings-ready event carries a type or a `dryRun` flag (`docs/api/sillytavern.md#chat-completion-settings-ready`, `docs/api/sillytavern.md#text-completion-settings-ready`). The `dryRun` guard on those two handlers is defensive belt-and-braces only: a dry run returns before `CHAT_COMPLETION_SETTINGS_READY` fires (`docs/api/sillytavern.md#body-assembly`).

## Block start only {#block-start-only}

A boundary is an occurrence of the literal **at a block start**, and nothing else. `findBoundary` strips the trailing colon from the literal and asks `findTagLiteral` (`docs/modules/grammar.md#tag-literal-lookup`) for every occurrence with `atBlockStart === true`; the first one is the boundary. `He turned. Mara: left.` mid-paragraph and `"Mara: stop," he said.` in dialogue are not boundaries and are left alone.

The test goes through `findTagLiteral`, never the actor string, because the broadened tag-header rule (`docs/briefs/0004-tag-header-rule.md`) makes `He turned. Mara` a legal actor name: a block whose header parses to that actor would match a name comparison, while the literal `Mara:` does not start that block. Position, not actor identity, is the criterion here.

The module does not escape, rewrite or flag occurrences of the literal inside ordinary prose. "Ordinary content must not contain the literal" is a prompt-level rule (`docs/protocol/invariants.md#enforcement-model`); the only code-side consequence is that a block-start occurrence is treated as the boundary.

## Stream fallback {#stream-fallback}

Stop strings are a request to the backend, and some backends ignore them, or the provider truncated the array before ours survived. `onStreamToken` is the fallback: the cumulative text of each chunk (`docs/api/sillytavern.md#stream-token-received`) is tested for a block-start occurrence of the literal, and the first hit calls `ctx.stopGeneration()`.

Two consequences follow from the host. The abort check runs *before* the emit for the current chunk, so the stop lands one chunk late; and a stop from a stream listener **keeps the partial text as the message** (`docs/api/sillytavern.md#stopgeneration`) — the literal that triggered the stop is inside the saved message. The receipt-side trim is therefore not an optimisation but the second half of this mechanism.

The stop fires at most once per generation: `stoppedThisGeneration` is set before the call and cleared only by `onGenerationStarted`. `text` is cumulative, so without that flag every subsequent chunk would call `stopGeneration` again.

## Receipt-side trim {#receipt-trim}

`onMessageReceived` is the last line of defence and the only one that changes stored history. For a non-user message whose `mes` contains the literal at a block start, it sets `mes` to everything before that index with trailing whitespace stripped, mirrors the same string into `swipes[swipe_id]` when that entry exists (editing an assistant message in place must update the active swipe too — `docs/api/sillytavern.md#message-shape`), sets the boundary marker, re-renders, and `await`s `saveChat()`. A message with no block-start occurrence is not written to, not re-rendered and not saved.

`updateMessageBlock(index, message)` is called **unconditionally**, with no third argument, and is passed the very object that was mutated — the renderer reads the object it is handed, not `chat[messageId]` (`docs/api/sillytavern.md#updatemessageblock`). One unconditional call is correct on both receipt paths (`docs/api/sillytavern.md#edit-on-receipt`): on the non-streaming path `MESSAGE_RECEIVED` fires *before* `addOneMessage`, no DOM node carries that `mesid` yet, and the call is a silent no-op while `addOneMessage` renders the already-edited text; on the streaming path the message is already painted with the streamed text, and this call is the only thing that repaints it. The module therefore does no path detection, reads no streaming state, and never calls `addOneMessage`.

No rollback of an incomplete trailing block happens here. Classifying natural completion against max-output, and truncating to the last complete block, is `recovery`'s work (INV-8, `docs/protocol/host-mapping.md#s14-recovery`); `truncateToLastCompleteBlock` and `isTrailingBlockComplete` are deliberately not called from this module. The reason classification has to be textual at all is that ST never surfaces a provider finish reason (`docs/api/sillytavern.md#finish-reason`).

## Empty output at the boundary {#empty-at-boundary}

If the trim yields `''` — the model tried to place the external character immediately, so its entire output was the reserved tag — the empty string is written to `mes` (and to the active swipe), the marker is set, and the message is re-rendered and saved. PLAN §14 states the outcome directly: the collaborator receives the floor, and an empty model turn is the correct record of that.

The message is not deleted, no placeholder text is substituted, no generation is re-triggered, and no rollback to the previous block happens. Forcing model text merely to avoid an empty generation would put words in the manuscript that the protocol did not ask for, and deleting the message would erase the fact that the floor changed hands here.

## Boundary marker {#boundary-marker}

A trimmed message gets `extra[METADATA_KEY] = { …, boundary: true }` (`docs/modules/host.md#metadata-namespace` names the key; here it namespaces the message's `extra`, not `chatMetadata`). It is the signal `recovery` reads later to know that the floor passed to the collaborator at this message.

It is a **message-local flag, not canonical state**. It lives on the message object, travels with the chat file, and says nothing about the frontier or the frozen spans; `boundary` never contributes to what the model sees. This module writes nothing into `chatMetadata` and reads no canonical state (`docs/modules/state.md#mutation-is-storage` is not involved).

## Barge-in is not gated here {#barge-in}

PLAN §15 lets the collaborator insert the external character at any valid block boundary. The stop sequence is *one* trigger for external authorship, not the permission mechanism. This module makes no claim that a stop must have happened before the collaborator may write: it blocks nothing, requires nothing, and offers no button, prompt or affordance. §15 is satisfied here precisely by the absence of a gate.

## Suspension {#suspension}

`suspendBoundary()` increments a module-level counter and returns a `resume()` function; the request-side handlers do nothing while the counter is above zero. It is a counter rather than a boolean so two overlapping suspensions cannot release each other early, and each returned `resume()` is idempotent for its own handle: it decrements at most once however often it is called, and the counter is never taken below zero. `resetBoundaryState()` clears it, for tests.

Exactly two handlers are gated, both on the outgoing request body: `onChatCompletionSettings` and `onTextCompletionSettings`. While suspended they return before anything else happens — no stop field is created and no reserved literal is computed, so the body is byte-identical on return.

`onStreamToken` is deliberately **not** gated. `generateRaw` never streams — it sends type `'quiet'`, for which the stream flag is always false, so `STREAM_TOKEN_RECEIVED` cannot fire on the suspended call at all (`docs/api/sillytavern.md#generateraw`). A gate there would be unreachable from the only caller and its sole live effect would be disarming the stream fallback of a *concurrent* real generation. `onGenerationStarted` and `onMessageReceived` are not suspendable either: `generateRaw` writes nothing to `chat[]`, so the receipt handler cannot see a suspended call anyway, and making it suspendable would only create a way for a leaked suspension to disarm the last line of defence on a real message.

`resume()` must be called from a `finally`, never from the happy path alone: a rejected call that left the counter raised would silently disarm the stop strings of every subsequent live generation. The one caller is `restructureStarter` (`docs/modules/starter.md#boundary-suspended`).

INV-2 is not weakened. The invariant is about the manuscript — PLAN §8 constrains what the model may *commit* in it. The suspended window covers one side-channel `generateRaw` call that creates no chat message, runs no `generate_interceptor`, reads no chat history and writes no canonical state, freeze span or frontier (`docs/api/sillytavern.md#generateraw`); its output lands in a drawer output box that the collaborator reads, edits and pastes into the character card by hand. That paste is PLAN §10 editorial authority — the human deciding the externally owned figure's blocks — not the model committing her tag in a live manuscript. Every `Generate()` path still runs with the counter at zero, and the receipt-side trim is never suspended at all.

Known limitation, accepted: the counter is global to the module, so a normal chat generation running *concurrently* with a restructure shares the window and loses its request-side stop strings for the overlap. Its stream fallback still fires, and the receipt-side trim still catches the result. The mitigation — disabling the Restructure button while a generation is in flight — is deliberately deferred to a separate task and is not implemented here.
