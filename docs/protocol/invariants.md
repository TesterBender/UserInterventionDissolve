# Protocol invariants

Condensed from PLAN.txt §26. This is the only protocol text the orchestrator keeps in context; agents that need detail read the cited PLAN section. Each invariant has a stable anchor (`#inv-n`) so audits and pointer comments can cite it.

| ID | Invariant | PLAN | Owning module (planned) |
|---|---|---|---|
| INV-1 | Commitment occurs through ownership-safe tag blocks. | §5, §7 | `grammar` |
| INV-2 | The model cannot generate the externally owned character's committing tag. | §8 | `boundary` |
| INV-3 | Real collaborator input is transformed into ordinary manuscript content, never preserved as a character-bearing user turn. | §9, §10 | `derive` |
| INV-4 | The mutable frontier is reconstructed on every request so old live continuation seams disappear immediately. | §12 | `frontier` |
| INV-5 | Only one current continuation-control seam remains at the active edge. | §12, §13 | `frontier`, `continuation` |
| INV-6 | Frozen spans are append-only and cut only at complete block boundaries. | §16 | `freeze` |
| INV-7 | Transport cuts avoid the external character and high-salience narrative structure. | §17 | `freeze` (cut selection) |
| INV-8 | Abnormal termination rolls back to the last complete block unless exact partial continuation is explicitly supported. | §14 | `recovery` |
| INV-9 | Aggregate tags may not bypass individually tagged character ownership. | §7 | system prompt + seed (not code) |
| INV-10 | Frozen history preserves fictional causality while discarding real interaction topology. | §3, §24 | `freeze`, `frontier` |

## INV-1 {#inv-1}
Tags apply impulses; buffers integrate them (§5). A buffer must not introduce a voluntary commitment for an individually tagged character.

## INV-2 {#inv-2}
Hard boundary on the reserved tag literal itself, not on `\n\nName:` (§8). Falls back to stream-side detection when the backend has no stop-string support.

## INV-3 {#inv-3}
Capture is character-specific; editing is manuscript-wide within the mutable frontier (§10).

## INV-4 {#inv-4}
Normalization happens every request. Freezing happens only when the frontier reaches its transport target (§12).

## INV-5 {#inv-5}
Continuation control is semantically boring and, in frozen history, byte-identical for cache stability (§13).

## INV-6 {#inv-6}
Never freeze through the middle of a block. Old spans are not re-cut (§16).

## INV-7 {#inv-7}
Cuts may correlate with low-salience structure required for safe cutting, never with authorship boundaries (§17).

## INV-8 {#inv-8}
Max-output, safety, recitation and provider interruptions are transport failures, not fictional events (§14).

## INV-9 {#inv-9}
Aggregates commit only currently unindividuated members (§7). This is a convention the system prompt states and the seed span demonstrates; it is not enforced in code. `Everyone:` and similar universal tags are flavor text, not a lint target (decision 0001). Tags exist to identify a discrete entity or action-aligned group so the manuscript stays legible; that purpose, not a blocklist, is what the prompt conveys.

## Enforcement model {#enforcement-model}
Structure is parsed in code because later modules need offsets: block delimiters, tag headers, completeness of the trailing block. Everything semantic (what a buffer may contain, cross-character commitment, aggregate membership, soft railroading) is regulated through the system prompt and reinforced by consistent chat — the seed span (§19) and the collaborator's own discipline in the blocks they write. The collaborator is responsible for upholding the grammar in their contributions; the extension does not correct them. Any future "lint" is advisory to the editor, never a gate.

## INV-10 {#inv-10}
Many live interaction histories must collapse to the same model-visible manuscript (§3, interaction-topology non-identifiability).

## Non-goals (do not implement) {#non-goals}
From §2: no attempt to hide stylistic authorship evidence; no schema-validated output; no guarantee against soft railroading (§21 treats it as narrative quality, editable before freeze); no dependence on a specific API message format.

## Final criterion {#final-criterion}
Every feature is judged by §27: does it make the model perceive a continuous fictional world rather than a conversational turn, and does it preserve fictional information while discarding transport information? A feature that makes the transport layer narratively legible is rejected.
