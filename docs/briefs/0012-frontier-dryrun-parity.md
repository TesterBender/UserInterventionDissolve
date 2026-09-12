# Brief 0012 — `frontier`: dryRun parity for the token-count preview
Status: deferred (awaiting user decision, see Verification result below)
Complexity: high
PLAN sections: §12 (normalisation happens on every request; the model-visible manuscript is the reconstruction, so any preview of "what will be sent" that shows the raw live history is showing something that will never exist), §13 (the single continuation-control turn is part of that reconstruction and therefore part of its token cost)
Invariants touched: INV-4, INV-5 (neither is *established* here — brief 0010 establishes both for the request that is actually sent; this brief only makes SillyTavern's dry-run token preview agree with it)

## Goal
The prompt-manager's token-count preview reflects the reconstructed history rather than the live `chat[]`. The `generate_interceptor` is skipped during dryRun (`docs/api/sillytavern.md#generate-interceptor`), so the same reconstruction brief 0010 produces is applied a second time in `CHAT_COMPLETION_PROMPT_READY` by splicing the chat-history portion of `eventData.chat` in place. Applying it when the interceptor has already run must be a no-op, and nothing outside the chat-history portion of that array may be disturbed. Only the displayed count changes; the request that is sent is already correct without this brief.

## Blocked — read this first
This brief must not be implemented until every item under **Verification needed** is `status: verified` in `docs/api/sillytavern.md`. The element shape of the prompt-manager array and the way its chat-history entries are identified are both load-bearing for every line of code here, and neither is currently recorded. Do not infer them from the OpenAI wire format.

## In scope (conditional on verification)
- **`src/frontier.js`** — two additions, no change to anything brief 0010 shipped:
  - `toPromptManagerEntries(history)` → array. Pure. Maps each ST-shaped message from `buildHistory` to the prompt-manager's element shape, using exactly the field names and role values the verification records. Nothing is dropped or merged; one message in, one entry out, same order.
  - `onChatCompletionPromptReady(eventData, ctx = getCtx())` → `boolean`. Reads `{ chat, dryRun }` (`docs/api/sillytavern.md#chat-completion-prompt-ready`). Locates the chat-history slice by the identification rule the verification records, computes `toPromptManagerEntries(buildHistory(getState(ctx), { name1: ctx.name1, name2: ctx.name2 }))`, and splices that slice in place with `chat.splice(start, count, ...entries)`. **Never assigns `eventData.chat`** — replacement is not honoured on this path; the local array is what becomes `generate_data.messages` (`#chat-completion-prompt-ready`). Returns `false` without touching anything when the history is empty (brief 0010's empty-state rule) or when no chat-history slice is found.
  - **Idempotence is content-based, not marker-based.** If the existing slice already deep-equals the computed entries, return `false` and splice nothing. Do not rely on `extra[METADATA_KEY].reconstructed` surviving into the prompt-manager array — whether it does is an open question (Verification needed, item 3), and a content comparison is correct whether the interceptor ran or not. Applying the same pure reconstruction twice is a no-op by construction; the check exists so the handler can report and test that.
  - The handler runs in both dryRun and non-dryRun. `dryRun` is read for logging/tests only, never to skip work: making the two paths differ is precisely the bug this brief removes.
- **`index.js`** — one guarded `CHAT_COMPLETION_PROMPT_READY` subscription added to the existing guarded-subscription block (briefs 0008/0009 shape), handler passing only the payload. No other change; the interceptor global stays exactly as brief 0010 left it.
- **`tests/frontier.test.js`** — added cases only; brief 0010's cases stay green unchanged.
- **`docs/modules/frontier.md`** — the `{#dryrun-parity}` heading brief 0010 wrote is rewritten to describe the implemented handler, plus one new heading per added pointer comment.

## Out of scope (explicit)
- **Text-completion dryRun parity.** `GENERATE_AFTER_COMBINE_PROMPTS` carries the whole prompt as one string including card, persona and world info (`docs/api/sillytavern.md#generate-after-combine-prompts`), so there is no chat-history portion to replace without reimplementing ST's prompt assembly — that is rejected outright. `GENERATE_BEFORE_COMBINE_PROMPTS` may expose the history as a separate field, but which field and whether mutating it is honoured are unverified (Verification needed, item 4). Until that is settled the accepted position is: **the text-completion token preview may be wrong; the request that is sent is right** (the interceptor covers it). No code for either event may be written under this brief.
- Changing `buildHistory`, `applyToRequestChat`, `shouldReconstruct`, `interceptGeneration`, or the interceptor wiring.
- Any `squash_system_messages`, message-merging, role-rewriting, token-counting, budget-trimming or example-message suppression. The splice replaces the history slice and touches nothing else.
- Suppressing, reordering or re-marking prompt-manager system blocks, the card, persona, world info or dialogue examples.
- Any setting, toggle or "show what will be sent" UI.

## Files
- allowed to create/modify: `src/frontier.js` (additions only), `index.js` (one guarded subscription only), `tests/frontier.test.js` (additions only), `docs/modules/frontier.md`, and this brief's Status line.
- must not touch: everything in brief 0010's must-not-touch list, plus `docs/modules/bootstrap.md` (brief 0010 already settled the interceptor section; add the subscription note to the existing subscriptions heading only if one exists, otherwise leave it), `manifest.json`, `tools/*`.

## ST APIs used
- CHAT_COMPLETION_PROMPT_READY — docs/api/sillytavern.md#chat-completion-prompt-ready (status: verified) — payload `{chat, dryRun}`; in-place mutation honoured, replacement of `eventData.chat` not honoured; chat-completion API only.
- Chat-completion body assembly and dryRun — docs/api/sillytavern.md#body-assembly (status: verified) — hook order: interceptor (skipped in dryRun) → PROMPT_READY → GENERATE_AFTER_DATA → [dryRun returns].
- `generate_interceptor` — docs/api/sillytavern.md#generate-interceptor (status: verified) — the "skipped in dryRun" fact this brief exists to compensate for.
- `SillyTavern.getContext()`, context keys `name1`, `name2`, `chatMetadata` — docs/api/sillytavern.md#getcontext, #context-keys (status: verified).
- GENERATE_AFTER_COMBINE_PROMPTS — docs/api/sillytavern.md#generate-after-combine-prompts (status: verified) — cited only as the reason the text path is refused.

## Verification needed
1. **Element shape of `CHAT_COMPLETION_PROMPT_READY`'s `chat` array** (from `chatCompletion.getChat()`, `openai.js:1607` / `:4025-4037`): the exact own-property names of one element (is it `{role, content}`? is `name` present? `identifier`? anything else?), the permitted `role` values, and whether extra own properties added by an extension survive into `generate_data.messages`.
2. **How chat-history entries are identified within that array**: does an element carry an identifier tying it to the prompt manager's `chatHistory` collection, or is position/role the only available signal? What is the reliable rule for locating the contiguous chat-history slice (start index and length) without misidentifying dialogue examples, the persona/card blocks or injected prompts? `#body-assembly` does not say.
3. **Whether a per-message field written by the interceptor survives into that array** — specifically, is `extra` (or any non-`mes` field) of a `coreChat` message carried through into the prompt-manager entry? Needed only to confirm that marker-based idempotence is unavailable and content-based comparison is the right choice.
4. **`GENERATE_BEFORE_COMBINE_PROMPTS` (`script.js:5151-5178`)**: which `data` field holds the chat-history portion of the text-completion prompt (`mesSendString`? `finalMesSend`? both, and how they relate), and whether mutating that field is honoured by the `combine()` closure or whether only `data.combinedPrompt` is read. If mutation is not honoured, item 4 is closed as "text dryRun parity impossible without reassembling the prompt" and the Out-of-scope position above becomes permanent.

## Acceptance
- [ ] With state `{frozen:[{text:'A'}], frontier:'B'}` and a fake prompt-ready payload containing card/persona entries plus a live chat history, the handler leaves every non-history entry byte-identical and replaces the history slice with entries deep-equal to `toPromptManagerEntries(buildHistory(state, names))`.
- [ ] `eventData.chat` is the same array object afterwards (`Object.is`) — mutation only, never replacement.
- [ ] Running the handler twice on the same payload changes nothing on the second run and returns `false` (content-based idempotence); running it on a payload whose history slice was already reconstructed by the interceptor likewise returns `false`.
- [ ] The handler behaves identically for `dryRun: true` and `dryRun: false` given the same payload (assert byte-equal results).
- [ ] Empty canonical state leaves the payload byte-identical and returns `false`.
- [ ] The reconstructed slice ends with exactly one continuation-control entry and contains exactly one user-role entry (INV-5 preserved through the mapping).
- [ ] `src/frontier.js` still contains no occurrence of `SillyTavern`, and no `GENERATE_AFTER_COMBINE_PROMPTS`/`GENERATE_BEFORE_COMBINE_PROMPTS` handling.
- [ ] All of brief 0010's acceptance items still pass unchanged.
- [ ] `npm run check` passes.
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/frontier.md`:
  - rewrite `## dryRun parity is elsewhere {#dryrun-parity}` into the implemented behaviour: why the second application exists (the interceptor is skipped in dryRun), that it mutates in place because replacement is not honoured, and that it is idempotent by content.
  - `## Prompt-manager mapping {#prompt-manager-mapping}` — the verified element shape, the field-by-field mapping from an ST message, and the verified rule for locating the chat-history slice; state plainly that everything outside that slice (card, persona, world info, examples, system blocks) is left alone.
  - `## Text completion has no dryRun parity {#text-dryrun-gap}` — the accepted gap and its bound: the sent request is correct via the interceptor; only the preview can be wrong. Record the outcome of Verification item 4 here.

## Verification result (2026-09-12)
- docs/api/sillytavern.md#prompt-ready-history-slice is **verified-negative**: the CHAT_COMPLETION_PROMPT_READY array is flat `{role, content}` objects with no identifier and no `extra` (#prompt-ready-entry-shape, #prompt-ready-extra-survival); the chat-history slice cannot be located reliably. Only fragile content-matching against live `chat[]` text would work.
- #before-combine-history-field is **verified**: on the text-completion path `data.finalMesSend[i].message` is honored by `combine()`, so text-completion preview parity IS achievable (contrary to this brief's original assumption).
- Orchestrator decision: deferred. The sent request is already correct via the interceptor (brief 0010); parity only affects the token-count preview. Options for the user: (a) accept a stale preview on chat completion and implement only the text-completion `finalMesSend` splice; (b) implement content-matching on chat completion and accept fragility; (c) drop parity entirely.
