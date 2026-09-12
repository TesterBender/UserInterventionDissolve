# prompt
Owns: INV-1, INV-5, INV-9 (docs/protocol/invariants.md)
PLAN: §5, §6, §7, §8, §13, §19, §20, §21, §22
Depends on: nothing

`src/prompt.js` holds the protocol's two text deliverables as frozen string constants: the system prompt that frames the work and states the narrative's formatting rules, and the canonical continuation-control string. The module is inert — no imports, no functions, no SillyTavern API, no DOM, no configuration. Nothing here injects anything; delivery is a separate concern (brief 0005).

## Grammar text

The system prompt does two things at once, and the order matters. It opens as craft framing — creative writing shaped by what is already on the page, the voices, the unfinished gestures, written as prose that feels particular and sensory and lets the story be strange — and only then lists a few formatting rules. PLAN §20 is explicit that "the grammar exists to preserve agency, not to flatten prose into legalese": a bare rule list gets obeyed as a form, producing stage directions rather than fiction. The framing is what keeps the rules in service of the writing.

As of Amendment 1 (2026-09-12), this text is the user's own wording, chosen because the previous draft read as flat and mechanical rather than as one human addressing another. It commits to the same load-bearing semantics and nothing more (§5–§7):

- blocks are written with a blank line between each one, and each block is either tagged to a figure or left as narration;
- a tagged block belongs to one figure alone, and that ownership covers interiority as well as action — what they say, do, choose, notice, intend, and how they understand what is happening;
- narration carries the parts of the scene that belong to no one's individual choice, and it can carry an action forward without quietly deciding for someone ("tags apply impulses, buffers integrate them");
- a group tag stands only for figures still moving together or indistinct, so a figure who becomes distinct enough for their own tag is never swept back into the group (§7, INV-9).

One further passage carries §6: an intention a tagged figure begins or holds can continue across later narration until the story gives it a reason to stop, change, or be interrupted. The closing line carries the anti-closure habit: "the story ends when it has reached its ending."

Semantics live here, at prompt level, by `docs/decisions/0001-prompt-level-grammar.md`. No code validates manuscript text against this prompt; §20's lint targets name failure modes the text pre-empts, and stay advisory.

## Tag ladder

The four example lines escalate deliberately: a proper name (`Idris`), a figure the page has not yet named (`The tall one`), a collective (`Guards`), and a non-human animate agent (`The dog`). Each rung widens what may hold a tag while keeping the same claim intact — a tag marks one discrete figure, or one group moving as a single body. The point is the tag's *purpose*, identifying a discrete entity or an action-aligned group, not personhood; a reader who saw only a name example would infer a rule about people.

As of Amendment 1, the ladder is presented as a fenced example block (each line its own paragraph inside a fenced span) rather than as indented lines within the running prose, matching the user's own draft.

The ladder stops there on purpose. Environmental forces — fire, weather, tide — are not taggable. Neutral narrative buffers must exist and must stay identifiable (§5): if world-material could be tagged, narration would have nothing left that is exclusively its own, and the `grammar` parser's tag/buffer split would stop meaning anything. Anything that is world rather than will belongs to narration. No rung is added below the animate one.

The unnamed rung also carries its own rule: the tag does not have to be a person's name, it can simply be whatever the story currently knows them as, and if the story later gives them a name, the tag can change with it. That is what lets an anonymous agent act with full ownership before the story has introduced them, and what keeps the transition from epithet to name an ordinary narrative event rather than a grammar violation.

## Plain tag header

A tag begins a block — newline, then the tag, then a colon — and the header itself is plain text. Styling (bold, italics, code) is free inside the block body, and the prompt text never mentions styling at all, in either direction.

The silence is deliberate. A plain header is what `grammar` recognises at block start, and `boundary` uses the header verbatim as a stop string (`docs/protocol/host-mapping.md#s8-boundary`). Mentioning styling would invite a model to decorate the header, which would break both. Forbidding styling outright would spend prompt weight on a mechanic and draw attention to the header as machinery rather than as a convention of the page. Saying nothing leaves the plain form as the obvious default, which is what the examples already demonstrate.

## Says nothing of mechanics

The text names no real character. The only personal name in it is `Idris`, inside an example line, and the externally owned character is never mentioned, never marked special, never given a rule of their own. PLAN §8 requires that the visible manuscript rules describe the same grammar for everyone; a rule that singled out one figure would itself be the leak. Keeping INV-2 (the model never commits the external character) a code-side boundary — `boundary`'s stop string — is what makes that possible.

The text also says nothing about how the page is assembled or delivered (§27): no seam, no span, no chunk, no freeze, no context, no history, no prompt, no token, and no instruction aimed at a single act of writing — no anti-recap directive, no length guidance, no instruction about how to spend reasoning. §22's forward-propagating causality is demonstrated by the seed, not asserted by a paragraph. Every such word would tell the model that it is producing installments into a machine rather than writing into a continuous manuscript.

The one exemption, recorded by Amendment 1: the phrase "that can continue across later narration" uses the whole word `continue`, but in the sense of a fictional intention persisting on the page (§6), not in the sense of a continuation-control instruction crossing a transport seam. The word describes what a tagged figure's intention does inside the story, not what the extension does between requests, so it does not leak mechanics.

## Continuation control

`CONTINUATION_CONTROL` is one string, defined once, never composed at call time. It is byte-identical on every read because it goes into frozen history: if the live seam and the frozen record ever differed by a character, the history would record where an intervention happened (§13, INV-5). There is exactly one variant; `host-mapping.md#s13-continuation` permits a second only if a brief justifies it, and none does.

The string is semantically boring and non-evaluative. It asks for continuity of cause, style, perspective and format, and forbids recap, restart, summary and forced resolution. It grades nothing, praises nothing, and judges nothing about the text before it, because the intended reading of a request is `[manuscript] + CONTINUE`, not submit → judge → installment.

It is plain-spoken rather than in-fiction, and is not softened or disguised. In the user's framing, it is meant to read as a genuine request from a collaborator, because doing so "enforces the notion of this being a creative writing endeavor and not a cheeky way to force a model to write better by disguising myself as a character in the story." An in-fiction disguise would make the control a trick played on the writer; an honest request keeps the work a creative-writing endeavour.

## Seed guidance

The seed span is hand-prepared by the user and shipped with no data by this repository; it is the initial in-context exemplar (§19) and is low priority relative to the rest of the protocol. It teaches by example what the prompt cannot state without exposing mechanics, so whoever writes one should make it demonstrate:

- continuous prose that reads as a manuscript already in motion, not as an opening;
- alternation of tag blocks and narrative buffers, with the buffers doing real work;
- characters acting independently, each tag committing only its own figure;
- the externally owned figure appearing naturally, and away from anything that would read as a cut point;
- dense runs of tags, so that several figures act in close sequence without narration between them;
- durable commitments — an intention tagged once and carried forward by later narration (§6);
- anonymous agents tagged by how the page knows them, including a collective and a non-human agent;
- unresolved continuation: threads left open, no handoff to the reader, no closure.

This is also where §22 lives. Reasoning that propagates forward from causes rather than backward from a desired outcome is shown by a seed in which each block follows from what precedes it, and where nothing is steering toward an ending — the anti-conclusion habit. Neither can be instructed in the prompt text without an instruction aimed at a single act of writing, which is out of bounds.
