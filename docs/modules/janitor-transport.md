# janitor-transport
Owns: nothing. No protocol invariant is enforced here.
PLAN: §23 (host requirements — this is the seam, not the behaviours), §27 (the transport must stay narratively invisible)
Depends on: nothing. No `src/` import, no `globalThis.SillyTavern`.

`janitor/` is the transport shell of the Janitor userscript: `shape.js` (request-shape recognition), `envelope.js` (the `/generateAlpha` record, route learning and URL gating), `shell.js` (the `window.fetch` hook), `xhr-warning.js` (a warn-only detector) and `main.js` (the build entry). It is phase 2 of `TamperContainment/PLAN-janitor.md#phasing`: it carries no protocol logic at all. The transform it calls is a parameter, and the build entry passes a transform that returns falsy, so with this phase installed every intercepted request and response is byte-identical to the one Janitor would have sent and received. That pass-through property is this phase's §27 compliance and is what `tests/janitor/` proves.

Line references `L####` point into `TamperContainment/TamperMonkeyJanAI.txt`, the "Janitor Request Optimizer 12.2.0", from which this shell is ported and narrowed. Janitor is closed source and unannounced-change prone; the observed facts behind this file live in `docs/api/janitor.md`.

## Boot capture (L16–29) {#boot-capture}

`installTransport` reads `window.fetch` once, before the page's own scripts have run, and keeps that reference as the dispatcher for everything it later forwards. The userscript header that matters is `@run-at document-start` plus Tampermonkey's Instant inject mode; without them another page script can wrap `fetch` first and the shell is no longer the innermost hook, which changes what body a later wrapper sees.

The shell cannot fix that, so it only reports it: `/\[native code\]/` tested against `Function.prototype.toString.call(bootFetch)` is false exactly when something already wrapped `fetch`, and the shell emits one `console.warn` naming Inject Mode: Instant and still installs. Installing anyway is deliberate — a wrapped-but-working hook is better than no hook, and the warning tells the human which knob to turn. A second `installTransport` call is a no-op: the capture happens once per page.

Two userscripts cannot share this seam (plan, JanitorAI realities #16). If the optimizer itself is running, one of the two must be disabled.

## Request gating (L7204–7245, L6241–6262, L2195–2203) {#request-gating}

The wrapper spends work on a request only after four rungs, in the optimizer's order, and any rung that fails returns `originalFetch.call(window, resource, config)` with the caller's own arguments untouched:

1. **URL screen.** `isJanitorAlphaUrl(url) || isTargetedCompletion(url)`. This runs first because it is the cheapest and because everything below it costs a body clone plus a full `JSON.parse`; the page posts JSON to analytics, auth and chat-metadata endpoints constantly.
2. **Body text.** A string `config.body` is used as-is; a `Request` resource is read through `resource.clone().text()` so the caller's body stays unconsumed.
3. **Shape of the transport.** `shouldInspectRequest`: non-empty body, first non-whitespace character `{` (leading whitespace defeated an earlier version of this check), method `POST` taken from `config.method` or the `Request`, and a content type that is absent or JSON.
4. **Shape of the payload.** `JSON.parse` inside a `try` — a parse failure passes through — then `locateCompletionRequest`, and a `null` result passes through.

`isTargetedCompletion` is the rung that makes the screen specific to this chat: it is never true for the `/generateAlpha` URL itself, and once an envelope has taught the shell a proxy route it requires that route to match. `COMPLETION_URL_PATTERN` (copied verbatim from L55–56) is only the fallback for the case where no envelope was seen — a hard refresh, a restored page, or a direct non-Janitor request. `routeMatches` accepts a candidate on the same host whose normalised path is the configured path exactly, or anything under it when the configured path is a base, or anything when the configured base is `/`, and additionally requires the completion-URL pattern so that a proxy mounted at `/` does not capture the whole host.

## Envelope record (L2241–2271, L1176–1204, L1751–1770, L1107–1217) {#envelope-record}

`/generateAlpha` is Janitor's pre-assembly envelope and precedes every model invocation (`docs/api/janitor.md`). `readEnvelope` reads it and nothing else; the request is then forwarded untouched and its response is handed back exactly as it arrived — not even the stream wrap of the completion path applies — because this phase adds no browser-visible behaviour.

| Field | Source | Note |
|---|---|---|
| `chatId` | `chat.id` | The stable conversation key; see [Conversation binding](#conversation-binding). |
| `characterId` | `chat.character_id` | Recorded only; no consumer in this phase. |
| `personaName` | `profile.name`, else the `profiles[]` entry whose `id` equals `profile.id` | **Never `profile.user_name`.** `profile.name` is the active roleplay persona, the value Janitor substitutes for `{{user}}` server-side; `user_name` is account/web identity metadata. The protocol's reserved literal is built from the persona name, so reading the wrong field would install the wrong boundary. |
| `generateType` | verbatim string | Per-action values are not yet captured; recorded for a later panel. |
| `prefill` | `generation_settings.prefill_enabled` / `prefill_text` | Read only. Prefill *recovery* — the optimizer's re-issue logic — is not ported. |
| `route` | `open_ai_reverse_proxy` parsed against `location.href` into `{url, host, path}` | `path` is collapsed (`//` → `/`) and stripped of a trailing slash. A missing or unparseable value records `null`: the human is not in proxy mode and the shell has nothing to intercept. |
| `janitorRouterEnabled` | `userConfig.janitor_router_enabled` | Router traffic is server-side and invisible to any userscript. |
| `chatMessages` | the envelope array | `[{position, id, isMain, isBot, message}]`. `id` is the entry's database id as a string (`''` when absent), which the adapter layer stores as that message's identity (`docs/api/janitor.md#envelope-message-entries-carry-database-ids`, `docs/modules/janitor-adapter.md#envelope-id-identity`). |

`position` is the 0-based index in the envelope array; it exists only so a later phase can align envelope entries with the provider `messages` array, and it is never stored. `id` is the entry's own `id` — a large integer database id, not a position (`docs/api/janitor.md#envelope-message-entries-carry-database-ids`) — rendered as a string, or `''` when the entry carries no usable id. `isMain` is `is_main === true` and most likely marks the selected alternative of a regenerated turn (`changeLastMessageIndex` in the initiator stack); `isBot` is `is_bot === true`, the envelope's role flag.

## Conversation binding (L132–139, L2148–2168) {#conversation-binding}

The record is stored in a module-level `Map` — in memory only, dying with the page; no `localStorage` in this phase — under two keys: the conversation identity derived from `location.pathname` (the segment after `/chats/`, or the whole pathname when there is none) and, once known, the envelope's `chatId`.

A new chat has no id in its URL when `/generateAlpha` is sent and acquires one mid-flight, so the exact lookup misses for the provider request of that same generation. `latestEnvelope` bridges that gap for `ROUTE_BINDING_FALLBACK_MS = 5_000` and no longer. The window is deliberately far too short to leak a route or a persona from one chat into another: a stale envelope from the chat the human just left would otherwise make the shell intercept — and later rewrite — a conversation it holds no state for. Once the URL has mutated to the new chat, its path segment equals the recorded `chatId` and the exact lookup takes over permanently.

## Chat-shape adapter (L1238–1314, L1082–1092) {#chat-shape-adapter}

`locateCompletionRequest` first tests the envelope shape (`userConfig` object, `chat` object, `chatMessages` array, `generateType` string) and returns `{kind: 'janitor-alpha', requestContainer: root.userConfig, janitorRoot: root}`.

Otherwise it walks the object graph for a node whose `messages` is a completion message array — non-empty, every entry an object with a string `role` and an own `content` — and pairs it with the nearest container that names a model. A model on the same node scores 2 and wins immediately, because a model sibling to the payload is the canonical provider request shape; a model on an ancestor scores 1 and is kept only until something better appears. A payload with no model anywhere is not a request, and the walk returns `null`. The result is `{kind: 'chat', messagesContainer, requestContainer, modelName}`.

Known misclassification: an Anthropic `/v1/messages` body is reported as `chat`, because the test never reads the top-level `system` string. That is harmless here — this phase forwards the body regardless of kind — but the phase-3 adapter must not trust `kind` to tell it which dialect it holds. The optimizer's third shape, `responses`, is **not** ported (L1094–1105): Janitor's proxy path is chat-shaped, and a branch with no consumer is dead code.

## Re-serialise only when changed (L7412–7428) {#re-serialise-only-when-changed}

`JSON.parse` followed by `JSON.stringify` is not the identity function on a request body. Key order survives, but whitespace, number formatting and non-significant escapes do not, and the provider prefix cache the protocol depends on is keyed on bytes. So the shell dispatches `JSON.stringify(data)` **only** when `transform` returns a truthy "modified" flag; in every other case it dispatches the original body text — usually by handing the caller's own `resource` and `config` objects straight to the captured `fetch`, so no copy is made at all.

This is the contract the pass-through tests encode: with the phase-2 no-op transform, the recorded body string of the fake `fetch` is `===` the caller's, and the recorded `resource` is the same object. When a re-serialisation does happen the dispatch is `Object.assign({}, config, { body })`, which preserves everything else the caller set, including `signal`.

## Response wrapper (L7010–7022, L7189–7201) {#response-wrapper}

A response with a body is returned to the page as a fresh `Response` around a fresh `ReadableStream` whose `pull` forwards each chunk from the upstream reader unchanged and whose `cancel` cancels upstream. Bodyless responses are returned as they arrived.

The wrap exists now, in a phase that changes no bytes, because phase 5's boundary suppression needs the seam and because inserting it later would be the risky change, not this one. `status`, `statusText` and `headers` are passed through the `Response` constructor; `url`, `redirected` and `type` are not constructor options and are copied with `Object.defineProperty`, since Janitor's own response handling reads them.

## Transform seam

`installTransport(transform)` takes the transform as a parameter rather than importing it. It has exactly two consumers — the phase-3 protocol pipeline and the tests — which is precisely the case where a parameter beats a module-level import: the tests get to drive the shell without stubbing a module, and phase 3 gets to add behaviour without editing the shell.

The contract is narrow. `transform(data, context)` may mutate `data` in place and returns truthy if and when it did; `context` is `{...envelope, url, adapter}` when this conversation has an envelope, otherwise `{url, adapter}`.

The seam is wired. `janitor/main.js` passes `transformRequest` from `janitor/transform.js` (brief 0033, `docs/modules/janitor-adapter.md#request-pipeline`); the phase-2 no-op is gone. The shell itself is unchanged and still knows nothing about the protocol, but it is no longer provably inert: the pass-through property now holds exactly for the bodies the transform gates out — a non-`chat` adapter, a request with no recorded envelope, and an Anthropic-shaped body carrying a top-level `system` string — and for those the caller's own body string is dispatched unchanged. The no-op transform survives only in the shell's own tests, which is what it was for.

## XHR detector

The current Janitor build dispatches the proxy completion through `fetch` with `accept: text/event-stream` (ledger 2026-09-13), so v1 hooks `fetch` only. An older build used `XMLHttpRequest`, and Janitor ships unannounced changes.

`installXhrWarning()` therefore wraps `XMLHttpRequest.prototype.open` once and, the first time it sees a completion-shaped URL, emits a single `console.warn` naming the degraded tier that a future XHR transport would fall back to — stop parameters plus a trim at the next derivation, with no live boundary, so the human would watch the model write their character while the model never sees it. Then it delegates to the original `open`.

It does nothing else: it never touches `send`, holds no per-instance state, and never reads or rewrites a body or a response. An XHR transport hook, an XHR-over-fetch shim and the response shadow are separate later tasks. There is nothing about XHR behaviour to test here, because there is no XHR behaviour.
