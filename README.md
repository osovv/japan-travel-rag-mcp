# japan-travel-rag-mcp

## Install dependencies

```bash
bun install
```

## Run API runtime

```bash
bun run index.ts
```

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
