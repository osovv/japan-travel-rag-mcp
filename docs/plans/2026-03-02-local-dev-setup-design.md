# Local Development Setup

**Date:** 2026-03-02
**Status:** Approved

## Problem

No local development environment exists. All testing happens by deploying to production.

## Solution

Minimal local dev stack: Postgres (pgvector) in Docker, Bun on host with hot reload.

### Architecture

```
Host machine
  └── bun --hot index.ts
        ├── connects to localhost:5432 (Postgres in Docker)
        ├── admin UI on localhost:3000/admin (auth via ROOT_AUTH_TOKEN)
        └── MCP endpoint on localhost:3000/mcp
```

### Changes

1. **`docker-compose.yaml`** — Replace `mcp` service with `postgres` (pgvector/pgvector:pg16)
2. **`src/config/index.ts`** — Add `DEV_MODE` env var; when true, skip validation for external services (Logto, proxy, Spider, Voyage) and apply placeholder defaults
3. **`package.json`** — Add `dev:db`, `dev:start`, `dev` convenience scripts
4. **`.env.example`** — Document `DEV_MODE` at the top
5. **`docker-compose.prod.yaml`** — No changes

### DEV_MODE behavior

- Always required: `DATABASE_URL`, `ROOT_AUTH_TOKEN`
- Defaults applied: `PORT=3000`, `PUBLIC_URL=http://localhost:3000`, `OAUTH_SESSION_SECRET` (32-char dev default)
- Placeholder defaults for all external services (Logto, portal, proxy, tg-chat-rag)
- Startup log warns about dev mode

### Dev workflow

```bash
cp .env.example .env
# Set DEV_MODE=true, DATABASE_URL, ROOT_AUTH_TOKEN
bun run dev  # starts postgres, pushes schema, runs app
```
