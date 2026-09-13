# Brief 0032 — Janitor identity, storage and the ST-shape shim (pure, unwired)
Status: draft
Complexity: high  (four new modules, a new persistence format, and the identity scheme INV-10 is argued over; nothing here is wired, but everything in brief 0033 is built on it)
PLAN sections: §3 (interaction-topology non-identifiability — the identity scheme and the stored state must persist no transport topology that can reach the model), §9 (human input is transformed into manuscript text, never preserved as a character-bearing user turn — the shim is what lets `deriveFrontier` do that on provider messages), §10 (editing is manuscript-wide within the mutable frontier — the prefix-hash watermark exists so a tail edit of the watermark message still re-derives instead of re-sending compiled text), §23 (a host reconstructs model-visible history from separately stored canonical state when native history editing is unavailable; on this host it is unavailable, so the store *is* the manuscript), §27 (no transport information reaches the model: ids and hashes live in private state only)
Invariants touched: INV-3 (the shim is what routes user turns through `toManuscriptBlock`), INV-10 (content hashes and the stored state must never surface in the model-visible output)

Depends on: **brief 0031** (merged) for the `maxFrozenEnd` option this brief's consumer will use — no code here calls it, but 0033 needs both. Brief 0033 depends on this one.

Scope source: `TamperContainment/PLAN-janitor.md` — "State and identity on Janitor" (storage key and shape, positional envelope ids used only for alignment, content-hash identity, prefix-hash watermark, the edit-to-compiled-text rule, the INV-10 argument); "Architecture" layer 3 (ST-shape shim, envelope diff, storage adapter); "Per-generation pipeline" request-side step 3b (injection classification) and step 5 (derive); "JanitorAI realities" 2, 4, 7, 12, 17, 20; "Layout and build". The SillyTavern host mapping (`docs/protocol/host-mapping.md`) does not apply.

## Goal
`janitor/` gains four pure, side-effect-free modules with no transport knowledge and no wiring: a content-hash identity scheme, a `localStorage` state adapter keyed by chat id, an envelope diff that classifies each provider message as history or injection, and a shim that presents provider `{role, content}` messages in the five-field SillyTavern shape `src/derive.js#deriveFrontier` reads and maps `src/frontier.js#buildHistory`'s output back to `{role, content}`. `janitor/main.js` is untouched: the no-op transform stays installed and the script's live behaviour is exactly what brief 0028 left. Vitest proves the four modules against recorded body fixtures and a fake `localStorage`.

## In scope

**`janitor/constants.js`** (new) — host constants, no settings, no readers of any stored preference:
- `SENTINEL = '//'` (plan, Decisions: "Sentinel literal is `//`"). Exact-match rule only; the consumer is 0033.
- `STORAGE_KEY_PREFIX = 'uid-janitor-v1:'`.
Every top-level name in this file must differ from every top-level name in `src/constants.js` and in the rest of the bundled graph — `tools/build-janitor.mjs` fails the build on a duplicate top-level name (`docs/modules/janitor-build.md#supported-module-syntax`).

**`janitor/identity.js`** (new) — pure:
- `fnv1a32(text)` → unsigned 32-bit hash, returned as a fixed-width lowercase hex string. One implementation, no seeds, no options.
- `messageIdentity(role, content, occurrence)` → `` `${fnv1a32(role + content)}#${occurrence}` ``. `content` is the **raw** provider string: no trim, no normalisation, no `{{user}}` substitution.
- `assignIdentities(messages)` → array of ids, one per input message, counting occurrences of an identical `(role, content)` pair from the front so duplicates get `#0`, `#1`, … Pure: returns ids, mutates nothing.
- `prefixIdentity(content, offset)` → `fnv1a32(content.slice(0, offset))`.
- `matchWatermark(ids, messages, watermark)` → given the stored watermark `{messageId, offset, prefixHash}`, return the index of the message that is the watermark message, or `-1`. Rule, in order: exact `messageId` match on an assigned id wins; otherwise a message whose `prefixIdentity(content, watermark.offset)` equals `watermark.prefixHash` and whose length is at least `offset` wins (that is the §10 tail-edit case); otherwise `-1`.
- `classifyDrift(ids, matchedFlags)` → `{ editedBeforeIndexes: number[] }`: the indexes of messages that matched no envelope/watermark expectation **and** sit before the last matched one. Reporting only — this module decides nothing and logs nothing.

**`janitor/storage.js`** (new) — the only file in `janitor/` that touches `localStorage`:
- `stateKey(chatId)` → `STORAGE_KEY_PREFIX + chatId`.
- `loadJanitorState(chatId, storage = localStorage)` → the stored object when it parses and its `version === STATE_VERSION` (imported from `src/constants.js`), otherwise a fresh `createState()` (`src/state.js`) extended with the three Janitor fields. Never migrates; a foreign or unparseable value is replaced, with one `console.warn`.
- `saveJanitorState(chatId, state, storage = localStorage)` → `JSON.stringify` and write; a throwing `setItem` (quota, disabled storage) is caught and warned once, never thrown at the caller.
- The stored shape is the v3 shape (`{version, frozen, units, frozenIds, watermark}`, `docs/modules/state.md#shape`) plus exactly three fields: `literal` (string, last recorded persona literal), `boundaries` (array of message identities, written by the later response-side brief, only round-tripped here) and `watermarkText` (string, full text of the watermark message). `watermark` additionally carries `prefixHash` and keeps `messageId`/`offset` as `src/state.js` writes them; `advanceWatermark` is not modified, so `prefixHash` is written by the caller (brief 0033) after it returns.
- A missing or empty `chatId` returns a fresh in-memory state and writes nothing.

**`janitor/history.js`** (new) — the envelope diff and the shim, both pure:
- `classifyMessages(messages, envelopeChatMessages)` → `{history: [{index, role, content}], injections: [{index, role, content}], systemIndex}`. Rules: the first `system`/`developer` message is the assembled context and is neither history nor injection (`systemIndex`); remaining messages are aligned **in order** against the envelope entries with `isMain === true` (`docs/modules/janitor-transport.md#envelope-record`) by exact string equality of content, two cursors, never by position index — a provider message that matches the next unconsumed envelope entry is history and consumes it; anything else is an injection, whatever its role. With no envelope (`null`/empty `chatMessages`) every non-system message is history and `injections` is empty; say so in the doc as the deliberate fallback.
- `toStShape(historyMessages, ids)` → `[{mes, is_user, is_system: false, extra: {[METADATA_KEY]: {id}}}]`, `is_user` being `role === 'user'`, `METADATA_KEY` imported from `src/constants.js`. No `name` field is invented and no message is mutated.
- `fromStShape(history)` → `[{role: msg.is_user ? 'user' : 'assistant', content: msg.mes}]`, dropping `name`/`is_system`/`extra`. This is the exact inverse of what `buildHistory` emits (`src/frontier.js:10–12`).
- A test in this brief runs `deriveFrontier(toStShape(...), state, literal)` and `fromStShape(buildHistory(state, {name1, name2}, {frontier}))` unmodified, proving the shim contract against the real `src/` functions.

**Tests** — `tests/janitor/identity.test.js`, `tests/janitor/storage.test.js`, `tests/janitor/history.test.js`, extending `tests/janitor/fixtures/` with (a) a provider chat body carrying a system message, alternating user/assistant history, a duplicated user message, an injected `system` message at depth, an injected `user` message at depth and an injected `assistant` message at depth; (b) a matching `/generateAlpha` envelope whose `chatMessages` contains the history entries only, with one non-`is_main` alternative present. The fake is a minimal in-memory `localStorage` stand-in defined in the test file; no `globalThis.SillyTavern` anywhere.

## Out of scope (explicit)
- Any wiring. `janitor/main.js` keeps `installTransport(() => false)`; nothing in `janitor/shell.js` changes; no module here is imported by the live transform. The bundle is not rebuilt.
- The system-prompt prepend, the sentinel drop, freeze, reconstruction, the horizon, the lead-in turn, the prefill strip, the stop array, the `console.info` line — all brief 0033.
- Anything response-side: stream cut, boundary recording, `classifyOutcome`, the INV-8 derivation-time trim. `boundaries` is a field this brief round-trips and no more.
- The panel, export/import, Recompile, the cross-tab `storage` event listener. Reloading state before a derivation is 0033's call site; there is no listener in v1 of this work.
- Editing `src/` in any way, including `advanceWatermark` for `prefixHash`, `createState` for the three extra fields, or `deriveFrontier`/`buildHistory` to be friendlier to the shim. If the shim cannot be built without an `src/` change, that is a `SCOPE_GAP`.
- An Anthropic adapter, a top-level `system` string, `stop_sequences`, or any second shape. The chat shape only.
- Repairing drift: `classifyDrift` reports indexes, it does not re-key state, delete spans or recompile.
- Any setting, toggle, or storage-format option; any new dependency.

## Files
- allowed to create: `janitor/constants.js`, `janitor/identity.js`, `janitor/storage.js`, `janitor/history.js`, `tests/janitor/identity.test.js`, `tests/janitor/storage.test.js`, `tests/janitor/history.test.js`, `tests/janitor/fixtures/*.js`, `docs/modules/janitor-adapter.md`
- allowed to modify: `docs/decisions/0007-janitor-host-deviations.md` (append the identity section only), `docs/README.md` (index line for the new doc)
- must not touch: `src/**`, `janitor/main.js`, `janitor/shell.js`, `janitor/envelope.js`, `janitor/shape.js`, `janitor/xhr-warning.js`, `tools/**`, `dist/**`, `index.js`, `manifest.json`, `package.json`, `eslint.config.js`, `tests/*.test.js`, `PLAN.txt`, `TamperContainment/**`, `docs/protocol/host-mapping.md`

## ST APIs used
- none. This host is janitorai.com; `globalThis.SillyTavern` must not be referenced in `janitor/` or `tests/janitor/`. Importing pure functions and constants from `src/` is not an ST API use — `src/derive.js`, `src/frontier.js`, `src/state.js` (`createState`) and `src/constants.js` reach no host object on the paths used here.

## Verification needed
- (empty) Every Janitor fact used is an answered item in `docs/api/janitor.md`: envelope ids are positional and usable only for alignment (2026-09-13); `is_main` most likely marks the selected alternative and the diff matches those entries only (2026-09-13); non-history turns are injected in any role (2026-09-13); an edited message is re-sent with its new text and a deleted one disappears (2026-09-13); `/generateAlpha` precedes every model invocation (2026-09-13). The open ledger items do not reach this brief: the storage adapter needs no context-size field, and the exact injection shapes only make the diff's fallback path more or less often taken, which is tested both ways. Do not launch `st-api-verifier`.

## Acceptance
- [ ] `fnv1a32` is stable across calls and processes for the same input, differs for `'a'`/`'b'`, and returns the documented fixed-width hex form.
- [ ] Two identical `(role, content)` messages in one array receive different ids (`#0`, `#1`); the same body re-sent on a later turn reproduces the same ids for the same messages.
- [ ] `matchWatermark` finds the watermark message by exact id; after a tail edit of that message it still finds it by prefix hash; after a head edit it returns `-1`.
- [ ] `classifyMessages` on the fixture puts the injected `system`, `user` and `assistant` messages in `injections` and the rest in `history`, in input order; the non-`is_main` envelope alternative never consumes a provider message; with `null` envelope every non-system message is history.
- [ ] Round trip: `fromStShape(buildHistory(state, names, {frontier: deriveFrontier(toStShape(history, ids), state, literal).text}))` produces `{role, content}` pairs only, with `[final, control] × n` roles alternating assistant/user, using unmodified `src/` functions.
- [ ] A user message goes through `toManuscriptBlock` by virtue of the shim alone: its derived text starts with `` `${literal}\n` `` (`docs/modules/derive.md#transformation-rule`).
- [ ] A message whose id is in `state.frozenIds` is dropped by `deriveFrontier` through the shim with no special-casing in `janitor/`.
- [ ] `loadJanitorState` round-trips `frozen`, `units`, `frozenIds`, `watermark` (including `prefixHash`), `literal`, `boundaries` and `watermarkText`; a `version: 2` blob, a foreign JSON object and an unparseable string each yield a fresh state and exactly one `console.warn`; a throwing `setItem` warns and does not throw.
- [ ] No file under `janitor/` references `SillyTavern`; `janitor/main.js` is byte-identical to its state after brief 0028 and `dist/` is unchanged.
- [ ] `npm run check` passes
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/janitor-adapter.md` — new; the adapter's doc, sibling to `docs/modules/janitor-transport.md`, which stays the transport's. Headings the pointer comments target, at minimum: `## Content-hash identity {#content-hash-identity}` (why `fnv1a32(role + content)` plus occurrence index rather than injected random ids or the envelope's positional ids; the known cost — deleting an earlier duplicate shifts occurrence indexes and can make an uncompiled twin match — and why that is acceptable given Recompile); `## Prefix-hash watermark {#prefix-hash-watermark}` (how a §10 tail edit of the watermark message still slices, what `offset`/`prefixHash` mean, and that `src/state.js` is unmodified so the caller writes `prefixHash`); `## Drift before the watermark {#drift}` (the edit-to-compiled-text rule, reporting only, mirroring `noticeFrozenEdit` without writing anything); `## Stored state {#stored-state}` (the key, the v3 shape plus `literal`/`boundaries`/`watermarkText`, why `watermarkText` is insurance against Janitor trimming the watermark message out of the request, why there is no migration path, and that storage is per browser so Export/Import — a later brief — is the only backup); `## Envelope diff {#envelope-diff}` (two-cursor alignment against `is_main` entries, why roles are never trusted, why alignment is by content and not by the positional ids, the no-envelope fallback, and that reconstruction discards depth so folding loses nothing); `## ST-shape shim {#st-shape-shim}` (the exact fields `deriveFrontier` reads and `buildHistory` emits, with the `src/` line references, and the rule that the shim adapts to `src/` and never the reverse); `## INV-10 under hashes {#inv-10}` (hashes and ids live in private state and never reach the model; decision 0004 rejected positional ids because they persisted topology into the chat file, and a hash list persists no more than SillyTavern's `frozenIds`).
- `docs/decisions/0007-janitor-host-deviations.md` — **append** one section, "Content hashes instead of injected ids, with a prefix-hash watermark": why the ST host's random `extra` ids have no counterpart when the history is server-side and read-only, what the occurrence-index cost is, and the alternatives rejected (envelope positional ids — decision 0004; a stored parallel array keyed by position — same objection). Do not restate or edit the sections written by brief 0031.
- `docs/README.md` — index line for `docs/modules/janitor-adapter.md`.
