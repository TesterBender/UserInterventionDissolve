# 0007 — Janitor host deviations

Date: 2026-09-13
Brief: docs/briefs/0032-janitor-identity-storage-shim.md
PLAN: §3, §9, §10, §23, §27

Where the janitorai.com host cannot offer what the SillyTavern host does, this file records what was done instead and what was rejected. Each section is written by the brief that made the deviation.

## Content hashes instead of injected ids, with a prefix-hash watermark

On SillyTavern every message the extension cares about carries a random id the extension itself wrote into `message.extra` and saved with the chat (`docs/modules/derive.md#message-ids`). `frozenIds` and the watermark are expressed over those ids, and they are stable because the extension owns the array they live on.

Janitor owns the array. The history is server-side, the request body is reassembled from it on every turn, and a userscript sitting on `fetch` sees `{role, content}` and nothing else. There is no field to write an id into that will come back, and no event that says "this message is the one you saw last turn". So identity has to be derived from the only thing that does come back: the text. A message's id is `fnv1a32(role + content)` plus the number of earlier identical `(role, content)` pairs in the same request (`docs/modules/janitor-adapter.md#content-hash-identity`), and the partially compiled watermark message additionally stores `prefixHash`, the hash of its compiled prefix, so a §10 tail edit still slices at the same offset instead of re-sending compiled text (`docs/modules/janitor-adapter.md#prefix-hash-watermark`).

The cost is the occurrence index: delete the earlier of two byte-identical messages and the later one inherits the compiled twin's id, so it is dropped from the frontier as though it were frozen. It is a narrow case, it is visible when it happens, and Recompile clears it. It is accepted because both alternatives are worse.

### Alternatives rejected

- **Envelope positional ids.** `/generateAlpha` numbers its `chatMessages`, and the numbering is positional (`docs/api/janitor.md`, 2026-09-13): every deletion renumbers everything after it. Decision 0004 already rejected index-derived ids on the SillyTavern host, for the identity reason (they repair badly) and for the INV-10 reason (a stored index is a record of where in the exchange a turn sat — the interaction topology the protocol exists to discard). Neither objection is weaker here. The envelope ids are used for alignment inside a single request and never stored.
- **A stored parallel array keyed by position** — state keeps `['first turn text', 'second turn text', …]` and matches by index. Same objection twice over: the index is topology, and it is invalidated by the first deletion or reorder. It also stores a second copy of the manuscript's uncompiled text, which is the accumulation decision 0004 removed.
- **Asking the human to keep the chat append-only.** A protocol rule that depends on the collaborator not using the host's edit button is not a rule, and §10 explicitly grants manuscript-wide editing within the mutable frontier.
