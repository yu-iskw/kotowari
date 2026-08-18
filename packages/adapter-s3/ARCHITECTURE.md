# adapter-s3 architecture

- **Public surface:** `src/public.ts` only.
- **Boundaries:** see `package-boundary.yaml`.
- **BlobStore:** path-style S3/MinIO via `fetch` and AWS SigV4 (no AWS SDK).
- **Tests:** in-process HTTP server (`startInProcessS3`); no Docker or live MinIO.
