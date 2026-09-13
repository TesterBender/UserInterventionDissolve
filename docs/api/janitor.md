# JanitorAI capture ledger

The Janitor host has no source of truth to read. janitorai.com is closed source and ships unannounced changes — the optimizer's hashed selectors and version churn show the rate — so this file replaces `docs/api/sillytavern.md`'s file:line evidence on that host with **dated captures**. It is written by hand from DevTools observations and user reports. `st-api-verifier` never writes here; it verifies SillyTavern only, and nothing in `janitor/` may be justified by a SillyTavern entry.

Every entry carries a capture date, the evidence, and a `status`:

- `answered` — observed directly, in DevTools or by the human operating the site.
- `assumed` — decided without observation; the consequence of being wrong is recorded with it.

Bundle names and hashes (`index-D_v0MjH6.js` and friends) change on every Janitor build. Re-check any entry that cites one after an update. Entries are seeded from `TamperContainment/PLAN-janitor.md` (git-ignored), which holds the planning context behind each.

## Transport of the proxy completion

status: answered — captured 2026-09-13

The proxy completion is dispatched with **`fetch`**, streaming **SSE**. The DevTools initiator stack tops out at `window.fetch` called from `fetchOpenAIProxyGenerate` (bundles `SkeletonLoader.module-DtlUjuUR.js`, `index-D_v0MjH6.js`), and the request carries `accept: text/event-stream`. The same stack names the generation chain `runGenerateAlternative → streamLlmGenerate → handleAnswerGenerationResponse → generate → fetchOpenAIProxyGenerate`.

The optimizer's XHR observation (its L8079–8102) describes an older build or another path. v1 hooks fetch only and carries a warn-only detector (`docs/modules/janitor-transport.md#xhr-detector`).

## /generateAlpha precedes every model invocation

status: answered — captured 2026-09-13

`/generateAlpha` is sent before everything that invokes the model, so the envelope record is available for the provider request of the same generation. Note the mid-flight URL mutation of a brand-new chat, which is why the binding carries a 5 s bridge (`docs/modules/janitor-transport.md#conversation-binding`).

Still open on the same envelope: the set of `generateType` values per user action, and the exact semantics of `is_main`.

## Envelope message entries carry database ids

status: answered — captured 2026-09-14

Each entry of the `/generateAlpha` envelope's `chatMessages` has the shape `{character_id (bot messages only), chat_id, created_at, id, is_bot, is_main, message}`. `id` is a large integer **database** id (e.g. `103237690204`), not a position, and the envelope includes the message currently being sent.

The earlier entry here — "the ids are 0-based positional indices, counted from the first system message" (2026-09-13) — **was wrong**. The follow-up brief that this entry deferred is brief 0036: these ids are now the adapter layer's stored message identity, read off the envelope entry alignment chose and written into `frozenIds`, the watermark and `boundaries` (`docs/modules/janitor-adapter.md#envelope-id-identity`).

Janitor keeps per-message alternatives (`changeLastMessageIndex` in the initiator stack), so `is_main === true` most likely marks the selected alternative; the diff matches against those entries only.

## Janitor prefixes user turns with the persona name

status: answered — captured 2026-09-14

In the provider body, **user-role** history messages arrive as `` `${profile.name}: ${message}` `` — inline, one colon, one space — while **assistant**-role messages arrive unprefixed. The envelope's `chatMessages` stores the bare text, without the prefix. The prefix is Janitor's transport formatting; it is not part of what the human wrote, and the diff strips it by matching that one exact form (`docs/modules/janitor-adapter.md#envelope-diff`).

Captured on a live proxy chat: the envelope held `"Oi, back to you, mate! …"` while the body sent `Shant: "Oi, back to you, mate! …`.

## Persona name lives at profile.name

status: answered — captured 2026-09-13 (optimizer evidence, L2241–2271)

`profile.name` is the active roleplay persona — the value Janitor substitutes for `{{user}}` server-side. `profile.user_name` is account/web identity metadata and must never be used. When `profile.name` is absent, the entry in `profiles[]` whose `id` matches `profile.id` carries it. `{{user}}` and bare `{user}` both occur in card and prompt text (L2300–2320).

## Janitor sends no default stop list

status: answered — captured 2026-09-13

There is no default `stop` / `stop_sequences` content on the outgoing body, and the field is not reachable from the frontend. The script owns all stop slots. (No stop string is written in this phase.)

## Regenerate drops the replaced assistant message

status: answered — captured 2026-09-13

A regenerate ("generate alternative") restarts from the latest user message with the replaced assistant message absent from `messages`. An edited message is re-sent with its new text; a deleted one disappears from `chatMessages` immediately. So no derivation ever sees a stale assistant message, and SillyTavern's `excludeLastAssistant` has no counterpart here.

## Empty completion is stored as an empty message

status: answered — captured 2026-09-13

A generation that produces nothing — the protocol's normal case at a boundary — makes Janitor store an empty assistant message, with no error. No filler is ever substituted.

## Non-history turns are injected in any role

status: answered — captured 2026-09-13 (user report)

Janitor injects non-history material into `messages` at depth with role `system`, `assistant` **or** `user`; system-role injections are aggregated to the front. Any later classification must diff the provider `messages` against the envelope's `chatMessages` rather than trust roles.

## The custom prompt may not be empty in proxy mode

status: answered — captured 2026-09-13 (user report)

An empty custom (global) prompt makes Janitor insert its own chat-oriented default. Users keep a lone `.` there. The exact default text is not captured yet, so nothing can warn on it.

## Post-stream save path

status: assumed — decided 2026-09-13, unverified

Assumption: Janitor persists the text the page received from the (script-wrapped) stream, not an internal accumulator fed by a terminal event. If this is wrong, a later stream-side cut shows up as a saved message that continues past the cut; the model view stays correct because the next derivation trims at the literal, and only the human-visible log leaks. Endpoint and payload are not captured.

## The context window is 128k tokens

status: answered — captured 2026-09-13

Janitor's total context size setting is 128,000 tokens (user report). The script's horizon budget of 100,000 tokens (brief 0033) sits under it with room for the assembled system message and a full-length response (the response cap is ~19k characters). The name of the field in `generation_settings` and whether Janitor trims by tokens or by messages are still open.

## Terminal frames are synthesised on a stream cut

status: assumed — decided 2026-09-14, unverified

Assumption: Janitor's SSE parser needs the dialect's terminal frames, so a stream that is simply closed early reads as a failed generation. The script therefore never closes the body silently. When it cuts at the reserved literal it emits, in order: at most one `data:` frame carrying the text before the cut as `choices[0].delta.content`, then a frame whose `choices[0]` is `{index: 0, delta: {}, finish_reason: "stop"}`, then `data: [DONE]`. Both synthesised frames copy `id`, `object`, `created` and `model` from the last upstream frame and add no field upstream did not send (`docs/modules/janitor-transport.md#response-wrapper`).

Symptom if wrong: Janitor rejects the synthesised frames and the turn shows as an error instead of a short message. The recorded fallback is then to let upstream run to completion while forwarding nothing after the cut, which costs the tokens of a generation nobody reads.

## Reasoning routes reject the `stop` parameter with a 4xx naming it

status: assumed — decided 2026-09-14, unverified

Assumption: some provider routes — the reasoning models in particular — answer a request carrying `stop` with a 4xx whose body names the parameter, rather than ignoring it. Evidence is indirect: the optimizer carries per-route rejected-parameter learning for exactly this class of refusal (`TamperContainment/TamperMonkeyJanAI.txt` L1586–1670), and the plan names `stop` as the parameter that gets refused. The script matches the body against `/\bstop(?:_sequences)?\b/i` and files the route under `host+path|model`, one way and TTL-free (`docs/modules/janitor-transport.md#stop-rejection-learning`).

Symptom if wrong: a route learned in error silently loses its stop string and relies on the stream cut for the boundary. That is the same enforcement point the genuinely refusing routes use, so no invariant is lost; the generation simply runs to its own end and the tokens past the boundary are wasted.

## Open

No answers are invented for these; nothing in phase 2 depends on any of them.

- The `generation_settings` field name for the 128k context window and its truncation unit (tokens or messages). Related, captured 2026-09-13: the *response*-length setting is in characters, capped at 20,000, landing near 19k characters in practice — an output ceiling, not the history window.
- Whether Janitor's composer stores the sentinel literal `//` verbatim.
- The Anthropic path: `/v1/messages` with a top-level `system`, or a converted chat body.
- Behaviour on a completion that ends at a stop sequence, and on an early stream close with no terminal frames. Still uncaptured; handled by decision rather than by waiting — the terminal frames are synthesised ([Terminal frames are synthesised on a stream cut](#terminal-frames-are-synthesised-on-a-stream-cut)).
- The body shape when Janitor's streaming toggle is off. Only the plain chat-completions JSON shape (`choices[0].message.content`) is rewritten; any other shape is delivered unchanged (`docs/modules/janitor-transport.md#response-wrapper`).
- The exact shapes and positions of injected turns, and whether the envelope's `chatMessages` omits them.
- Whether only a configured reverse proxy or custom key makes the browser dispatch the provider request at all (router traffic is believed server-side and invisible).
- The exact text of Janitor's default custom prompt.
- `generateType` values per user action; the precise meaning of `is_main`.
