# 0007 — Janitor host deviations from the SillyTavern implementation
Date: 2026-09-13
Brief: docs/briefs/0031-selectcut-last-message-clamp.md, docs/briefs/0032-janitor-identity-storage-shim.md, docs/briefs/0033-janitor-request-transform.md
PLAN: §3, §9, §10, §16, §17, §23, §27

The second host reaches the model through the provider request rather than through a chat log it owns. Where that forces the protocol's mechanics to be arranged differently from the SillyTavern extension, the difference is recorded here. Each section is written by the brief that made the deviation; brief 0033 extends this record.

## Freeze at request build, not at receipt

The SillyTavern host compiles when a generation is received. On the Janitor host the compiler runs while the outgoing request is being built.

INV-6 and INV-7 constrain *where* a cut may fall — never through the middle of a complete block, never inside a reserved span, hard rules before preferences. They say nothing about *when* the compiler runs, and neither does PLAN §16; `docs/modules/freeze.md#not-decided` leaves the schedule to the caller for exactly this reason. Moving the trigger therefore changes no invariant.

It is safe to repeat, too. Freezing at request build is idempotent in the sense that matters: the compiler is a pure function of the derived frontier and the stored state (`docs/modules/freeze.md#purity`), so a request that fails or is abandoned after the state moved re-derives the same frontier from the same inputs on the next attempt, and a request that fails before the state moved leaves the state byte-identical. Nothing in the freeze path depends on a response arriving.

## Last-message clamp on `selectCut`

On the Janitor host a regenerate restarts from the latest user message with the replaced assistant message absent (`docs/api/janitor.md#regenerate-drops-the-replaced-assistant-message`). Combined with freezing at request build, that lets the head of a trailing assistant message be compiled and then the message itself be replaced by a different draft — a compiled head plus a fresh full message, the same passage twice from two drafts. `selectCut` alone does not prevent it: its last-block rule protects the last *block* of the frontier, not the last *message*.

The fix is an **option on `selectCut`, not a fork of it**: `maxFrozenEnd`, a character offset into the frontier text past which no boundary may be taken, enforced as a hard rule alongside completeness, `min` and the reserved-span test (`docs/modules/freeze.md#last-message-clamp`). It is off by default. The SillyTavern host left it unset until brief 0041 (decision 0008, 2026-09-14) found the same replayed-head failure on a swipe and set it at receipt too.

### Alternatives rejected (clamp)

- **A second `freeze.js` for the Janitor host.** Cut selection is the module that owns INV-6 and INV-7; two copies means two places for those invariants to drift, and every existing cut-selection test covers only one of them. A single withholding option keeps one implementation under one test suite.
- **Protecting the region in the caller, by truncating the frontier text before `selectCut`.** The frontier text and `derived.segments` share one offset space; a caller that shortens the text hands `compileUnit` segment offsets that no longer describe it, and the watermark — which is computed by mapping `cut.frozenEnd` back through those segments (`docs/modules/freeze.md#watermark-mapping`) — would be derived from a corrupted mapping. Passing a cap leaves the text and its segments intact and lets the existing mapping run unchanged.

## Content hashes instead of injected ids, with a prefix-hash watermark

On SillyTavern every message the extension cares about carries a random id the extension itself wrote into `message.extra` and saved with the chat (`docs/modules/derive.md#message-ids`). `frozenIds` and the watermark are expressed over those ids, and they are stable because the extension owns the array they live on.

Janitor owns the array. The history is server-side, the request body is reassembled from it on every turn, and a userscript sitting on `fetch` sees `{role, content}` and nothing else. There is no field to write an id into that will come back, and no event that says "this message is the one you saw last turn". So identity has to be derived from the only thing that does come back: the text. A message's id is `fnv1a32(role + content)` plus the number of earlier identical `(role, content)` pairs in the same request (`docs/modules/janitor-adapter.md#content-hash-identity`), and the partially compiled watermark message additionally stores `prefixHash`, the hash of its compiled prefix, so a §10 tail edit still slices at the same offset instead of re-sending compiled text (`docs/modules/janitor-adapter.md#prefix-hash-watermark`).

The cost is the occurrence index: delete the earlier of two byte-identical messages and the later one inherits the compiled twin's id, so it is dropped from the frontier as though it were frozen. It is a narrow case, it is visible when it happens, and Recompile clears it. It is accepted because both alternatives are worse.

### Alternatives rejected (identity)

- **Envelope positional ids.** `/generateAlpha` numbers its `chatMessages`, and the numbering is positional (`docs/api/janitor.md`, 2026-09-13): every deletion renumbers everything after it. Decision 0004 already rejected index-derived ids on the SillyTavern host, for the identity reason (they repair badly) and for the INV-10 reason (a stored index is a record of where in the exchange a turn sat — the interaction topology the protocol exists to discard). Neither objection is weaker here. The envelope ids are used for alignment inside a single request and never stored.
- **A stored parallel array keyed by position** — state keeps `['first turn text', 'second turn text', …]` and matches by index. Same objection twice over: the index is topology, and it is invalidated by the first deletion or reorder. It also stores a second copy of the manuscript's uncompiled text, which is the accumulation decision 0004 removed.
- **Asking the human to keep the chat append-only.** A protocol rule that depends on the collaborator not using the host's edit button is not a rule, and §10 explicitly grants manuscript-wide editing within the mutable frontier.

## Script-enforced horizon

The provider window is finite and a manuscript grows without bound, so something has to decide what leaves the request. On SillyTavern the host does it: the extension hands over a reconstructed chat and SillyTavern's own context management trims it. On Janitor the script assembles the final body itself, and whatever Janitor would have trimmed it has already trimmed before `/generateAlpha` — the script's body replaces that history wholesale.

So the script carries its own window policy (`docs/modules/janitor-adapter.md#transport-horizon`): a fixed budget of 100,000 estimated tokens, hysteresis down to 80% of it once exceeded, whole `[final, control]` pairs dropped from the front, and span 0 — the §19 seed or the character greeting — pinned. The frontier turn and the edge control are never touched, and canonical state is never written, so this is invisible to `state.frozen`, to Export and to every compilation horizon in PLAN §18. It is a transport-window policy and nothing else.

The budget is a constant rather than a setting because PLAN.txt names no such choice as host-selectable and because 128k (`docs/api/janitor.md#the-context-window-is-128k-tokens`) minus room for the assembled system message and a full-length response is not a number a human needs to tune.

### Alternatives rejected (horizon)

- **Reading Janitor's own context-size setting from `generation_settings`.** The field name for the 128k window and its truncation unit are an open ledger item (`docs/api/janitor.md#open`); reading a field whose name is a guess means either silently reading `undefined` and falling back anyway, or reading a number in the wrong unit and trimming by a factor of four. A constant that is deliberately under the known window is honest about what is known. If the ledger item is ever answered, this section is what gets revisited.
- **Trimming the frontier instead of dropping finals.** The frontier text and `derived.segments` share one offset space and the watermark is computed by mapping a cut offset back through those segments (`docs/modules/freeze.md#watermark-mapping`). A transport-level trim of the frontier would desynchronise the watermark from the text the next derivation produces, and it would hide uncompiled human contributions from the model while leaving them in the manuscript — the frontier is exactly the part that may not be edited by the transport.
- **Dropping single messages instead of whole pairs.** A final without its continuation control puts two assistant turns next to each other, which is transport shape leaking into the fiction (§27), and the resulting prefix changes every turn instead of every few turns.

## Trailing prefill stripped

Janitor appends its configured prefill text as a trailing `assistant` message. The reconstructed request drops it, because every non-system message is replaced and `buildHistory` ends on the continuation control (`docs/modules/janitor-adapter.md#prefill-strip`).

It is a protocol violation and a compatibility hazard at once. Under §27 the model must perceive a continuous manuscript: a prefill is a fragment of transport configuration presented as the beginning of the model's own next turn, which is neither manuscript nor the continuation control, and it would sit directly against the boundary machinery INV-2 puts at the edge. And a trailing assistant turn is the request shape modern Gemini refuses outright, which is the same shape `JANITOR_LEAD_IN` exists to avoid at the other end of the array.

### Alternatives rejected (prefill)

- **Folding the prefill into the continuation control.** The control is byte-identical in frozen history by INV-4 and §13 (`CONTINUATION_CONTROL` is imported, never re-composed); appending a user-configured string to it would break every cached prefix and make the control a function of Janitor's settings.
- **Passing the prefill through and relying on the provider.** Providers disagree about trailing assistant turns, and the ones that accept it treat it as text the model has already written — so the prefill would be indistinguishable from manuscript to the model and absent from canonical state.

## Envelope database ids as message identity (revises the content-hash decision)

Brief: docs/briefs/0036-janitor-envelope-id-identity.md

The section above rejected the envelope's ids on a fact that turned out to be wrong. The 2026-09-13 report described `chatMessages` ids as 0-based positional indices; the 2026-09-14 capture shows them to be large integer **database** ids — `103237690204` — assigned by Janitor when the row is stored (`docs/api/janitor.md#envelope-message-entries-carry-database-ids`). The rejection therefore no longer stands on its own reasons, and the scheme it defended stands on nothing better than the hazard it accepted. Identity on this host is now the envelope entry's `id`, as a string (`docs/modules/janitor-adapter.md#envelope-id-identity`).

A database id is not the index-derived id decision 0004 rejected. It encodes no position: the ids are not consecutive, and where a message sits in the exchange is the envelope array's order, which is not stored. It survives the deletion, editing and reordering of every other message, because none of that rewrites a primary key. And it renumbers nothing, which was the whole of the repair objection — the case that made the old scheme lose a message (delete the earlier of two identical turns and the later one inherits the compiled twin's occurrence index) cannot arise when two identical texts are two rows.

INV-10 holds and is re-argued rather than inherited (`docs/modules/janitor-adapter.md#inv-10`). The invariant is stated over the model-visible output; `fromStShape` emits `{role, content}` and nothing else, so no id, offset or hash reaches the model on either host. On the stored side, `frozenIds` now records *that* a message with a given server key was compiled — the same statement SillyTavern's random ids make, and not the record of where in the exchange a turn sat that decision 0004 refused. The envelope's `position` is deliberately not stored beside the id.

The cost is twofold and bounded. The id exists only while Janitor sends the envelope: a provider request that arrives without one (no `/generateAlpha` capture, or an entry with no usable `id`) has no identity for its messages, and the freeze gate refuses to compile that request rather than write an empty id into state — nothing is lost, the next identified request compiles the same frontier. And every state written before this brief is discarded once, at the `JANITOR_STATE_FORMAT` bump, because its `frozenIds` are hashes that name no envelope id (`docs/modules/janitor-adapter.md#stored-state`). What it buys: drift detection that is exact instead of positional, no occurrence index, no duplicate collision, and an identity that survives a §10 edit of the message it names — which the content hash, by construction, could not.

`prefixHash` stays on the watermark even so. An id match is the normal path, but a regenerate gives the replacement message a new row and therefore a new id, and a request that has trimmed the watermark message out needs the hash to recognise it when it comes back (`docs/modules/janitor-adapter.md#prefix-hash-watermark`). That is the one surviving caller of `fnv1a32` in this layer.

### Alternatives rejected (envelope-id identity)

- **Keeping content hashes as a fallback identity when the id is missing.** Two identity schemes in one store, each with its own failure mode, and no way to tell from a stored `frozenIds` entry which scheme wrote it. The hybrid is worse than either half: a message compiled under a hash and later seen with an id is not recognised as compiled and is re-sent as frontier, which is exactly the failure the id scheme exists to remove. Refusing to compile a request whose messages have no ids costs one request's compilation and nothing else.
- **Storing `created_at` or `position` beside the id.** Both are interaction topology — when in the exchange a turn happened, or where it sat — persisted into a store that outlives the session, which is what INV-10 and decision 0004 exist to prevent. Neither has a reader: alignment uses content and order, the horizon uses span sizes, and drift uses the id and the compiled corpus. A field with no consumer is a field that will acquire the wrong one.
- **Migrating the hash-keyed store instead of discarding it.** A migration would have to re-derive each old hash from text, which means it can only run while holding a request that still carries every compiled message — precisely the messages the manuscript has already consumed and that Janitor may have trimmed. It would guess, and a wrong guess either re-sends compiled manuscript or drops uncompiled human contributions, both silently. Discarding is loud, once, and recoverable by Recompile; `STORAGE_KEY_PREFIX` is unchanged so the stale entry is overwritten rather than left behind.

## Boundary trim and rollback at derivation time

Brief: docs/briefs/0037-janitor-derivation-rollback-and-boundary-records.md

INV-8 and PLAN §14 say a generation that ended mid-block is transport debris and is rolled back to the last complete block, while a generation that stopped at the reserved literal is a deliberate handoff and is kept whole. The SillyTavern host implements that at receipt: it edits the message it just received. This host cannot. Janitor's history lives on Janitor's server, the script has no write path to it, and there is no hook between "the stream ended" and "Janitor stored the row" that may change what was stored (§23). The same guarantee is therefore met at the next request build, on the text the script derives from: every assistant-role history entry is trimmed before identity, the watermark and the frontier are computed (`docs/modules/janitor-adapter.md#derivation-rollback`).

The model-visible result is identical to the ST host's. The debris never enters a compiled span, never enters the frontier and never reaches the model as a fictional event, which is all §27 and INV-8 are stated over. The human-visible result differs: Janitor's own log still shows the truncated sentence the generation ended on. The two views already differ on this host — persona headers, sentinels, total reconstruction — and repairing the log would mean writing to the human's own record of their chat.

The rule is two pure steps in a fixed order, with no classifier: cut at a block-start occurrence of the bare reserved literal (`trimAtBoundary`), then, if the trailing block of what remains is incomplete, cut back to the last complete block (`truncateToLastCompleteBlock`). Literal first, because a completion that ran past the stop string carries the literal and a fragment behind it. A message whose envelope id is in `state.boundaries` is exempt from **both** steps: it already stopped where it meant to, and a second pass could only remove text the model meant to keep. Which messages those are is decided by the `pendingBoundaryAfter` marker, because the generated message has no database id until the next envelope carries it (`docs/modules/janitor-adapter.md#boundary-records`).

The residual cost is a boundary stop that is never recorded — the marker was lost, or the request that would have resolved it was a regenerate. That message is trimmed back to its last complete block on the next request: the model sees a slightly shorter manuscript, the human's log keeps the full text, and no invariant is broken, because nothing about the boundary was ever allowed to reach the model.

The stream-time half of the plan's deviation — rewriting the SSE stream and learning which routes reject `stop` — is recorded by brief 0038 under its own heading.

### Alternatives rejected (derivation-time rollback)

- **Porting `classifyOutcome` from `src/recovery.js`.** The file cannot be imported here: it collides with `src/boundary.js` on a top-level name in the userscript concatenator (`docs/modules/janitor-build.md#supported-module-syntax`, brief 0033). Re-implementing it under `janitor/` would put a second definition of block completeness in the repository (`docs/modules/grammar.md#block-completeness`), free to drift from the first, in exchange for an enum no caller on this host reads: the two pure functions decide the whole trim.
- **Writing the trimmed text back to Janitor through its save endpoint.** The endpoint is unverified — nothing in `docs/api/janitor.md` answers what a save POST requires or what it does to a row mid-generation — and even verified it would edit the human's own log, which is the one thing this script has consistently refused to do. The trim is a statement about what the model is shown, not about what the human wrote down.
- **One-block hold-back buffering during the stream.** Holding the trailing block back until the next block starts would make the truncation invisible in the log too, at the price of stalling Janitor's token-by-token UI for a whole block and of a half-buffered block whenever a stream ends early. No invariant asks for it: INV-8 is stated over what the model perceives, and the derivation-time trim already satisfies that.

## Stream-side boundary suppression and terminal-frame synthesis

Brief: docs/briefs/0038-janitor-stream-boundary-and-stop-learning.md

INV-2 has two enforcement points on this host, and they are two implementations of one §23 requirement rather than a mechanism and a backup. The first is the `stop` parameter: the reserved literal written first into the outgoing body, so the provider stops generating before it commits the human's character. The second is the cut on the response stream: the script parses the SSE frames, accumulates the delta text, and stops forwarding at a block-start occurrence of the bare literal (`docs/modules/janitor-transport.md#response-wrapper`).

The cut has to exist because the first point is not always available. Reasoning routes answer a request carrying `stop` with a 4xx that names the parameter (`docs/api/janitor.md#reasoning-routes-reject-the-stop-parameter-with-a-4xx-naming-it`); on those routes the parameter is not a weaker guarantee, it is no guarantee at all, and without a stream cut the model would write the human's character in front of the human. The script therefore learns which routes refuse it, keyed by `host+path|model`, and skips the parameter there (`docs/modules/janitor-transport.md#stop-rejection-learning`). Learning is one-way and TTL-free: a route stays learned for the life of the browser profile, because the cost of a wrong entry is one route relying on the cut, which is what the correct entries do anyway. Un-learning would mean re-sending a request the provider already refused, on the human's turn, to test a guess.

On a hit the script **cancels upstream and synthesises the dialect's terminal frames** — the text before the cut, then `finish_reason: "stop"`, then `data: [DONE]`. This is pinned, not a toggle: there is no setting, no constant with two live values and no runtime detection. It answers an open ledger item rather than waiting on it, because an early close with no terminal frames is believed to be a parse failure for Janitor (`docs/api/janitor.md#terminal-frames-are-synthesised-on-a-stream-cut`); if a capture shows the parser refusing what is synthesised, the recorded fallback is adopted by amendment.

The hold-back is bounded by the literal. A record whose accumulated text ends in a non-empty proper prefix of the literal is held and released as soon as a later record proves the match fails, so at most `literal.length - 1` characters are ever delayed. That is what keeps a persona name split across frames (`Mar` then `a:`) from reaching the page, and it is deliberately not the one-block hold-back rejected under [Alternatives rejected (derivation-time rollback)](#alternatives-rejected-derivation-time-rollback): the bound is a few characters of a name, not a whole block of prose, and it never stalls Janitor's token-by-token UI.

What the human's saved log holds depends on an assumption the script does not control: Janitor is believed to persist the text the page received from the wrapped stream (`docs/api/janitor.md#post-stream-save-path`). If it saves from an accumulator of its own instead, the saved message runs past the cut. The model-visible view is unaffected either way, because the next derivation trims at the literal before anything is compiled or shown — which is the point of doing both halves. The derivation-time half of the plan's deviation is recorded above under [Boundary trim and rollback at derivation time](#boundary-trim-and-rollback-at-derivation-time).

### Alternatives rejected (stream-side suppression)

- **Letting upstream drain while forwarding nothing after the cut.** Not a rejection of principle: it is the **recorded fallback** for the case where Janitor's parser refuses the synthesised frames. It is not the primary path because it pays for a whole generation past the boundary — tokens, latency and the human's money — every time the provider does not honour `stop`, which on a learned route is every turn.
- **Retrying the rejected request without `stop`.** A second dispatch the human did not ask for, on a turn they think failed, with no way to tell them it happened; and the request body has already been consumed and dispatched, so the retry would have to re-serialise and re-send state the transform has already moved. The 4xx goes back to Janitor untouched and the human sends again — that second request is the one that omits the parameter.
- **Learning a TTL, or a capability table per model family.** Both are guesses about providers this project cannot observe: a TTL guesses how long a refusal lasts, and a family table guesses which models share a backend. Each is a second thing to keep correct as providers churn, in exchange for restoring a parameter whose absence costs nothing, because the stream cut already enforces the boundary.
- **Re-emitting every frame rewritten rather than forwarding upstream bytes.** Normalising each frame through `JSON.parse`/`JSON.stringify` would be simpler code and would destroy the property the tests assert: with no literal in the stream, the bytes the page reads are the bytes upstream sent. Key order, number formatting, whitespace and any field this script does not model would all drift, and the script would be silently rewriting a response it has no reason to touch (§27).

## Recompile as a request-time rebuild, and state export as the only backup

Brief: docs/briefs/0039-janitor-panel-state-recompile-and-transfer.md

On SillyTavern a recompile runs on demand: the extension owns the chat file, so `src/recompile.js` resets the state and rebuilds it from `chat[]` the instant the collaborator asks, with the whole history in hand. Neither half of that is true here. The script owns nothing — it sees the conversation only as the body of a request Janitor has already assembled — and it cannot make Janitor send one. So a recompile on this host is a **flag consumed by the next transformed request**: `requestRecompile(chatId)` records the wish in memory, and the next generation the human starts on that chat discards the stored state and rebuilds it from the messages that request carries. Until then the recompile has not happened, and the panel says so.

That bounds what a rebuild can contain. Janitor trims the history to its configured window before assembling (reality 4 of `TamperContainment/PLAN-janitor.md`), so a chat it has truncated rebuilds short: the prose that fell out of the window is not in the request and cannot be re-compiled from it. The rebuild is therefore a repair tool for recent bookkeeping, not a time machine.

Which is why Export exists at all on this host. The SillyTavern implementation keeps the compiled manuscript in the chat file the human already backs up; here the only copy is a `localStorage` entry in one browser profile (reality 20), behind a host that truncates the history the spans came from. `exportStateJson` hands that entry to the human as a JSON string they can keep, and `importStateJson` takes one back after a format check and refuses anything it cannot read whole. It is part of the §23 host contract, not a convenience feature.

### Alternatives rejected (recompile and transfer)

- **Synthesising a generation so the rebuild happens immediately.** The script would have to fabricate a completion request the human did not ask for — billed to their provider account, on their turn, with a response they have to discard. Making the click feel instant is not worth spending someone else's money, and the flag costs the human one ordinary message.
- **Persisting the recompile flag in the stored state.** The state is shared by every tab on this browser profile and survives a reload, so a wish recorded there would fire in whichever tab sent next and again after a refresh, discarding a manuscript in a window the human was not looking at. The flag is per page because the click was.
- **Merging an imported state into the current one.** Two states are two cuts of overlapping prose with two watermarks, and there is no rule for which cut wins — a merge would have to invent one, and inventing one means rewriting compiled text (INV-6). Import replaces or it refuses.
- **Downloading the export as a file.** Decided in brief 0040 against `Blob` plus an object URL: a judgement about userscript-sandbox fragility across managers and Janitor's own CSP, not a principle. The string is the artefact either way.

## A context override that never asks at send time

Brief: docs/briefs/0042-janitor-context-override.md

On SillyTavern the assembled prompt is the host's own object: the prompt manager lists every block, the human reorders, disables and edits them there, and the extension needs no seam of its own. On janitorai.com there is no such surface. The whole assembled context — preamble, the human's custom prompt, separator, hidden context — arrives as the first system message of an already-built request, and that message is the only place a script can reach it. Nothing in Janitor's own UI shows the human what finally goes into it. §10 puts editorial authority over the manuscript with the human, and this one message is the piece of the outgoing body they otherwise cannot touch.

The optimizer ported into `TamperContainment/TamperMonkeyJanAI.txt` has a context editor for exactly this, and it has a failure mode worth naming, because removing it is why this feature exists. It compares the whole assembled system message against a baseline on every send, and this script aggregates every classified injection into that same message ([System message](../modules/janitor-adapter.md#system-message)). Any injection — a jailbreak note, an OOC aside, a depth prompt — changed the message, so every send looked like a change and re-opened a blocking prompt before the request could go out.

The shape adopted instead: the editable unit is Janitor's captured first system message alone, taken from the incoming array *before* the manuscript prompt is prepended and the injections are appended. There is nothing to compare and nothing to ask. A saved override lives in its own `localStorage` entry keyed by chat id, with its own format version, and replaces that unit on every request until the human clears it. The outgoing message is always `[manuscript prompt] + [override, else capture] + [folded injections]` and is byte-stable across identical requests. The override carries a copy of the capture it was saved against, so a later change in Janitor's own context is reported as a sentence and acted on by nobody. Details in [Context override](../modules/janitor-adapter.md#context-override).

### Alternatives rejected (context override)

- **A split/seam editor that separates the human's custom prompt from Janitor's hidden context.** The optimizer's matcher degrades to the whole-message bundle whenever it fails — no fresh `/generateAlpha` baseline, an empty hidden remainder, a reflowed prompt (L4482–4538) — and a matcher that silently falls back cannot be relied on. Here a mis-split would either rewrite Janitor's text in place, which the transform forbids, or hide part of the context from the human editing it. The bundle is the unit.
- **Character scope for the stored override.** The optimizer offers it, needs a stable character id it does not always have, and falls back to conversation scope when it cannot find one (L2666–2698). A manuscript is a per-chat object on this host in every other respect; one scope that always works beats two of which one sometimes does not.
- **A send-time prompt, a grace period or a "send now" escape.** That is the behaviour this feature exists to delete: a modal in front of a generation the human already asked for, on a message that changes for reasons that are not theirs. The editor is opened when the human wants it, the saved override simply applies, and drift is a sentence in the panel rather than a question in the way.
- **Including the injections in the editable unit or in its change detection.** It is what made the optimizer ask on every send, and it would also hand the human a text box whose content is partly rewritten by the next depth prompt. Excluding them is structural — they are appended after the unit — not a filter and not a toggle, because a toggle would only offer the broken behaviour back.
