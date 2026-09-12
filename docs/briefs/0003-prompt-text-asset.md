# Brief 0003 — `prompt`: system-prompt grammar text, canonical continuation string, seed guidance
Status: done
Complexity: high
PLAN sections: §5 (blocks separated by a blank line; tag blocks commit one actor, buffers integrate — "tags apply impulses, buffers integrate them"), §6 (a tagged intention may persist across later buffers without retagging; actor/action/target/persistence/termination need no explicit syntax), §7 (an aggregate commits only currently unindividuated members and must not silently include an individually tagged character; universal tags are the failure case this guards against), §8 (the visible manuscript rules do not state that the externally owned character is special — same grammar as everyone else), §13 (continuation control is semantically boring and non-evaluative; one canonical byte-identical string in frozen history; the intended reading is `[manuscript] + CONTINUE`, not submit→judge→installment), §19 (a hand-prepared seed span is the initial in-context exemplar; lists what it must demonstrate), §20 (lint targets name the failure modes the prompt must pre-empt; "the grammar exists to preserve agency, not to flatten prose into legalese"), §21 (the model may create circumstances affecting the external character but may not commit their voluntary response), §22 (reasoning propagates forward from causes, not backward from a desired outcome)
Invariants touched: INV-1, INV-5, INV-9 (and the enforcement model in `docs/protocol/invariants.md#enforcement-model`, which assigns all semantic grammar to this text asset)

## Goal
The repository contains the protocol's text deliverables as frozen string constants in one module, `src/prompt.js`: the system-prompt text that frames the work as creative writing shaped by what already stands on the page and states the few formatting rules that govern the narrative, and the canonical continuation-control string that the `continuation`/`frontier` modules will place at the active seam. The text names no real character, including the external one, and says nothing whatsoever about the mechanics of how it is assembled or delivered — no seams, no transport, no instructions aimed at a single act of writing. Seed-span guidance (§19) is written as documentation, not code. **This brief ships the text and its tests only — nothing injects it into a request.** Delivery is brief 0005.

## In scope
- Create `src/prompt.js` (ES module, named exports only, no imports, no ST API, no DOM):
  - `MANUSCRIPT_SYSTEM_PROMPT` — the string drafted below, verbatim; exactly one definition, no template interpolation, no macros.
  - `CONTINUATION_CONTROL` — the string drafted below, verbatim. Single line, no leading or trailing whitespace, no newline. Byte-stable: the same characters on every read, never composed at call time (§13, INV-5).
  - No functions, no options object, no builder, no settings.
- Create `tests/prompt.test.js` (vitest) asserting the properties under Acceptance.
- Create `docs/modules/prompt.md` with the header shape from `docs/modules/README.md`, one heading per pointer comment written, plus the seed-span guidance section (§19).

### `MANUSCRIPT_SYSTEM_PROMPT` — approved text, ship verbatim

```text
This is a piece of creative writing, shaped entirely by what already stands on the page — the voices, the unfinished gestures. Write into it as prose: particular, sensory, willing to be strange.

A few formatting rules govern the narrative.

Text is set in blocks separated by a blank line. Each block is tagged or it is narration.

A tagged block opens with a tag and a colon. What follows belongs to that figure alone — speech, action, choice, intent, attention, private interpretation. A tag need not be a person's name; it marks one discrete figure, or one group moving as a single body. A figure not yet named is tagged by how the page knows them, and takes a name once the story grants one:

    Idris: sets the cup down. "No."
    The tall one: laughs before she has decided to.
    Guards: lower their spears together.
    The dog: refuses the doorway.

Narration between tags carries the world rather than the will: light, distance, elapsed time, the settling of what was already chosen. It integrates; it does not decide for anyone.

An intention, once tagged, holds until something ends it; later narration may carry it forward.

A group tag stands for those still anonymous within it; once someone is drawn out and tagged alone, their choices are their own. Tags keep who did what legible.

The story closes when the story does.
```

**Note on the ladder.** The four rungs run: proper name → a figure the page has not yet named → collective → non-human animate agent, and stop there. Environmental forces (fire, weather, tide) are deliberately **not** taggable: neutral narrative buffers must exist and must stay identifiable, so anything that is world rather than will belongs to narration (§5; the `grammar` parser's tag/buffer split depends on it). The implementer must not add a rung.

**Note on the tag header.** A tag begins a block — newline, then the tag, then the colon — and the header itself is plain text. Styling (bold, italics, code) is free *inside* the block body and is never mentioned in the prompt text, because a plain header is what `grammar` parses at block start and what `boundary` uses verbatim as the stop string (`docs/protocol/host-mapping.md#s8-boundary`).

### `CONTINUATION_CONTROL` — approved text, ship verbatim

PLAN §13's own preferred wording:

```text
Continue the manuscript directly from the current endpoint. Preserve established causal, stylistic, perspectival, and formatting continuity. Do not recap, restart, summarize, or force resolution.
```

Rationale to record, in the user's own framing: this string is meant to read as a genuine request from a collaborator, because doing so "enforces the notion of this being a creative writing endeavor and not a cheeky way to force a model to write better by disguising myself as a character in the story." It is therefore plain-spoken rather than in-fiction, and is not softened or disguised.

## Out of scope (explicit)
- Delivery (preset bundle or injection) is brief 0005 pending research. No `setExtensionPrompt` call, no `index.js` change, no manifest change, no event subscription, no preset file in this brief.
- A settings UI, a toggle to enable/disable the prompt, a per-chat override, a "prompt strength" control, or any configurability (`docs/decisions/0001-prompt-level-grammar.md`).
- Naming the external character, reading `{{user}}`/`name1`, or embedding any macro. The only name in the text is `Idris` inside an example line.
- Any mention of tag styling in the prompt text, and any parser change to accept styled headers. The header stays plain.
- An environmental-force rung in the ladder, or any wording that lets world-material be tagged (see the note above).
- Lint, validation, or any code that checks manuscript text against this prompt. Semantics are prompt-level by decision 0001; §20 lint stays advisory and belongs to a later brief.
- Shipping a seed span as data. §19 guidance is documentation only; the seed is user-supplied.
- Any wording that exposes or gestures at the assembly mechanics (§27): no seam, no "write from here", no "span", "chunk", "freeze", "context", "history", "prompt", "token".
- Any instruction aimed at a single act of writing — no anti-recap directive, no length guidance, no instruction about how to spend reasoning (§22 is served by the seed and by craft framing, not by an instruction paragraph).
- Any wording that grades, praises, or evaluates the preceding text (§13).
- Editing, extending or annotating the approved texts above. They ship byte-for-byte as written.
- Variants of the continuation string for the live seam versus frozen history (`host-mapping.md#s13-continuation` allows one only if a brief justifies it; this brief does not).
- New dependencies; changes to `package.json`, `eslint.config.js`, `vitest.config.js`.

## Files
- allowed to create/modify: `src/prompt.js`, `tests/prompt.test.js`, `docs/modules/prompt.md`, and this brief's Status line
- must not touch: `PLAN.txt`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, other `docs/briefs/*`, `src/grammar.js`, `index.js`, `manifest.json`, `package.json`, `eslint.config.js`, `vitest.config.js`, `tools/*`

## ST APIs used
- none. This brief's code calls no SillyTavern API.

## Verification needed
- (empty for this brief.) Carried to brief 0005: `setExtensionPrompt(key, value, position, depth, scan, role)` signature and the semantics of `position`, `depth`, `role`; only the key's presence on the context is verified today (`docs/api/sillytavern.md#context-keys`). Also open for 0005: whether an ST extension can ship a prepackaged preset profile.

## Acceptance
- [x] `MANUSCRIPT_SYSTEM_PROMPT` and `CONTINUATION_CONTROL` are byte-identical to the approved texts above; a test compares each against an inline copy.
- [x] `CONTINUATION_CONTROL` is byte-identical across reads (`Object.is` on two reads) and contains no newline and no leading/trailing whitespace.
- [x] `MANUSCRIPT_SYSTEM_PROMPT` contains none of these as whole words, case-insensitive: `edge`, `boundary`, `continue`, `generation`, `turn`, `reply`, `respond`, `user`, `model`, `reasoning`, `thinking`, `privileged`.
- [x] `MANUSCRIPT_SYSTEM_PROMPT` additionally contains none of: `assistant`, `chat`, `message`, `prompt`, `token`, `span`, `chunk`, `freeze`, `summarize`, `recap`, `bold`, `italic`, `markdown`.
- [x] `MANUSCRIPT_SYSTEM_PROMPT` contains no `{{` macro delimiter and no occurrence of `Mara`; the only whitelisted personal name is `Idris`.
- [x] The tag ladder is exactly four consecutive indented lines each matching `/^\s+[^\n:]{1,40}: .+$/`, includes one collective and one non-personal tag, and contains no environmental-force tag (§5, §7, INV-9).
- [x] The tag-contents sentence lists speech, action, choice, intent, attention and private interpretation (§5, interiority belongs to tags).
- [x] `MANUSCRIPT_SYSTEM_PROMPT` states that an unnamed figure is tagged by how the page knows them and takes a name once the story grants one.
- [x] `MANUSCRIPT_SYSTEM_PROMPT` contains the four grammar commitments: blank-line block separation, one-figure ownership of a tagged block, narration-integrates-rather-than-decides, group-tags-stand-only-for-the-anonymous (§5, §7, INV-1, INV-9).
- [x] `MANUSCRIPT_SYSTEM_PROMPT` is exactly 229 words, counted as matches of `/[A-Za-z'’]+/g` (cap relaxed from 220 by the orchestrator on 2026-09-12: the approved text is shipped byte-for-byte; the test freezes the count).
- [x] `src/prompt.js` exports exactly two names and declares no function.
- [x] `src/prompt.js` contains no reference to `SillyTavern`, `getContext`, `window`, `document`, or `import`.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/prompt.md#grammar-text` — what the system prompt frames and what it deliberately leaves unsaid; why it is craft framing plus a short rule list rather than a rule list alone (§5–§7, §20's legalese caveat, decision 0001).
- `docs/modules/prompt.md#tag-ladder` — why the examples escalate from a personal name through an unnamed figure and a collective to a non-human agent, why they stop before environmental forces (buffers must remain identifiable and parseable), and that the point is the tag's purpose — identifying a discrete entity or action-aligned group — rather than personhood (§5, §7, INV-9).
- `docs/modules/prompt.md#plain-tag-header` — a tag opens a block and its header is plain text; styling belongs inside the body; why the prompt says nothing about styling (`grammar` parsing and the `boundary` stop string, `docs/protocol/host-mapping.md#s8-boundary`).
- `docs/modules/prompt.md#says-nothing-of-mechanics` — why the text names no real character and describes nothing about how the page is assembled (§8, §27; INV-2 stays a code-side boundary).
- `docs/modules/prompt.md#continuation-control` — why the string is neutral, why it is one frozen constant that no module may recompose (§13, INV-5), and the user's rationale recorded above: it is an honest request from a collaborator, not an in-fiction disguise, which is what keeps the work a creative-writing endeavour rather than a trick played on the writer.
- `docs/modules/prompt.md#seed-guidance` — §19's checklist restated for whoever writes the seed: continuous prose, tag/buffer alternation, independent characters, the external figure appearing naturally and away from cut points, dense tag runs, durable commitments, anonymous agents, unresolved continuation, no handoff, no closure; the seed is user-supplied and low priority; and it, not the prompt, is where §22's causal forward motion and the anti-conclusion habit are demonstrated.

## Questions for the user
- (none outstanding — all answered; answers folded into the texts, Out of scope and Acceptance above. Delivery moves to brief 0005.)

## Amendment 1 (2026-09-12) — user-authored system prompt

User request: "it's probably the lack of humanity in the damn tone of every prompt, can you have this as the standard system prompt for each installation". The text below replaces `MANUSCRIPT_SYSTEM_PROMPT` byte-for-byte (the user pasted it twice; one copy is used). Straight apostrophes as pasted; the example ladder is a fenced code block exactly as written; no trailing newline after the final sentence.

````text
This is a piece of creative writing shaped by what is already on the page: the voices, the unfinished gestures, the things characters have begun but not yet completed. Write it as prose that feels particular and sensory, and let it be strange when the story wants to be strange.

The narrative follows a simple format.

The text is written in blocks, with a blank line between each one. A block is either tagged to a figure or left as narration.

A tagged block begins with a tag followed by a colon. Everything inside that block belongs to that figure: what they say, what they do, what they choose, what they notice, what they intend, and how they understand what is happening.

The tag does not have to be a person's name. It can simply be whatever the story currently knows them as. If the story later gives them a name, the tag can change with it.

```
Idris: sets the cup down. "No."

The tall one: laughs before she has decided to.

Guards: lower their spears together.

The dog: refuses the doorway.
```

Narration sits between these tagged blocks and carries the parts of the scene that do not belong to anyone's individual choice: light, weather, distance, passing time, sound, atmosphere, or the physical consequences of something already set in motion.

It can carry an action forward, but it should not quietly make a new decision on someone's behalf.

If a tagged figure begins something or holds an intention, that can continue across later narration until the story gives it a reason to stop, change, or be interrupted.

A group tag can stand for several figures while they are still moving together or remain individually indistinct. Once one of them becomes distinct enough to receive their own tag, their actions and choices belong to them separately.

The purpose of the tags is simply to keep the page clear about who is speaking, acting, noticing, or choosing, without forcing the prose into a conventional script.

Beyond that, follow the story where it leads.

The story ends when it has reached its ending.
````

### Files allowed
src/prompt.js (the constant only); tests/prompt.test.js (verbatim assertion; word-count freeze updated to the new count; the ladder assertion updated to the fenced form; the whole-word ban on `continue` gets one documented exemption for the phrase "can continue across later narration" — every other forbidden/banned case stays); docs/modules/prompt.md (`#grammar-text` and `#tag-ladder` requoted; one sentence under `#says-nothing-of-mechanics` recording the `continue` exemption and why it is fictional persistence, not transport); presets/*.json regenerated via `npm run build:preset` (no hand edits).

### Acceptance
- [ ] `MANUSCRIPT_SYSTEM_PROMPT` equals the fenced text verbatim.
- [ ] `CONTINUATION_CONTROL` unchanged.
- [ ] Forbidden-word tests pass with the single documented exemption.
- [ ] `presets/Manuscript Protocol.json` and the sysprompt JSON regenerated; `npm run build:preset` run twice leaves the tree unchanged.
- [ ] `npm run check` passes.
