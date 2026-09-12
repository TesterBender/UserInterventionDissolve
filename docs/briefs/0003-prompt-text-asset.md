# Brief 0003 — `prompt`: system-prompt grammar text, canonical continuation string, seed guidance
Status: draft
Complexity: high
PLAN sections: §5 (blocks separated by a blank line; tag blocks commit one actor, buffers integrate — "tags apply impulses, buffers integrate them"), §6 (a tagged intention may persist across later buffers without retagging; actor/action/target/persistence/termination need no explicit syntax), §7 (an aggregate commits only currently unindividuated members and must not silently include an individually tagged character; universal tags are the failure case this guards against), §8 (the visible manuscript rules do not state that the externally owned character is special — same grammar as everyone else), §13 (continuation control is semantically boring and non-evaluative; one canonical byte-identical string in frozen history; the intended reading is `[manuscript] + CONTINUE`, not submit→judge→installment), §19 (a hand-prepared seed span is the initial in-context exemplar; lists what it must demonstrate), §20 (lint targets name the failure modes the prompt must pre-empt; "the grammar exists to preserve agency, not to flatten prose into legalese"), §21 (the model may create circumstances affecting the external character but may not commit their voluntary response), §22 (reasoning propagates forward from causes, not backward from a desired outcome)
Invariants touched: INV-1, INV-5, INV-9 (and the enforcement model in `docs/protocol/invariants.md#enforcement-model`, which assigns all semantic grammar to this text asset)

## Goal
The repository contains the protocol's text deliverables as frozen string constants in one module, `src/prompt.js`: the system-prompt text that regulates the manuscript grammar (blocks, tags, buffers, durable commitments, aggregates, causal reasoning, no recaps or mini-endings), and the canonical continuation-control string that the `continuation`/`frontier` modules will place at the active edge. The text is written as scene direction, never as rules-lawyering; it names no character, including the external one; it never mentions turns, messages, spans, freezing, or any other transport structure. Seed-span guidance (§19) is written as documentation, not code. **This brief ships the text and its tests only — nothing injects it into a request yet**; how it reaches the model is a user decision recorded below and implemented by a later brief.

## In scope
- Create `src/prompt.js` (ES module, named exports only, no imports, no ST API, no DOM):
  - `MANUSCRIPT_SYSTEM_PROMPT` — the string drafted below, `Object.freeze`-irrelevant for strings but declared `const` and exported as-is; exactly one definition, no template interpolation, no macros.
  - `CONTINUATION_CONTROL` — the string drafted below. Single line, no leading or trailing whitespace, no newline. Byte-stable: the same characters on every read, never composed at call time (§13, INV-5).
  - No functions, no options object, no builder, no settings.
- Create `tests/prompt.test.js` (vitest) asserting the properties under Acceptance.
- Create `docs/modules/prompt.md` with the header shape from `docs/modules/README.md`, one heading per pointer comment written, plus the seed-span guidance section (§19) and the delivery-options section (below, stated as an open user decision, not a recommendation).

### Draft — `MANUSCRIPT_SYSTEM_PROMPT`
(Wording is a draft for the user to accept or edit; the implementer ships whatever wording the user approves, unedited.)

```text
This is a continuous manuscript. It has no opening and no close — only a moving edge. Write from that edge.

The page is built from blocks separated by a blank line. A block is either tagged or it is narration.

A tagged block opens with a name and a colon, and everything in it belongs to that figure alone — speech, action, choice, attention, intention, thought, the way that figure reads the room:

Anton: sets the cup down. "No."

A name on the page exists to mark one discrete figure, or one group acting as a single body, so that who did what stays legible. That is all a name is for.

Narration between tags carries the world, not the will: weather, distance, elapsed time, sound, the physical settling of what has already been chosen, motion already underway, state already established. Narration may move a body; it may not decide for a named figure. Impulses come from tags; narration integrates them.

An intention, once tagged, keeps running until something in the world ends it. "Anton: follows Elise until she stops." Later narration may carry that walking forward without tagging it again; let it lapse only when the manuscript gives it a reason to lapse.

A group name speaks only for those still anonymous inside it. The moment someone is drawn out and given a name on the page, that figure's choices are their own and the group no longer speaks for them. Sweeping collective flourishes read as atmosphere; they are not a way to move named figures.

No figure on this page holds a privileged position. Every one of them is written under the same grammar.

Continue directly from the last words standing on the page — mid-scene, mid-motion, mid-breath if that is where the edge falls. Do not restate what is already written, do not summarize, do not gather the threads, do not settle into the cadence of an ending. Length is not an arrival. Leave things underway; a scene closes when the story reaches its close, not when a stretch of writing has run long.

Where thinking precedes writing, spend it on the present state: where everyone stands, what each figure knows and does not know, which intentions are still running, which earlier causes have not yet landed, who now has reason to move. Do not spend it choosing a destination, manufacturing novelty, or shaping a tidy thematic close. Push forward from causes; never work backward from an outcome you would like to reach.
```

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
- Naming the external character, reading `{{user}}`/`name1`, or embedding any macro. The text names no one but the illustrative `Anton`/`Elise` of PLAN §5/§6.
- Lint, validation, or any code that checks manuscript text against this prompt. Semantics are prompt-level by decision 0001; §20 lint stays advisory and belongs to a later brief.
- Shipping an actual seed span as data. §19 guidance is documentation in this brief; whether the extension ships an example seed is a question for the user (below).
- Any wording that exposes transport structure (§27): no "span", "chunk", "freeze", "context", "history", "prompt", "turn", "message", "token", "continue generating".
- Any wording that grades, praises, or evaluates the preceding text (§13).
- Variants of the continuation string for the live edge versus frozen history (`host-mapping.md#s13-continuation` allows one only if a brief justifies it; this brief does not).
- New dependencies; changes to `package.json`, `eslint.config.js`, `vitest.config.js`.

## Files
- allowed to create/modify: `src/prompt.js`, `tests/prompt.test.js`, `docs/modules/prompt.md`, and this brief's Status line
- must not touch: `PLAN.txt`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, other `docs/briefs/*`, `src/grammar.js`, `index.js`, `manifest.json`, `package.json`, `eslint.config.js`, `vitest.config.js`, `tools/*`

## ST APIs used
- none in this brief's code. Referenced as an option only: `setExtensionPrompt` — docs/api/sillytavern.md#context-keys (status: verified — presence of the key only; call semantics unverified)

## Verification needed
- `setExtensionPrompt(key, value, position, depth, scan, role)` — exact signature, the meaning and allowed values of `position`, `depth` and `role`, whether it survives a chat switch, and whether it is honored on both chat- and text-completion paths. Only the key's **presence** on the context object is verified today. Delivery option 1 and 3 are blocked until this is verified; option 2 is not blocked.

## Acceptance
- [ ] `CONTINUATION_CONTROL` is byte-identical across reads: a test comparing two separate imports/reads asserts `Object.is` equality and asserts the exact byte length and SHA-free literal match against an inline copy in the test.
- [ ] `CONTINUATION_CONTROL` contains no newline, no leading/trailing whitespace, and none of `excellent`, `good`, `great`, `well done`, `nice` (case-insensitive) — §13's non-evaluative requirement.
- [ ] `MANUSCRIPT_SYSTEM_PROMPT` matches none of the regexes for transport/chat vocabulary, case-insensitive, as whole words: `user`, `turn`, `reply`, `respond`, `response`, `message`, `chat`, `assistant`, `AI`, `model`, `prompt`, `token`, `span`, `chunk`, `freeze`, `context window`, `roleplay`, `system`.
- [ ] `MANUSCRIPT_SYSTEM_PROMPT` contains no `{{` macro delimiter and no occurrence of the strings `Mara` or `{{user}}`.
- [ ] `MANUSCRIPT_SYSTEM_PROMPT` contains the four grammar commitments, asserted by substring/keyword tests the implementer writes against the approved wording: blank-line block separation, one-figure ownership of a tagged block, narration-integrates-impulses, and group-names-do-not-speak-for-named-figures (§5, §7, INV-1, INV-9).
- [ ] `src/prompt.js` exports exactly two names and declares no function.
- [ ] `src/prompt.js` contains no reference to `SillyTavern`, `getContext`, `window`, `document`, or `import`.
- [ ] `npm run check` passes.
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/prompt.md#grammar-text` — what the system prompt is responsible for regulating and why it is prose rather than a rule list (§5–§7, §20's legalese caveat, decision 0001).
- `docs/modules/prompt.md#no-privileged-figure` — why the text names no character and states no exception for the externally owned one (§8, INV-2 stays a code-side boundary).
- `docs/modules/prompt.md#continuation-control` — why the string is neutral, why it is one frozen constant, and that no module may recompose it (§13, INV-5).
- `docs/modules/prompt.md#seed-guidance` — §19's checklist restated for whoever writes the seed: continuous prose, tag/buffer alternation, independent characters, the external figure appearing naturally and away from boundaries, dense tag runs, durable commitments, anonymous agents, unresolved continuation, no handoff, no closure; and that the seed is the working demonstration of the grammar the prompt only describes.
- `docs/modules/prompt.md#delivery` — the three delivery options verbatim from this brief, marked as an unresolved user decision, with the `setExtensionPrompt` verification gap named.

## Questions for the user
1. **Block delimiter.** The draft states the delimiter as a blank line (PLAN §5's "ordinarily"). Confirm blank line, or name another.
2. **Tag syntax.** `Name: text` on the same line, header at the very start of the block. Confirm, or specify an alternative (e.g. `Name —`, a newline after the colon).
3. **Interiority inside tags.** The draft puts thought, attention and intention inside the tagged block (PLAN §5 lists interiority as tag content). Confirm, or say that interiority belongs in narration instead.
4. **Strictness of "no recap / no endings".** The draft is firm but unquantified ("do not summarize… length is not an arrival"). Should it be softer (a preference), or harder (an explicit prohibition with named symptoms: closing images, thematic echoes, summarizing final paragraphs)?
5. **Aggregates.** The draft treats sweeping collective tags as atmosphere rather than naming `Everyone:` as forbidden, per decision 0001 and your "flavor text, not a rule". Confirm that no universal tag is named or banned in the text.
6. **Illustrative names.** The draft reuses PLAN's `Anton`/`Elise` in one example. Acceptable, or should the example be nameless/abstract so no name at all appears?
7. **`{{user}}`.** The draft does not use the macro anywhere, so the external figure is never distinguished. Confirm — or say you want `{{user}}` appearing as one name among several in an example.
8. **Reasoning paragraph.** The draft addresses thinking/reasoning directly (§22). Keep it in the same block of text, or split it into a second constant so it can be placed differently later?
9. **Continuation string wording.** The draft is PLAN §13's own sentence verbatim. Keep verbatim, or reword (e.g. shorter: "Continue the manuscript from the current endpoint.")?
10. **Seed span.** Does the extension ship an example seed span as data (and if so, whose prose?), or is the seed entirely user-supplied with only the §19 checklist documented? The brief currently assumes the latter.
11. **Delivery.** Extension-injected via `setExtensionPrompt` (blocked on verification), user pastes into their preset's system prompt, or both? The brief ships text only until you choose.
12. **Length.** The draft is ~350 words. Too long, about right, or should it be tighter still?
