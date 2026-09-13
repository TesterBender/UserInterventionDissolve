# 0007 — Janitor host deviations from the SillyTavern implementation
Date: 2026-09-13
Brief: docs/briefs/0031-selectcut-last-message-clamp.md, docs/briefs/0032-janitor-identity-storage-shim.md
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
