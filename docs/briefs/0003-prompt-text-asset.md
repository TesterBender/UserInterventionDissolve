# Brief 0003 — `prompt`: system-prompt grammar text, canonical continuation string, seed guidance
Status: draft
Complexity: high
PLAN sections: §5 (blocks separated by a blank line; tag blocks commit one actor, buffers integrate — "tags apply impulses, buffers integrate them"), §6 (a tagged intention may persist across later buffers without retagging; actor/action/target/persistence/termination need no explicit syntax), §7 (an aggregate commits only currently unindividuated members and must not silently include an individually tagged character; universal tags are the failure case this guards against), §8 (the visible manuscript rules do not state that the externally owned character is special — same grammar as everyone else), §13 (continuation control is semantically boring and non-evaluative; one canonical byte-identical string in frozen history; the intended reading is `[manuscript] + CONTINUE`, not submit→judge→installment), §19 (a hand-prepared seed span is the initial in-context exemplar; lists what it must demonstrate), §20 (lint targets name the failure modes the prompt must pre-empt; "the grammar exists to preserve agency, not to flatten prose into legalese"), §21 (the model may create circumstances affecting the external character but may not commit their voluntary response), §22 (reasoning propagates forward from causes, not backward from a desired outcome)
Invariants touched: INV-1, INV-5, INV-9 (and the enforcement model in `docs/protocol/invariants.md#enforcement-model`, which assigns all semantic grammar to this text asset)

## Goal
The repository contains the protocol's text deliverables as frozen string constants in one module, `src/prompt.js`: the system-prompt text that frames the work as creative writing shaped by what already stands on the page and states the few formatting rules that govern the narrative, and the canonical continuation-control string that the `continuation`/`frontier` modules will place at the active seam. The text names no real character, including the external one, and says nothing whatsoever about the mechanics of how it is assembled or delivered — no seams, no transport, no instructions aimed at a single act of writing. Seed-span guidance (§19) is written as documentation, not code. **This brief ships the text and its tests only — nothing injects it into a request yet**; how it reaches the model is a user decision recorded below and implemented by a later brief.

## In scope
- Create `src/prompt.js` (ES module, named exports only, no imports, no ST API, no DOM):
  - `MANUSCRIPT_SYSTEM_PROMPT` — the string drafted below; exactly one definition, no template interpolation, no macros.
  - `CONTINUATION_CONTROL` — the string drafted below. Single line, no leading or trailing whitespace, no newline. Byte-stable: the same characters on every read, never composed at call time (§13, INV-5).
  - No functions, no options object, no builder, no settings.
- Create `tests/prompt.test.js` (vitest) asserting the properties under Acceptance.
- Create `docs/modules/prompt.md` with the header shape from `docs/modules/README.md`, one heading per pointer comment written, plus the seed-span guidance section (§19) and the delivery-options section (below, stated as an open user decision, not a recommendation).

### Draft — `MANUSCRIPT_SYSTEM_PROMPT`
(Wording is a draft for the user to accept or edit; the implementer ships whatever wording the user approves, unedited.)

```text
This is a piece of creative writing, shaped entirely by what already stands on the page — the voices, the unfinished gestures. Write into it as prose: particular, sensory, willing to be strange.

A few formatting rules govern the narrative.

Text is set in blocks separated by a blank line. Each block is tagged or it is narration.

A tagged block opens with a tag and a colon. What follows belongs to that figure alone — speech, action, choice, intent. A tag need not be a person's name; it marks one discrete figure, or one group moving as a single body:

    Idris: sets the cup down. "No."
    The tall one: laughs before she has decided to.
    Guards: lower their spears together.
    The dog: refuses the doorway.
    The fire in the stairwell: takes the banister and keeps going.

Narration between tags carries the world rather than the will: light, distance, elapsed time, the settling of what was already chosen. It integrates; it does not decide for anyone.

An intention, once tagged, holds until something ends it; later narration may carry it forward.

A group tag stands for those still anonymous within it; once someone is drawn out and tagged alone, their choices are their own. Tags keep who did what legible.

The story closes when the story does.
```

**Note on the escalation ladder.** The examples run: proper name → epithet → collective → non-human agent → an impersonal force treated as one body with a will. The last rung is deliberately included but is the one place the list pushes against the sentence that follows it ("narration carries the world rather than the will"); the reconciliation is that a force earns a tag only when it is being written as a single acting figure rather than as ambient world. This is the sharpest open question below; if the user rejects it, the implementer drops that one line and nothing else changes.

### Draft — `CONTINUATION_CONTROL`
PLAN §13's own preferred wording, taken verbatim so the constant is traceable:

```text
Continue the manuscript directly from the current endpoint. Preserve established causal, stylistic, perspectival, and formatting continuity. Do not recap, restart, summarize, or force resolution.
```

### Delivery — **user decision, not made by this brief**
`docs/modules/prompt.md#delivery` records all three options and marks the choice as open. No injection code is written in this brief under any option.
1. **Extension-injected.** `setExtensionPrompt` exists on the context (`docs/api/sillytavern.md#context-keys`, status: verified — *presence only*). Its position/depth/role parameters are **not verified**; see Verification needed. Cannot be implemented until they are.
2. **Preset-owned.** The user pastes `MANUSCRIPT_SYSTEM_PROMPT` into their own preset's system prompt; the extension ships the text and a copy affordance only. Requires no ST API.
3. **Both**, with the extension injecting only when the preset does not already contain the text.
The continuation string's delivery is already settled elsewhere and is not re-decided here: it is emitted by the reconstruction as the final user message (`docs/protocol/host-mapping.md#s13-continuation`).

## Out of scope (explicit)
- Any injection, registration, or `setExtensionPrompt` call. No `index.js` change, no manifest change, no event subscription.
- A settings UI, a toggle to enable/disable the prompt, a per-chat override, a "prompt strength" control, or any configurability (`docs/decisions/0001-prompt-level-grammar.md`).
- Naming the external character, reading `{{user}}`/`name1`, or embedding any macro. The only name in the text is the invented `Idris` inside an example line.
- Lint, validation, or any code that checks manuscript text against this prompt. Semantics are prompt-level by decision 0001; §20 lint stays advisory and belongs to a later brief.
- Shipping an actual seed span as data. §19 guidance is documentation in this brief; whether the extension ships an example seed is a question for the user (below).
- Any wording that exposes or gestures at the assembly mechanics (§27): no seam, no "write from here", no "span", "chunk", "freeze", "context", "history", "prompt", "token".
- Any instruction aimed at a single act of writing — no anti-recap directive, no length guidance, no instruction about how to spend reasoning (§22 is served by the seed and by craft framing, not by an instruction paragraph).
- Any wording that grades, praises, or evaluates the preceding text (§13).
- Extending the example ladder beyond the approved lines, or adding commentary explaining each example. The list teaches by escalation, not by annotation.
- Variants of the continuation string for the live seam versus frozen history (`host-mapping.md#s13-continuation` allows one only if a brief justifies it; this brief does not).
- New dependencies; changes to `package.json`, `eslint.config.js`, `vitest.config.js`.

## Files
- allowed to create/modify: `src/prompt.js`, `tests/prompt.test.js`, `docs/modules/prompt.md`, and this brief's Status line
- must not touch: `PLAN.txt`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, other `docs/briefs/*`, `src/grammar.js`, `index.js`, `manifest.json`, `package.json`, `eslint.config.js`, `vitest.config.js`, `tools/*`

## ST APIs used
- none in this brief's code. Referenced as an option only: `setExtensionPrompt` — docs/api/sillytavern.md#context-keys (status: verified — presence of the key only; call semantics unverified)

## Verification needed
- `setExtensionPrompt(key, value, position, depth, scan, role)` — exact signature, the meaning and allowed values of `position`, `depth` and `role`, whether it survives a chat switch, and whether it is honored on both chat- and text-completion paths. Only the key's **presence** on the context object is verified today. Delivery options 1 and 3 are blocked until this is verified; option 2 is not blocked.

## Acceptance
- [ ] `CONTINUATION_CONTROL` is byte-identical across reads: a test comparing two separate imports/reads asserts `Object.is` equality and asserts the exact byte length and a literal match against an inline copy in the test.
- [ ] `CONTINUATION_CONTROL` contains no newline, no leading/trailing whitespace, and none of `excellent`, `good`, `great`, `well done`, `nice` (case-insensitive) — §13's non-evaluative requirement.
- [ ] `MANUSCRIPT_SYSTEM_PROMPT` contains none of these as whole words, case-insensitive: `edge`, `boundary`, `continue`, `generation`, `turn`, `reply`, `respond`, `user`, `model`, `reasoning`, `thinking`, `privileged`.
- [ ] `MANUSCRIPT_SYSTEM_PROMPT` additionally contains none of: `assistant`, `chat`, `message`, `prompt`, `token`, `span`, `chunk`, `freeze`, `summarize`, `recap`.
- [ ] `MANUSCRIPT_SYSTEM_PROMPT` contains no `{{` macro delimiter and no occurrence of `Mara`. The only personal name it contains is the invented example name in the tag ladder; a test asserts the set of capitalised non-sentence-initial words is exactly the approved example set.
- [ ] The tag ladder is present as 5–7 consecutive indented lines each matching `/^\s+[^\n:]{1,40}: .+$/`, and it includes at least one collective tag and at least one non-personal tag (§7, INV-9 — tags identify a discrete entity or action-aligned group).
- [ ] `MANUSCRIPT_SYSTEM_PROMPT` contains the four grammar commitments, asserted by substring/keyword tests the implementer writes against the approved wording: blank-line block separation, one-figure ownership of a tagged block, narration-integrates-rather-than-decides, and group-tags-stand-only-for-the-anonymous (§5, §7, INV-1, INV-9).
- [ ] `MANUSCRIPT_SYSTEM_PROMPT` is at most 220 words, counted as matches of `/[A-Za-z'’]+/g` (punctuation and dashes are not words).
- [ ] `src/prompt.js` exports exactly two names and declares no function.
- [ ] `src/prompt.js` contains no reference to `SillyTavern`, `getContext`, `window`, `document`, or `import`.
- [ ] `npm run check` passes.
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/prompt.md#grammar-text` — what the system prompt frames and what it deliberately leaves unsaid; why it is craft framing plus a short rule list rather than a rule list alone (§5–§7, §20's legalese caveat, decision 0001).
- `docs/modules/prompt.md#tag-ladder` — why the examples escalate from a personal name to a collective to a non-human agent, and that the point is the tag's purpose (identifying a discrete entity or action-aligned group) rather than personhood (§7, INV-9).
- `docs/modules/prompt.md#says-nothing-of-mechanics` — why the text names no real character and describes nothing about how the page is assembled (§8, §27; INV-2 stays a code-side boundary).
- `docs/modules/prompt.md#continuation-control` — why the string is neutral, why it is one frozen constant, and that no module may recompose it (§13, INV-5).
- `docs/modules/prompt.md#seed-guidance` — §19's checklist restated for whoever writes the seed: continuous prose, tag/buffer alternation, independent characters, the external figure appearing naturally and away from cut points, dense tag runs, durable commitments, anonymous agents, unresolved continuation, no handoff, no closure; and that the seed, not the prompt, is where §22's causal forward motion and the anti-conclusion habit are actually demonstrated.
- `docs/modules/prompt.md#delivery` — the three delivery options verbatim from this brief, marked as an unresolved user decision, with the `setExtensionPrompt` verification gap named.

## Questions for the user
1. **Forces as tags.** The ladder's last rung, `The fire in the stairwell: takes the banister and keeps going.`, treats an impersonal force as a figure with a will — which sits in tension with "narration carries the world rather than the will". Keep it (a force may be tagged when written as one acting body), or stop the ladder at the non-human animate agent (`The dog:`)?
2. **The one proper name.** The ladder opens with an invented personal name, `Idris`, so the escalation has a baseline. Acceptable, or should the text contain no personal name at all (epithets and collectives only)? Substitute name welcome.
3. **Ladder length and rungs.** Five rungs: name → epithet → collective → animal → force. Want a sixth (a role such as `The clerk:`, or a larger collective such as `The crowd on the stairs:`), or fewer?
4. **Block delimiter.** The draft states the delimiter as a blank line (PLAN §5's "ordinarily"). Confirm blank line, or name another.
5. **Tag syntax.** `Tag: text` on the same line, header at the very start of the block. Confirm, or specify an alternative (e.g. `Tag —`, a newline after the colon).
6. **Interiority inside tags.** The draft trims tag contents to "speech, action, choice, intent" for length; PLAN §5 also lists interiority and character-specific interpretation. Restore the fuller list, or leave it implied?
7. **Aggregates.** The draft treats a group tag as a legibility device standing for the still-anonymous, and never names or bans `Everyone:`, per decision 0001 and your "flavor text, not a rule". Confirm.
8. **The closing clause.** `The story closes when the story does.` is the only surviving no-conclusion nudge, phrased as craft. Keep it, or cut it entirely?
9. **Continuation string wording.** Currently PLAN §13's sentence verbatim — which is itself somewhat on the nose ("do not recap, restart, summarize, or force resolution"). Reduce it to a single quiet sentence (e.g. `Continue the manuscript from the current endpoint.`), or keep §13's wording?
10. **Seed span.** Does the extension ship an example seed span as data (and if so, whose prose?), or is the seed entirely user-supplied with only the §19 checklist documented? The brief currently assumes the latter — which also makes the seed the only place §22's causal forward motion is demonstrated.
11. **Delivery.** Extension-injected via `setExtensionPrompt` (blocked on verification), user pastes into their preset's system prompt, or both? The brief ships text only until you choose.
12. **Length and register.** The draft is ~216 words and leans literary ("willing to be strange"). Right register, or plainer?
