// FILE: src/sites/ingestion/orchestrator.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Coordinate the crawl-parse-chunk-embed-upsert pipeline for curated sites ingestion.
//   SCOPE: Orchestrate Spider crawl, page parsing, text chunking, Voyage embedding, and repository upsert for scheduled and targeted recrawl jobs.
//   DEPENDS: M-SPIDER-CLOUD-CLIENT, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-SITES-PARSER, M-SITES-CHUNKER, M-LOGGER
//   LINKS: M-SITES-INGESTION, M-SPIDER-CLOUD-CLIENT, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-SITES-PARSER, M-SITES-CHUNKER, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SourceForIngestion - Input source descriptor for an ingestion run.
//   IngestionError - Typed error record accumulated during pipeline execution.
//   IngestionResult - Aggregated result counters and error list from an ingestion run.
//   IngestionDeps - External dependencies injected into the orchestrator factory.
//   IngestionOrchestrator - Runtime orchestrator interface exposing scheduled and targeted ingestion.
//   SitesIngestionError - Typed error class for ingestion failures with SITES_INGESTION_ERROR code.
//   INDEX_VERSION - Current index version tag for chunk and embedding records.
//   createIngestionOrchestrator - Factory that builds an IngestionOrchestrator bound to its dependencies.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Add provider outage detection (skipOnProviderOutage), pauseSource/resumeSource controls, per-source observability logging, and tick summary.
// END_CHANGE_SUMMARY

import type { SpiderCloudClient } from "../../integrations/spider-cloud-client";
import { SpiderProxyError } from "../../integrations/spider-cloud-client";
import type { VoyageProxyClient } from "../../integrations/voyage-proxy-client";
import type {
  SitesIndexRepository,
  UpsertChunkInput,
  UpsertEmbeddingInput,
  UpsertPageInput,
} from "../search/repository";
import { parseCrawlItem } from "../parser/index";
import { chunkPage, CHUNKING_VERSION } from "../chunking/index";
import type { Logger } from "../../logger/index";

// START_BLOCK_DEFINE_INGESTION_TYPES_M_SITES_INGESTION_001
export type SourceForIngestion = {
  source_id: string;
  domain: string;
  max_pages: number;
  crawl_interval_minutes: number;
};

export type IngestionError = {
  source_id: string;
  url?: string;
  error: string;
  code: string;
};

export type IngestionResult = {
  sources_processed: number;
  pages_fetched: number;
  chunks_created: number;
  embeddings_created: number;
  errors: IngestionError[];
};

export type IngestionDeps = {
  spiderClient: SpiderCloudClient;
  voyageClient: VoyageProxyClient;
  repository: SitesIndexRepository;
  logger: Logger;
};

export type IngestionOrchestrator = {
  runScheduledIngestion(sources: SourceForIngestion[]): Promise<IngestionResult>;
  runTargetedRecrawl(url: string, sourceId: string): Promise<IngestionResult>;
};
// END_BLOCK_DEFINE_INGESTION_TYPES_M_SITES_INGESTION_001

// START_BLOCK_DEFINE_INGESTION_ERROR_CLASS_M_SITES_INGESTION_002
export class SitesIngestionError extends Error {
  public readonly code: "SITES_INGESTION_ERROR" = "SITES_INGESTION_ERROR";
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SitesIngestionError";
    this.details = details;
  }
}
// END_BLOCK_DEFINE_INGESTION_ERROR_CLASS_M_SITES_INGESTION_002

// START_BLOCK_DEFINE_INDEX_VERSION_M_SITES_INGESTION_003
export const INDEX_VERSION = "v1" as const;
export const PROVIDER_OUTAGE_THRESHOLD = 3;
// END_BLOCK_DEFINE_INDEX_VERSION_M_SITES_INGESTION_003

// START_BLOCK_DEFINE_SOURCE_CONTROLS_M_SITES_INGESTION_003B
// START_CONTRACT: pauseSource
//   PURPOSE: Set a source's status to 'paused' in the site_sources table. Admin-only operation.
//   INPUTS: { db: { query: (sql: string, params: unknown[]) => unknown } - Database handle, sourceId: string - Source to pause }
//   OUTPUTS: { Promise<void> }
//   SIDE_EFFECTS: [Updates site_sources row]
//   LINKS: [M-SITES-INGESTION, M-DB]
// END_CONTRACT: pauseSource
export async function pauseSource(
  db: { query: (sql: string, params: unknown[]) => Promise<unknown> | unknown },
  sourceId: string,
): Promise<void> {
  await db.query(
    "UPDATE site_sources SET status = $1 WHERE source_id = $2",
    ["paused", sourceId],
  );
}

// START_CONTRACT: resumeSource
//   PURPOSE: Set a source's status to 'active' in the site_sources table. Admin-only operation.
//   INPUTS: { db: { query: (sql: string, params: unknown[]) => unknown } - Database handle, sourceId: string - Source to resume }
//   OUTPUTS: { Promise<void> }
//   SIDE_EFFECTS: [Updates site_sources row]
//   LINKS: [M-SITES-INGESTION, M-DB]
// END_CONTRACT: resumeSource
export async function resumeSource(
  db: { query: (sql: string, params: unknown[]) => Promise<unknown> | unknown },
  sourceId: string,
): Promise<void> {
  await db.query(
    "UPDATE site_sources SET status = $1 WHERE source_id = $2",
    ["active", sourceId],
  );
}
// END_BLOCK_DEFINE_SOURCE_CONTROLS_M_SITES_INGESTION_003B

// START_CONTRACT: computeChunkContentHash
//   PURPOSE: Compute SHA-256 hex digest of chunk text for content deduplication.
//   INPUTS: { text: string - Chunk text content }
//   OUTPUTS: { string - Hex-encoded SHA-256 hash }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-INGESTION]
// END_CONTRACT: computeChunkContentHash
function computeChunkContentHash(text: string): string {
  // START_BLOCK_COMPUTE_CHUNK_CONTENT_HASH_M_SITES_INGESTION_004
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
  // END_BLOCK_COMPUTE_CHUNK_CONTENT_HASH_M_SITES_INGESTION_004
}

// START_CONTRACT: createIngestionOrchestrator
//   PURPOSE: Factory that builds an IngestionOrchestrator bound to its external dependencies.
//   INPUTS: { deps: IngestionDeps - Spider client, Voyage client, repository, and logger }
//   OUTPUTS: { IngestionOrchestrator - Orchestrator with runScheduledIngestion and runTargetedRecrawl }
//   SIDE_EFFECTS: [none at factory time; methods perform I/O through injected deps]
//   LINKS: [M-SITES-INGESTION, M-SPIDER-CLOUD-CLIENT, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-SITES-PARSER, M-SITES-CHUNKER, M-LOGGER]
// END_CONTRACT: createIngestionOrchestrator
export function createIngestionOrchestrator(deps: IngestionDeps): IngestionOrchestrator {
  const { spiderClient, voyageClient, repository, logger } = deps;

  // START_BLOCK_PROCESS_SINGLE_SOURCE_M_SITES_INGESTION_005
  // START_CONTRACT: processSource
  //   PURPOSE: Execute the full crawl-parse-chunk-embed-upsert pipeline for one source.
  //   INPUTS: { source: SourceForIngestion - Source descriptor, result: IngestionResult - Mutable accumulator }
  //   OUTPUTS: { Promise<void> - Mutates result in place }
  //   SIDE_EFFECTS: [Crawls via Spider, writes to repository, calls Voyage for embeddings]
  //   LINKS: [M-SITES-INGESTION]
  // END_CONTRACT: processSource
  async function processSource(
    source: SourceForIngestion,
    result: IngestionResult,
  ): Promise<void> {
    const functionName = "processSource";

    // Step 1: Crawl
    logger.info(
      `Starting crawl for source ${source.source_id} (${source.domain}).`,
      functionName,
      "CRAWL_SOURCE",
      { sourceId: source.source_id, domain: source.domain, maxPages: source.max_pages },
    );

    const crawlResponse = await spiderClient.runCrawl({
      url: `https://${source.domain}`,
      limit: source.max_pages,
      return_format: "markdown",
    });

    const crawlItems = crawlResponse.data;
    result.pages_fetched += crawlItems.length;

    logger.info(
      `Crawl returned ${crawlItems.length} items for source ${source.source_id}.`,
      functionName,
      "CRAWL_COMPLETE",
      { sourceId: source.source_id, itemCount: crawlItems.length },
    );

    // Process each crawl item
    for (const item of crawlItems) {
      try {
        await processPage(item, source, result);
      } catch (pageError: unknown) {
        const errorMessage = pageError instanceof Error ? pageError.message : String(pageError);
        const errorCode = pageError instanceof SitesIngestionError
          ? pageError.code
          : "SITES_INGESTION_ERROR";

        logger.error(
          `Failed to process page ${item.url} for source ${source.source_id}: ${errorMessage}`,
          functionName,
          "PAGE_PROCESSING_ERROR",
          { sourceId: source.source_id, url: item.url, error: errorMessage },
        );

        result.errors.push({
          source_id: source.source_id,
          url: item.url,
          error: errorMessage,
          code: errorCode,
        });
      }
    }
  }
  // END_BLOCK_PROCESS_SINGLE_SOURCE_M_SITES_INGESTION_005

  // START_BLOCK_PROCESS_SINGLE_PAGE_M_SITES_INGESTION_006
  // START_CONTRACT: processPage
  //   PURPOSE: Execute parse-chunk-embed-upsert for a single crawled page.
  //   INPUTS: { item: SpiderCrawlItem - Raw crawl result, source: SourceForIngestion - Source descriptor, result: IngestionResult - Mutable accumulator }
  //   OUTPUTS: { Promise<void> - Mutates result in place }
  //   SIDE_EFFECTS: [Writes page/chunks/embeddings to repository, calls Voyage for embeddings]
  //   LINKS: [M-SITES-INGESTION]
  // END_CONTRACT: processPage
  async function processPage(
    item: import("../../integrations/spider-cloud-client").SpiderCrawlItem,
    source: SourceForIngestion,
    result: IngestionResult,
  ): Promise<void> {
    const functionName = "processPage";

    // Step 2: Parse
    const parsedPage = parseCrawlItem(item, source.source_id, logger);

    // Step 3: Upsert page
    const upsertPageInput: UpsertPageInput = {
      source_id: parsedPage.source_id,
      url: parsedPage.url,
      canonical_url: parsedPage.canonical_url,
      title: parsedPage.title,
      text_hash: parsedPage.text_hash,
      http_status: parsedPage.http_status,
      fetched_at: parsedPage.fetched_at,
    };

    const pageId = await repository.upsertPage(upsertPageInput);

    logger.info(
      `Page upserted with id ${pageId} for ${parsedPage.canonical_url}.`,
      functionName,
      "PAGE_UPSERTED",
      { pageId, canonicalUrl: parsedPage.canonical_url, sourceId: source.source_id },
    );

    // Step 4: Chunk (v1: always re-chunk, hash-based skip deferred)
    const chunks = chunkPage(parsedPage.clean_text, logger);

    if (chunks.length === 0) {
      logger.warn(
        `No chunks produced for page ${parsedPage.canonical_url}. Skipping embedding.`,
        functionName,
        "NO_CHUNKS_PRODUCED",
        { pageId, canonicalUrl: parsedPage.canonical_url },
      );
      return;
    }

    // Step 5: Generate chunk IDs and build upsert inputs
    const upsertChunkInputs: UpsertChunkInput[] = chunks.map((chunk) => ({
      chunk_id: `${pageId}:${chunk.chunk_index}`,
      chunk_index: chunk.chunk_index,
      chunk_text: chunk.chunk_text,
      char_count: chunk.char_count,
      token_estimate: chunk.token_estimate,
      content_hash: computeChunkContentHash(chunk.chunk_text),
      chunking_version: CHUNKING_VERSION,
      index_version: INDEX_VERSION,
      start_offset: chunk.start_offset,
      end_offset: chunk.end_offset,
    }));

    // Step 6: Upsert chunks
    await repository.upsertChunks(pageId, upsertChunkInputs);
    result.chunks_created += upsertChunkInputs.length;

    logger.info(
      `Upserted ${upsertChunkInputs.length} chunks for page ${pageId}.`,
      functionName,
      "CHUNKS_UPSERTED",
      { pageId, chunkCount: upsertChunkInputs.length },
    );

    // Step 7: Embed all chunks at once
    const chunkTexts = chunks.map((c) => c.chunk_text);
    const embeddings = await voyageClient.embedDocuments(chunkTexts);

    // Step 8: Upsert embeddings
    const embeddingInputs: UpsertEmbeddingInput[] = upsertChunkInputs.map((chunk, idx) => ({
      chunk_id: chunk.chunk_id,
      embedding: embeddings[idx],
      embedding_model: "voyage-4",
      embedding_version: "v1",
      index_version: INDEX_VERSION,
    }));

    await repository.upsertEmbeddings(embeddingInputs);
    result.embeddings_created += embeddingInputs.length;

    logger.info(
      `Upserted ${embeddingInputs.length} embeddings for page ${pageId}.`,
      functionName,
      "EMBEDDINGS_UPSERTED",
      { pageId, embeddingCount: embeddingInputs.length },
    );
  }
  // END_BLOCK_PROCESS_SINGLE_PAGE_M_SITES_INGESTION_006

  // START_BLOCK_RUN_SCHEDULED_INGESTION_M_SITES_INGESTION_007
  // START_CONTRACT: runScheduledIngestion
  //   PURPOSE: Execute the ingestion pipeline for a batch of sources, accumulating results and errors.
  //   INPUTS: { sources: SourceForIngestion[] - Sources to ingest }
  //   OUTPUTS: { Promise<IngestionResult> - Aggregated counters and errors }
  //   SIDE_EFFECTS: [Crawls, parses, chunks, embeds, and upserts for each source]
  //   LINKS: [M-SITES-INGESTION]
  // END_CONTRACT: runScheduledIngestion
  async function runScheduledIngestion(sources: SourceForIngestion[]): Promise<IngestionResult> {
    const functionName = "runScheduledIngestion";
    const tickStartedAt = Date.now();

    const result: IngestionResult = {
      sources_processed: 0,
      pages_fetched: 0,
      chunks_created: 0,
      embeddings_created: 0,
      errors: [],
    };

    logger.info(
      `Starting scheduled ingestion for ${sources.length} sources.`,
      functionName,
      "SCHEDULED_INGESTION_START",
      { sourceCount: sources.length },
    );

    let consecutiveSpider5xx = 0;
    let providerOutage = false;

    for (const source of sources) {
      // Provider outage circuit breaker
      if (providerOutage) {
        logger.warn(
          `Skipping source ${source.source_id} due to provider outage (${consecutiveSpider5xx} consecutive 5xx errors).`,
          functionName,
          "PROVIDER_OUTAGE_SKIP",
          { sourceId: source.source_id, consecutiveSpider5xx },
        );
        result.errors.push({
          source_id: source.source_id,
          error: `Skipped due to provider outage (${consecutiveSpider5xx} consecutive Spider 5xx errors).`,
          code: "PROVIDER_OUTAGE",
        });
        result.sources_processed += 1;
        continue;
      }

      const sourceStartedAt = Date.now();
      const pagesBefore = result.pages_fetched;
      const chunksBefore = result.chunks_created;
      const embeddingsBefore = result.embeddings_created;

      try {
        await processSource(source, result);
        result.sources_processed += 1;
        // Successful crawl resets the consecutive 5xx counter
        consecutiveSpider5xx = 0;
      } catch (sourceError: unknown) {
        const errorMessage = sourceError instanceof Error ? sourceError.message : String(sourceError);
        const errorCode = sourceError instanceof SitesIngestionError
          ? sourceError.code
          : "SITES_INGESTION_ERROR";

        logger.error(
          `Failed to process source ${source.source_id}: ${errorMessage}`,
          functionName,
          "SOURCE_PROCESSING_ERROR",
          { sourceId: source.source_id, error: errorMessage },
        );

        result.errors.push({
          source_id: source.source_id,
          error: errorMessage,
          code: errorCode,
        });

        // Count the source as processed even if it failed
        result.sources_processed += 1;

        // Track consecutive Spider 5xx errors for provider outage detection
        if (
          sourceError instanceof SpiderProxyError &&
          sourceError.status !== undefined &&
          sourceError.status >= 500 &&
          sourceError.status < 600
        ) {
          consecutiveSpider5xx += 1;
          if (consecutiveSpider5xx >= PROVIDER_OUTAGE_THRESHOLD) {
            providerOutage = true;
            logger.error(
              `Provider outage detected: Spider returned 5xx for ${consecutiveSpider5xx} consecutive sources. Skipping remaining sources.`,
              functionName,
              "PROVIDER_OUTAGE_DETECTED",
              { consecutiveSpider5xx, threshold: PROVIDER_OUTAGE_THRESHOLD },
            );
          }
        } else {
          // Non-Spider-5xx error resets the counter
          consecutiveSpider5xx = 0;
        }
      }

      // Per-source observability logging
      const sourceDurationMs = Date.now() - sourceStartedAt;
      logger.info(
        `Source ${source.source_id} ingestion summary.`,
        functionName,
        "SOURCE_INGESTION_SUMMARY",
        {
          source_id: source.source_id,
          pages_fetched: result.pages_fetched - pagesBefore,
          chunks_created: result.chunks_created - chunksBefore,
          embeddings_created: result.embeddings_created - embeddingsBefore,
          duration_ms: sourceDurationMs,
        },
      );
    }

    // Tick summary observability logging
    const tickDurationMs = Date.now() - tickStartedAt;
    logger.info(
      `Scheduled ingestion tick complete.`,
      functionName,
      "INGESTION_TICK_SUMMARY",
      {
        total_sources: result.sources_processed,
        total_pages: result.pages_fetched,
        total_chunks: result.chunks_created,
        total_embeddings: result.embeddings_created,
        total_duration_ms: tickDurationMs,
        errors_count: result.errors.length,
      },
    );

    logger.info(
      `Scheduled ingestion complete. Processed ${result.sources_processed} sources, fetched ${result.pages_fetched} pages, created ${result.chunks_created} chunks, ${result.embeddings_created} embeddings, ${result.errors.length} errors.`,
      functionName,
      "SCHEDULED_INGESTION_COMPLETE",
      {
        sourcesProcessed: result.sources_processed,
        pagesFetched: result.pages_fetched,
        chunksCreated: result.chunks_created,
        embeddingsCreated: result.embeddings_created,
        errorCount: result.errors.length,
      },
    );

    return result;
  }
  // END_BLOCK_RUN_SCHEDULED_INGESTION_M_SITES_INGESTION_007

  // START_BLOCK_RUN_TARGETED_RECRAWL_M_SITES_INGESTION_008
  // START_CONTRACT: runTargetedRecrawl
  //   PURPOSE: Execute the ingestion pipeline for a single URL, using limit=1.
  //   INPUTS: { url: string - URL to recrawl, sourceId: string - Source identifier }
  //   OUTPUTS: { Promise<IngestionResult> - Aggregated counters and errors }
  //   SIDE_EFFECTS: [Crawls, parses, chunks, embeds, and upserts for the single URL]
  //   LINKS: [M-SITES-INGESTION]
  // END_CONTRACT: runTargetedRecrawl
  async function runTargetedRecrawl(url: string, sourceId: string): Promise<IngestionResult> {
    const functionName = "runTargetedRecrawl";

    logger.info(
      `Starting targeted recrawl for ${url} (source: ${sourceId}).`,
      functionName,
      "TARGETED_RECRAWL_START",
      { url, sourceId },
    );

    // Build a synthetic SourceForIngestion for the single URL
    let domain: string;
    try {
      domain = new URL(url).hostname;
    } catch {
      domain = url;
    }

    const source: SourceForIngestion = {
      source_id: sourceId,
      domain,
      max_pages: 1,
      crawl_interval_minutes: 0,
    };

    const result: IngestionResult = {
      sources_processed: 0,
      pages_fetched: 0,
      chunks_created: 0,
      embeddings_created: 0,
      errors: [],
    };

    try {
      // For targeted recrawl, override the crawl URL to the exact URL (not domain)
      const crawlResponse = await spiderClient.runCrawl({
        url,
        limit: 1,
        return_format: "markdown",
      });

      const crawlItems = crawlResponse.data;
      result.pages_fetched += crawlItems.length;

      for (const item of crawlItems) {
        try {
          await processPage(item, source, result);
        } catch (pageError: unknown) {
          const errorMessage = pageError instanceof Error ? pageError.message : String(pageError);
          logger.error(
            `Failed to process page ${item.url} during targeted recrawl: ${errorMessage}`,
            functionName,
            "TARGETED_PAGE_ERROR",
            { sourceId, url: item.url, error: errorMessage },
          );
          result.errors.push({
            source_id: sourceId,
            url: item.url,
            error: errorMessage,
            code: "SITES_INGESTION_ERROR",
          });
        }
      }

      result.sources_processed = 1;
    } catch (crawlError: unknown) {
      const errorMessage = crawlError instanceof Error ? crawlError.message : String(crawlError);
      logger.error(
        `Targeted recrawl failed for ${url}: ${errorMessage}`,
        functionName,
        "TARGETED_RECRAWL_ERROR",
        { sourceId, url, error: errorMessage },
      );
      result.errors.push({
        source_id: sourceId,
        url,
        error: errorMessage,
        code: "SITES_INGESTION_ERROR",
      });
      result.sources_processed = 1;
    }

    logger.info(
      `Targeted recrawl complete for ${url}. Pages: ${result.pages_fetched}, chunks: ${result.chunks_created}, embeddings: ${result.embeddings_created}, errors: ${result.errors.length}.`,
      functionName,
      "TARGETED_RECRAWL_COMPLETE",
      {
        url,
        sourceId,
        pagesFetched: result.pages_fetched,
        chunksCreated: result.chunks_created,
        embeddingsCreated: result.embeddings_created,
        errorCount: result.errors.length,
      },
    );

    return result;
  }
  // END_BLOCK_RUN_TARGETED_RECRAWL_M_SITES_INGESTION_008

  return {
    runScheduledIngestion,
    runTargetedRecrawl,
  };
}
