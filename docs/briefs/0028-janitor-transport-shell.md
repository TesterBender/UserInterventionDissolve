# Brief 0028 — Janitor transport shell (fetch-only)
Status: draft
Complexity: high  (>1 module: `janitor/` shell + envelope + shape + detector, new test tree, new docs; the response wrapper and the route binding are subtle)
PLAN sections: §23 (host requirements: a host needs the listed *behaviours*, not an API; "the protocol depends on behavior, not on any particular API role names or extension system" — this brief builds none of those behaviours, it only gives them a seam), §27 (final criterion: a feature must not make the transport layer narratively legible — the shell adds nothing model-visible, so the pass-through proof *is* its §27 compliance)
Invariants touched: none. No protocol logic exists in this brief; the model-visible request is byte-identical to Janitor's own.

Scope source: `TamperContainment/PLAN-janitor.md` ("Architecture" layer 1; "Per-generation pipeline" request-side steps 1, 2 and 9; "Layout and build"; "Decisions"; the answered items of "Verification ledger"). The SillyTavern host mapping (`docs/protocol/host-mapping.md`) does **not** apply to this host. `TamperContainment/TamperMonkeyJanAI.txt` ("Janitor Request Optimizer 12.2.0") is the evidence source for transport behaviour; `L####` below are its line numbers.

## Goal
`janitor/` exists as tracked source holding a fetch-only transport shell for janitorai.com: it captures `window.fetch` at boot, checks it looked native, lets everything that is not a POSTed JSON completion body through untouched, reads Janitor's `/generateAlpha` envelope and forwards it untouched while recording what later phases will need (chat id, persona name, generate type, prefill settings, proxy route, chat-message positions and `is_main`), binds that record to the conversation identity with the optimizer's 5-second bridge, recognises the provider request by the learned route, parses the body, hands it to a single injected transform seam, re-serialises **only** when that seam reports a change, dispatches, and returns the response through a fresh `ReadableStream`/`Response` that forwards every chunk unchanged. A one-function detector warns (console only) if a completion-shaped `XMLHttpRequest` is ever seen and does nothing else. With the phase-2 no-op transform installed, every intercepted request and response is byte-identical to the one Janitor would have sent and received, and vitest proves it.

## In scope
Files under `janitor/`, split as follows.

**`janitor/shape.js`** — request-shape recognition, ported from the optimizer, narrowed:
- `isCompletionMessageArray(messages)` — non-empty array, every entry an object with a string `role` and an own `content` (L1082–1092). Record in the doc that this classifies an Anthropic body as `chat` because it never reads a top-level `system` (plan, Architecture layer 1).
- `isJanitorAlphaRequestShape(node)` — object with object `userConfig`, object `chat`, array `chatMessages`, string `generateType` (L1114–1122).
- `locateCompletionRequest(root)` — returns `{kind: 'janitor-alpha', requestContainer: root.userConfig, janitorRoot: root}` for the envelope, else walks the object graph for the `chat` shape and returns `{kind: 'chat', messagesContainer, requestContainer, modelName}` using the optimizer's score-2 (model sibling) / score-1 (model on an ancestor) rule (L1238–1314). **The `responses` shape is dropped** (L1094–1105 not ported): Janitor's proxy path is chat-shaped, and a second shape with no consumer is an unused branch.

**`janitor/envelope.js`** — envelope reading and route binding:
- `readEnvelope(data)` → `{chatId, characterId, personaName, generateType, prefill, route, chatMessages}` where `personaName` comes from `profile.name`, never `user_name`, falling back to the `profiles[]` entry whose `id` matches `profile.id` (L2241–2271); `chatId` from `chat.id`, `characterId` from `chat.character_id`; `generateType` verbatim; `prefill` from `userConfig.generation_settings.prefill_enabled` / `prefill_text` (L1751–1770); `route` from `userConfig.open_ai_reverse_proxy` parsed to `{url, host, path}` plus `janitorRouterEnabled` from `userConfig.janitor_router_enabled` (L1107–1217, L2115–2146); `chatMessages` as a positional list `[{position, isMain, isBot, message}]` where `position` is the 0-based index in the envelope array, `isMain` is `is_main === true` and `isBot` is `is_bot === true` (L1176–1204; ledger 2026-09-13: ids are positional, `is_main` most likely marks the selected alternative).
- A module-level registry keyed by conversation identity (the chat segment of `location.pathname`, or the envelope's `chatId` once known) plus `latestEnvelope` with the 5-second bridge for Janitor's mid-flight URL mutation (`ROUTE_BINDING_FALLBACK_MS = 5_000`, L132–139, L2148–2168). In-memory only.
- `isJanitorAlphaUrl(url)`, `routeMatches(url)` (same host, exact path / configured base / under-base, plus the completion-URL pattern, L2174–2193) and `isTargetedCompletion(url)` (never the alpha URL; require the learned route once one exists, otherwise fall back to the URL pattern, L2195–2203). The `COMPLETION_URL_PATTERN` literal is copied verbatim from L55–56.

**`janitor/shell.js`** — the hook:
- `installTransport(transform)` captures `window.fetch` once, tests `/\[native code\]/` against `Function.prototype.toString.call(...)` and `console.warn`s the Inject Mode: Instant message when it fails (L16–29), then assigns the wrapper. Called by the build entry; tests call it with their own transform and their own fake `window.fetch`.
- Gating order, exactly the optimizer's (L7204–7245): URL screen first (`isJanitorAlphaUrl || isTargetedCompletion`, else pass through untouched); read the body text (string `config.body`, else `resource.clone().text()` for a `Request`); `shouldInspectRequest` — non-empty body, first non-whitespace char `{`, method POST, content-type absent or JSON (L6241–6262); `JSON.parse` in a try, pass through on failure; `locateCompletionRequest`, pass through when null.
- Alpha branch: `readEnvelope` + record, then forward the **original** `resource`/`config` untouched (pipeline step 1).
- Completion branch: call `transform(data, context)` where `context` is the recorded envelope for this conversation (or null) plus `{url, adapter}`. `transform` returns a truthy "modified" flag. Re-serialise `JSON.stringify(data)` **only** when it is truthy; otherwise dispatch the original body text unchanged (L7412–7428, pipeline step 9). Dispatch preserves the caller's `resource`/`config` in every other respect, including `signal`.
- Response: wrap in a fresh `ReadableStream` whose `pull` forwards each chunk from the upstream reader unchanged and whose `cancel` cancels upstream, build `new Response(stream, {status, statusText, headers})`, and copy `url`/`redirected`/`type` with `Object.defineProperty` (L7010–7022, L7189–7201). Non-streaming or bodyless responses are returned as-is.
- `transform` is a parameter, not a static import: the phase-3 protocol pipeline and the tests are its two consumers.

**`janitor/xhr-warning.js`** — `installXhrWarning()`: wrap `XMLHttpRequest.prototype.open` once, and on a completion-shaped URL `console.warn` a single message naming the degraded tier, then delegate. It never touches `send`, never holds per-instance state, never mutates a body or a response (Decisions: "v1 hooks fetch only and carries a one-function detector"; ledger 2026-09-13: the current build is fetch + SSE).

**`janitor/main.js`** — build entry, ≤ 10 lines: `installTransport(() => false)` and `installXhrWarning()`. The no-op transform is the phase boundary and the doc says so.

**Config and tests**
- `eslint.config.js`: add the globals `janitor/` needs (`fetch`, `Request`, `Response`, `Headers`, `ReadableStream`, `XMLHttpRequest`, `location`, `TextEncoder`, `TextDecoder`) to the browser globals list, and add them for `tests/**` too. No rule changes.
- `package.json`: add `janitor` to the `check:comments` path list. Nothing else in this brief.
- `tests/janitor/` (vitest, jsdom env as configured): fixtures under `tests/janitor/fixtures/` as JSON-string constants — (a) a `/generateAlpha` envelope with `userConfig` (including `open_ai_reverse_proxy`, `janitor_router_enabled`, `generation_settings.prefill_enabled`/`prefill_text`), `chat`, `profile`, `profiles`, `chatMessages` entries of `{is_bot, is_main, message}`, and `generateType`; (b) a chat-completions body with a first `system` message and alternating user/assistant turns. Tests install a fake `window.fetch` that records `(resource, config)` and returns a fake streaming `Response`; where jsdom lacks `Response`/`ReadableStream`, the test file defines minimal stand-ins on `globalThis` (no dependency, no polyfill package).

## Out of scope (explicit)
- Any protocol logic: system-prompt injection, sentinel drop, injection diff, derivation, freeze, reconstruction, stop strings, horizon, rollback. The transform seam stays a no-op.
- Any `src/` import. The shell must not import the pure core in this brief; that is phase 3.
- `localStorage`, the `storage` cross-tab listener, export/import, and any persistence. The envelope registry is in-memory and dies with the page.
- The panel, the shadow-DOM host, the stop-button observer, any UI at all. The XHR detector warns to `console` only.
- An XHR transport hook, XHR-over-fetch shim, or response shadow (Decisions: fetch only for v1; ledger 2026-09-13 answers the transport as fetch).
- Everything the plan excludes from the borrow: caching / Gemini cache modes, Flex and service tiers, prefill *recovery* (reading the prefill settings is in scope; acting on them is not), rejected-parameter learning, the context/prompt editor, notifications, sounds, token calibration, retries, deadlines and timeout responses.
- The `responses` request shape and the Anthropic top-level-`system` adapter.
- Settings, toggles, or `CONFIG` constants with more than one live value. The optimizer's config block is not ported.
- Modifying `src/`, `index.js`, `manifest.json`, the ST extension's tests, or `docs/protocol/host-mapping.md`.
- Adding a dependency, or touching `.gitignore` (`TamperContainment/` stays ignored).

## Files
- allowed to create: `janitor/shell.js`, `janitor/envelope.js`, `janitor/shape.js`, `janitor/xhr-warning.js`, `janitor/main.js`, `tests/janitor/*.test.js`, `tests/janitor/fixtures/*.js`, `docs/modules/janitor-transport.md`, `docs/api/janitor.md`
- allowed to modify: `eslint.config.js` (globals only), `package.json` (`check:comments` path list only), `docs/README.md` (index entries for the two new docs)
- must not touch: `src/**`, `index.js`, `manifest.json`, `style.css`, `tests/*.test.js` (the ST tests), `tools/**`, `presets/**`, `PLAN.txt`, `TamperContainment/**`, `.gitignore`, `vitest.config.js`

## ST APIs used
- none. This host is janitorai.com; `globalThis.SillyTavern` does not exist here and must not be referenced in `janitor/` or `tests/janitor/`.

## Verification needed
- (empty) Every Janitor fact this brief relies on is an answered ledger item in `TamperContainment/PLAN-janitor.md#verification-ledger` (transport is fetch + SSE, 2026-09-13; `/generateAlpha` precedes every model invocation, 2026-09-13; envelope ids are positional 0-based, 2026-09-13; Janitor sends no default `stop` list, 2026-09-13) or is read directly from the optimizer source at the cited lines. Do **not** launch `st-api-verifier`; it verifies SillyTavern only. The open ledger items (save path, `generation_settings` context field, sentinel acceptance, Anthropic path shape, exact injection shapes) all sit in phases 3–5 and block nothing here.

## Acceptance
- [ ] With `transform` returning falsy, the fetch wrapper dispatches a body string `===` the caller's original for: the `/generateAlpha` envelope fixture, the chat-completions fixture, a POST to a non-matching URL, a non-POST request to a matching URL, and a POST of a non-JSON body. Asserted on the recorded `(resource, config)` of the fake `fetch`, by strict equality of the body string and by identity of the `resource` object where no re-serialisation occurred.
- [ ] With a transform that mutates `data` and returns truthy, the dispatched body is `JSON.stringify(data)` and differs from the original; with a transform that mutates nothing and returns falsy, the original string is dispatched even though `JSON.parse`/`stringify` would have reordered nothing.
- [ ] Response bytes read by the caller through the wrapper equal the upstream chunks concatenated, in order, and `status`, `statusText`, `headers.get(...)` and `url` survive the wrap; cancelling the wrapped body cancels upstream.
- [ ] `readEnvelope` on the fixture returns `personaName` from `profile.name` (a test fixture where `profile.user_name` differs proves `user_name` is never used), the `chatId`, `generateType`, prefill settings, the parsed route, and `chatMessages` positions with `isMain` flags.
- [ ] `isTargetedCompletion` returns false for the alpha URL, false for a completion-shaped URL on a different host once a route is bound, true for the bound route's URL, and — after 5 s of simulated time with no conversation-identity match — false via the expired bridge (fake timers).
- [ ] A non-native `window.fetch` at install time produces exactly one `console.warn` and still installs.
- [ ] `installXhrWarning` warns once on a completion-shaped `open()` and calls through; no test asserts any XHR body or response behaviour, because none exists.
- [ ] No file under `janitor/` imports from `src/` or references `SillyTavern`.
- [ ] `npm run check` passes (`check:comments` now covers `janitor`).
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/janitor-transport.md` — new. Headings the pointer comments will target, at minimum: `## Boot capture` (why fetch is captured at `document-start` and what the native check means, L16–29); `## Request gating` (the POST / JSON / URL / learned-route ladder and why each rung exists); `## Envelope record` (field-by-field, `profile.name` vs `user_name`, positional `chatMessages`, `is_main`); `## Conversation binding` (the 5 s bridge and why it is deliberately too short to leak a route across chats); `## Chat-shape adapter` (the score rule; the known Anthropic misclassification); `## Re-serialise only when changed` (the contract the pass-through tests encode); `## Response wrapper` (fresh `ReadableStream` + metadata copy, and that phase 2 forwards chunks verbatim); `## Transform seam` (the phase-3 boundary; why it is a parameter); `## XHR detector` (warn-only, and the degraded tier it would announce). Each heading names the optimizer line range it came from.
- `docs/api/janitor.md` — new capture ledger replacing the ST verifier's file:line evidence on this host (plan, JanitorAI realities #19). Seed it with the **answered** items from `TamperContainment/PLAN-janitor.md#verification-ledger`, each with its capture date `2026-09-13`, its evidence sentence, and a `status` of `answered` or `assumed` (the save path is `assumed`). List the still-open items under a `## Open` heading with no invented answers. State at the top that this file is written by hand from captures, not by `st-api-verifier`, and that Janitor bundle hashes change per build.
- `docs/README.md` — index lines for both new docs.
