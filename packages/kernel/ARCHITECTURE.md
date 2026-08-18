# Kernel architecture

- **Public surface:** `src/public.ts` only.
- **Allowed dependencies:** none (ADR-0001).
- **Invariants:** every semantic write requires compact provenance; claims require evidence; decisions require a context snapshot and must not store chain-of-thought.
- **Authorization:** `allow(principal, action, resource, context)` is deny-by-default across tenants.
