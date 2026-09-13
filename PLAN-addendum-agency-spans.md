# Addendum: Persistent Agency Spans and Neutral Narrative Scope

**Status:** Follow-up implementation note to V3
**Purpose:** Refine the manuscript grammar without replacing the existing ownership, normalization, transport, or concealment architecture.

## 1. Reason for this addendum

The existing V3 design treats the manuscript as a sequence of atomic tag blocks and buffer blocks, ordinarily separated by blank lines.

That provides clear ownership, but it also makes ordinary prose paragraphing carry structural meaning. In practice, this risks encouraging:

* one action or thought per tagged block;
* repeated character headers during otherwise continuous prose;
* short character-response units;
* excessive alternation between actors;
* detailed writing being expressed as more actions rather than deeper treatment of the same action, thought, hesitation, perception, or consequence.

The revised approach separates **prose paragraphing** from **agency ownership**.

The primary model-facing semantic unit should therefore be an **agency span**, not an atomic paragraph-sized block.

---

## 2. Core change: agency spans

A character header opens an agency span.

That span may continue across any number of ordinary prose paragraphs until another agency header appears.

For example:

```text
Anton:
He set the folder down but kept one hand resting on it.

For several seconds he said nothing. His attention moved once toward
the window before returning to Mara, as though whatever answer he had
prepared had become less convincing while he waited.

"I didn't know what else you expected me to do."

Mara:
...
```

The blank lines inside Anton's passage are simply prose paragraph boundaries.

They do not mean that Anton's ownership ended.

The model-facing rule should therefore be approximately:

> A character header establishes the character whose voluntary agency currently owns the passage. That ownership persists naturally across paragraphs until another character takes agency or the narration itself takes the floor.

This should be taught primarily through the prompt and seed examples rather than enforced as a rigid paragraph grammar by the application.

---

## 3. What the application needs to understand

The application does not need to micromanage every narrative transition.

Its hard responsibilities remain comparatively small:

* recognize reserved character headers where needed for ownership protection;
* hard-stop before the externally owned character's reserved header;
* preserve collaborator-supplied multi-paragraph material as one continuous manuscript contribution;
* reconstruct and normalize the mutable manuscript;
* preserve ordinary paragraphing;
* avoid turning model generation boundaries into fictional boundaries.

The application should **not** attempt to determine sentence by sentence whether prose is "character narration" or "neutral narration."

That distinction belongs primarily to the model-facing writing grammar.

The prompt should shape it.

The model should perform it.

The application should preserve it.

---

## 4. Neutral narrative buffer as a prompt concept

The earlier V3 notion of a **buffer** remains useful, but it should be reframed less as a special object created by the application and more as a mode of narration the prompt teaches the model to use.

The essential distinction is:

> Character spans carry new voluntary commitments. Neutral narrative buffers integrate the fictional world without assigning a new voluntary commitment to an individually represented character.

A neutral buffer may contain:

* setting;
* atmosphere;
* sensory detail;
* elapsed time;
* environmental motion;
* consequences already caused by previous actions;
* ongoing states;
* transitions;
* contextual information;
* world-level developments that do not themselves constitute a character choosing something.

The model should learn when such a buffer is useful from instruction and demonstrations.

The application need not insert one automatically.

---

## 5. The neutral boundary should remain subtle

There still needs to be some model-readable way for neutral narration to take the floor when necessary.

However, this should be regarded as part of the **prompted manuscript style**, not as application control syntax.

A candidate notation remains:

```text
∅:
```

but its meaning should be explained narratively rather than mechanically.

For example:

```text
Mara:
She released the handle at last.

∅:
Rain worked steadily against the windows. Somewhere downstairs, the
building door opened and shut, followed by footsteps fading toward the
stairs.

Anton:
His attention shifted briefly toward the sound before returning to her.
```

The prompt might describe `∅:` approximately as:

> `∅:` marks a passage temporarily owned by the surrounding world rather than by any individual character. Use it when neutral narration meaningfully takes the floor between character-owned passages. Do not use it merely because a sentence contains description.

This keeps the notation semantically intuitive.

It is not:

> "Set application owner state to null."

It is:

> "For this passage, nobody individually chooses; the world and already-established consequences are what move."

That distinction should be reflected throughout the implementation notes.

---

## 6. Do not overuse the neutral buffer

Neutral narration may appear naturally inside a character-owned passage without requiring a separate buffer.

For example:

```text
Mara:
She pushed open the door.

Cold air moved immediately into the hallway, carrying the smell of rain
and wet concrete.

She stopped with one hand still against the door. "Anton?"
```

There is no reason to interrupt this with a neutral marker.

The description belongs naturally to the unfolding of Mara's passage.

A separate neutral buffer becomes useful when the narrative viewpoint or causal attention meaningfully leaves the character's immediate action:

```text
Mara:
She pushed open the door.

∅:
The storm had reached the eastern half of the city nearly an hour
earlier. Water had already begun backing over the gutters, and beyond
the apartment blocks a transformer flashed blue against the clouds.

Anton:
He appeared behind her.
```

The prompt should therefore teach:

> Use a neutral buffer when the world meaningfully takes narrative initiative, not whenever the prose becomes descriptive.

This is a literary distinction more than a parser distinction.

---

## 7. Prompt design should carry most of the burden

The desired behavior should be established through both direct instruction and demonstrations.

A model-facing instruction could resemble:

> Character headers indicate the character currently permitted to make new voluntary choices, speak, act intentionally, or acquire new interior commitments. A character's passage may extend naturally across multiple paragraphs and may include locally relevant description, consequences, observation, hesitation, and atmosphere.
>
> Do not repeat a character header merely because a new paragraph begins.
>
> When narration meaningfully shifts away from any individual character's voluntary agency and the world itself temporarily carries the passage, use the neutral narrative marker `∅:`. Neutral passages may develop setting, time, atmosphere, ongoing motion, already-caused consequences, and other non-volitional state, but should not independently decide what an individually represented character voluntarily does.
>
> Use neutral passages only when narratively useful. Ordinary description inside a character passage does not require one.

The actual production prompt may be shorter, but this is the conceptual behavior it should encode.

---

## 8. Demonstrations are especially important

The seed manuscript should demonstrate the distinction more strongly than prose instructions alone.

It should contain examples of:

* one character retaining agency through several paragraphs;
* description occurring naturally inside that character's passage;
* another character taking over simply through their own header;
* neutral buffers between character passages;
* neutral buffers lasting multiple paragraphs when appropriate;
* passages where no neutral buffer is needed;
* several consecutive NPC-owned spans without involving the external character;
* long passages where detail increases without event density increasing.

The model should infer from repeated examples that the grammar describes **narrative ownership**, not conversational turn-taking.

---

## 9. Application behavior around neutral buffers

The host should generally treat neutral-buffer notation as ordinary manuscript text.

It does not need special intervention logic equivalent to the external-character hard stop.

If `∅:` is selected as the final notation, the host may recognize it structurally for linting, formatting, or safe cut selection, but this is secondary.

The important rule is:

> The application should not manufacture neutral buffers merely because its parser believes one is due.

Nor should it split a character span automatically in order to insert one.

Neutral-buffer placement is a writing decision generated under the manuscript prompt.

Where the model makes a poor choice, the mutable frontier can be regenerated or edited before freezing just like other narrative-quality problems.

---

## 10. Linting should remain advisory

Neutral-buffer linting should not become a rigid deterministic classifier.

Obvious violations may be flagged.

For example:

```text
∅:
Anton decides he has had enough and leaves the room.
```

This clearly introduces a new Anton commitment from neutral scope.

But ambiguous prose should not require formal adjudication.

For example:

```text
∅:
Anton was still standing by the window.
```

may simply describe already-established state.

The grammar exists to shape generation toward useful agency separation.

It should not force the application to solve natural-language agency attribution perfectly.

---

## 11. Character hard-stop behavior remains mechanical

This distinction is important:

### Character ownership protection

This is an application guarantee.

If Mara is externally owned:

```text
Mara:
```

remains a reserved hard boundary that the model cannot cross.

### Neutral narrative buffering

This is primarily a prompted narrative behavior.

The model is instructed and demonstrated how to use it appropriately.

The application may understand the notation, but does not need to generate or enforce every transition.

So the architecture deliberately combines:

> **hard mechanical enforcement where authorship ownership requires it**

with:

> **soft prompted grammar where prose quality and narrative organization require judgment.**

---

## 12. Transport remains independent

Neither character-span changes nor neutral-buffer changes should become transport boundaries by default.

Paragraph boundaries remain useful low-salience cut candidates.

Agency transitions may also happen to be safe cuts.

But transport should continue to be selected independently enough that the model does not learn:

```text
Mara:
...
[assistant message ends]

Anton:
...
[assistant message ends]

∅:
...
[assistant message ends]
```

The manuscript grammar exists inside the fiction.

The transport grammar should remain as invisible as possible.

---

## 13. Recommended conceptual hierarchy

The revised system should be thought about as four separate layers:

### Prose paragraphs

Control literary rhythm and presentation.

### Prompted agency grammar

Character headers and occasional neutral narrative buffers shape who may make new fictional commitments.

### Hard authorship boundary

The application mechanically prevents generation of the externally owned character.

### Transport

The host reconstructs, normalizes, chunks, and freezes manuscript material without allowing those operations to become narratively meaningful.

These layers should cooperate without being collapsed into one another.

---

## 14. Revised implementation shorthand

For anyone implementing from the earlier V3 draft:

> Do not build a state machine whose job is to constantly decide when the manuscript should enter and leave neutral narration.

Instead:

> Give the model a well-demonstrated agency grammar in which characters can own multi-paragraph passages and neutral narration can occasionally take the floor. Mechanically enforce only the ownership boundary that actually requires mechanical protection.

The host should be capable of **carrying** the grammar.

The prompt should be responsible for **eliciting** it.

The model should be responsible for **using** it as part of the prose.

---

## 15. Revised guiding principle

The overall principle becomes:

> **Agency is mechanically protected only where necessary, but narratively expressed through prompted manuscript grammar.**

And, more compactly:

> **Ownership persists. Paragraphs breathe. The prompt shapes the buffer. Transport disappears.**
