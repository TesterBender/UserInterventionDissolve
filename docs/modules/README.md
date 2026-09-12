# Module docs

One file per `src/` module, named after the module (`boundary.md` for `src/boundary.js`). Each file starts with:

```
# <module>
Owns: INV-n, INV-m (docs/protocol/invariants.md)
PLAN: §a, §b
Depends on: <modules>
```

then one heading per concept a pointer comment cites. A heading exists because a line of code needed it; do not write headings speculatively.

Beyond the one-file-per-module rule, [derive.md](derive.md) documents `src/derive.js`: the per-request derivation of the mutable frontier from `chat[]` and the message ids it depends on.
