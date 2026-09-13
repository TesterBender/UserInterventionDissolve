# Brief 0035 â€” Janitor persona-prefix alignment in the envelope diff
Status: done
Complexity: high  (the misclassification it fixes is an INV-3 failure â€” the human's turn never reaches the frontier as a manuscript block â€” and the fix threads text through two `janitor/` modules and changes a stored identity's input)
PLAN sections: Â§9 (the collaborator's input must become manuscript text headed by the reserved literal; a user turn folded into the system message is the failure this brief repairs), Â§10 (the frontier is manuscript-wide editable, so the aligned text must be the text the human wrote, not a transport decoration), Â§27 (Janitor's `Name: ` prefix is transport formatting; it must not reach the model as part of the manuscript)
Invariants touched: INV-3 (user turns route through `toManuscriptBlock` and arrive as an own-line header block), INV-10 (the aligned/hashed text is private state; no transport artefact is stored or emitted)

Depends on: brief 0032 (envelope diff, identity, shim â€” merged) and brief 0033 (request transform â€” merged). This brief amends what both produced; it does not restate their scope.

Scope source: `TamperContainment/PLAN-janitor.md` â€” "State and identity on Janitor" (envelope ids positional and used only for alignment; identity is `fnv1a32(role + raw content)` plus occurrence index) and "Per-generation pipeline" request-side steps 3b (diff the provider `messages` against the envelope's `chatMessages`; a message with no counterpart is an injection) and 5 (derive: `deriveFrontier` turns user turns into `Persona:\nâ€¦` blocks). Host: janitorai.com only; `docs/protocol/host-mapping.md` does not apply.

## The observed failure

Captured 2026-09-14 by the user on a live proxy chat. `/generateAlpha`'s `chatMessages` stores the user's message bare:

```
"Oi, back to you, mate! The heck is this intrusion?!" Shant spoke â€¦
```

The provider body sends the same message as:

```
Shant: "Oi, back to you, mate! The heck is this intrusion?!" Shant spoke â€¦
```

Janitor prefixes **user-role** messages with `` `${personaName}: ` `` â€” inline, one colon, one space. The assistant greeting in the same capture carried no prefix, and the custom-prompt `.` arrived as a separate message before the user turn and was correctly folded. `classifyMessages` compares by exact string equality, so the prefixed turn matches no envelope entry, is classified as an injection, is appended to the assembled system message by `janitor/transform.js` step 6, and never reaches the frontier: the assistant-role frontier turn ends without the `Shant:` block, which is INV-3 failing in the direction that loses the human's contribution.

## Goal
`classifyMessages` recognises a provider `user`-role message that is an envelope entry carrying Janitor's persona prefix, classifies it as history, and hands the **bare envelope text** onward, so identity, the sentinel test, `deriveFrontier` and `toManuscriptBlock` all see exactly what the human wrote and `src/derive.js` writes the own-line `Shant:` header itself, as it does on SillyTavern. `docs/api/janitor.md` stops claiming the envelope's message ids are positional and records what the capture actually shows, plus the persona-prefix rewrite as a new answered entry. `dist/janitor-manuscript-dissolve.user.js` is rebuilt and committed.

## In scope

**`janitor/history.js`**
- `classifyMessages(messages, envelopeChatMessages, personaName)` gains a third parameter, the persona name from the envelope's `profile.name` (`docs/api/janitor.md#persona-name-lives-at-profile-name`) â€” the same value the call site already turns into the reserved literal. Absent or empty, the function behaves exactly as it does today.
- Alignment against the next unconsumed `isMain` entry accepts a second form, **only** when the provider message's `role === 'user'` and `personaName` is non-empty: `content === personaName + ': ' + entry.message`. Exactly one colon and one space; no trim, no case folding, no regex, no tolerance for a missing space or a newline variant. Exact equality remains the first test and is unchanged for every role.
- Assistant-role (and every non-`user`-role) message is never prefix-matched, per the capture.
- A prefix match pushes a history entry whose `content` is the envelope's `message` **verbatim** â€” the bare text. Everything downstream (`assignIdentities`, `matchWatermark`, the sentinel test, `toStShape`, `prefixIdentity`, `watermarkText`) therefore operates on the bare text with no further change, because Janitor added the prefix and the human did not. `index` and `role` are unchanged, so `janitor/transform.js`'s positional prefill rule still sees the incoming array's positions.
- An exact match still pushes the provider `content` unchanged, so the assistant path and the no-envelope fallback are byte-for-byte what they are today.

**`janitor/transform.js`** â€” the call site only: pass `context.personaName` as the third argument to `classifyMessages`. Nothing else in the pipeline changes, and the step order of `docs/modules/janitor-adapter.md#request-pipeline` is untouched.

**`janitor/identity.js`** â€” expected to need **no edit**. It is on the allowlist only in case threading the bare text requires one; if no edit is needed, leave it byte-identical.

### Identity hashes the bare text (decided here)

`messageIdentity` hashes the text `classifyMessages` emitted, which after this brief is the bare envelope text for a prefixed user turn. That is the intended outcome, not an accident:

- The stored identity must not depend on a decoration Janitor owns and may change or drop in any build; if it did, the next Janitor deployment would silently re-key every compiled user turn and re-send compiled manuscript.
- The bare text is also what the watermark's `prefixHash` and `watermarkText` must describe, since the compiled prefix is a slice of the derived manuscript, not of Janitor's transport string.

The store is `uid-janitor-v1:` with no users to migrate (`docs/modules/janitor-adapter.md#stored-state` â€” there is no migration path by design), so the change of hashed input costs nothing: any pre-existing local state that re-keys is the same "rebuild with Recompile" case the doc already accepts. `STATE_VERSION` is **not** bumped and `src/` is not touched.

**Tests â€” `tests/janitor/`**
- A new recorded-body fixture reproducing the 2026-09-14 capture: assembled `system` message, an assistant greeting with no prefix, a separate `.` message (the custom-prompt injection) before the user turn, and the user turn sent as `` `Shant: "Oi, back to you, mate! â€¦` ``, with a matching `/generateAlpha` envelope whose `chatMessages` holds the greeting and the **bare** user message as `isMain` entries.
- An end-to-end assertion through the real transform: the dispatched body's frontier (the assistant-role turn produced by reconstruction) ends with an own-line `Shant:` block whose body is the bare text; the `.` appears exactly once, inside the system message; the prefixed string `` `Shant: "Oi` `` appears nowhere in the dispatched body.
- Unit tests on `classifyMessages`: prefixed user turn matches; unprefixed user turn still matches; a turn prefixed with a *different* name does not match and stays an injection; an assistant message carrying `` `Shant: ` `` is never prefix-matched; with an empty `personaName` the prefixed turn is an injection (today's behaviour).
- One assertion that the history entry's `content` for a prefix match is the envelope's bare string, so identity and derivation both see it.

**`dist/janitor-manuscript-dissolve.user.js`** â€” regenerated with `npm run build:janitor` and committed. Never hand-edited.

## Out of scope (explicit)
- **Changing the identity scheme.** Using the envelope's database ids as message identity is a follow-up brief, not this one. `docs/decisions/0007-janitor-host-deviations.md`'s "Envelope positional ids" rejection rationale rests on the now-corrected ledger claim and must be revisited **by that follow-up**; this brief does not edit that decision file at all.
- Any tolerance beyond the one exact prefix form: no trimming, no normalisation, no fuzzy or prefix-of-prefix matching, no `startsWith` fallback, no `{{user}}` substitution, no second separator variant. A message that does not match either exact form stays an injection, which is the existing, tested behaviour.
- Rewriting alignment to use envelope ids, positions, `created_at`, `character_id` or `is_bot` for anything.
- Recording or storing the fact that a message arrived prefixed; no new state field, no flag on the history entry, no `STATE_VERSION` bump, no migration.
- Anything response-side, the panel, Export/Import, Recompile, the Anthropic adapter.
- Editing `src/**` for any reason, including a Janitor-aware `toManuscriptBlock` or a prefix-stripper in `src/derive.js`. If the fix cannot be made without an `src/` change, that is a `SCOPE_GAP`.
- Any setting, toggle or new dependency.

## Files
- allowed to modify: `janitor/history.js`, `janitor/transform.js` (the one call site), `janitor/identity.js` (only if threading the bare text demands it), `docs/api/janitor.md`, `docs/modules/janitor-adapter.md` (existing headings amended), `dist/janitor-manuscript-dissolve.user.js` (regenerated)
- allowed to create: files under `tests/janitor/` (the new test and its fixture)
- must not touch: `src/**`, `janitor/constants.js`, `janitor/storage.js`, `janitor/main.js`, `janitor/shell.js`, `janitor/envelope.js`, `janitor/shape.js`, `janitor/xhr-warning.js`, `tools/**`, `package.json`, `eslint.config.js`, `index.js`, `manifest.json`, `presets/**`, `PLAN.txt`, `TamperContainment/**`, `docs/decisions/**`, `docs/protocol/**`, `tests/*.test.js`

## ST APIs used
- none. This host is janitorai.com; `globalThis.SillyTavern` must not be referenced in `janitor/` or `tests/janitor/`. No entry of `docs/api/sillytavern.md` is relied on.

## Verification needed
- (empty) The Janitor behaviour this brief depends on was captured by the user on 2026-09-14 in a live proxy chat and is recorded by this brief as an answered ledger entry. Everything else it uses is already answered: the persona lives at `profile.name` (2026-09-13), non-history turns are injected in any role (2026-09-13), the custom prompt may not be empty (2026-09-13). Do not launch `st-api-verifier`; it verifies SillyTavern only.

## Acceptance
- [x] On the new fixture, the dispatched body's assistant-role frontier turn ends with `Shant:` on its own line followed by the bare captured text; the string `` `Shant: "Oi` `` (prefix form) appears nowhere in the dispatched body.
- [x] On the same fixture, `.` appears exactly once, inside the assembled system message, and no non-system dispatched message equals `.`.
- [x] `classifyMessages` unit cases all hold: prefixed user turn â†’ history with bare `content`; unprefixed user turn â†’ history; `Other: <text>` â†’ injection; assistant message beginning `Shant: ` â†’ injection (never prefix-matched); empty `personaName` â†’ prefixed turn is an injection.
- [x] The id assigned to a prefixed user turn equals the id assigned to the same turn sent unprefixed â€” identity is over the bare text.
- [x] Every test that passed before this brief still passes unchanged; no existing fixture is edited to accommodate the new rule.
- [x] `npm run build:janitor` regenerates `dist/janitor-manuscript-dissolve.user.js`, the committed file matches a fresh build, and it parses via `new Function`.
- [x] `npm run check` passes
- [x] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/api/janitor.md` â€” replace the entry "Envelope message ids are positional" with a corrected entry (status: answered, captured 2026-09-14) stating what the capture shows: each `chatMessages` entry is `{character_id (bot messages only), chat_id, created_at, id, is_bot, is_main, message}`, `id` is a large integer database id (e.g. `103237690204`), not a position; and the envelope includes the message currently being sent. State plainly that the earlier "0-based positional indices" claim was wrong, and that whether those ids are usable as stored identity is deliberately left to a follow-up brief. Add a new answered entry (captured 2026-09-14), "Janitor prefixes user turns with the persona name": in the provider body, user-role history messages arrive as `` `${profile.name}: ${message}` `` â€” inline, one colon, one space â€” while assistant-role messages arrive unprefixed; the envelope stores the bare text. Do not touch the other entries or the `Open` list beyond this.
- `docs/modules/janitor-adapter.md#envelope-diff` â€” amend: alignment accepts the persona-prefixed form for `user`-role messages only, exactly one colon and one space, and the history entry carries the bare envelope text because Janitor added the prefix and the human did not; say why exact-only (no trimming or fuzzy matching) is the right stance on a host that ships unannounced changes, and note the consequence that the sentinel test and every downstream consumer now compare against the bare text.
- `docs/modules/janitor-adapter.md#content-hash-identity` â€” amend: the hashed `content` is the text the diff emitted, i.e. bare for a prefixed user turn; why the stored identity must not depend on a prefix Janitor owns; and correct the bullet that calls the envelope's ids positional â€” they are database ids, the reason they are not used as identity here is now an open question for a follow-up brief rather than a settled one, and nothing in this layer stores them either way.
