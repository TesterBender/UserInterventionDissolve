# janitor-transport
Owns: INV-2 on the response side of the Janitor host (the stream cut). Nothing else.
PLAN: §8 (the hard boundary, enforced on the stream when the backend has no usable stop support), §23 (host requirements — this is the seam, not the behaviours), §27 (the transport must stay narratively invisible)
Depends on: `src/boundary.js` (`findBoundary`, `trimAtBoundary`, pure). No `globalThis.SillyTavern`.

`janitor/` is the transport shell of the Janitor userscript: `shape.js` (request-shape recognition), `envelope.js` (the `/generateAlpha` record, route learning and URL gating), `shell.js` (the `window.fetch` hook), `sse.js` (the boundary filter over SSE frames), `stop-routes.js` (which routes reject `stop`), `xhr-warning.js` (a warn-only detector) and `main.js` (the build entry). Through phase 2 it carried no protocol logic at all: the transform it calls is a parameter, and with a transform that returns falsy every intercepted request and response is byte-identical to the one Janitor would have sent and received. That pass-through property is still what `tests/janitor/` proves for every body the transform gates out; phase 5 adds exactly one rewrite on top of it, the boundary cut ([Response wrapper](#response-wrapper)).

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

A response with a body is returned to the page as a fresh `Response` around a fresh `ReadableStream` whose `cancel` cancels upstream. `status`, `statusText` and `headers` are passed through the `Response` constructor; `url`, `redirected` and `type` are not constructor options and are copied with `Object.defineProperty`, since Janitor's own response handling reads them. Bodyless responses are returned as they arrived, and so is an error response, which is never filtered and never reported as a completion.

Since brief 0038 the stream is no longer a verbatim forwarder in every case. Each upstream chunk goes through `createBoundaryFilter(literal)` (`janitor/sse.js`), built from the plan the transform returned ([Transform seam](#transform-seam)); the chunks it returns are what the page reads. An empty literal — and a pass-through response, which is wrapped with no plan at all — disables the filter completely: `push` returns the upstream chunk object itself, so the phase-2 pass-through property still holds byte for byte.

**Framing.** The filter decodes into a text buffer and processes only **complete** SSE records, split on the record separator (a blank line); an incomplete trailing record stays in the buffer until a later chunk completes it, or until `flush()` emits it verbatim at the end of the stream. A record that carries no `data:` line, or whose payload is `[DONE]`, or whose payload is not JSON, is forwarded verbatim and contributes no text: the filter never rewrites what it does not understand. Only `choices[0].delta.content`, and only when it is a string, adds to the accumulated completion text.

Because of that framing a chunk can complete no record at all — a network chunk split mid-frame — and the stream's `pull` therefore reads again rather than returning empty-handed: a `pull` that enqueues nothing is not guaranteed to be called back, and the page would wait forever on a stream that upstream is still feeding.

**The boundary test** is `findBoundary(accumulated, literal)` from `src/boundary.js` — the bare reserved literal at a block start and nothing else (`docs/modules/boundary.md#block-start-only`). A mid-paragraph mention is manuscript text and is forwarded like any other delta. This is INV-2 on the response side of this host; it exists because the `stop` parameter is not usable on every route ([Stop rejection learning](#stop-rejection-learning)).

**Deferred release.** A record is held rather than forwarded when the accumulated text ends in a non-empty **proper prefix** of the literal, and the held records are released verbatim, in order, as soon as a later record proves the match fails, or at `flush()`. The hold is therefore bounded by `literal.length - 1` characters of delta text — a few tokens, not the one-block hold-back the plan refuses (`docs/decisions/0007-janitor-host-deviations.md`) — and it is derived, never configured. Without it a literal split across frames (`Mar` + `a:`) would reach the page, and the human-visible saved message would carry a fragment of their own persona name.

**Cancel and synthesise.** When the literal does appear, the filter forwards the held records whose contribution ends at or before the cut; for the record that spans the cut it emits **one** synthesised `data:` frame carrying only the text before the cut as `choices[0].delta.content` (omitted when that text is empty); then a synthesised frame with `choices[0] = {index: 0, delta: {}, finish_reason: 'stop'}` and `data: [DONE]`. Synthesised frames copy `id`, `object`, `created` and `model` from the last parsed upstream frame and carry no field upstream did not send. The filter is then `done`: the shell cancels the upstream reader, closes the controller, and every later `push` returns nothing.

Synthesising the terminal frames rather than simply closing the stream early is the pinned choice of brief 0038: an early close with no terminal frames is believed to be a parse failure for Janitor (`docs/api/janitor.md#terminal-frames-are-synthesised-on-a-stream-cut`). The **recorded fallback**, not implemented, is to let upstream run to completion while forwarding nothing after the cut; it costs the tokens of a generation nobody reads, and it is adopted by amendment only if a capture shows Janitor's parser refusing the synthesised frames.

Whether Janitor saves the text the page received or an accumulator of its own is unverified (`docs/api/janitor.md#post-stream-save-path`). If the optimistic assumption is wrong, the human-visible saved message runs past the cut; the model-visible view stays correct because the next derivation trims at the literal (`docs/modules/janitor-adapter.md#derivation-rollback`).

**Non-streaming JSON.** When the response's content type is JSON rather than `text/event-stream` and the plan carries a literal, the body is read once through a clone. If it parses and `choices[0].message.content` is a string holding a block-start literal, that field is replaced by `trimAtBoundary(content, literal)` and a fresh `Response` is built from the re-serialised JSON with the original status, headers and copied metadata. Anything that does not parse, or that holds no boundary, is delivered unchanged. Only this one chat-completions shape is handled; no other dialect, and no Anthropic event stream.

**Completion report.** After the body finishes — a normal end, a boundary cut, or the JSON branch — the shell calls `plan.onCompletion({boundaryHit, text})` exactly once, inside a `try`, with the completion text the page actually received. It is not called for a pass-through response or for an error response. What the adapter does with it is `docs/modules/janitor-adapter.md#boundary-records`.

The wrap was introduced in phase 2, in a phase that changed no bytes, because this phase needed the seam and inserting it here would have been the risky change.

## Stop rejection learning (L1586–1670) {#stop-rejection-learning}

Some provider routes — the reasoning ones — answer a request that carries `stop` with a 4xx that names the parameter (`docs/api/janitor.md#reasoning-routes-reject-the-stop-parameter-with-a-4xx-naming-it`). INV-2 still has to hold there, so the script learns those routes and falls back to the stream cut.

The rule is narrow. When the dispatched response has a status in 400–499, the plan says `stopSent` was true, and the plan carries a route key, the shell reads `response.clone().text()` in a `try` and tests it against one module-level regexp, `/\bstop(?:_sequences)?\b/i`. On a match it calls `recordStopRejected(routeKey)` and warns once per key. The response itself goes back to Janitor untouched: no retry, no resend, no body rewrite. The human sees the provider's own error and sends again, and that second request omits `stop`.

The key is `` `${host}${path}|${model}` `` (`stopRouteKey`), because the refusal is a property of a provider endpoint and a model, not of a conversation. It lives in its own `localStorage` entry, `JANITOR_STOP_ROUTES_KEY` (`uid-janitor-stop-rejected-v1`), holding a JSON array of keys — deliberately not per chat, and deliberately a key that can never collide with `STORAGE_KEY_PREFIX + <chatId>`. An unreadable or unparsable value is treated as "nothing learned"; a write that throws warns once and is dropped, like `saveJanitorState` (`docs/modules/janitor-adapter.md#stored-state`).

Learning is **one-way and TTL-free**: a route that rejected `stop` stays learned for the life of the browser profile. There is no expiry, no probe to unlearn it and no UI to clear it, because the cost of being wrong is small and symmetrical — a route learned in error loses its stop parameter and relies on the stream cut, which is the same enforcement point the learned routes use anyway.

This is the optimizer's per-route rejected-parameter machinery (L1586–1670) narrowed to exactly one parameter. Its wider form — a compat state object per route, `flexUnsupported`, `cacheControlRejected`, a rejected-tag map, preflight rollback of ledger mutations and a reset path — is not ported: nothing else this script writes on the body has ever been observed to be rejected, and a learning table with one real entry and five speculative ones is five things to keep correct.

## Transform seam {#transform-seam}

`installTransport(transform)` takes the transform as a parameter rather than importing it. It has exactly two consumers — the protocol pipeline and the tests — which is precisely the case where a parameter beats a module-level import: the tests get to drive the shell without stubbing a module, and the protocol layer gets to add behaviour without editing the shell.

`transform(data, context)` may mutate `data` in place; `context` is `{...envelope, url, adapter}` when this conversation has an envelope, otherwise `{url, adapter}`. It returns either a falsy value — pass-through, and the body text the caller supplied is dispatched unchanged — or a **plan object** with five fields:

| Field | Meaning |
|---|---|
| `modified` | truthy when `data` was mutated, so the shell dispatches `JSON.stringify(data)` ([Re-serialise only when changed](#re-serialise-only-when-changed)) |
| `literal` | the reserved literal to suppress on the response, `''` for none |
| `stopSent` | whether the request carried the literal in its `stop` field |
| `routeKey` | the `host+path|model` key stop learning is filed under ([Stop rejection learning](#stop-rejection-learning)) |
| `onCompletion` | called once with `{boundaryHit, text}` when the response body finishes ([Response wrapper](#response-wrapper)) |

The boolean return is gone: a bare `true` is no longer part of the contract, and the shell's own tests return `{modified: true}`. A plan is not a settings object — it is one request's facts, built and discarded inside one call, and the shell reads each field exactly once.

The seam is wired. `janitor/main.js` passes `transformRequest` from `janitor/transform.js` (brief 0033, `docs/modules/janitor-adapter.md#request-pipeline`); the phase-2 no-op is gone. The pass-through property now holds exactly for the bodies the transform gates out — a non-`chat` adapter, a request with no recorded envelope, and an Anthropic-shaped body carrying a top-level `system` string — and for those the caller's own body string is dispatched unchanged and the response is forwarded byte for byte. The no-op transform survives only in the shell's own tests, which is what it was for.

## XHR detector

The current Janitor build dispatches the proxy completion through `fetch` with `accept: text/event-stream` (ledger 2026-09-13), so v1 hooks `fetch` only. An older build used `XMLHttpRequest`, and Janitor ships unannounced changes.

`installXhrWarning()` therefore wraps `XMLHttpRequest.prototype.open` once and, the first time it sees a completion-shaped URL, emits a single `console.warn` naming the degraded tier that a future XHR transport would fall back to — stop parameters plus a trim at the next derivation, with no live boundary, so the human would watch the model write their character while the model never sees it. Then it delegates to the original `open`.

It does nothing else: it never touches `send`, holds no per-instance state, and never reads or rewrites a body or a response. An XHR transport hook, an XHR-over-fetch shim and the response shadow are separate later tasks. There is nothing about XHR behaviour to test here, because there is no XHR behaviour.
