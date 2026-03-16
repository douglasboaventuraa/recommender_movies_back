# Deploy Pipeline

This repository uses GitHub Actions for CI and tag-based CD.

## Workflow

- File: `.github/workflows/backend-ci-cd.yml`
- CI runs on:
  - `pull_request` to `main`
  - `push` to `main`
- Deploy runs on tag:
  - `api-v*` (example: `api-v1.0.0`)

## Required GitHub Secret

- `BACKEND_DEPLOY_HOOK_URL`: Deploy hook endpoint (Render, Railway, Fly.io, etc.)

## Release Process

1. Merge changes into `main`
2. Create and push a tag:

```bash
git tag api-v1.0.0
git push origin api-v1.0.0
```

3. GitHub Actions triggers deploy hook automatically.
