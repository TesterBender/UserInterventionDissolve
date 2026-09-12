# Host mapping: PLAN.txt → SillyTavern mechanism → module

PLAN.txt §23 lists what a host must provide. This file says which verified SillyTavern mechanism (`docs/api/sillytavern.md`) supplies each one, and which `src/` module owns it. Briefs cite rows here; rows cite API entries. Every mechanism below is `status: verified` unless marked.

## Architecture in one paragraph {#architecture}

SillyTavern's own `chat[]` remains the user-facing view and is left honest: the collaborator's messages stay visible as theirs, the model's as the model's. The **canonical history** (PLAN §4) is an append-only list of frozen spans in `chatMetadata` plus a watermark saying how much of `chat[]` those spans have consumed (`docs/modules/state.md#shape`). The mutable frontier is **not stored**: it is derived from the messages above the watermark on every request (`docs/modules/derive.md#derivation-rule`). On every generation the extension replaces what the model sees with a reconstruction: frozen spans as assistant turns, the derived frontier as one assistant turn, and one byte-identical continuation-control user turn at the edge. Concealment therefore lives entirely at prompt-build time; nothing in the visible chat needs to be hidden, rewritten, or faked, and an edit anywhere above the watermark is picked up by the next request with no synchronisation step.

## Row table {#rows}

| PLAN | Requirement | ST mechanism | Module |
|---|---|---|---|
| §8 | Hard external-character boundary | stop strings via CHAT_COMPLETION_SETTINGS_READY / TEXT_COMPLETION_SETTINGS_READY; stream-side fallback via STREAM_TOKEN_RECEIVED + stopGeneration | `boundary` |
| §9, §10 | Capture collaborator input before it becomes persistent raw history | no pre-send hook exists; capture at MESSAGE_SENT into canonical state, strip at prompt build | `capture` |
| §12 | Reconstruct model-visible history every request | `generate_interceptor` (both APIs) + CHAT_COMPLETION_PROMPT_READY in-place / GENERATE_AFTER_COMBINE_PROMPTS for dryRun parity | `frontier` |
| §13 | Insert neutral continuation control | same reconstruction; last message is the canonical continuation string | `continuation` |
| §14 | Classify generation outcome, roll back incomplete blocks | no finish reason exposed; classify from text; edit message + `swipes[swipe_id]`, `saveChat` | `recovery` |
| §15 | Barge-in | same path as §9 (a user message at any time is a capture) | `capture` |
| §16, §17 | Freeze at low-salience block boundary, append-only | pure function over canonical state; persist via `saveMetadata` | `freeze` |
| §5–§7, §20 | Grammar structure (blocks, tag headers, completeness) | pure functions, no ST API | `grammar` |
| §5–§7, §20, §21 | Grammar semantics, aggregate ownership, lint | system prompt via the prompt manager / `setExtensionPrompt`, seed span, collaborator discipline — not code (`docs/protocol/invariants.md#enforcement-model`) | `prompt` (text asset), `ui` (editor) |
| §19 | Seed span | stored as frozen span 0 in canonical state; entered through the extension UI | `ui`, `freeze` |
| §23 opt. | Prefix caching | byte-identical frozen turns + identical continuation string; nothing else needed client-side | `frontier` |

## §8 — Hard boundary {#s8-boundary}

- **The reserved literal is the persona name.** The external character is whatever `{{user}}` resolves to: `substituteParams('{{user}}')` (equivalently `name1`, `docs/api/sillytavern.md#context-keys`), read fresh on every request since the context captures it by value. The stop literal is `${name1}:` — the tag itself, not `\n\n${name1}:`, per PLAN §8. No character name is configured or stored by the extension.
- **Chat completion:** in CHAT_COMPLETION_SETTINGS_READY, append that literal to `generate_data.stop`. This runs after ST's 4-string cap, so it is not truncated client-side; Claude is uncapped server-side (`docs/api/sillytavern.md#stop-chat-completion`). Provider-side caps (OpenAI: 4) are the provider's; the extension should place the reserved tag **first** in the array so a provider that truncates keeps it.
- **Text completion:** in TEXT_COMPLETION_SETTINGS_READY, prepend to both `stopping_strings` and `stop` (`#stop-text-completion`).
- **Fallback for backends that ignore stop strings:** subscribe to STREAM_TOKEN_RECEIVED (cumulative text); when the text contains the reserved tag at a block boundary, call `stopGeneration()`. The stop applies on the next chunk and the partial text is kept as the message (`#stopgeneration`), so `recovery` must then trim from the tag onward. Non-streaming backends with no stop support get the same trim applied at MESSAGE_RECEIVED.
- PLAN §8 asks that the literal not occur elsewhere in manuscript content. That is a prompt-level instruction plus the seed's demonstration; `recovery` treats any occurrence at a block start as the boundary, which is the only code-side consequence.

## §9 — Capture {#s9-capture}

There is no event that lets an extension rewrite or cancel the composer text before it becomes a chat message (`#pre-send-hook`). Two compliant paths; the brief for `capture` chooses one and records a decision:

1. **Composer path.** The collaborator types Mara's block in the normal composer. It lands in `chat[]` as a user message and MESSAGE_SENT fires with its index. `capture` marks it (`extra.<ext>.captured = true`) and gives it an id; it copies nothing. The transform into a tagged manuscript block happens at prompt build, once per request, inside the derivation (`docs/modules/derive.md#derivation-rule`), so a turn the collaborator later edits is re-tagged from its current text. The user turn as such never reaches the model, because the reconstruction is total. The visible chat stays a faithful log.
2. **Own input surface.** As Intercede did, an extension-owned textarea collects the block and pushes it into canonical state directly, optionally mirroring it into `chat[]` as an assistant-side message for display. Avoids relying on MESSAGE_SENT ordering but adds UI.

Either way, INV-3 holds because the model-visible history is rebuilt from canonical state, never from `chat[]`. Editing authority (§10) is an edit of the frontier in canonical state via the extension UI; it does not go through the composer.

## §12 — Frontier reconstruction {#s12-frontier}

- `generate_interceptor` receives a per-request copy of the non-system messages for **both** chat- and text-completion paths and mutations affect only that request (`#generate-interceptor`). `frontier` empties it and pushes: one assistant message per frozen span, one assistant message for the mutable frontier, one user message with the canonical continuation string.
- The mutable frontier is rebuilt from `chat[]` on every request rather than accumulated: every non-system message whose id is not already consumed by a frozen span is transformed (user turns through `toManuscriptBlock`, model turns verbatim) and joined (`docs/modules/derive.md#derivation-rule`). That is what makes §12's "normalisation happens every request" literal — earlier live seams cannot survive, because nothing carries them forward — and it is what gives §10 its mutable frontier: editing, swiping or deleting any not-yet-frozen message changes the next request with no extra code path.
- The interceptor is skipped in dryRun (token counting), so the prompt-manager token preview is stale. Parity on the chat-completion path is **not safely achievable**: the prompt-ready array is flat `{role, content}` objects with no identifier and no `extra`, so the history slice cannot be located reliably (`docs/api/sillytavern.md#prompt-ready-history-slice`, verified-negative). On the text-completion path `data.finalMesSend[i].message` in GENERATE_BEFORE_COMBINE_PROMPTS is honored (`#before-combine-history-field`). Preview parity is deferred pending the user's choice (brief 0012); the sent request is unaffected.
- Character card, persona, world info and the prompt manager's system blocks are untouched; only the chat-history portion is replaced. Whether to also suppress example messages is a brief-level decision.
- The reconstruction is a pure function of canonical state, which is what makes INV-10 testable: many live histories, one output.

## §13 — Continuation control {#s13-continuation}

- The continuation string is a host constant per PLAN §13 (neutral, non-evaluative). Frozen history uses one byte-identical string; the live edge may use a variant only if a brief justifies it.
- Triggering a continuation without adding a user message: **verified** (`docs/api/sillytavern.md#empty-send`, `#slash-trigger`). Pressing Send on an empty composer runs `Generate('normal')` and pushes no user message; `/trigger` does the same; programmatically the call is `ctx.generate('normal')`. The reconstruction supplies the single continuation user turn, so the collaborator's workflow is: type a block and send when it is their character's turn, or send empty to let the manuscript continue. Caveat: a chat-completion preset with a non-empty `send_if_empty` injects a synthetic user message and breaks the neutral seam; the reference preset leaves it at its default, and `frontier` drops any such message during reconstruction anyway.

## §14 — Outcomes and recovery {#s14-recovery}

- ST exposes no finish reason (`#finish-reason`). Classification is textual, applied at MESSAGE_RECEIVED on the new assistant message:
  - text ends at the reserved tag (or was trimmed there) ⇒ **boundary**; floor to collaborator.
  - empty text ⇒ **empty at boundary**; floor stays with collaborator; no forced text.
  - last block complete ⇒ **natural completion**; next continuation.
  - last block incomplete ⇒ **max-output or abnormal**; roll back to the last complete block: edit `message.mes` and `message.swipes[message.swipe_id]` (`#message-shape`), `updateMessageBlock`, `saveChat`.
- GENERATION_ENDED cannot be paired with GENERATION_STARTED reliably (`#generation-stopped`); `recovery` keys off MESSAGE_RECEIVED, not the ended event.

## §16–§17 — Freezing {#s16-freeze}

- `freeze` is pure: given the frontier and a target (3,000–4,200 words with jitter, a host constant — the one place PLAN names a configurable), pick the cut per §17 salience rules, move the span into the frozen list. Persist with `saveMetadata` (`#chat-metadata`).
- **Compiled once, remembered — of frozen spans only.** A frozen span is compiled exactly once and persisted; later requests read it back verbatim and never recompile it. The `chat[]` messages it was compiled from are no longer inputs: their ids are listed in `frozenIds` and the derivation skips them, so editing, deleting or swiping *those* messages after the freeze changes the visible log only. The **uncompiled** region is the opposite and always was: nothing has been compiled there, so there is nothing to remember, and it is re-read from `chat[]` on every request (`docs/modules/derive.md#derivation-rule`). Authorial editing (§10) therefore acts on the uncompiled region alone, and an edit there is picked up by the next request without touching any frozen span. (User's framing, 2026-09-12: a compile "is something that is remembered, such that previous message structures, after being compiled, no longer need to be recompiled again".)
- **Freezing consumes messages, concretely.** The apply step maps the chosen character cut back onto `chat[]` (`docs/modules/freeze.md#watermark-mapping`): messages wholly inside the span have their ids appended to `frozenIds`, and a message the cut ran through is recorded once as `watermark = { messageId, offset }`. Those two fields *are* "compiled once, remembered" — the derivation skips a `frozenIds` message entirely and starts the watermark message at `offset`, so no compiled character is ever sent twice and no uncompiled character is dropped. A cut that would land inside a user block whose derived text is not a verbatim slice of `mes` is refused rather than approximated; the next receipt tries again. Editing a message a frozen span consumed changes the visible log only, and the extension says so once with a toast (`docs/modules/freeze.md#frozen-edit-notice`) — the sole UI in the freeze path.
- Storage size: frozen spans in `chatMetadata` travel with the chat file (exportable, simple). If chat files grow problematic, a later brief may move span bodies to localforage as Intercede did; the cut/index metadata stays in `chatMetadata` either way.

## What ST cannot do, and how the protocol absorbs it {#gaps}

| Gap | Absorbed by |
|---|---|
| No pre-send transform hook | total reconstruction at prompt build (§12) makes the raw turn irrelevant |
| No finish reason | §14 default rule already classifies by block completeness |
| STREAM stop lands one chunk late | recovery trims from the tag; stop strings remain the primary mechanism |
| Interceptor skipped in dryRun | duplicate reconstruction in the prompt-ready events, idempotent |
| `getContext()` values captured at call time | never cache the context object |
