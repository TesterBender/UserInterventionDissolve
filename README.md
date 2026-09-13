# UserInterventionDissolve

A SillyTavern extension implementing the Collaborative Manuscript Protocol with hidden interaction boundaries (`PLAN.txt`): one character is authored by the human, the model never commits that character's tag, and the model-visible history never reveals where the human intervened.

## Import the reference preset

The repository ships the protocol's system prompt as an importable SillyTavern preset under `presets/`. The files are generated from `src/prompt.js` — see `docs/modules/preset.md` — so the text in them is byte-identical to what the extension uses.

Open **AI Response Configuration**, find the **Chat Completion Presets** section, click **Import preset** (the file-import button next to the preset dropdown) and choose `presets/Manuscript Protocol.json`. The preset appears in the dropdown under the file's name. The extension does not need to be installed for the preset to work.

The preset also carries a "Take stock (thinking models)" entry, shipped disabled, so importing it changes nothing until you turn it on yourself in the prompt manager's own prompt list.

For the text-completion path, `presets/manuscript-protocol.sysprompt.json` is a system-prompt template carrying the same text; import it through the AI Response Formatting import control, where it takes its name from inside the file rather than from the filename.
