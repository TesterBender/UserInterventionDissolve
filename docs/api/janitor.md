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

## Envelope message ids are positional

status: answered — captured 2026-09-13

The ids in the envelope's `chatMessages` are **0-based positional indices**, counted from the first system message to the most recent. They shift on every deletion, so they are not usable as message identity; decision 0004 rejected index identity for exactly this reason. They are recorded only to align envelope entries with the provider `messages` array for a later injection diff.

Janitor keeps per-message alternatives (`changeLastMessageIndex` in the initiator stack), so `is_main === true` most likely marks the selected alternative; a later diff must match against those entries only.

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

## Open

No answers are invented for these; nothing in phase 2 depends on any of them.

- The `generation_settings` context-size field and its truncation unit (tokens or messages). Related, captured 2026-09-13: the *response*-length setting is in characters, capped at 20,000, landing near 19k characters in practice — an output ceiling, not the history window.
- Whether Janitor's composer stores the sentinel literal `//` verbatim.
- The Anthropic path: `/v1/messages` with a top-level `system`, or a converted chat body.
- Behaviour on a completion that ends at a stop sequence, and on an early stream close with no terminal frames.
- The exact shapes and positions of injected turns, and whether the envelope's `chatMessages` omits them.
- Whether only a configured reverse proxy or custom key makes the browser dispatch the provider request at all (router traffic is believed server-side and invisible).
- The exact text of Janitor's default custom prompt.
- `generateType` values per user action; the precise meaning of `is_main`.
