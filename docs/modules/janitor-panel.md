# janitor-panel

Owns: nothing. Every number it shows and every rule it states was decided elsewhere; this layer renders.
PLAN: §10 (the rebuild is editorial authority and only a human may ask for it), §23 (the host contract includes giving the human a way to see and keep canonical state), §27 (the panel is human-facing and sits outside the model's world)
Depends on: `janitor/status.js`, `janitor/recompile.js`, `janitor/portable.js`, `janitor/storage.js`.

`janitor/panel-text.js` and `janitor/panel.js` are the userscript's only human surface and its only DOM code. `docs/protocol/host-mapping.md` describes the SillyTavern host and does not apply here: there is no settings drawer, no toast and no extension menu on janitorai.com.

## What the panel is {#what-it-is}

One launcher button and one panel, both inside a shadow root. The panel reports what the last transformed request did, offers a rebuild, and hands the human their state as text. It holds no state of its own beyond which DOM nodes exist, takes no protocol decision, and never touches a request: everything it shows comes from `janitor/status.js`'s snapshot ([status snapshot](janitor-adapter.md#status-snapshot)) and everything it writes goes through `saveJanitorState`.

The host element gets `attachShadow({ mode: 'open' })` for the reason the optimizer's own editor does (`TamperContainment/TamperMonkeyJanAI.txt` L3119–3126, L3752): Janitor's stylesheet must not reach the panel and the panel's rules must not reach Janitor's page. `:host { all: initial }` closes the remaining inheritance. No rule is added outside the shadow root, so uninstalling the script leaves the page exactly as it was.

The host is appended to `document.documentElement`, not to `document.body`. The script runs at `document-start`, where the body does not exist yet but the document element always does, so appending there needs no wait, no `MutationObserver` and no retry — three moving parts avoided by choosing a different parent. `installPanel()` returns early when its host id is already in the document, which is the only idempotence guard it needs.

## Status line {#status-line}

Each line is built by `statusLines(status)` from the snapshot described at [status snapshot](janitor-adapter.md#status-snapshot), written once per transformed request.

- **Chat id** — which Janitor chat the stored manuscript belongs to. It is the key an import is written under.
- **The reserved name** — the literal the protocol keeps for the human's character. A persona switch changes it, and this host reports the change and never repairs the spans that were compiled under the old one (`TamperContainment/PLAN-janitor.md` reality 8). Seeing an unexpected name here is the signal to stop and check the persona, not something the script can fix.
- **Sealed spans, unsealed units, live scene words** — how much of the chat has been compiled into immutable history, how much is waiting in units, and how much mutable text the last request carried.
- **The transport tier** — whether the boundary is enforced by the `stop` parameter or by cutting the stream, from `status.stopSent` and the route learning at [stop rejection learning](janitor-transport.md#stop-rejection-learning). "The stream cut is carrying the boundary" means the provider refused `stop` for this route: the reply still ends in the right place, but the provider may generate a little text past it that the script discards. Nothing is wrong and there is nothing to do.
- **The router warning** — shown only when the envelope reported `janitor_router_enabled`. Janitor is then making the model call on its own servers and the script sees no request at all (`TamperContainment/PLAN-janitor.md` reality 1: proxy mode only). This is the one status line that asks the human to act, because only they can point Janitor at a proxy.
- **Edit-to-compiled-text notices** — one line per entry in the drift ledger. This is this host's replacement for the SillyTavern toast ([frozen-edit notice](freeze.md#frozen-edit-notice)): it appears once per occurrence, names the message, and reports only. INV-6 forbids re-cutting a sealed span, so the honest offer is a full rebuild, not a repair.

With no snapshot yet — `at === 0` or an empty chat id — the panel says so in one line and shows nothing else, because every other line would be a zero pretending to be a fact.

## Recompile {#recompile-button}

The button flags; it does not run. This script cannot start a generation on janitorai.com, so `requestRecompile(chatId)` records the wish and the next transformed request on that chat consumes it — the rule is at [recompile](janitor-adapter.md#recompile) and is not restated here. The panel says two things about it: the rebuild happens on the next message, and it can only use the messages Janitor still sends. It is disabled with an explanation before the first request of the page, because without a chat id there is nothing to flag.

## Export and import {#transfer}

Export writes `exportStateJson(chatId, loadJanitorState(chatId))` into a **read-only textarea**, selected on focus so copying is one keystroke. It is deliberately not a download and deliberately not a clipboard write:

1. `<a download>` with a `Blob` or object URL is the fragile path under Tampermonkey — the script runs in a sandboxed context and the page's CSP can refuse the URL scheme.
2. A download that is silently blocked loses the human's only backup and reports nothing.
3. `navigator.clipboard` fails the same way: permission prompts, non-secure-context refusals, and a "copied" claim that may be false.

A textarea is visible proof the data exists. It is also the only backup the manuscript has: `localStorage` in this browser profile is the single copy (`TamperContainment/PLAN-janitor.md` realities 4 and 20), and Janitor's own window truncation means the chat is not a second one.

Import parses through `importStateJson`, and on success **replaces** this chat's state — it never merges, for the reason given at [state transfer](janitor-adapter.md#state-transfer). A refusal writes nothing and renders the sentence for its reason. When the export names a different chat the panel says so and imports anyway: restoring a manuscript into a re-created chat is the point of the feature, not an accident to guard against.

## Cross-tab behaviour {#cross-tab}

`installPanel` registers a `window` `storage` listener that ignores every key not starting with `STORAGE_KEY_PREFIX` and every key that is not this chat's, then re-renders. It reloads nothing into any running computation and writes nothing, because it does not have to: `janitor/transform.js` reloads state from storage before every derivation ([request pipeline](janitor-adapter.md#request-pipeline), step 2), which has been true since brief 0033 and is what makes two tabs safe enough.

Safe enough is not safe. Two tabs on one chat is **last-writer-wins**: there is no lock, no lease, no leader election and no merge, and adding one would be a distributed-systems answer to a problem a sentence solves. The panel states the limit instead, and the human closes the second tab.

## Why the DOM is untested {#untested-dom}

`panel-text.js` is pure — no DOM, no storage, no clock — and holds every sentence, every number and every decision the panel takes, including which chat id an import saves under. It is tested. `panel.js` is plumbing: create an element, append it, set `textContent`, toggle `hidden`, add a listener. It contains no conditional other than element presence and the storage-key filter, and no string a human reads other than element names, ids and CSS.

That split is what makes the missing tests honest rather than lazy. Testing element creation would need jsdom — a dependency this host does not have and will not take — or a hand-rolled fake DOM, which would test the fake. An implementer who wants a test for `panel.js` has put logic in the wrong file; move it into `panel-text.js` and test it there.

## No settings {#no-settings}

There are none, and the list of actions is closed: status, Recompile, Export, Import. PLAN names nothing on this surface as host-selectable; the sentinel, the horizon budget and the reserved literal are constants in `janitor/constants.js`. No theme, no verbosity, no per-chat enable flag, no "turn the script off" — the way to turn it off is Tampermonkey's own switch. Panel open/closed state is not persisted either, because a remembered panel is a setting nobody asked for.
