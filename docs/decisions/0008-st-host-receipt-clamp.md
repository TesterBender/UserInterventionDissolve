# 0008 — The SillyTavern host clamps the receipt-time compile to the last message
Date: 2026-09-14
Brief: docs/briefs/0041-st-receipt-clamp-last-message.md
PLAN: §12, §14, §16, §17

## Decision

The SillyTavern host's receipt-time compile now passes `maxFrozenEnd` — the start of the derivation's trailing segment — to `compileUnit`, and skips the compile altogether when the derivation has fewer than two segments (`docs/modules/recovery.md#freeze-hookup`). The newest assistant message is therefore never compiled at its own receipt. The reason is swipe safety, traced concretely on 2026-09-14: once the frontier is past `FREEZE_MIN_WORDS` a cut could land inside the message just received, compiling its head into `state.units` and pointing `watermark.messageId` at it; on the next swipe `excludeLastAssistant` correctly drops the message from the derivation, but `buildHistory` still replays the compiled head to the model, and the stale watermark slices the *new* draft at the old draft's offset. It is also parity with the Janitor host, which clamps the same quantity at request build for the same reason a regenerate can replace the trailing message (`docs/decisions/0007-janitor-host-deviations.md`, "Last-message clamp on `selectCut`"). The clamp is unconditional — not keyed to the generation type — because a hard rule that only withholds candidates is safe on every receipt (`docs/modules/freeze.md#last-message-clamp`).

## Alternatives rejected

- **Filter `state.units` by message id at reconstruction** — hides the compiled text from the request but leaves `watermark.messageId` pointing into a replaced draft, so the next derivation still slices the new text at a stale offset. It treats the symptom in `frontier` and leaves the corruption in canonical state.
- **Roll canonical state back on GENERATION_STARTED for a swipe** — a second mutation path over compiled state, which decision 0004 rejected for the frontier and which INV-6 forbids for anything already sealed: freezing is append-only, and compiled text is never re-cut or un-cut.

## Consequences

- Both hosts now clamp, so `maxFrozenEnd` has no caller that leaves it unset; the option's "off by default" path survives only as the module's own default.
- Compilation of the newest message is deferred by one receipt, so the frontier runs slightly longer than the 3,000–4,200-word target before a cut lands. PLAN §16 makes the target advisory, and the deferral is invisible to the model.
- `recovery` subscribes to no lifecycle event and gains none here: the receipt stays the only scheduled moment at which canonical state moves.
