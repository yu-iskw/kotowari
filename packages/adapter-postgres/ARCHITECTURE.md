# adapter-postgres architecture

- **Public surface:** `src/public.ts` only.
- **Boundaries:** see `package-boundary.yaml`.
- **CanonicalStore:** JSON-in-SQL records plus a `to_tsvector` lexical projection.
- **Queue:** durable `jobs` table for Compose workers.
- **Tests:** PGlite in-process Postgres; no Docker.
