# 0007 — Janitor host deviations from the SillyTavern implementation
Date: 2026-09-13
Brief: docs/briefs/0031-selectcut-last-message-clamp.md
PLAN: §16, §17

The second host reaches the model through the provider request rather than through a chat log it owns. Where that forces the protocol's mechanics to be arranged differently from the SillyTavern extension, the difference is recorded here. This record is extended by briefs 0032 and 0033; the remaining deviations are recorded in later sections of this file.

## Freeze at request build, not at receipt

The SillyTavern host compiles when a generation is received. On the Janitor host the compiler runs while the outgoing request is being built.

INV-6 and INV-7 constrain *where* a cut may fall — never through the middle of a complete block, never inside a reserved span, hard rules before preferences. They say nothing about *when* the compiler runs, and neither does PLAN §16; `docs/modules/freeze.md#not-decided` leaves the schedule to the caller for exactly this reason. Moving the trigger therefore changes no invariant.

It is safe to repeat, too. Freezing at request build is idempotent in the sense that matters: the compiler is a pure function of the derived frontier and the stored state (`docs/modules/freeze.md#purity`), so a request that fails or is abandoned after the state moved re-derives the same frontier from the same inputs on the next attempt, and a request that fails before the state moved leaves the state byte-identical. Nothing in the freeze path depends on a response arriving.

## Last-message clamp on `selectCut`

On the Janitor host a regenerate restarts from the latest user message with the replaced assistant message absent (`docs/api/janitor.md#regenerate-drops-the-replaced-assistant-message`). Combined with freezing at request build, that lets the head of a trailing assistant message be compiled and then the message itself be replaced by a different draft — a compiled head plus a fresh full message, the same passage twice from two drafts. `selectCut` alone does not prevent it: its last-block rule protects the last *block* of the frontier, not the last *message*.

The fix is an **option on `selectCut`, not a fork of it**: `maxFrozenEnd`, a character offset into the frontier text past which no boundary may be taken, enforced as a hard rule alongside completeness, `min` and the reserved-span test (`docs/modules/freeze.md#last-message-clamp`). It is off by default and the SillyTavern host never sets it, so that host's behaviour is unchanged.

### Alternatives rejected

- **A second `freeze.js` for the Janitor host.** Cut selection is the module that owns INV-6 and INV-7; two copies means two places for those invariants to drift, and every existing cut-selection test covers only one of them. A single withholding option keeps one implementation under one test suite.
- **Protecting the region in the caller, by truncating the frontier text before `selectCut`.** The frontier text and `derived.segments` share one offset space; a caller that shortens the text hands `compileUnit` segment offsets that no longer describe it, and the watermark — which is computed by mapping `cut.frozenEnd` back through those segments (`docs/modules/freeze.md#watermark-mapping`) — would be derived from a corrupted mapping. Passing a cap leaves the text and its segments intact and lets the existing mapping run unchanged.
