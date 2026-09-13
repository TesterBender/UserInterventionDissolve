# janitor-adapter

Owns: INV-3 routing (through the shim, not by a rule of its own) and INV-10 (envelope ids, offsets and the watermark hash stay in private state).
PLAN: §3 (interaction-topology non-identifiability), §9 (human input becomes manuscript text), §10 (manuscript-wide editing inside the mutable frontier), §23 (canonical state reconstructs model-visible history when the host cannot edit it), §27 (no transport information reaches the model)
Depends on: `src/constants.js`, `src/state.js` (`createState`), and — at its call sites — `src/derive.js` and `src/frontier.js`. No `globalThis.SillyTavern`; this host is janitorai.com.

`janitor/constants.js`, `janitor/identity.js`, `janitor/storage.js` and `janitor/history.js` are the adapter layer of the Janitor userscript: the pure modules between the transport shell (`docs/modules/janitor-transport.md`) and the protocol code in `src/`. On SillyTavern the extension owns the chat array, stamps its own random message ids into `extra` and saves state into the chat file. On Janitor none of that exists: history lives on Janitor's server, arrives as an opaque `{role, content}` array in the request body, and is read-only. This layer manufactures the three things `src/` assumes and the host does not give — a stable identity per message, a place to keep canonical state, and the message shape `deriveFrontier` reads.

`janitor/transform.js` (brief 0033) is the call site: it is installed by `janitor/main.js` as the shell's transform and drives every function in this layer once per outgoing provider request. Its own behaviour is documented from [Request pipeline](#request-pipeline) down.

Janitor facts cited below are ledger entries in `docs/api/janitor.md`, not source: Janitor is closed source.

## Envelope-id identity {#envelope-id-identity}

A message's identity is the `id` of the `/generateAlpha` envelope entry it aligned to, rendered as a string: `'103237690204'`. That id is what `extra[METADATA_KEY].id` carries into `deriveFrontier`, what `state.frozenIds` lists, what `state.watermark.messageId` names and what `state.boundaries` holds.

It is available because the 2026-09-14 capture retired the premise the earlier rejection rested on. The envelope's ids were reported as positional (ledger 2026-09-13), and a positional id is precisely what `docs/decisions/0004-derived-frontier.md` rejected: it renumbers on every deletion and it records where in the exchange a turn sat. They are in fact large integer **database** ids (`docs/api/janitor.md#envelope-message-entries-carry-database-ids`) — Janitor's own key for the stored row, assigned once, unchanged by the deletion, editing or reordering of any other message.

The id is read off the entry that [alignment](#envelope-diff) already chose. It is never used to *find* the entry: alignment stays two-cursor, by content and order, so a change in Janitor's numbering cannot silently pair a provider message with the wrong envelope entry — it can only leave an entry unaligned, which is a visible symptom with a known cause.

An entry whose envelope record carries no usable id gets `''`. An empty id is never in `frozenIds`, never matches the watermark by id, and — because the freeze gate additionally requires every kept entry to carry a non-empty id — makes that request compile nothing rather than write `''` into `frozenIds`, where it would name every id-less message at once. A request that cannot identify its messages loses nothing by compiling nothing: the next request that can identify them derives the same frontier and compiles it.

The duplicate-collision cost the content-hash scheme accepted is gone with the occurrence index. Two byte-identical messages have two database ids because Janitor's database says so, so compiling the first leaves the second in the frontier, and deleting either one renumbers nothing.

`fnv1a32` survives in this layer for exactly one caller, the watermark's [prefix hash](#prefix-hash-watermark).

## Content-hash identity (superseded) {#content-hash-identity}

Superseded by [Envelope-id identity](#envelope-id-identity). Identity is no longer `fnv1a32(role + content)` plus an occurrence index, and `messageIdentity` and `assignIdentities` no longer exist.

## Prefix-hash watermark {#prefix-hash-watermark}

The prefix hash is FNV-1a/32: it needs no dependency, allocates nothing, and gives the same value for the same text in every process, so a hash stored in one session matches in the next. It identifies a compiled prefix, not a message, so its collision space is one message wide.

A freeze cuts mid-message, so state records `{messageId, offset}` — the one partially consumed message and the character offset the cut ran through (`docs/modules/state.md#shape`) — and this layer adds `prefixHash`. `messageId` is an envelope id string ([Envelope-id identity](#envelope-id-identity)); `prefixHash` is `fnv1a32(content.slice(0, offset))`, the hash of the **compiled part only**.

`matchWatermark(entries, watermark)` tries, in order:

1. an entry whose non-empty `messageId` equals `watermark.messageId` — the normal case now. A §10 tail edit of the watermark message keeps its database id, so the edit costs nothing and the same cut still applies. An empty `messageId` never matches here.
2. with `offset > 0` and a non-empty `prefixHash`: an entry at least `offset` characters long whose first `offset` characters hash to `prefixHash`. This is what survives an id that is not in the request — Janitor trimmed the message out and later sends it again, or a regenerate replaced it with a new row and therefore a new id. Everything the model has already seen is byte-identical and only the uncompiled tail differs, so the same cut is still correct, and the caller re-keys the watermark to the matched entry's id.
3. `-1` — a head edit, or a message shorter than the offset. The compiled prefix no longer exists in the request and no cut is honest. What to do about that is the caller's decision (brief 0033); this module only answers the question.

`src/state.js` is unmodified by this layer, so `advanceWatermark` still writes `{messageId, offset}` and the caller writes `prefixHash` onto the watermark after it returns.

## Drift: edits to compiled text {#drift}

`classifyDrift(entries, state)` is the Janitor counterpart of SillyTavern's `noticeFrozenEdit`. With identity supplied by the host's database rather than derived from the text, the test is exact rather than positional: it no longer infers an edit from *where* an unmatched message sits. It returns `{editedCompiledIndexes}`, the entries that are demonstrably no longer the text that was compiled:

- an entry whose non-empty `messageId` is in `state.frozenIds` and whose non-empty `content` is **not a substring** of the compiled corpus — `[...state.frozen, ...state.units]` joined by `BLOCK_DELIMITER`. A fully consumed message's text sits verbatim inside a compiled span (a human turn only gains the own-line `Persona:` header in front of it), so "is this still the text that was compiled?" is decidable from state as it already stands, with no second copy of the manuscript and no per-message hash;
- the entry matched as the watermark message by id, when `prefixIdentity(content, watermark.offset)` no longer equals `watermark.prefixHash` — its compiled head changed, which is the head-edit case the watermark's rule 2 deliberately refuses to honour.

The one residual false negative is an edit whose new text happens to occur elsewhere in the corpus — replacing a paragraph with a sentence the manuscript already contains. Closing it would mean storing a hash per compiled message, which is a second identity scheme in the store for a case that is reported and not repaired either way; the substring test needs nothing stored and is wrong only in the direction of silence.

It reports and no more: no re-keying, no span deletion, no recompile, no log line of its own. Exclusion from the frontier is `frozenIds` membership doing its existing job inside `deriveFrontier`, not something this function performs. Compiled text is never rewritten (INV-6); the only honest responses are to leave it alone or to rebuild state deliberately, and both belong to a call site with a human in front of it.

## Stored state {#stored-state}

The key is `STORAGE_KEY_PREFIX + chatId` — `uid-janitor-v1:<chat id>` — in `localStorage`, with the chat id taken from the `/generateAlpha` envelope (`docs/modules/janitor-transport.md#conversation-binding`). `janitor/storage.js` is the only file under `janitor/` that touches `localStorage`.

The stored value is the v3 state shape (`docs/modules/state.md#shape`) plus exactly four fields:

- `literal` — the last recorded reserved literal, derived from the envelope's persona name. Stored because a completion request can arrive before this page has seen an envelope.
- `boundaries` — envelope id strings ([Envelope-id identity](#envelope-id-identity)) of messages whose generation stopped at the reserved literal. Written response-side by a later brief; this layer only round-trips it.
- `janitorFormat` — `JANITOR_STATE_FORMAT`, this layer's own version of the stored shape, checked beside `version`.
- `watermarkText` — the full text of the watermark message. Insurance against Janitor dropping that message out of the request entirely (a long chat is trimmed from the front): with the text kept, the compiled prefix is still known when the message it came from is gone.

`watermarkText` is unchanged by the move to envelope ids: it is keyed by nothing, it is the full raw text rather than an identity, and it is still the only thing that knows the compiled prefix on a turn where Janitor drops the watermark message out of the request entirely.

`janitorFormat` exists because the two versions answer different questions. `STATE_VERSION` describes the protocol state shape that `src/` owns and that both hosts share; what changed at this brief is what the Janitor layer's ids *mean* — hash-and-occurrence strings became database ids — while the shape stayed identical. Bumping `STATE_VERSION` would discard every SillyTavern chat's state for a Janitor-only change; a second version field discards exactly the states that are wrong. `STORAGE_KEY_PREFIX` stays `uid-janitor-v1:`, so the stale entry is overwritten on the next save rather than orphaned in `localStorage` forever.

There is **no migration path**. A value that does not parse, or whose `version` is not `STATE_VERSION`, or whose `janitorFormat` is not `JANITOR_STATE_FORMAT`, is replaced by a fresh state with one `console.warn` — the same refusal to guess as `docs/modules/state.md#unknown-version`. Every state written before this brief lacks the field and is therefore discarded, which is the intended effect and not a regrettable side effect: its `frozenIds` are content hashes, they name no envelope id, and a state whose compiled set can never match anything would re-send the whole manuscript as frontier. Re-keying the old ids is impossible in the other direction too — the hashes were computed over text this request may no longer carry. A half-understood state on this host would silently re-send or silently drop compiled manuscript.

`localStorage` is per browser and per origin. It does not travel with the chat the way SillyTavern's `chatMetadata` does, so a cleared browser profile is a lost manuscript; Export/Import — a later brief — is the only backup, and there is no cross-tab `storage` listener in this version. A write that throws (quota, storage disabled) is caught and warned, never raised at the caller: a failed save must not abort a generation in flight.

A missing or empty chat id yields a fresh in-memory state and writes nothing. Keying state under a placeholder would merge two conversations into one manuscript, which is worse than losing one turn's persistence.

## The sentinel literal {#sentinel}

`SENTINEL` is `//`: the line the collaborator sends when the manuscript should continue without a human contribution. Only an exact match counts — a message that merely begins with `//` is manuscript text — and the rule is exact so that nothing the collaborator writes can be swallowed by accident. The constant is declared in this layer and read by the request-side transform (brief 0033); nothing in these four modules consumes it.

## Envelope diff {#envelope-diff}

`classifyMessages` splits the provider `messages` array into the assembled context, history and injections.

The first `system` (or `developer`) message is the assembled context — character card, persona, scenario, memory — and is neither history nor injection; its index is returned as `systemIndex`.

The rest are aligned against the `/generateAlpha` envelope's `chatMessages` entries with `isMain === true` (`docs/modules/janitor-transport.md#envelope-record`) using two cursors and exact string equality: a provider message equal to the next unconsumed envelope entry is history and consumes it; anything else is an injection. Non-`isMain` entries are alternatives of a regenerated turn that were not selected, so they are filtered out before alignment and can never consume a provider message.

Each history entry is `{index, role, content, messageId}`, where `messageId` is the `id` of the envelope entry it consumed — `''` on the no-envelope fallback path and for an entry that carries no usable id. Injections carry no `messageId`: they are never manuscript and never have an identity.

Two rules are deliberate:

- **Roles are never trusted.** Janitor injects non-history turns in any role — a `system` note at depth, a `user` OOC line, an `assistant` nudge. "It is history iff the envelope listed it" is the only test that survives that.
- **Alignment is by content and order, not by the envelope's ids.** The order of the conversation is the thing both sides agree on; a database id is a key, not a sequence, and nothing says the provider array and the envelope array agree on which ids they carry until alignment has paired them. The id is read off the entry alignment chose and stored as that message's identity ([Envelope-id identity](#envelope-id-identity)).

Alignment accepts a **second** form for `user`-role messages only: Janitor sends a user turn as `` `${personaName}: ${message}` `` while the envelope stores the bare text (`docs/api/janitor.md#janitor-prefixes-user-turns-with-the-persona-name`). A provider `user` message equal to that one string — exactly one colon, one space, inline — consumes the next unconsumed entry and is pushed as history whose `content` is the envelope's `message` **verbatim**. Assistant-role messages arrive unprefixed and are never prefix-matched, even if their text happens to begin with `Name: `. With an empty or absent `personaName` only exact equality applies.

The history entry carries the bare text because Janitor added the prefix and the human did not: everything downstream — the sentinel test, `matchWatermark`, `classifyDrift`, `toStShape`, `deriveFrontier` and `toManuscriptBlock` — must see exactly what the collaborator wrote, so the derivation writes the own-line `Persona:` header itself, as it does on SillyTavern. Without this the prefixed turn matched nothing, was classified as an injection and was folded into the system message, and the human's contribution never reached the frontier at all (INV-3).

Tolerance stops there: no trimming, no case folding, no regex, no `startsWith`, no newline variant, no `{{user}}` substitution. On a host that ships unannounced changes, a loose matcher is the dangerous one — it would quietly swallow a genuine injection, or a genuine user line that opens with the persona's name and a colon, and the damage (manuscript text invented or lost) is silent. One exact, dated form fails loudly instead: if Janitor changes the decoration, prefixed turns become injections again, which is a visible symptom with a known cause.

With no envelope — `null`, or a record whose `chatMessages` is empty — every non-system message is treated as history and `injections` is empty. This is the deliberate fallback: the cost of treating an injection as history is that one line of someone else's text is folded into the manuscript, while the cost of treating history as an injection is losing the manuscript. Reconstruction discards depth anyway — everything becomes one continuous manuscript turn — so folding a genuine history message loses nothing positional.

## ST-shape shim {#st-shape-shim}

`src/derive.js` and `src/frontier.js` are unmodified and unmodifiable by this layer; the shim adapts to them, never the reverse.

`toStShape(historyMessages)` produces exactly what `deriveFrontier` reads (`src/derive.js`): `mes` (the text), `is_user` (`role === 'user'`), `is_system: false` (the gate in `isConsidered`) and `extra[METADATA_KEY].id`, read straight off the entry's `messageId` ([Envelope-id identity](#envelope-id-identity)) — the id that `frozenIds` membership and the watermark are expressed over. `name` is not invented, because `deriveFrontier` never reads it. There is no parallel id array to keep aligned any more: the identity travels on the entry the classifier produced.

Routing follows for free: `is_user === true` is what sends a message through `toManuscriptBlock`, so a human turn arrives as `${literal}\n${text}` (INV-3, `docs/modules/derive.md#transformation-rule`) without this layer restating the rule.

`fromStShape(history)` is the exact inverse of what `buildHistory` emits (`src/frontier.js:10–12`): `{role: is_user ? 'user' : 'assistant', content: mes}`, dropping `name`, `is_system` and `extra`. Dropping them is the point — they are extension bookkeeping, and INV-10 is why none of it may leave for the provider.

## INV-10 under envelope ids {#inv-10}

Every id, offset and hash in this layer lives in `localStorage` and in local variables. `fromStShape` emits `{role, content}` and nothing else, so no id, hash, offset or envelope position can reach the model. That is the whole of INV-10's requirement, which is stated over the model-visible output (`docs/protocol/invariants.md`, `docs/modules/frontier.md#inv-10`).

The stored side needs its own argument now that the stored identity is a server-assigned key. `docs/decisions/0004-derived-frontier.md` rejected index-derived ids on the SillyTavern host because they persist interaction topology — where in the exchange each message sat — into a file that outlives the session. A database id is not that: it is assigned once when Janitor stores the row, it encodes no position (ids are not consecutive and the envelope's own array order is what gives position), it survives the deletion of any other message, and it renumbers nothing. `frozenIds` therefore records *that* a message with that server key was compiled — the same statement the SillyTavern host's random ids make — and not where in the exchange it sat. The envelope's `position` field is deliberately not stored; it exists only for the duration of one alignment.

The id is also not a secret leaking outward: it is Janitor's own key for text Janitor already holds, and it goes nowhere but this browser's `localStorage`.

## Request pipeline {#request-pipeline}

`transformRequest(data, context)` is the whole request side of the Janitor host. It runs once per provider completion, mutates `data` in place and returns the shell's modified flag (`docs/modules/janitor-transport.md#transform-seam`). The order of its steps is load-bearing, not stylistic:

1. **Gate.** Only a `chat` adapter with an envelope is transformed. A container carrying a top-level `system` string is the Anthropic-shaped body the shell's chat test deliberately accepts (`docs/modules/janitor-transport.md#chat-shape-adapter`); it passes through silently, because the Anthropic adapter is a later phase and a half-applied protocol is worse than none. A missing envelope warns once per page and passes through: without a chat id there is no state to key and without a persona there is no reserved literal, so there is nothing this layer could do that would not corrupt the manuscript.
2. **State** is reloaded from `localStorage` on every request and never cached in a module variable. Another tab may have compiled a unit since the last request; the request body is the only thing that is guaranteed fresh, so the state read beside it must be too.
3. **Classify** before anything else touches the array, because the envelope diff aligns against Janitor's `chatMessages` by exact content ([Envelope diff](#envelope-diff)) and any edit this layer made first would break the alignment.
4. **Sentinel** drop ([The sentinel literal](#sentinel)) before identity, so a sentinel turn never enters the frontier and is never a candidate for the watermark.
5. **Identity** before derivation: `frozenIds` membership and the watermark slice are expressed over envelope ids, so `deriveFrontier` cannot decide what is already compiled until the watermark has been matched and, if it moved, re-keyed ([Envelope-id identity](#envelope-id-identity), [Prefix-hash watermark](#prefix-hash-watermark)). The drift report is computed here, while the state is still the one the ids were matched against ([Drift](#drift)).
6. **System message** rewrite ([System message](#system-message)).
7. **Derive** with the literal `` `${personaName}:` ``, built at this call site because `src/boundary.js`'s `reservedLiteral` reads a SillyTavern context and this host has none. Nothing else about the derivation differs between the two hosts.
8. **Freeze** before reconstruction ([Freeze at request build](#freeze-at-request-build)) — the reconstruction is built from the post-freeze state, so a unit compiled this request is already a span in the body that carries it, and the state is saved before the body is dispatched.
9. **Reconstruct**: the non-system messages are replaced wholesale by `[final, control] × n, frontier, edge` (`docs/modules/frontier.md#total-reconstruction`). Nothing of the incoming array survives, which is what makes the model-visible history identical for any two chats that normalise the same way (INV-10) and what strips the prefill for free ([Prefill strip](#prefill-strip)).
10. **Horizon** before the lead-in ([Transport horizon](#transport-horizon)), so the lead-in is never itself a candidate for dropping and its presence does not depend on how much was dropped.
11. **Lead-in** ([Lead-in turn](#lead-in)).
12. **Stop** ([Stop array](#stop-array)).
13. **Report** ([Request report](#request-report)).

## System message {#system-message}

Janitor's assembled context — preamble, custom prompt, separator, hidden context — is the first `system` or `developer` message. The transform rewrites that one message and never edits, reorders or trims Janitor's own text inside it: the hidden context is the optimizer's territory, and the custom prompt is the human's.

`MANUSCRIPT_SYSTEM_PROMPT` is prepended, separated by `BLOCK_DELIMITER`, unless Janitor's text already contains the prompt's **first sentence**. That sentence is computed at module load from the imported constant (`slice(0, indexOf('.') + 1)`), never copied as a literal, so a reword of the prompt cannot leave a stale detector behind that silently prepends a second copy every turn. Testing the first sentence rather than the whole prompt catches the realistic case: the human pasted the prompt into Janitor's global custom prompt field and Janitor reflowed or truncated the tail.

Every classified injection's content is then **appended**, in input order, each behind a `BLOCK_DELIMITER`. Appending rather than inserting is what keeps the provider-side cached prefix stable: the manuscript prompt and Janitor's static context stay at byte 0 and only the volatile tail moves. Injections are folded here rather than left in place because reconstruction discards depth anyway, and an injected turn left among the messages would reach the model as a non-manuscript turn (§27).

One hazard is Janitor's, not ours: the custom prompt may not be left empty in proxy mode (`docs/api/janitor.md#the-custom-prompt-may-not-be-empty-in-proxy-mode`) or Janitor substitutes its own chat-oriented default. A lone `.` is the usual workaround, and the transform leaves it alone like any other Janitor text.

## Freeze at request build {#freeze-at-request-build}

`compileUnit` runs while the outgoing request is being assembled rather than when a generation is received (`docs/decisions/0007-janitor-host-deviations.md`). Repeating it is safe: the compiler is a pure function of the derived frontier and the stored state, so an abandoned request either moved the state — and the next request re-derives the shorter frontier — or left it byte-identical.

The clamp value is the `start` offset of the **last** entry of `derived.segments`, passed as `maxFrozenEnd` (`docs/modules/freeze.md#last-message-clamp`). That offset is where the last surviving message's text begins in the frontier, so no cut can consume any part of a message Janitor's regenerate can still replace. With fewer than two segments no freeze is attempted at all, because the only segment there is, is the last one.

On a non-`null` result the watermark's `prefixHash` and `watermarkText` are written from the watermark message's raw content before the state is saved, and the frontier is derived a second time against the updated state — the request must carry the post-freeze view, not the view that produced the cut. A `null` result writes nothing at all, and no save is attempted.

## Transport horizon {#transport-horizon}

The provider window is finite and the manuscript is not. When the estimated size of the assembled body exceeds the budget, whole `[final, control]` pairs are dropped **from the front, starting at the second pair**, until the estimate is at or below `JANITOR_HORIZON_HYSTERESIS` of the budget. The first pair is never dropped: it holds the §19 seed or the character's greeting, which is where the manuscript's voice and premise are established. The frontier turn and the edge control are never dropped or trimmed either — they are the live writing surface and the continuation instruction.

Only whole pairs move, and only with hysteresis, because a prefix that shrinks by one message every turn invalidates the provider's prompt cache every turn; stepping down to 80% of the budget instead means the prefix is stable across many turns.

**Canonical state is never touched.** Dropping is a property of one outgoing body; `state.frozen` and `state.units` keep every span, so addendum §7/§11 (no merge, no reorder, no reword of compiled text) hold and a later Export still holds the whole manuscript. This is a transport-window policy, in the same category as SillyTavern's own context trimming — it is explicitly **not** a fourth freeze horizon, and PLAN §18's three horizons are unaffected by it.

When nothing more may be dropped and the estimate is still over budget, the transform warns once and dispatches anyway: a body the provider may refuse is better than a body with no manuscript in it.

## Horizon budget is a constant {#horizon-budget}

`JANITOR_HORIZON_TOKEN_BUDGET` is 100,000 tokens — a host constant, not a setting, and not read from Janitor. Janitor's total context size is 128k tokens (`docs/api/janitor.md#the-context-window-is-128k-tokens`), but the `generation_settings` field name for that window and its truncation unit are an open ledger item (`docs/api/janitor.md#open`); until that item is answered there is nothing to read. 100k leaves room under the real window for the assembled system message and a full-length response, and the script's own trimming sits on top of whatever Janitor does with the rest.

The estimate is `countWords(text) * JANITOR_WORDS_PER_TOKEN` with `JANITOR_WORDS_PER_TOKEN = 1.4` (`docs/modules/freeze.md#word-counting`). No tokenizer and no dependency: a tokenizer for one heuristic threshold would be several hundred kilobytes in a userscript, and the hysteresis band absorbs an estimate that is off by a fifth.

Exposing the budget as a setting is out of the question for the same reason every other knob is: PLAN.txt does not name it as host-selectable, and a human who lowered it below the frontier would silently lose finals from the model's view.

## Lead-in turn {#lead-in}

Some providers require the first non-system message to be a user turn, and reconstruction naturally starts on an assistant turn (a final span). When the first post-system message is `assistant`, one user turn holding `JANITOR_LEAD_IN` is inserted before it.

The string is pinned: it is byte-stable across every request, so it joins the cached prefix rather than breaking it, and a reword goes through the pinned-string lane (`docs/workflow/workflow.md#pinned-string-lane`). It reads as an ordinary request to write and says nothing about transport, reconstruction, freezing or the collaborator — the §27 test — and it uses none of decision 0003's banned transform-and-echo vocabulary (`docs/decisions/0003-duplication-filter-wording.md`).

## Prefill strip {#prefill-strip}

Janitor appends its configured prefill as a trailing `assistant` message. It never survives the reconstruction: every non-system message is replaced, and `buildHistory` ends on a user turn (the continuation control), so there is no trailing assistant message left to remove and `prefill_text` is never re-added.

One rule is needed on top of that, because the prefill has no counterpart in the envelope's `chatMessages` and the diff therefore calls it an injection ([Envelope diff](#envelope-diff)). Folding it into the system message would put it in front of the model by the other door. So the **last** message of the incoming array is dropped rather than folded when it is an injection with role `assistant`. The test is positional and role-based, not a read of `generation_settings.prefill_text`: the prefill setting is not read anywhere in this layer, and a trailing assistant injection is a prefill whatever the setting says.

Both reasons to want it gone hold. A trailing assistant turn re-creates the shape modern Gemini rejects, and it shows the model a turn that is neither manuscript nor the continuation control — transport leaking into the fiction, which §27 forbids.

## Stop array {#stop-array}

`applyStopStrings(requestContainer, literal, 'chat')` is reused unchanged from the SillyTavern host: the reserved literal goes in first and any duplicate of it is removed (`docs/modules/boundary.md#why-first-in-stop-array`). Janitor sends no default `stop` list of its own (`docs/api/janitor.md#janitor-sends-no-default-stop-list`), so the script owns every slot and index 0 survives any provider-side cap on the array.

## Request report {#request-report}

Exactly one `console.info` per transformed request, prefixed with `LOG_PREFIX`: how many final spans and unsealed units the state holds, how many words the frontier carries, whether a unit was compiled this request, and how many messages carry text that is no longer the text that was compiled under their id ([Drift](#drift)). It is operator-facing and never part of the body.

Until the panel exists it is the only sign of life the script gives, which is why it is one line with the four facts that decide whether the protocol is working rather than a debug stream: it has to stay readable in a console Janitor itself writes to.
