---
name: verify-api
description: Verify one or more SillyTavern API claims against real source and record them in docs/api/sillytavern.md. `/verify-api <api names or question>`.
---

Launch the `st-api-verifier` agent with this request, verbatim: $ARGUMENTS

Relay its returned status lines to the user unchanged. If any result contradicts `docs/protocol/host-mapping.md`, say which row and stop; do not edit the mapping yourself — that is a `/task`.
