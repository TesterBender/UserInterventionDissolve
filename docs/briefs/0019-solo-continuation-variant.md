# Brief 0019 — One-shot solo continuation variant
Status: done
Complexity: high
PLAN sections: §13 (continuation control must be semantically boring and non-evaluative; frozen history preferably uses one byte-identical canonical string — the live edge is not required to be that same string, and `docs/protocol/host-mapping.md#s13-continuation` states the live edge "may use a variant only if a brief justifies it"); §12 via `docs/protocol/host-mapping.md#s12-frontier` (the model-visible history is rebuilt from canonical state on every request, so a per-request variant lives only in the request array).
Invariants touched: INV-5, INV-10 (and INV-4 by construction: the variant cannot outlive one request).

## Goal
The collaborator can ask for exactly one continuation in which the manuscript moves without their character taking the page, by running `/uidsolo` instead of pressing Send on an empty composer. That single request's continuation-control turn is the canonical `CONTINUATION_CONTROL` text plus one added sentence naming the collaborator's figure as present-but-not-written; every other request, before and after, uses the canonical string byte-identically. The variant exists only inside the per-request `chat` array handed to the interceptor: canonical state, frozen spans and the persisted frontier never contain it, and nothing about it is stored, configurable, or repeatable without another explicit `/uidsolo`.

### Why this does not break INV-5 or INV-10 {#justification}
INV-5 says only one current continuation-control seam remains at the active edge, and that in frozen history the control text is byte-identical for cache stability. The solo variant replaces the text of that one seam for one request; it does not add a second seam, and it never reaches frozen history — `freeze` compiles frontier manuscript text, never the control turn, so a frozen span cannot contain it (acceptance covers this with a test). Prefix caching is unaffected for frozen spans, which are byte-identical regardless; only the final live turn differs, and only once. INV-10 holds because the variant is a function of a transient in-memory flag, not of canonical state: two chats with identical canonical state still produce identical persisted history, and the next request from either produces the identical canonical array.

## In scope
- `src/prompt.js`: add `export const SOLO_CONTINUATION_CONTROL` = the exact `CONTINUATION_CONTROL` string, a single space, then the added sentence below. Compose it from `CONTINUATION_CONTROL` by reference so the canonical prefix can never drift from it. The `{{user}}` placeholder is stored literally and never stored resolved.
  - **Draft added sentence (for the user's eye; the implementer must not reword it, and must not ship this brief until the user confirms or amends the wording):**
    `For this stretch, {{user}} is in the scene but stays out of the writing; let the others carry it.`
  - Pinned string. Do not reword during implementation. A user-requested change goes through the pinned-string lane (`docs/workflow/workflow.md#pinned-string-lane`) as an amendment to this brief.
- `src/solo.js` (new, ~3 exports, module-level boolean, no persistence):
  - `armSolo()` — sets the flag true; idempotent (arming while armed leaves exactly one pending solo request).
  - `consumeSoloFlag()` — returns the flag and clears it, so it is true at most once per arm.
  - `resolveSoloControl(ctx)` — returns `SOLO_CONTINUATION_CONTROL` with `{{user}}` resolved at request time: try `ctx.substituteParams(SOLO_CONTINUATION_CONTROL)`; if that throws, is not a string, or still contains `{{user}}`, replace `{{user}}` with `String(ctx.name1 ?? '').trim()`. Mirrors the existing resolution discipline in `reservedLiteral` (`src/boundary.js:13`). Never caches the result.
- `src/frontier.js`:
  - `buildHistory(state, names, options)` gains a third parameter; `options.control`, when a non-empty string, is used as the text of the single continuation user turn instead of `CONTINUATION_CONTROL`. Absent/empty/non-string → canonical. `buildHistory` stays pure: it does not read the flag, the context, or `substituteParams`.
  - `interceptGeneration`: when `shouldReconstruct(type)` is false, call `consumeSoloFlag()` and discard the result before returning `false` — a skipped (`quiet`/`impersonate`) generation must not leave a solo armed for the next real request. When reconstructing, call `consumeSoloFlag()` once and pass `{ control: resolveSoloControl(ctx) }` when it returned true, `undefined` otherwise.
- `index.js`: register one slash command `/uidsolo`, using exactly the verified call shape (`docs/api/sillytavern.md#slash-command-registration`):
  ```js
  const { SlashCommandParser, SlashCommand } = ctx;
  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'uidsolo',
    callback: soloCallback,
    helpString: '…',
    returns: '…',
  }));
  ```
  Both classes are read off `getContext()`; never imported from ST modules. `aliases`, `namedArgumentList` and `unnamedArgumentList` are omitted (the command takes no arguments and no alias — see Out of scope). The callback signature is `(namedArgs, unnamedArgs)` and must return a string or `Promise<string>`; this one ignores both arguments and resolves to `''`. Rules:
  - Registration is guarded like the event wiring already is: if `ctx.SlashCommandParser`, `ctx.SlashCommand` or `ctx.generate` is absent, log one `console.warn` with `LOG_PREFIX` and skip registration. No throw, no retry. No duplicate-name defence is written: a duplicate only `console.trace`-warns and overwrites, it never throws (`#slash-command-registration`), and `init()` is already idempotent via the `ready` flag.
  - Callback body: `armSolo()`, then `await ctx.generate('normal')` — the real `Generate`, which pushes no user message and continues from existing history (`docs/api/sillytavern.md#generate-normal-from-slash`, corroborated by `#slash-trigger` and `#empty-send`). The resolved value is ignored and must not be inspected or returned; the callback returns `''`.
  - If `ctx.generate` throws or rejects, call `consumeSoloFlag()` and discard it in a `catch`, log one `console.error` with `LOG_PREFIX`, and return `''` — a failed start must never leave the flag armed.
  - Registration happens inside `init()`, after the event wiring, before `renderSettings(ctx)`.
- Tests as listed under Acceptance.
- Doc headings as listed under "Docs to write/update".

## Out of scope (explicit)
- Any setting, toggle, checkbox, drawer control, or persisted preference for the solo variant. **Decision: the settings drawer is not touched at all** — no status-line sentence naming the command. The command is discoverable through ST's own slash-command autocomplete, which `helpString` feeds.
- A repeating / "N times" / "until further notice" solo mode, or any second flag.
- Any second continuation-control variant, or parameterising the sentence (no `/uidsolo <text>`, no `namedArgumentList`/`unnamedArgumentList` entries).
- Changing `CONTINUATION_CONTROL` itself, the system prompt, the seed, or the reference preset.
- Writing the variant into canonical state, `chatMetadata`, `extensionSettings`, or a frozen span; adding a marker to the reconstructed message's `extra`.
- New event subscriptions (GENERATION_ENDED / GENERATION_STOPPED handlers for flag hygiene). The clearing rules above — consumed by the interceptor, cleared on a skipped type, cleared on a failed `generate` — are the whole rule set.
- Any `/uidsolo` alias, second command, duplicate-registration guard, or `executeSlashCommandsWithOptions` usage.
- Reading `ctx.chat` after the awaited `generate` (the verified entry suggests it for callers that need the reply text; this callback needs nothing).
- Touching `src/freeze.js`, `src/capture.js`, `src/boundary.js`, `src/recovery.js`, or `src/constants.js` (in particular: do **not** add `SlashCommandParser`, `SlashCommand` or `generate` to `REQUIRED_KEYS` — their absence degrades the command, it does not disable the extension).
- The dryRun-parity path (brief 0012) — it is deferred and must not learn about solo.

## Files
- allowed to create/modify: `src/prompt.js`, `src/solo.js` (new), `src/frontier.js`, `index.js`, `tests/prompt.test.js`, `tests/frontier.test.js`, `tests/solo.test.js` (new), `tests/bootstrap.test.js` (registration assertions only), `tests/helpers/fake-context.js` (add `generate` and `SlashCommandParser`/`SlashCommand` fakes to the default context), `docs/modules/prompt.md`, `docs/modules/frontier.md`, `docs/modules/bootstrap.md`
- must not touch: `PLAN.txt`, `docs/protocol/*`, `docs/api/sillytavern.md`, `src/constants.js`, `src/state.js`, `src/freeze.js`, `src/capture.js`, `src/boundary.js`, `src/recovery.js`, `src/starter.js`, `src/ui/*`, `presets/*`, `manifest.json`, `style.css`

## ST APIs used
- `getContext()` — docs/api/sillytavern.md#getcontext (status: verified)
- `substituteParams`, `name1`, `generate`, `SlashCommandParser`, `SlashCommand` (presence as context keys) — docs/api/sillytavern.md#context-keys (status: verified)
- `SlashCommandParser.addCommandObject(SlashCommand.fromProps({…}))` — docs/api/sillytavern.md#slash-command-registration (status: verified)
- `await ctx.generate('normal')` from a slash-command callback: no user message pushed, resolved value not to be relied on — docs/api/sillytavern.md#generate-normal-from-slash (status: verified), corroborated by docs/api/sillytavern.md#slash-trigger and docs/api/sillytavern.md#empty-send (status: verified)
- `generate_interceptor` per-request array, skipped in dryRun — docs/api/sillytavern.md#generate-interceptor (status: verified)

## Verification needed
- (empty — `#slash-command-registration` and `#generate-normal-from-slash` landed verified; this brief is unblocked in full.)

## Acceptance
- [x] `SOLO_CONTINUATION_CONTROL.startsWith(CONTINUATION_CONTROL)` is true, the remainder is exactly `' '` plus the pinned sentence, and the constant contains the literal `{{user}}`.
- [x] `resolveSoloControl(ctx)` with `substituteParams: (s) => s.replace('{{user}}', 'Mara')` returns the sentence containing `Mara` and no `{{user}}`.
- [x] `resolveSoloControl(ctx)` with a `substituteParams` that throws, and with one that returns the string unchanged, both fall back to `ctx.name1`; with `name1` empty the placeholder is replaced by the empty string and the result still contains no `{{user}}`.
- [x] `buildHistory(state, names, { control: 'X' })` returns a final user turn whose `mes` is `'X'` while every assistant turn is unchanged; `buildHistory(state, names)`, `{ control: '' }` and `{ control: 42 }` all produce `CONTINUATION_CONTROL`.
- [x] `armSolo(); armSolo(); consumeSoloFlag()` is `true` and the immediately following `consumeSoloFlag()` is `false`.
- [x] With state present and the flag armed, `interceptGeneration(chat, …, 'normal', ctx)` produces a last message whose `mes` equals the resolved solo text; a second identical call with no re-arm produces `CONTINUATION_CONTROL` byte-identically.
- [x] `armSolo()` followed by `interceptGeneration(chat, …, 'quiet', ctx)` returns `false`, leaves `chat` untouched, and the next `'normal'` interception uses `CONTINUATION_CONTROL` (flag cleared by the skipped type).
- [x] INV-10/INV-5 test: after an armed solo request, the canonical state object (frozen spans, frontier) is deep-equal to what it was before, and no frozen span's `text` and no persisted value contains the solo sentence.
- [x] Bootstrap test: `init()` with a fake `SlashCommandParser`/`SlashCommand` calls `SlashCommand.fromProps` once with an object whose `name` is `'uidsolo'` and whose `callback` is a function, and passes that instance to `addCommandObject` exactly once; awaiting the registered callback with `({}, '')` calls `ctx.generate` with `'normal'`, pushes nothing onto `ctx.chat`, and resolves to `''`; when `ctx.generate` rejects, the callback still resolves to `''` and the flag is not left armed (a following `'normal'` interception uses `CONTINUATION_CONTROL`); with `SlashCommandParser` omitted from the context, `init()` still completes and `isReady()` is true.
- [x] `npm run check` passes
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/prompt.md#solo-continuation` — what `SOLO_CONTINUATION_CONTROL` is, that it is the canonical string plus one pinned sentence, why the placeholder stays unresolved in the constant, and that rewording goes through the pinned-string lane.
- `docs/modules/frontier.md#solo-variant` — the `control` option on `buildHistory`, the one-shot flag read in `interceptGeneration`, the three clearing rules, and the INV-5/INV-10 argument (copy the reasoning under `#justification` above, not the brief link). Must state explicitly that the variant never reaches canonical state or a frozen span. This heading is also the target for `src/solo.js`'s pointer comments; no new module doc is created.
- `docs/modules/bootstrap.md#slash-commands` — that `init()` registers one guarded slash command via `addCommandObject(SlashCommand.fromProps(…))` with both classes read off the context, what `/uidsolo` does, why it calls `ctx.generate('normal')` rather than pushing a message and why its resolved value is ignored, and why absence of `SlashCommandParser` is a warning rather than a capability-gate failure.
