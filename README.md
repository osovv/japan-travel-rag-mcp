# TravelMind MCP

A curated data source for AI travel agents, delivered as an MCP (Model Context Protocol) server. Multi-region architecture with Japan as the first supported destination.

## Local Development

Everything runs in Docker. **Do NOT run `bun run index.ts`, `bun --hot`, or any dev server manually** — the Docker Compose stack already handles the app with hot reload.

### Quick start

```bash
bun install              # install dependencies (needed for IDE support)
docker compose up        # starts Postgres (pgvector) + app with hot reload
docker compose down      # stops everything
```

The app starts at `http://localhost:3000` with `DEV_MODE=true`. Admin UI is at `/admin` with token `dev-root-token`.

Source code is mounted into the container — edit files on your host and the app reloads automatically inside Docker.

### Local database

Postgres runs on **port 5433** (not 5432, to avoid conflicts with SSH tunnels or local installs).

```bash
# Connect via psql
docker compose exec postgres psql -U dev -d japan_travel_rag

# Or connect from host
psql postgresql://dev:dev@localhost:5433/japan_travel_rag

# Drizzle Studio (visual DB browser)
DATABASE_URL=postgresql://dev:dev@localhost:5433/japan_travel_rag bun run db:studio
```

DB data persists in a Docker volume (`pgdata`) across restarts. To reset it:

```bash
docker compose down -v   # removes volumes too
docker compose up        # fresh database, re-bootstrapped from scratch
```

### Logs

```bash
docker compose logs -f       # all services
docker compose logs -f mcp   # app only
```

## Production

Production uses a separate `docker-compose.prod.yaml` with Coolify/Traefik. See that file for details.

## Fixture collection scripts (direct Spider API, no proxy)

These scripts are for collecting raw page fixtures for parser cleanup/chunking tests.

### 1) Single URL scrape

Script:
- `scripts/spider-direct-scrape-fixture.ts`

Command:

```bash
SPIDER_API_KEY=... bun run fixtures:spider:scrape --url "https://wrenjapan.com/yaponiya/chto-smotret-i-gde-zhit-v-gorode-kanadzava/"
```

Optional flags:
- `--out <path>`: output JSON file path
- `--return-format <markdown|text|html>`: Spider `return_format` (default: `markdown`)

Example with explicit output path:

```bash
SPIDER_API_KEY=... bun run fixtures:spider:scrape \
  --url "https://example.com" \
  --out "src/sites/parser/__fixtures__/wrenjapan/raw/example.json" \
  --return-format markdown
```

### 2) Batch scrape from URL file

Script:
- `scripts/spider-batch-scrape-fixtures.sh`

Command:

```bash
SPIDER_API_KEY=... bun run fixtures:spider:batch --url-file scripts/fixtures-urls.example.txt
```

Optional flags:
- `--fixtures-root <path>`: root output folder (default: `src/sites/parser/__fixtures__`)
- `--return-format <markdown|text|html>`: Spider `return_format` (default: `markdown`)
- `--sleep-seconds <int>`: delay between requests (default: `1`)
- `--stop-on-error`: stop on first failed URL

URL file format:
- One URL per line
- Empty lines ignored
- Lines starting with `#` ignored
- Inline comments supported: `https://... # note`

Output layout:

```text
src/sites/parser/__fixtures__/<source_or_domain>/raw/<slug>-<hash>.json
```

Known curated domains are mapped to `source_id` folders (for example `wrenjapan`, `insidekyoto`); unknown domains fallback to host slug.
