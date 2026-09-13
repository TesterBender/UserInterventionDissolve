# Brief 0043 — Janitor panel: captured-context box, override editor, Use captured / Save / Clear
Status: draft
Complexity: high  (it adds a second writing surface to the panel, changes both panel modules, extends the export/import wiring, and amends brief 0040's pinned "no conditional in panel.js" rule)
PLAN sections: §10 (editorial authority is the human's, and this is the only surface on this host where they can exercise it over the assembled context), §23 (the host contract includes giving the human a way to see and keep what the script sends; the captured unit is otherwise invisible to them), §27 (the panel is human-facing and sits outside the model's world; nothing it renders may enter a request except the override text the human typed)
Invariants touched: INV-10 (the panel renders the captured context and the override; neither it nor anything about them may reach the reconstructed history)

Depends on: **brief 0042**, which must be merged first. This brief adds **no logic**: `loadOverride`, `saveOverride`, `clearOverride`, `overrideDrift`, `status.capturedContext` and the three-argument `exportStateJson` / four-field `importStateJson` all come from 0042. It also depends on brief 0040 (the panel itself) and amends one of its rules, stated below.

Scope source: the orchestrator's 2026-09-14 decision with the user. Layout is read from `TamperContainment/TamperMonkeyJanAI.txt` L3652–3750 — the two-column "captured, read only" / "editable" pair at L3693–3709 is the shape that is kept; the eyebrow, the chips, the timer, the empty-state card, the "Saved records" manager (L3711–3739) and the footer's `Send now` / `Use saved override` / `Use new original` / `Restore original` buttons (L3741–3749) are **not** ported, because every one of them belongs to the send-time flow this design removes.

## Goal
The panel gains one section: a read-only box showing the context Janitor assembled for the last transformed request, an editable textarea holding the override for this chat, and three buttons — **Use captured**, **Save**, **Clear**. Saving writes the override for the current chat together with the capture it was saved against; clearing removes it and the next request goes back to Janitor's text. When the captured unit differs from the one the saved override was saved against, the status area says so in one sentence and nothing else happens — no block, no prompt, no automatic re-save. The export textarea now carries the override alongside the state, and an import replaces the override as well. There is still no send-time pop-up, no grace period and no settings.

## In scope

**`janitor/panel-text.js`** — every sentence and every decision, as brief 0040 requires:
- New `PANEL_LABELS` entries for the section heading, the captured box heading, the editor heading and the three buttons.
- `contextLines(status, override)` → the lines for the status area's context part: whether an override is in force for this chat or Janitor's own context is being used, and, when `overrideDrift(override, status.capturedContext)` is true, one sentence saying Janitor's context has changed since the override was saved, that the override is still being sent unchanged, and that Use captured then Save is how to take the new text. It is informational; it never says the request was blocked, because it never is.
- `overrideSaveOutcome(status, text)` → `{ chatId, text, capturedText, message }` — the same shape of decision `importOutcome` already makes, so `panel.js` branches on nothing: an empty or whitespace-only `text` yields the "cleared" message, and a non-empty one the "saved" message naming that it applies from the next message onwards.
- `overrideClearedText()`.
- `importOutcome(result, chatId)` gains `override` in its return so the panel writes the imported override (or clears it when `result.override` is `null`) without a branch of its own. Its existing fields and behaviour do not change.
- Human-facing text is free (`PLAN-addendum-hierarchical-compilation.md` §13 — frontend presentation is outside the specification, and nothing here is model-facing or pinned). Write it plainly; do not explain boundary or compilation mechanics the human cannot act on. Tests assert on facts present (the chat id, the word `Save`, that the drift sentence exists), never on whole sentences.

**`janitor/panel.js`** — plumbing only:
- One new section, after the status area and before Export: a read-only `<textarea>` for the captured unit (selected on focus, like the export area) and a writable `<textarea>` for the override, plus the three buttons.
- `renderPanel()` fills the captured box from `getRequestStatus().capturedContext` and appends `contextLines(status, loadOverride(status.chatId))` to the status text. **It never writes into the override textarea** — otherwise a transformed request or another tab's write would delete what the human is typing.
- The override textarea is filled from `loadOverride` by the **launcher click handler** (which already toggles and re-renders) and by **Use captured** (which writes `status.capturedContext` into it). Consequence, pinned: **unsaved text does not survive closing the panel**, and there is no draft store. The optimizer's `draft`/`committed` pair (L2761–2773) is not ported.
- **Save** calls `overrideSaveOutcome`, then `saveOverride(outcome.chatId, outcome.text, outcome.capturedText)`, sets the message line and re-renders. Because `saveOverride` removes the entry for empty text (brief 0042), Save with an empty box and Clear reach the same place through one code path.
- **Clear** calls `clearOverride(status.chatId)`, empties the override textarea, sets `overrideClearedText()` and re-renders.
- **Import** additionally writes the imported override: `saveOverride` when `outcome.override` is non-null, `clearOverride` when it is null, under the same chat id `importOutcome` already decides. **Export** passes `loadOverride(status.chatId)` as `exportStateJson`'s third argument.
- **Amendment to brief 0040's rule.** 0040 pinned that `panel.js` contains no conditional other than element presence and the storage-key filter. This brief keeps the spirit and states the new bound exactly: `panel.js` still contains **no conditional at all beyond those two** — the import's override branch lives in `panel-text.js`'s `importOutcome`, the empty-text branch lives in `overrideSaveOutcome` and `saveOverride`, and the editor is refilled on every launcher click rather than only on open, which is why no open/closed test is needed. An implementer who reaches for an `if` here has put logic in the wrong file. The source-shape assertions in `tests/janitor/panel-text.test.js` are extended to hold this.

**Tests — `tests/janitor/panel-text.test.js`** (extended; pure only, no DOM, no jsdom):
- `contextLines` says an override is in force when one is loaded and says Janitor's own context is in use when it is not;
- the drift sentence appears exactly when `overrideDrift` is true, and never claims anything was blocked or changed;
- `overrideSaveOutcome` returns the current chat id, the typed text and `status.capturedContext` as the captured copy; an empty or whitespace-only text yields the cleared message and an empty `text`;
- `importOutcome` carries the result's `override` through, `null` included, and its existing fields are unchanged;
- **source shape**: `panel.js` contains no human-facing string outside `panel-text.js`; it contains no conditional beyond element presence and the storage-key filter; `renderPanel` does not assign to the override textarea's `value`; no test imports `janitor/panel.js`.

**`dist/janitor-manuscript-dissolve.user.js`** — regenerated with `npm run build:janitor` and committed. Never hand-edited.

### Decisions this brief takes (do not re-open during implementation)
- **No send-time surface of any kind**: no pop-up, no modal, no countdown, no "send this for future responses", no `Send now`, no request held open waiting for a human.
- **Three buttons, and the list is closed**: Use captured, Save, Clear. No `Restore original` (that is Clear), no `Use saved override` (a saved override is already in force), no per-request enable.
- **The captured box is read-only** and shows only the last transformed request's capture. It is not a history, not a diff and not a list.
- **No cross-tab listener for the override key.** The existing `storage` filter stays exactly as it is; two tabs on one chat remains last-writer-wins, which the panel already says.
- **No settings, no persisted panel state** (`docs/modules/janitor-panel.md#no-settings` stays true).

## Out of scope (explicit)
- Any change to `janitor/context-override.js`, `janitor/transform.js`, `janitor/portable.js`, `janitor/status.js`, `janitor/constants.js` or `janitor/storage.js`. If the panel needs something they do not expose, that is a `SCOPE_GAP` against brief 0042, not an edit here.
- A diff view, a side-by-side highlight, a character or token counter, a word count, an undo stack, a draft autosave, a revision list, or a "saved records" manager.
- Multiple overrides per chat, named templates, a character-scoped or global override, an import of someone else's override on its own.
- A resize handle, a drag handle, a modal layout, a keyboard shortcut, a theme, or any CSS beyond the rules the new elements need inside the existing shadow root.
- Any `MutationObserver`, any Janitor selector, any reading of Janitor's own DOM, any rendering inside Janitor's chat.
- A dependency of any kind, and **jsdom in particular**, including as a devDependency, a vitest `environment` setting or a per-file pragma.
- Editing `src/**`, `docs/modules/janitor-adapter.md`, `docs/decisions/**`, `docs/api/**`, `PLAN.txt`, `TamperContainment/**` or `docs/protocol/**`.

## Files
- allowed to modify: `janitor/panel.js`, `janitor/panel-text.js`, `tests/janitor/panel-text.test.js`, `docs/modules/janitor-panel.md`, `dist/janitor-manuscript-dissolve.user.js` (regenerated)
- must not touch: `src/**`, `janitor/context-override.js`, `janitor/transform.js`, `janitor/portable.js`, `janitor/status.js`, `janitor/storage.js`, `janitor/constants.js`, `janitor/recompile.js`, `janitor/main.js`, `janitor/shell.js`, `janitor/sse.js`, `janitor/stop-routes.js`, `janitor/rollback.js`, `janitor/identity.js`, `janitor/history.js`, `janitor/envelope.js`, `janitor/shape.js`, `janitor/xhr-warning.js`, `tools/**`, `package.json`, `eslint.config.js`, `index.js`, `manifest.json`, `presets/**`, `style.css`, `tests/*.test.js`, `tests/janitor/**` except `panel-text.test.js`, `docs/modules/janitor-adapter.md`, `docs/modules/janitor-transport.md`, `docs/README.md`, `docs/decisions/**`, `docs/api/**`, `PLAN.txt`, `TamperContainment/**`, `docs/protocol/**`

## ST APIs used
- none. This host is janitorai.com; `globalThis.SillyTavern` must not be referenced in `janitor/` or `tests/janitor/`.

## Verification needed
- (empty) No SillyTavern API is involved and no new Janitor fact is needed; the panel renders what brief 0042 computes. Do not launch `st-api-verifier`.

## Acceptance
- [ ] The panel shows the last request's captured context in a read-only box and the saved override for the current chat in an editable box, and says in the status area whether an override is in force.
- [ ] Use captured copies the captured text into the editor and writes nothing to storage; Save stores the editor text together with the capture it was saved against; Clear removes the entry and empties the editor.
- [ ] Save with an empty or whitespace-only editor clears the override rather than storing one.
- [ ] The drift sentence appears exactly when the captured unit differs from the one the override was saved against, states that the override is still being sent, and no code path blocks, re-saves or clears on drift.
- [ ] Export includes the override; Import writes the imported override and clears it when the file carries none.
- [ ] `renderPanel` never assigns to the override textarea's value; a status write or a `storage` event does not disturb text being typed.
- [ ] `janitor/panel.js` contains no human-facing string outside `panel-text.js` and no conditional beyond element presence and the storage-key filter.
- [ ] No test imports `janitor/panel.js`; `package.json` is byte-identical and no test file names jsdom or sets a DOM environment.
- [ ] `npm run build:janitor` regenerates `dist/janitor-manuscript-dissolve.user.js`, the committed file matches a fresh build, and it parses via `new Function`.
- [ ] `npm run check` passes
- [ ] every new pointer comment resolves (`node tools/check-comments.mjs`)

## Docs to write/update
- `docs/modules/janitor-panel.md` — new `## Context editor {#context-editor}`: what the two boxes are (the last request's captured unit, read-only; the override for this chat, editable), what the three buttons do, that a saved override applies from the next message onwards until it is cleared, that Save with an empty box is the same act as Clear, and that the rule for what the unit contains lives at `docs/modules/janitor-adapter.md#context-override` rather than being restated here.
- `docs/modules/janitor-panel.md` — new `## Drift in Janitor's context {#context-drift}`: that the panel reports when Janitor's own assembled context has changed since the override was saved, that the override is still sent unchanged, that Use captured followed by Save is the way to take the new text, and that this is deliberately not a prompt — with the one-line reason (comparing the whole assembled message at send time is what made the optimizer ask on every message, and the injections that caused it are not part of the unit here).
- `docs/modules/janitor-panel.md#transfer` — amend: the export carries the override and the import replaces it, clearing it when the file carries none.
- `docs/modules/janitor-panel.md#untested-dom` — amend: the editor is filled only by the launcher click and by Use captured, `renderPanel` never writes into it, unsaved text is lost when the panel closes, and `panel.js` still carries no conditional beyond the two named ones — with the source-shape assertions that hold it.
- `docs/modules/janitor-panel.md#no-settings` — amend one sentence: the action list is now status, Recompile, Export, Import, Use captured, Save, Clear, and it is still closed.
