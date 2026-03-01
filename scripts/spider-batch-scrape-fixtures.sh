#!/usr/bin/env bash
# FILE: scripts/spider-batch-scrape-fixtures.sh
# VERSION: 1.0.0
# START_MODULE_CONTRACT
#   PURPOSE: Fetch multiple Spider `/scrape` fixtures from a URL list file and save JSON artifacts grouped by source/domain folder.
#   SCOPE: Parse CLI flags, iterate URLs, route to source/domain fixture folders, invoke direct scrape script, and report batch summary.
#   DEPENDS: M-SPIDER-DIRECT-FIXTURE-FETCHER
#   LINKS: M-SPIDER-BATCH-FIXTURE-FETCHER, M-SPIDER-DIRECT-FIXTURE-FETCHER
# END_MODULE_CONTRACT
#
# START_MODULE_MAP
#   print_usage - Show script usage and examples.
#   require_binary - Validate required command availability.
#   trim - Trim leading/trailing whitespace.
#   sanitize_slug - Convert free text into filesystem-safe slug.
#   parse_host_from_url - Extract host from URL.
#   resolve_source_folder - Map host to curated source_id folder fallbacking to host slug.
#   short_hash - Produce short deterministic SHA-256 hash for uniqueness.
#   main - Batch entrypoint for URL file processing.
# END_MODULE_MAP
#
# START_CHANGE_SUMMARY
#   LAST_CHANGE: v1.0.0 - Initial batch fixture fetcher for URL-list-driven Spider scrape collection.
# END_CHANGE_SUMMARY

set -euo pipefail

# START_BLOCK_DEFINE_DEFAULTS_M_SPIDER_BATCH_FIXTURE_FETCHER_001
SCRIPT_NAME="$(basename "$0")"
DEFAULT_FIXTURES_ROOT="src/sites/parser/__fixtures__"
DEFAULT_RETURN_FORMAT="markdown"
DEFAULT_SLEEP_SECONDS="1"
# END_BLOCK_DEFINE_DEFAULTS_M_SPIDER_BATCH_FIXTURE_FETCHER_001

# START_CONTRACT: print_usage
#   PURPOSE: Print usage instructions for batch fixture scraping.
#   INPUTS: {}
#   OUTPUTS: { void }
#   SIDE_EFFECTS: [Writes to stdout]
#   LINKS: [M-SPIDER-BATCH-FIXTURE-FETCHER]
# END_CONTRACT: print_usage
print_usage() {
  # START_BLOCK_PRINT_USAGE_M_SPIDER_BATCH_FIXTURE_FETCHER_002
  cat <<EOF
Usage:
  SPIDER_API_KEY=... bash scripts/spider-batch-scrape-fixtures.sh --url-file <path> [options]

Required:
  --url-file <path>           Text file with one URL per line.

Options:
  --fixtures-root <path>      Output root (default: ${DEFAULT_FIXTURES_ROOT})
  --return-format <format>    Spider return_format (default: ${DEFAULT_RETURN_FORMAT})
  --sleep-seconds <int>       Delay between requests (default: ${DEFAULT_SLEEP_SECONDS})
  --stop-on-error             Stop batch on first failed URL.
  --help                      Show this message.

URL file format:
  - One URL per line.
  - Empty lines are ignored.
  - Lines starting with '#' are ignored.
  - Inline comments are supported: <url> # comment

Output layout:
  <fixtures-root>/<source_or_domain>/raw/<slug>-<hash>.json

Examples:
  SPIDER_API_KEY=... bash scripts/spider-batch-scrape-fixtures.sh --url-file scripts/fixtures-urls.example.txt
  SPIDER_API_KEY=... bash scripts/spider-batch-scrape-fixtures.sh --url-file urls.txt --return-format markdown --sleep-seconds 2
EOF
  # END_BLOCK_PRINT_USAGE_M_SPIDER_BATCH_FIXTURE_FETCHER_002
}

# START_CONTRACT: require_binary
#   PURPOSE: Ensure a required binary exists in PATH.
#   INPUTS: { binary_name: string - command name }
#   OUTPUTS: { void }
#   SIDE_EFFECTS: [Exits process on missing binary]
#   LINKS: [M-SPIDER-BATCH-FIXTURE-FETCHER]
# END_CONTRACT: require_binary
require_binary() {
  # START_BLOCK_REQUIRE_BINARY_M_SPIDER_BATCH_FIXTURE_FETCHER_003
  local binary_name="$1"
  if ! command -v "${binary_name}" >/dev/null 2>&1; then
    echo "[SpiderBatchFixtureFetcher][main][MISSING_BINARY] Required command not found: ${binary_name}" >&2
    exit 1
  fi
  # END_BLOCK_REQUIRE_BINARY_M_SPIDER_BATCH_FIXTURE_FETCHER_003
}

# START_CONTRACT: trim
#   PURPOSE: Trim leading and trailing whitespace.
#   INPUTS: { value: string }
#   OUTPUTS: { string - trimmed value }
#   SIDE_EFFECTS: [none]
#   LINKS: [M-SPIDER-BATCH-FIXTURE-FETCHER]
# END_CONTRACT: trim
trim() {
  # START_BLOCK_TRIM_HELPER_M_SPIDER_BATCH_FIXTURE_FETCHER_004
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
  # END_BLOCK_TRIM_HELPER_M_SPIDER_BATCH_FIXTURE_FETCHER_004
}

# START_CONTRACT: sanitize_slug
#   PURPOSE: Convert arbitrary text into a filesystem-safe slug.
#   INPUTS: { raw: string }
#   OUTPUTS: { string - slug }
#   SIDE_EFFECTS: [none]
#   LINKS: [M-SPIDER-BATCH-FIXTURE-FETCHER]
# END_CONTRACT: sanitize_slug
sanitize_slug() {
  # START_BLOCK_SANITIZE_SLUG_M_SPIDER_BATCH_FIXTURE_FETCHER_005
  local raw="$1"
  local slug
  slug="$(printf '%s' "${raw}" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's#[^a-z0-9._-]+#-#g' \
    | sed -E 's#-+#-#g; s#^-##; s#-$##')"
  if [[ -z "${slug}" ]]; then
    slug="fixture"
  fi
  printf '%s' "${slug}"
  # END_BLOCK_SANITIZE_SLUG_M_SPIDER_BATCH_FIXTURE_FETCHER_005
}

# START_CONTRACT: parse_host_from_url
#   PURPOSE: Extract lowercase host without port from URL string.
#   INPUTS: { url: string }
#   OUTPUTS: { string - host }
#   SIDE_EFFECTS: [Returns empty string on malformed input]
#   LINKS: [M-SPIDER-BATCH-FIXTURE-FETCHER]
# END_CONTRACT: parse_host_from_url
parse_host_from_url() {
  # START_BLOCK_PARSE_HOST_FROM_URL_M_SPIDER_BATCH_FIXTURE_FETCHER_006
  local url="$1"
  local host
  host="$(printf '%s' "${url}" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://([^/@]+@)?([^/:?#]+).*$#\2#' | tr '[:upper:]' '[:lower:]')"
  host="${host#www.}"
  printf '%s' "${host}"
  # END_BLOCK_PARSE_HOST_FROM_URL_M_SPIDER_BATCH_FIXTURE_FETCHER_006
}

# START_CONTRACT: resolve_source_folder
#   PURPOSE: Map host to known source_id folder or fallback to host slug.
#   INPUTS: { host: string - normalized host }
#   OUTPUTS: { string - source/domain folder name }
#   SIDE_EFFECTS: [none]
#   LINKS: [M-SPIDER-BATCH-FIXTURE-FETCHER]
# END_CONTRACT: resolve_source_folder
resolve_source_folder() {
  # START_BLOCK_RESOLVE_SOURCE_FOLDER_M_SPIDER_BATCH_FIXTURE_FETCHER_007
  local host="$1"
  case "${host}" in
    wrenjapan.com|*.wrenjapan.com) printf '%s' "wrenjapan" ;;
    insidekyoto.com|*.insidekyoto.com) printf '%s' "insidekyoto" ;;
    trulytokyo.com|*.trulytokyo.com) printf '%s' "trulytokyo" ;;
    kansai-odyssey.com|*.kansai-odyssey.com) printf '%s' "kansai_odyssey" ;;
    theinvisibletourist.com|*.theinvisibletourist.com) printf '%s' "invisible_tourist" ;;
    japanunravelled.substack.com|*.japanunravelled.substack.com) printf '%s' "japan_unravelled" ;;
    japan-guide.com|*.japan-guide.com) printf '%s' "japan_guide" ;;
    reddit.com|*.reddit.com) printf '%s' "reddit_japantravel" ;;
    japantravel.navitime.com|*.japantravel.navitime.com) printf '%s' "navitime" ;;
    world.jorudan.co.jp|*.world.jorudan.co.jp) printf '%s' "jorudan" ;;
    jreast.co.jp|*.jreast.co.jp) printf '%s' "jreast" ;;
    smart-ex.jp|*.smart-ex.jp) printf '%s' "smart_ex" ;;
    *) sanitize_slug "${host}" ;;
  esac
  # END_BLOCK_RESOLVE_SOURCE_FOLDER_M_SPIDER_BATCH_FIXTURE_FETCHER_007
}

# START_CONTRACT: short_hash
#   PURPOSE: Compute short stable hash for URL uniqueness in output filenames.
#   INPUTS: { value: string }
#   OUTPUTS: { string - 8-char hex prefix }
#   SIDE_EFFECTS: [none]
#   LINKS: [M-SPIDER-BATCH-FIXTURE-FETCHER]
# END_CONTRACT: short_hash
short_hash() {
  # START_BLOCK_SHORT_HASH_HELPER_M_SPIDER_BATCH_FIXTURE_FETCHER_008
  local value="$1"
  bun -e 'const value = process.argv[1] ?? ""; const h = new Bun.CryptoHasher("sha256"); h.update(value); console.log(h.digest("hex").slice(0, 8));' "${value}"
  # END_BLOCK_SHORT_HASH_HELPER_M_SPIDER_BATCH_FIXTURE_FETCHER_008
}

# START_CONTRACT: main
#   PURPOSE: Run batch scrape flow for all URLs from input file and persist fixtures in source/domain folders.
#   INPUTS: {}
#   OUTPUTS: { void }
#   SIDE_EFFECTS: [Reads URL file, performs network requests through nested script, writes fixture files]
#   LINKS: [M-SPIDER-BATCH-FIXTURE-FETCHER, M-SPIDER-DIRECT-FIXTURE-FETCHER]
# END_CONTRACT: main
main() {
  # START_BLOCK_MAIN_EXECUTION_M_SPIDER_BATCH_FIXTURE_FETCHER_009
  local url_file=""
  local fixtures_root="${DEFAULT_FIXTURES_ROOT}"
  local return_format="${DEFAULT_RETURN_FORMAT}"
  local sleep_seconds="${DEFAULT_SLEEP_SECONDS}"
  local stop_on_error="0"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --url-file)
        url_file="${2:-}"
        shift 2
        ;;
      --fixtures-root)
        fixtures_root="${2:-}"
        shift 2
        ;;
      --return-format)
        return_format="${2:-}"
        shift 2
        ;;
      --sleep-seconds)
        sleep_seconds="${2:-}"
        shift 2
        ;;
      --stop-on-error)
        stop_on_error="1"
        shift
        ;;
      --help|-h)
        print_usage
        return 0
        ;;
      *)
        echo "[SpiderBatchFixtureFetcher][main][INVALID_ARG] Unsupported argument: $1" >&2
        print_usage
        return 1
        ;;
    esac
  done

  require_binary bun

  if [[ -z "${url_file}" ]]; then
    echo "[SpiderBatchFixtureFetcher][main][MISSING_URL_FILE] --url-file is required." >&2
    print_usage
    return 1
  fi
  if [[ ! -f "${url_file}" ]]; then
    echo "[SpiderBatchFixtureFetcher][main][URL_FILE_NOT_FOUND] File not found: ${url_file}" >&2
    return 1
  fi

  if [[ -z "${SPIDER_API_KEY:-}" ]]; then
    echo "[SpiderBatchFixtureFetcher][main][MISSING_API_KEY] SPIDER_API_KEY env var is required." >&2
    return 1
  fi

  if ! [[ "${sleep_seconds}" =~ ^[0-9]+$ ]]; then
    echo "[SpiderBatchFixtureFetcher][main][INVALID_SLEEP] --sleep-seconds must be a non-negative integer." >&2
    return 1
  fi

  local total=0
  local success=0
  local failed=0

  echo "[SpiderBatchFixtureFetcher][main][START] url_file=${url_file} fixtures_root=${fixtures_root} return_format=${return_format} sleep_seconds=${sleep_seconds}"

  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    local line
    line="$(trim "${raw_line%%#*}")"
    if [[ -z "${line}" ]]; then
      continue
    fi

    total=$((total + 1))

    local url="${line}"
    local host
    host="$(parse_host_from_url "${url}")"
    if [[ -z "${host}" ]]; then
      echo "[SpiderBatchFixtureFetcher][main][SKIP_INVALID_URL] Unable to parse host for URL: ${url}" >&2
      failed=$((failed + 1))
      if [[ "${stop_on_error}" == "1" ]]; then
        break
      fi
      continue
    fi

    local source_folder
    source_folder="$(resolve_source_folder "${host}")"

    local raw_path
    raw_path="$(printf '%s' "${url}" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+/?##' | sed -E 's#[?#].*$##')"
    raw_path="${raw_path:-root}"

    local slug
    slug="$(sanitize_slug "${host}-${raw_path}")"
    local hash8
    hash8="$(short_hash "${url}")"

    local out_path="${fixtures_root}/${source_folder}/raw/${slug}-${hash8}.json"
    mkdir -p "$(dirname "${out_path}")"

    echo "[SpiderBatchFixtureFetcher][main][FETCH_URL] (${total}) ${url} -> ${out_path}"

    if bun run fixtures:spider:scrape --url "${url}" --out "${out_path}" --return-format "${return_format}"; then
      success=$((success + 1))
    else
      failed=$((failed + 1))
      echo "[SpiderBatchFixtureFetcher][main][FETCH_FAILED] URL failed: ${url}" >&2
      if [[ "${stop_on_error}" == "1" ]]; then
        break
      fi
    fi

    if [[ "${sleep_seconds}" -gt 0 ]]; then
      sleep "${sleep_seconds}"
    fi
  done < "${url_file}"

  echo "[SpiderBatchFixtureFetcher][main][SUMMARY] total=${total} success=${success} failed=${failed}"

  if [[ "${failed}" -gt 0 ]]; then
    return 1
  fi
  return 0
  # END_BLOCK_MAIN_EXECUTION_M_SPIDER_BATCH_FIXTURE_FETCHER_009
}

main "$@"

