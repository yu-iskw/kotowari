# environments

Environment-specific Terraform roots for Kotowari (for example `dev`, `staging`, `prod`) compose the modules under `infra/terraform/modules/`. Each environment supplies backend config, region, sizing, and feature flags. Phase 0-1 documents the layout only; no cloud resources are provisioned in the default verify path.
