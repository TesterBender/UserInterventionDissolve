# starter
Owns: —
PLAN: §19, §20, §23
Depends on: host, prompt, grammar, boundary

`src/starter.js` takes a chat starter written as ordinary prose and asks the configured model to re-set it in the manuscript's tagged-block form. It returns the sanitised text to its caller and writes nothing anywhere: no character card, no chat, no canonical state, no setting.

## Why a reformatter at all {#why}

PLAN §19 asks for a cold start: the first request carries no demonstrations, so the protocol works best when a prepared exemplar — substantial prose, tag and buffer blocks alternating, the externally owned figure appearing naturally, no artificial handoff — is already on the page. Most starters people already have are ordinary prose. This module converts one.

It does not author one, does not judge one and does not install one. PLAN §20 makes any check on text that will become a persistent demonstration advisory to the human, never a gate, and the user's ruling of 2026-09-12 settled where the result goes: "it should just have an output box that the user can then copy and paste over to the alternate greeting list." The collaborator reads the output, edits their input if they dislike it, and moves the text into the character's Alternate Greetings themselves. An extension that edits character cards is a different feature with different risks.

## The rewrite request {#rewrite-request}

The system prompt of the rewrite call is `MANUSCRIPT_SYSTEM_PROMPT` by identity — the same object, never a copy or a concatenation. The manuscript's grammar is carried entirely by that text (`docs/decisions/0001-prompt-level-grammar.md`), so a rewrite performed under it is shaped by the same rules the manuscript itself runs under. A second, "rewriting-specific" description of the form would be a second source of truth for the grammar.

The user prompt is one frozen constant followed by a blank line and the trimmed starter:

```
[OOC: Restructure the passage below into the manuscript's form — a tagged block for each figure's speech, action and intent, narration between them. Keep every event, every line of dialogue and every detail; change only the shape on the page. Add nothing that is not already there. Return the restructured passage alone.]
```

It is OOC-framed because the same preset and the same system prompt are in force and this one call is deliberately off-story: the request is about the passage on the page, not about the world. Within that frame it stays scene direction, not rules-lawyering — it names no mechanism, no host, no character and no macro, and it passes the same forbidden-vocabulary lists the system prompt passes. Changing this string is a new brief, not an implementation detail.

The starter is passed through the same reserved-literal removal the result is (see [Sanitising the result](#sanitise)) before it is embedded, so the model is never shown a block that commits the externally owned figure and is therefore never invited to produce one. When no persona name is set, `reservedLiteral` returns `''`, nothing is reserved, and the removal step is skipped rather than guessed at. An empty or whitespace-only starter yields the instruction alone; refusing to send it is the caller's job.

## generateRaw, not generateQuietPrompt {#generate-raw}

The call is `await ctx.generateRaw({ prompt, systemPrompt })` — one options object with exactly those two keys, no `api`, `responseLength`, `prefill`, `jsonSchema`, `instructOverride` or `quietToLoud`. `generateRaw` replaces the prompt and system prompt wholesale: no character card, no world info, no persona, no chat history (`docs/api/sillytavern.md#generateraw`). The current connection settings — model, temperature, preset — still apply, which is what "ask the model the collaborator is actually using" means here.

`generateQuietPrompt` is the wrong tool and is cited only to record that (`docs/api/sillytavern.md#generatequietprompt`): it injects its prompt into the full normal pipeline, so history, card, world info and `generate_interceptor` all run. That is the opposite of a side channel.

A missing `generateRaw` and a rejected call end the same way: one `console.error` with `LOG_PREFIX` and an empty-string result. The module never throws and never notifies — the drawer owns every user-facing message.

## Sanitising the result {#sanitise}

The model's answer is cleaned in order: a leading and/or trailing `[OOC: …]` echo of the instruction is dropped, an enclosing code fence (with or without a language word) and any stray fence lines are dropped, the remainder is parsed with `parseManuscript`, every block whose header is the reserved literal is dropped, and the survivors are rejoined with one blank line and trimmed. An all-reserved answer sanitises to `''`, which the caller treats as a failure.

A reserved block is dropped rather than flagged. INV-2 is that the model never commits the externally owned figure's tag, and a greeting is a persistent demonstration: the wrong demonstration teaches the wrong thing every time the chat is started. Only a block *beginning* with the literal counts — the decision is `block.actor` plus a `findTagLiteral` hit at offset 0 in `block.raw`. A mid-block mention of the same name is ordinary prose about that figure and survives untouched.

All structural work is `parseManuscript` and `findTagLiteral` from `src/grammar.js`. This module adds no parser and knows no grammar of its own.

## Off the protocol path {#off-path}

Nothing this module sends or receives enters the protocol. `runGenerationInterceptors` is never called for `generateRaw`, so `frontier`'s `generate_interceptor` cannot touch this request; it fires neither `GENERATION_STARTED` nor `CHAT_COMPLETION_SETTINGS_READY`, so `boundary` neither arms nor applies its stop strings on that path; it adds nothing to `chat[]`, so `capture` and `recovery` never see it (`docs/api/sillytavern.md#generateraw`). No canonical state, freeze or frontier call appears here.

That isolation is by construction, not by guard, so there is no suppression flag and no "skip me" branch anywhere in the protocol modules. Should `boundary`'s stop strings or its stream-side stop reach this call by some path, that is welcome rather than a leak — a rewrite that halts before the externally owned figure's tag is exactly the output wanted — and the sanitiser is the guarantee either way (INV-3, INV-10).
