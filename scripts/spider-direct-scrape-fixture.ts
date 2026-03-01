// FILE: scripts/spider-direct-scrape-fixture.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Fetch a single page fixture directly from Spider `/scrape` API and save a normalized JSON artifact for parser tests.
//   SCOPE: Parse CLI args, call Spider API via fetch (no proxy), capture request/response envelope, and write JSON fixture file.
//   DEPENDS: none
//   LINKS: M-SPIDER-DIRECT-FIXTURE-FETCHER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ScriptArgs - Parsed CLI arguments for url, output path, format, and help mode.
//   parseArgs - Parse and validate command-line arguments.
//   buildDefaultOutputPath - Build deterministic default fixture path from URL and timestamp.
//   fetchScrapeFixture - Execute direct Spider `/scrape` request and return normalized envelope.
//   printUsage - Print script usage help.
//   main - Script entrypoint.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial direct Spider fixture fetcher with fetch-based API call and JSON file output.
// END_CHANGE_SUMMARY

import { dirname, join } from "node:path";

// START_BLOCK_DEFINE_TYPES_AND_CONSTANTS_M_SPIDER_DIRECT_FIXTURE_FETCHER_001
type ScriptArgs = {
  url: string | null;
  outPath: string | null;
  returnFormat: string;
  help: boolean;
};

const DEFAULT_FIXTURE_DIR = "src/sites/parser/__fixtures__/wrenjapan/raw";
const DEFAULT_RETURN_FORMAT = "markdown";
const SPIDER_SCRAPE_ENDPOINT = "https://api.spider.cloud/scrape";
// END_BLOCK_DEFINE_TYPES_AND_CONSTANTS_M_SPIDER_DIRECT_FIXTURE_FETCHER_001

// START_CONTRACT: parseArgs
//   PURPOSE: Parse and minimally validate CLI flags for fixture scraping.
//   INPUTS: { argv: string[] - Process argv array (typically Bun.argv) }
//   OUTPUTS: { ScriptArgs - Parsed arguments with defaults }
//   SIDE_EFFECTS: [Throws Error on unsupported flags or missing flag values]
//   LINKS: [M-SPIDER-DIRECT-FIXTURE-FETCHER]
// END_CONTRACT: parseArgs
function parseArgs(argv: string[]): ScriptArgs {
  // START_BLOCK_PARSE_CLI_ARGS_M_SPIDER_DIRECT_FIXTURE_FETCHER_002
  const args: ScriptArgs = {
    url: null,
    outPath: null,
    returnFormat: DEFAULT_RETURN_FORMAT,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    if (token === "--url") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --url.");
      }
      args.url = value;
      i++;
      continue;
    }

    if (token === "--out") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --out.");
      }
      args.outPath = value;
      i++;
      continue;
    }

    if (token === "--return-format") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --return-format.");
      }
      args.returnFormat = value;
      i++;
      continue;
    }

    throw new Error(`Unsupported argument: ${token}`);
  }

  return args;
  // END_BLOCK_PARSE_CLI_ARGS_M_SPIDER_DIRECT_FIXTURE_FETCHER_002
}

// START_CONTRACT: buildDefaultOutputPath
//   PURPOSE: Build a default fixture file path using source host/path slug and UTC timestamp.
//   INPUTS: { targetUrl: string - URL to scrape }
//   OUTPUTS: { string - Relative output path under fixture directory }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SPIDER-DIRECT-FIXTURE-FETCHER]
// END_CONTRACT: buildDefaultOutputPath
function buildDefaultOutputPath(targetUrl: string): string {
  // START_BLOCK_BUILD_DEFAULT_OUTPUT_PATH_M_SPIDER_DIRECT_FIXTURE_FETCHER_003
  const parsed = new URL(targetUrl);
  const base = `${parsed.hostname}${parsed.pathname}`.replace(/\/+/g, "-");
  const slug = base.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const safeSlug = slug.length > 0 ? slug.toLowerCase() : "fixture";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(DEFAULT_FIXTURE_DIR, `${safeSlug}-${timestamp}.json`);
  // END_BLOCK_BUILD_DEFAULT_OUTPUT_PATH_M_SPIDER_DIRECT_FIXTURE_FETCHER_003
}

// START_CONTRACT: fetchScrapeFixture
//   PURPOSE: Call Spider `/scrape` directly and return a normalized envelope for fixture storage.
//   INPUTS: { apiKey: string - Spider API key, targetUrl: string - URL to scrape, returnFormat: string - Spider return format }
//   OUTPUTS: { Promise<Record<string, unknown>> - Serializable request/response envelope }
//   SIDE_EFFECTS: [Performs external HTTP POST request]
//   LINKS: [M-SPIDER-DIRECT-FIXTURE-FETCHER]
// END_CONTRACT: fetchScrapeFixture
async function fetchScrapeFixture(
  apiKey: string,
  targetUrl: string,
  returnFormat: string,
): Promise<Record<string, unknown>> {
  // START_BLOCK_FETCH_SPIDER_SCRAPE_FIXTURE_M_SPIDER_DIRECT_FIXTURE_FETCHER_004
  const payload = {
    return_format: returnFormat,
    url: targetUrl,
  };

  const response = await fetch(SPIDER_SCRAPE_ENDPOINT, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  const rawBodyText = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBodyText);
  } catch {
    body = rawBodyText;
  }

  const envelope: Record<string, unknown> = {
    fetched_at: new Date().toISOString(),
    endpoint: SPIDER_SCRAPE_ENDPOINT,
    request: payload,
    response_status: response.status,
    ok: response.ok,
    body,
  };

  if (!response.ok) {
    throw new Error(
      `Spider scrape failed with status ${response.status}. Envelope: ${JSON.stringify(envelope).slice(0, 2000)}`,
    );
  }

  return envelope;
  // END_BLOCK_FETCH_SPIDER_SCRAPE_FIXTURE_M_SPIDER_DIRECT_FIXTURE_FETCHER_004
}

// START_CONTRACT: printUsage
//   PURPOSE: Print usage instructions for this script.
//   INPUTS: {}
//   OUTPUTS: { void }
//   SIDE_EFFECTS: [Writes to stdout]
//   LINKS: [M-SPIDER-DIRECT-FIXTURE-FETCHER]
// END_CONTRACT: printUsage
function printUsage(): void {
  // START_BLOCK_PRINT_USAGE_M_SPIDER_DIRECT_FIXTURE_FETCHER_005
  console.log(
    [
      "Usage:",
      "  bun run scripts/spider-direct-scrape-fixture.ts --url <https://...> [--out <path>] [--return-format <markdown|text|html>]",
      "",
      "Env:",
      "  SPIDER_API_KEY  Required Spider API key for direct calls.",
      "",
      "Examples:",
      "  bun run scripts/spider-direct-scrape-fixture.ts --url https://wrenjapan.com/yaponiya/chto-smotret-i-gde-zhit-v-gorode-kanadzava/",
      "  bun run scripts/spider-direct-scrape-fixture.ts --url https://example.com --out src/sites/parser/__fixtures__/wrenjapan/raw/example.json",
    ].join("\n"),
  );
  // END_BLOCK_PRINT_USAGE_M_SPIDER_DIRECT_FIXTURE_FETCHER_005
}

// START_CONTRACT: main
//   PURPOSE: Validate inputs/env, fetch fixture via Spider scrape API, and write JSON file to disk.
//   INPUTS: {}
//   OUTPUTS: { Promise<void> }
//   SIDE_EFFECTS: [Performs network I/O, creates directories, writes fixture file]
//   LINKS: [M-SPIDER-DIRECT-FIXTURE-FETCHER]
// END_CONTRACT: main
async function main(): Promise<void> {
  // START_BLOCK_MAIN_EXECUTION_M_SPIDER_DIRECT_FIXTURE_FETCHER_006
  const args = parseArgs(Bun.argv);
  if (args.help) {
    printUsage();
    return;
  }

  if (!args.url) {
    throw new Error("Missing required --url argument.");
  }

  // Validate URL format early
  new URL(args.url);

  const apiKey = (process.env.SPIDER_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("SPIDER_API_KEY env var is required.");
  }

  const outputPath = args.outPath ?? buildDefaultOutputPath(args.url);

  console.log(
    `[SpiderFixtureFetcher][main][FETCH_SCRAPE] Fetching fixture for ${args.url} with return_format=${args.returnFormat}`,
  );

  const envelope = await fetchScrapeFixture(apiKey, args.url, args.returnFormat);

  await Bun.write(
    outputPath,
    `${JSON.stringify(envelope, null, 2)}\n`,
  );

  console.log(
    `[SpiderFixtureFetcher][main][WRITE_FIXTURE] Saved fixture to ${outputPath}`,
  );
  // END_BLOCK_MAIN_EXECUTION_M_SPIDER_DIRECT_FIXTURE_FETCHER_006
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[SpiderFixtureFetcher][main][FATAL] ${message}`);
  process.exit(1);
});

