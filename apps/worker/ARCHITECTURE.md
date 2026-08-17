# worker architecture

- **Public surface:** `src/public.ts` only.
- **Boundaries:** see `package-boundary.yaml`.
- **Role:** drain the Queue port and rebuild lexical projections / re-extract from stored blobs.
