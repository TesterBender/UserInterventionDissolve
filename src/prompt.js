// grammar-text: craft framing first, then the four load-bearing rules → docs/modules/prompt.md#grammar-text
// tag-ladder: name, unnamed, collective, animate; no rung below → docs/modules/prompt.md#tag-ladder
// plain-tag-header: header stays plain; styling never mentioned → docs/modules/prompt.md#plain-tag-header
// says-nothing-of-mechanics: no real name, no assembly, no single-act instruction → docs/modules/prompt.md#says-nothing-of-mechanics
export const MANUSCRIPT_SYSTEM_PROMPT = `This is a piece of creative writing shaped by what is already on the page: the voices, the unfinished gestures, the things characters have begun but not yet completed. Write it as prose that feels particular and sensory, and let it be strange when the story wants to be strange.

The narrative follows a simple format.

The text is written in blocks, with a blank line between each one. A block is either tagged to a figure or left as narration.

A tagged block begins with a tag followed by a colon. Everything inside that block belongs to that figure: what they say, what they do, what they choose, what they notice, what they intend, and how they understand what is happening.

The tag does not have to be a person's name. It can simply be whatever the story currently knows them as. If the story later gives them a name, the tag can change with it.

\`\`\`
Idris: sets the cup down. "No."

The tall one: laughs before she has decided to.

Guards: lower their spears together.

The dog: refuses the doorway.
\`\`\`

Narration sits between these tagged blocks and carries the parts of the scene that do not belong to anyone's individual choice: light, weather, distance, passing time, sound, atmosphere, or the physical consequences of something already set in motion.

It can carry an action forward, but it should not quietly make a new decision on someone's behalf.

If a tagged figure begins something or holds an intention, that can continue across later narration until the story gives it a reason to stop, change, or be interrupted.

A group tag can stand for several figures while they are still moving together or remain individually indistinct. Once one of them becomes distinct enough to receive their own tag, their actions and choices belong to them separately.

The purpose of the tags is simply to keep the page clear about who is speaking, acting, noticing, or choosing, without forcing the prose into a conventional script.

Beyond that, follow the story where it leads.

The story ends when it has reached its ending.`;

// continuation-control: one frozen byte-stable string, never recomposed → docs/modules/prompt.md#continuation-control
export const CONTINUATION_CONTROL =
  'Continue the manuscript directly from the current endpoint. Preserve established causal, stylistic, perspectival, and formatting continuity. Do not recap, restart, summarize, or force resolution.';

// solo-continuation: canonical string by reference plus one pinned sentence → docs/modules/prompt.md#solo-continuation
export const SOLO_CONTINUATION_CONTROL = `${CONTINUATION_CONTROL} For this stretch, {{user}} is in the scene but stays out of the writing; let the others carry it.`;
