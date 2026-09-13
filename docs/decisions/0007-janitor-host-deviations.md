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

The fix is an **option on `selectCut`, not a fork of it**: `maxFrozenEnd`, a character offset into the frontier text past which no boundary may be taken, enforced as a hard rule alongside completeness, `min` and the reserved-span test (`docs/modules/freeze.md#last-message-clamp`). It is off by default and the SillyTavern host never sets it, so that host's behaviour is unchanged.

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
