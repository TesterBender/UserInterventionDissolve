# frontier
Owns: INV-4, INV-5, INV-10 (docs/protocol/invariants.md)
PLAN: §11, §12, §13, §24
Depends on: host, constants, prompt, state, derive, boundary

`src/frontier.js` turns the frozen spans plus the derived frontier into the history the model sees. It exports one pure builder (`buildHistory`), one in-place array replacement (`applyToRequestChat`), one generation-type test (`shouldReconstruct`) and the whole body of the `generate_interceptor` global (`interceptGeneration`). It writes nothing at all — no metadata save, no chat save, no id assignment, no mutation of state or of `chat[]`.

## Total reconstruction {#total-reconstruction}

PLAN §12: the model-visible history is rebuilt in full on *every* request, not patched at the moments the collaborator happens to intervene. Frozen spans come from canonical state; the mutable frontier is derived from `chat[]` on every call (`docs/modules/derive.md#derivation-rule`) and handed to `buildHistory` as `options.frontier` — the builder itself stays pure and reads no chat. Each request throws away the per-request chat array and writes a fresh one, so an intervention leaves no continuation seam behind it: the seams of all past interventions vanish at once because they were never in the array to begin with. Freezing (promoting derived text into a frozen span and advancing the watermark) belongs to `freeze`; this module never moves a byte between the two.

The live `chat[]` is an input to the derivation and never a target. The collaborator's own messages, `capture`'s `captured` marks and `boundary`'s trims all stay in the visible log exactly as they are; nothing is rewritten, hidden or deleted, and the reconstruction replaces only the per-request array (`docs/protocol/host-mapping.md#architecture`). INV-10 is still structural, but it is now stated over the derivation: two chats whose visible messages and whose canonical state agree produce byte-identical arrays, no matter how many edits, swipes, stops or barge-ins produced them, because none of that history is reachable from `chat[]`'s current contents.

## Shape of the reconstruction {#shape}

In order: for each **final** span in `state.frozen` whose text is a non-empty string, one assistant message carrying the span and then one user message carrying `CONTINUATION_CONTROL` (`docs/modules/prompt.md#continuation-control`); then one assistant "current frontier" message carrying the unsealed units and `options.frontier`, joined with `BLOCK_DELIMITER` and with blank pieces dropped; then exactly one user message carrying the live edge control. The result is `[A, U] × n, A_frontier, U_edge`.

The historical controls are `CONTINUATION_CONTROL` **by reference**, byte-identical on every call and never `options.control`: the addendum (§6, §11) keeps a sparse canonical seam between final spans and forbids rewriting one that has already entered history, and INV-5 makes them identical rather than merely similar. Only the last user turn takes `options.control` (see [One-shot solo variant](#solo-variant)).

Internal tier boundaries create **no** model-visible turns (addendum §10): the units are concatenated into the one frontier message, so a final span that was compiled from three units is indistinguishable from one compiled in a single cut. The frontier message is omitted entirely when every piece is blank, and the live edge control is pushed **only if** that message was pushed — which is what keeps the array strictly alternating and free of two consecutive user turns. A state with finals but nothing unsealed and nothing hot therefore ends with the canonical control after its last final, and that control is the edge seam.

Because past finals and their controls are emitted from `state.frozen` alone, the provider-visible prefix grows monotonically: two builds from the same `frozen` with different units or frontier text agree byte-for-byte on the first `2n` messages, and appending a new final leaves those `2n` untouched (addendum §8, §11). The frontier string is passed through verbatim — not trimmed, not re-joined, not re-wrapped; `derive` owns block joining (`docs/modules/derive.md#derivation-rule`). `span.words` and `span.createdAt` are never read; they are bookkeeping for `freeze` and never reach the model.

A produced message has exactly five fields (`docs/api/sillytavern.md#message-shape`): `name`, `is_user`, `is_system`, `mes`, `extra`. `is_system` is set to `false` explicitly because ST's prompt filter is `!x.is_system`. `extra` carries `{ [METADATA_KEY]: { reconstructed: true } }` and nothing else.

Deliberately absent: `send_date`, `gen_started`, `gen_finished`, `swipes`, `swipe_id`, token counts, index and id. Every one of those varies per request or per wall-clock moment, and any of them would make two runs from the same canonical state differ byte-for-byte. Their absence is what lets INV-10 and INV-5 be tested by `JSON.stringify` comparison, and it is what gives the frozen prefix the stability PLAN §23 asks of prefix caching: the same canonical state serialises to the same bytes today and tomorrow.

`assistantName` is `String(name2 ?? '')` and `userName` is `String(name1 ?? '')`, read off a fresh context per request. An empty persona name is legal (`docs/modules/bootstrap.md#capability-gate`) and is never substituted with a placeholder; `name2` is not added to `REQUIRED_KEYS`.

## What the interceptor cannot see {#interceptor-scope}

`generate_interceptor` receives `coreChat` — a fresh array of fresh objects built from the chat history alone (`docs/api/sillytavern.md#generate-interceptor`). The character card, the persona, world info, dialogue examples and system blocks are assembled elsewhere and are structurally out of reach on this path. "Only the chat-history portion is replaced" therefore needs no filtering code here: there is nothing else in the array to protect. Because the array is per-request, clearing and refilling it affects only the request in flight on both the chat- and text-completion paths, never stored history.

`applyToRequestChat` never reassigns its argument — the caller's array object is what ST reads back, so the replacement is `chat.length = 0` followed by a `push` loop. A loop rather than `push(...history)`, because a long frozen list would otherwise be passed as one argument per span and could hit the engine's argument-count limit.

## Interceptor body {#interceptor-body}

`interceptGeneration(chat, contextSize, abort, type, ctx = getCtx())` is the whole body of the global; `index.js` holds one delegating line and no logic (`docs/modules/bootstrap.md#interceptor-placeholder`). Four steps:

1. Return `false` when `shouldReconstruct(type)` is false.
2. Read canonical state with `getState(ctx)` and derive the frontier from `ctx.chat` with `deriveFrontier(ctx.chat, state, reservedLiteral(ctx), { excludeLastAssistant: regeneratesLastMessage(type) })` — `true` for `'swipe'` only.
3. Build the history from that state plus `ctx.name1` / `ctx.name2`, passing the derived text as `options.frontier`.
4. Return `applyToRequestChat(chat, history)` — `true` when it replaced anything.

The generation type selects the **derivation scope** as well as whether to reconstruct at all. `regeneratesLastMessage(type)` is `true` for exactly `'swipe'`, and for nothing else. A swipe replaces the last model output, and ST leaves that message in the live `chat[]` — it removes it from the request copy alone, with `coreChat.pop()` (`docs/api/sillytavern.md#swipe-scope`) — so derivation, which reads `ctx.chat`, has to drop it itself (`docs/modules/derive.md#regeneration-scope`); otherwise the model is shown its own last attempt as manuscript and writes a continuation of it instead of an alternative to it.

`'regenerate'` passes `false` even though it also replaces the last output: ST has already deleted that message from `chat[]` before `Generate` runs, so the frontier derived from the live chat excludes it with no help from us. Dropping "the last assistant message" there would drop the *previous* one, which this protocol produces in pairs routinely — empty-send continuations leave consecutive assistant messages. `'continue'` passes `false` because ST appends the model's output to the last message, so the manuscript it continues must still contain it. `'normal'`, `undefined` and every other reconstructed type pass `false` too. The post-receipt freeze derivation in `recovery` takes no options by design (`docs/modules/recovery.md#freeze-hookup`): by receipt time the message holds the *new* text, which belongs in the frontier that freezing measures.

The derivation is repeated in full on every request, with no cache, no dirty flag and no debounce (`docs/modules/derive.md#purity`); the reserved literal is resolved fresh per request from `boundary` (`docs/modules/boundary.md#reserved-literal`), the same source the stop string uses.

The body is `src/frontier-host.js`; `buildHistory`, `applyToRequestChat`, `shouldReconstruct` and `regeneratesLastMessage` stayed in `src/frontier.js` unchanged (`docs/modules/host.md#host-shell`). The reconstruction INV-4 and INV-5 rest on is therefore the same code on every host, proved by the same tests.

`ctx` is a defaulted parameter so tests can inject a host without a global (`docs/decisions/0002-structure-from-intercede.md`), and it is never cached (`docs/api/sillytavern.md#getcontext`). `contextSize` is accepted and ignored: no trimming, no budget arithmetic, no dropping of frozen spans to fit. `abort` is accepted and never called — this module has no failure mode that should cancel a generation; an empty or malformed state simply leaves the request array alone. Nothing is persisted: no `saveMetadata`, no `saveChat`, no mutation of canonical state. `getState` may lazily materialise state on first read (`docs/modules/state.md#lazy-init`); that is `state`'s documented behaviour, and this module adds no persistence of its own.

## Generation types this module skips {#skipped-generation-types}

`shouldReconstruct(type)` is `false` for `'quiet'` and `'impersonate'` and `true` for everything else, including `undefined` and unknown strings (`docs/api/sillytavern.md#generation-types`). A `quiet` generation is out-of-band: its output never becomes a manuscript block, so replacing its history would corrupt an operation the protocol has no stake in. An `impersonate` generation is ST writing the collaborator's own turn, which must see the chat as it stands. Everything else — `'normal'`, `'continue'`, `'regenerate'`, `'swipe'`, a host build that passes nothing, a future type string — is a manuscript request and is reconstructed, because failing open to "reconstruct" keeps INV-3 rather than silently leaking a live history.

This is the same rule and the same reasoning as `src/boundary.js` (`docs/briefs/0008-boundary-module.md`, "Generation-type rule"). The two must not drift: if one module ever starts skipping a third type, the other has to follow in the same task.

## Empty state is not a wipe {#empty-state}

When there are no usable frozen spans *and* the frontier is blank, `buildHistory` returns `[]` and `applyToRequestChat` refuses an empty history, so the request array is left exactly as ST built it. A lone continuation-control turn would be worse than doing nothing: it would erase a real chat's history from the model's view and then ask it to "continue" from nothing.

In practice this case is a genuinely empty chat: a chat with any non-system content above the watermark derives a non-blank frontier (`docs/modules/derive.md#derivation-rule`), so the only way to reach `[]` is to have nothing frozen and nothing left to derive. Where there really is nothing, leaving the array alone is indistinguishable from replacing it.

## INV-10 in one test {#inv-10}

INV-10 has a second testable half here: **prefix stability**. Building twice from the same `state.frozen` with different `units` and `frontier` yields byte-identical first `2n` messages, and appending a final leaves the earlier `2n` unchanged — the monotonic growth the addendum (§8, §11) asks for, checked by `JSON.stringify` on the slice rather than by trusting the loop.

INV-10 — many live histories, one model-visible manuscript. The test is a byte comparison: two fake contexts whose canonical state and whose *visible messages* agree, but which were produced by completely different interaction histories (one message written in six generations with edits and swipes between them, versus the same text arriving at once), produce `JSON.stringify`-equal arrays. The same comparison is run a second time under `type === 'swipe'`, so the narrowed derivation scope (`docs/modules/derive.md#regeneration-scope`) is held to the invariant too. Live topology — who stopped whom, how many swipes were browsed, where the human barged in — is not recorded anywhere, so it cannot reach the output. That test is only writable because the output contains nothing time-varying (see [Shape](#shape)); the moment a `send_date` appeared, the invariant would still hold in spirit but could no longer be checked mechanically, and the prefix-caching claim of PLAN §23 would quietly stop being true.

## dryRun parity is elsewhere {#dryrun-parity}

`generate_interceptor` is skipped during dryRun, the token-count preview (`docs/api/sillytavern.md#generate-interceptor`). The prompt manager therefore shows token numbers for the *live* history, not for the reconstruction, until brief 0012 applies the same transformation on the prompt-ready events. This affects the displayed count only: the request that is actually sent always goes through this module, because the real generation is never a dryRun.

## One-shot solo variant {#solo-variant}

`buildHistory(state, names, options)` takes an optional third argument. When `options.control` is a non-empty string it becomes the `mes` of the **live edge** user turn instead of `CONTINUATION_CONTROL`; the controls between final spans never take it. When the frontier message is omitted — no unsealed units and nothing hot — no edge turn is pushed at all, so the solo variant is silently dropped for that request: there is no turn it could apply to, and inserting one would add a seam to stable history. The next request with anything mutable applies it normally; anything else — absent, `undefined`, `''`, a non-string — yields the canonical string. `buildHistory` stays pure: it does not read the solo flag, the context, or `substituteParams`, so the same `(state, names)` pair still produces the same array.

`src/solo.js` holds the whole mechanism: a module-level boolean, `armSolo()` (idempotent — arming twice leaves exactly one pending request), `consumeSoloFlag()` (returns and clears, so an arm is true at most once), and `resolveSoloControl(ctx)`, which resolves `{{user}}` at request time by trying `ctx.substituteParams(SOLO_CONTINUATION_CONTROL)` and falling back to `ctx.name1` when that throws, returns a non-string, or leaves the placeholder standing — the same resolution discipline as `reservedLiteral` (`docs/modules/boundary.md#reserved-literal`). Nothing is cached and nothing is persisted. The text itself is `docs/modules/prompt.md#solo-continuation`.

`interceptGeneration` applies three clearing rules, which are the whole rule set — there are no GENERATION_ENDED/STOPPED subscriptions:

1. A skipped type (`quiet`, `impersonate`) consumes and discards the flag before returning `false`, so an out-of-band generation cannot leave a solo armed for the next real request.
2. A reconstructing request consumes the flag once and, when it was armed, passes `{ control: resolveSoloControl(ctx) }`.
3. `/uidsolo` clears the flag itself if `ctx.generate` throws or rejects (`docs/modules/bootstrap.md#slash-commands`).

### Why INV-5 and INV-10 hold {#solo-variant-invariants}

INV-5 says one current continuation-control seam remains at the active edge, and that in frozen history the control text is byte-identical for cache stability. The solo variant replaces the text of that one seam for one request; it does not add a second seam, and it never reaches frozen history — `freeze` compiles frontier manuscript text, never the control turn, so a frozen span cannot contain it. Prefix caching is unaffected for frozen spans, which are byte-identical regardless; only the final live turn differs, and only once.

INV-10 holds because the variant is a function of a transient in-memory flag, not of canonical state: two chats with identical canonical state still produce identical persisted history, and the next request from either produces the identical canonical array. The variant exists only inside the per-request `chat` array handed to the interceptor (`docs/api/sillytavern.md#generate-interceptor`) — canonical state, frozen spans and the persisted frontier never contain it, and nothing about it is stored, configurable, or repeatable without another explicit `/uidsolo`.
