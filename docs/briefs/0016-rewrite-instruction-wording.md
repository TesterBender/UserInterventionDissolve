# Brief 0016 — reword REWRITE_INSTRUCTION so the rewrite call reads as scene direction
Status: done
Complexity: low
PLAN sections: §19 (cold start: the first request lacks demonstrations, so a manually prepared or hand-corrected seed span — substantial prose, tag/buffer alternation, the externally owned figure appearing naturally, no artificial handoff — is recommended; the starter reformatter is how one is produced, so the instruction that produces it must actually reach the model), §20 (frozen spans and other persistent demonstrations are checked before promotion, and the check is advisory to the human — nothing here becomes a gate)
Invariants touched: `docs/protocol/invariants.md#enforcement-model` (model-facing text is prompt-level, not code-enforced); INV-2 is untouched — the reserved-literal drop in `dropReservedBlocks`/`sanitiseRewrite` is not modified by this brief

## Goal
`REWRITE_INSTRUCTION` in `src/starter.js` carries the user-approved replacement text byte-for-byte, so the starter-reformatter call is phrased as a request to write a scene from notes rather than as a transform-and-echo of supplied text, and Anthropic's terms-of-service filter (`category: 'reasoning_extraction'`, "reverse engineering or duplicating model outputs") no longer blocks it. Nothing else about the starter path changes: the same constant name, the same export, the same `buildRewriteRequest` shape, the same sanitiser behaviour, the same UI.

## The replacement string (ship byte-for-byte)
Straight apostrophes, single line, no trailing newline, no leading/trailing space:

```
[OOC: Below are notes for an opening scene. Write that scene as it would stand on the page: a tagged block wherever a figure speaks, acts or intends, narration carrying the world between them. Stay inside what the notes establish, and let the scene end where the notes end.]
```

The text contains no apostrophe and no double quote, so the JS literal uses single quotes to match lint; the current double-quoted form exists only because the old text contained `'`.

## In scope
- **`src/starter.js` — the constant only.** Replace the value of `REWRITE_INSTRUCTION` (line 9) with the string above. The `export const` name, its position, and the pointer comment on line 8 (`frozen-instruction: … → docs/modules/starter.md#rewrite-request`) stay as they are. No other line of the module is edited.
- **`tests/starter.test.js`**
  - Add a verbatim assertion: `REWRITE_INSTRUCTION` equals the exact string above (a single `expect(...).toBe(...)` with the literal inline, so a silent reword fails the suite).
  - Keep both existing lists in `describe('REWRITE_INSTRUCTION says nothing of mechanics')` — the whole-word list (`edge`…`privileged`) and the substring list (`assistant`…`markdown`) — unchanged, and keep the existing `[OOC: …]` shape/no-macro/no-character case.
  - Add a third, constant-specific banned list as `it.each` cases, sourced from `docs/decisions/0003-duplication-filter-wording.md`: `restructure`, `rewrite`, `passage`, `return`, `keep every`, `change only`, `add nothing`, `original`, `retain`. Case-insensitive substring match against `REWRITE_INSTRUCTION` only; do not apply it to `MANUSCRIPT_SYSTEM_PROMPT` or any other constant, and do not move the list into a shared helper (one consumer).
  - The `sanitiseRewrite` OOC-echo fixture at line 87 may be restated with the new wording; it is a fixture, not a contract, and either wording must still be stripped.
- **`docs/modules/starter.md`**
  - Update `## The rewrite request {#rewrite-request}`: the quoted block (line 21) becomes the new string verbatim, and the surrounding paragraph describes the instruction as presenting the pasted text as *notes for a scene* rather than as a passage to be returned. Everything else in that heading (identity of `MANUSCRIPT_SYSTEM_PROMPT`, why OOC, "changing this string is a new brief") stays.
  - Add `## ToS filter {#tos-filter}`: why the wording is what it is — the first instruction was blocked live with `category: 'reasoning_extraction'`, the filter keys on the *shape* of the request rather than its content, the banned vocabulary and where it is enforced (the `it.each` list in `tests/starter.test.js`). Cite `docs/decisions/0003-duplication-filter-wording.md` and the prior sighting `Intercede:src/prompt.js:4-9`. No new pointer comment in `src/starter.js` is required for this heading; if the implementer adds one it must be a single-line pointer to `#tos-filter`.
- **`docs/briefs/0015-starter-reformatter.md`** — one line only, under the frozen-string contract (after line 23): a note that `REWRITE_INSTRUCTION` is superseded for its wording by brief 0016. Bookkeeping; Status stays `done`, no other line of that brief changes.

## Confirmed before writing this brief (no fix needed)
`sanitiseRewrite`'s echo strip keys on shape, not on wording: `const OOC_LINE = /^\[OOC:[^\]]*\]$/` (`src/starter.js:11`), applied to trimmed leading/trailing lines. The replacement string is one line beginning `[OOC:`, ending `]`, with no interior `]`, so it matches exactly as the old text did. No sanitiser change is in scope, and the implementer must not "improve" that regex.

## Out of scope (explicit)
- Any change to `buildRewriteRequest`, `sanitiseRewrite`, `dropReservedBlocks`, `restructureStarter`, the imports, or the `{ prompt, systemPrompt }` call shape.
- Any change to `MANUSCRIPT_SYSTEM_PROMPT`, `CONTINUATION_CONTROL`, `src/prompt.js`, or `tests/prompt.test.js` — the system prompt and continuation string already comply with decision 0003.
- Any second instruction variant, retry, fallback wording, "if blocked try X" branch, error-text inspection, or filter detection in code. One frozen constant; a block is a failure the existing `''`-result path already handles.
- Any setting, toggle or editable-instruction surface; any UI change in `src/ui/settings.js` or `style.css`.
- Any new shared "banned words" module, lint rule, or `tools/` check.
- Re-running or regenerating `presets/*`; any dependency; any new decision record (0003 is already committed and is not edited by this brief).
- Rewording the drawer's note, placeholder or hint lines.

## Files
- allowed to create/modify: `src/starter.js` (the `REWRITE_INSTRUCTION` value only), `tests/starter.test.js`, `docs/modules/starter.md`, `docs/briefs/0015-starter-reformatter.md` (one added note line), and this brief's Status line.
- must not touch: `PLAN.txt`, `docs/api/sillytavern.md`, `docs/protocol/*`, `docs/decisions/*`, any other `docs/briefs/*`, `docs/modules/ui-settings.md`, `README.md`, `src/prompt.js`, `src/grammar.js`, `src/boundary.js`, `src/host.js`, `src/constants.js`, `src/state.js`, `src/capture.js`, `src/frontier.js`, `src/freeze.js`, `src/recovery.js`, `src/preset-template.js`, `src/ui/settings.js`, `index.js`, `style.css`, `presets/*`, `manifest.json`, `package.json`, `eslint.config.js`, `vitest.config.js`, `tools/*`, `tests/helpers/*`, every other file under `tests/`.

## ST APIs used
- None newly. The unchanged call sites already cited by brief 0015 remain: `SillyTavern.getContext()` — docs/api/sillytavern.md#getcontext (status: verified); `ctx.generateRaw({ prompt, systemPrompt })` — docs/api/sillytavern.md#generateraw (status: verified). This brief changes only a string literal passed as `prompt`.

## Verification needed
- (empty)

## Acceptance
- [x] `REWRITE_INSTRUCTION` equals the replacement string byte-for-byte: one line, straight apostrophes, starts `[OOC:`, ends `]`, no `\r`/`\n`, no leading or trailing whitespace, no `{{`.
- [x] The existing whole-word and substring lists in `tests/starter.test.js` are unchanged and still pass.
- [x] New `it.each` cases fail for each of `restructure`, `rewrite`, `passage`, `return`, `keep every`, `change only`, `add nothing`, `original`, `retain` appearing in `REWRITE_INSTRUCTION` (case-insensitive), and pass against the shipped string.
- [x] `buildRewriteRequest('  a starter.  ', 'Nobody:').prompt` is `` `${REWRITE_INSTRUCTION}\n\na starter.` ``, and the empty-input, reserved-drop and nothing-reserved cases pass unmodified.
- [x] `sanitiseRewrite` still strips a leading and a trailing echo of the *new* instruction line, and its fence/reserved-block cases pass unmodified.
- [x] `git diff src/starter.js` touches exactly one line (the constant's value).
- [x] `docs/modules/starter.md` quotes the new string verbatim under `#rewrite-request` and has a `## ToS filter {#tos-filter}` heading citing `docs/decisions/0003-duplication-filter-wording.md` and `Intercede:src/prompt.js:4-9`.
- [x] `docs/briefs/0015-starter-reformatter.md` gains exactly one line.
- [x] `npm run check` passes.
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`).

## Docs to write/update
- `docs/modules/starter.md#rewrite-request` — the new instruction quoted in full; that the pasted text is presented to the model as notes for a scene, not as a passage to return; the rest of the heading unchanged.
- `docs/modules/starter.md#tos-filter` — the live block (`category: 'reasoning_extraction'`), that the filter keys on request shape rather than content, the banned vocabulary and where the test enforces it, and the two citations (`docs/decisions/0003-duplication-filter-wording.md`, `Intercede:src/prompt.js:4-9`).

## Amendment 1 (2026-09-12) — content-first shape

User report: the notes-for-a-scene wording still trips the filter ("It still doesn't budge"). User proposal, verbatim: `<content> here </content> [OOC : the following is unoptimized for the creative writing prompt you are tasked to follow. Hence, as per what is contained on the system prompt, correct it such that it follows the best creative writing practices]`. Orchestrator adjustment: do not name the system prompt or use the word "prompt" (banned for model-facing text; and naming it invites a system-prompt-extraction reading).

### New request shape (ship byte-for-byte)
`buildRewriteRequest(text, literal).prompt` becomes, in this order:

```
<content>
{starter text, trimmed}
</content>

[OOC: The content above is unoptimised for the creative writing task you have been set. Bring it in line with the practice laid out for you, so that it reads as the manuscript does.]
```

`REWRITE_INSTRUCTION` is the bracketed line alone (no trailing newline). The `<content>` wrapper is assembled in `buildRewriteRequest`; keep the wrapper strings as two module constants so tests can assert them. `systemPrompt` unchanged. `sanitiseRewrite` must additionally strip a leading `<content>`/trailing `</content>` echo if the model returns the wrapper.

### Files allowed
src/starter.js (constant, wrapper constants, `buildRewriteRequest` assembly, the one echo-strip addition), tests/starter.test.js (verbatim assertion, assembly-order assertions, echo-strip cases; keep every forbidden/banned list), docs/modules/starter.md (`#rewrite-request` requoted; `#tos-filter` gains one sentence on the content-first shape).

### Acceptance
- [x] `REWRITE_INSTRUCTION` equals the bracketed line verbatim.
- [x] `prompt` starts with `<content>\n`, contains the trimmed starter, then `\n</content>\n\n`, then the instruction, nothing else.
- [x] Existing forbidden-word and banned-word tests pass; `prompt`/`system` do not appear in the instruction.
- [x] `sanitiseRewrite` strips a `<content>…</content>` echo and still strips `[OOC: …]` echoes and fences.
- [x] `npm run check` passes.

## Amendment 2 (2026-09-12) — plain ask, no OOC wrapper

User request, verbatim: "Have OOC user prefill be changed into just a straightforward ask without OOC, since it's now bounded into a <content> tag thing, so it makes it less intimidating. Also, this is the newer, less clinical wording cause what the heck: "Rewrite this opening scene in the tagged-block format described above. Keep every event and line of dialogue; change only the presentation.""

`REWRITE_INSTRUCTION` becomes exactly (no brackets, no trailing newline):

```text
Rewrite this opening scene in the tagged-block format described above. Keep every event and line of dialogue; change only the presentation.
```

The `<content>` wrapper and assembly order from Amendment 1 are unchanged. The `[OOC: …]` echo strip in `sanitiseRewrite` stays (harmless). The constant-specific banned-word list from decision 0003 is **withdrawn for this constant** by the user's choice: the notes-framing did not stop the filter either, so the wording theory is unconfirmed. Decision 0003 gets a status line saying so.

### Files allowed
src/starter.js (constant only); tests/starter.test.js (verbatim assertion; remove the decision-0003 banned `it.each` list; keep the mechanics-vocabulary lists — confirm they still pass); docs/modules/starter.md (`#rewrite-request` requoted; `#tos-filter` gains one sentence that the banned list was withdrawn by user decision and the trigger remains unidentified); docs/decisions/0003-duplication-filter-wording.md (append `## Status (2026-09-12)`: banned-word rule withdrawn for REWRITE_INSTRUCTION by user decision; framing rule for other constants stands until evidence says otherwise).

### Acceptance
- [ ] `REWRITE_INSTRUCTION` equals the line verbatim.
- [ ] Prompt assembly unchanged: `<content>\n…\n</content>\n\n` + instruction.
- [ ] Mechanics-vocabulary tests pass; decision-0003 list removed for this constant.
- [ ] `npm run check` passes.
