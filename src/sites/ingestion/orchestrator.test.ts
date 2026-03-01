// FILE: src/sites/ingestion/orchestrator.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate the ingestion orchestrator pipeline with mocked dependencies.
//   SCOPE: Assert correct pipeline flow, result accumulation, per-source error isolation, per-page error isolation, and targeted recrawl behavior.
//   DEPENDS: M-SITES-INGESTION, M-SPIDER-CLOUD-CLIENT, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-LOGGER
//   LINKS: M-SITES-INGESTION-TEST, M-SITES-INGESTION, M-SPIDER-CLOUD-CLIENT, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build deterministic no-op logger for orchestrator tests.
//   createMockSpiderClient - Build mock Spider client returning configurable crawl items.
//   createMockVoyageClient - Build mock Voyage client returning configurable embeddings.
//   createMockRepository - Build mock repository tracking upsert calls.
//   ScheduledIngestionTests - Validate full pipeline for single and multiple sources.
//   ErrorIsolationTests - Validate per-source and per-page error accumulation.
//   TargetedRecrawlTests - Validate targeted recrawl pipeline and error handling.
//   ResultCounterTests - Validate accurate accumulation of result counters.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial test suite for M-SITES-INGESTION orchestrator.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { Logger } from "../../logger/index";
import type { SpiderCloudClient, SpiderCrawlItem, SpiderCrawlResponse } from "../../integrations/spider-cloud-client";
import type { VoyageProxyClient } from "../../integrations/voyage-proxy-client";
import type { SitesIndexRepository, UpsertChunkInput, UpsertEmbeddingInput, UpsertPageInput } from "../search/repository";
import {
  createIngestionOrchestrator,
  INDEX_VERSION,
  SitesIngestionError,
  type IngestionDeps,
  type IngestionResult,
  type SourceForIngestion,
} from "./orchestrator";

// START_BLOCK_TEST_HELPERS_M_SITES_INGESTION_TEST_001
function createNoopLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
}

function makeCrawlItem(overrides: Partial<SpiderCrawlItem> = {}): SpiderCrawlItem {
  return {
    url: "https://example.com/page-1",
    content: "# Test Page\n\nThis is a test page with enough content to form at least one chunk. ".repeat(10),
    status_code: 200,
    metadata: { title: "Test Page" },
    ...overrides,
  };
}

function makeSource(overrides: Partial<SourceForIngestion> = {}): SourceForIngestion {
  return {
    source_id: "src-001",
    domain: "example.com",
    max_pages: 10,
    crawl_interval_minutes: 1440,
    ...overrides,
  };
}

type MockSpiderOptions = {
  items?: SpiderCrawlItem[];
  throwError?: Error;
};

function createMockSpiderClient(options: MockSpiderOptions = {}): SpiderCloudClient {
  const items = options.items ?? [makeCrawlItem()];
  return {
    runCrawl: async () => {
      if (options.throwError) {
        throw options.throwError;
      }
      return { data: items, status: "ok" };
    },
  };
}

type MockVoyageOptions = {
  embeddingDim?: number;
  throwError?: Error;
};

function createMockVoyageClient(options: MockVoyageOptions = {}): VoyageProxyClient {
  const dim = options.embeddingDim ?? 4;
  return {
    embedDocuments: async (texts: string[]) => {
      if (options.throwError) {
        throw options.throwError;
      }
      return texts.map(() => Array(dim).fill(0.1));
    },
    embedQuery: async () => {
      if (options.throwError) {
        throw options.throwError;
      }
      return Array(dim).fill(0.1);
    },
  };
}

type UpsertPageCall = { input: UpsertPageInput; returnedPageId: string };
type UpsertChunksCall = { pageId: string; chunks: UpsertChunkInput[] };
type UpsertEmbeddingsCall = { embeddings: UpsertEmbeddingInput[] };

type MockRepositoryOptions = {
  pageIdPrefix?: string;
  upsertPageThrow?: Error;
  upsertChunksThrow?: Error;
  upsertEmbeddingsThrow?: Error;
};

function createMockRepository(options: MockRepositoryOptions = {}): {
  repository: SitesIndexRepository;
  calls: {
    upsertPage: UpsertPageCall[];
    upsertChunks: UpsertChunksCall[];
    upsertEmbeddings: UpsertEmbeddingsCall[];
  };
} {
  let pageCounter = 0;
  const prefix = options.pageIdPrefix ?? "page";

  const calls = {
    upsertPage: [] as UpsertPageCall[],
    upsertChunks: [] as UpsertChunksCall[],
    upsertEmbeddings: [] as UpsertEmbeddingsCall[],
  };

  const repository: SitesIndexRepository = {
    upsertPage: async (input: UpsertPageInput) => {
      if (options.upsertPageThrow) {
        throw options.upsertPageThrow;
      }
      pageCounter++;
      const pageId = `${prefix}-${String(pageCounter).padStart(3, "0")}`;
      calls.upsertPage.push({ input, returnedPageId: pageId });
      return pageId;
    },
    upsertChunks: async (pageId: string, chunks: UpsertChunkInput[]) => {
      if (options.upsertChunksThrow) {
        throw options.upsertChunksThrow;
      }
      calls.upsertChunks.push({ pageId, chunks });
    },
    upsertEmbeddings: async (embeddings: UpsertEmbeddingInput[]) => {
      if (options.upsertEmbeddingsThrow) {
        throw options.upsertEmbeddingsThrow;
      }
      calls.upsertEmbeddings.push({ embeddings });
    },
    searchHybrid: async () => [],
    getChunkWithNeighbors: async () => null,
  };

  return { repository, calls };
}
// END_BLOCK_TEST_HELPERS_M_SITES_INGESTION_TEST_001

// START_BLOCK_SCHEDULED_INGESTION_TESTS_M_SITES_INGESTION_TEST_002
describe("runScheduledIngestion", () => {
  it("processes a single source through the full pipeline", async () => {
    const crawlItem = makeCrawlItem();
    const spiderClient = createMockSpiderClient({ items: [crawlItem] });
    const voyageClient = createMockVoyageClient();
    const { repository, calls } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const source = makeSource();
    const result = await orchestrator.runScheduledIngestion([source]);

    expect(result.sources_processed).toBe(1);
    expect(result.pages_fetched).toBe(1);
    expect(result.chunks_created).toBeGreaterThan(0);
    expect(result.embeddings_created).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    // Verify upsertPage was called
    expect(calls.upsertPage).toHaveLength(1);
    expect(calls.upsertPage[0].input.source_id).toBe("src-001");

    // Verify upsertChunks was called
    expect(calls.upsertChunks).toHaveLength(1);
    expect(calls.upsertChunks[0].pageId).toBe("page-001");

    // Verify upsertEmbeddings was called
    expect(calls.upsertEmbeddings).toHaveLength(1);

    // Verify chunk counts match embedding counts
    const chunkCount = calls.upsertChunks[0].chunks.length;
    const embeddingCount = calls.upsertEmbeddings[0].embeddings.length;
    expect(chunkCount).toBe(embeddingCount);
    expect(result.chunks_created).toBe(chunkCount);
    expect(result.embeddings_created).toBe(embeddingCount);
  });

  it("processes multiple sources sequentially", async () => {
    const spiderClient = createMockSpiderClient({
      items: [makeCrawlItem()],
    });
    const voyageClient = createMockVoyageClient();
    const { repository, calls } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const sources = [
      makeSource({ source_id: "src-001", domain: "example.com" }),
      makeSource({ source_id: "src-002", domain: "example.org" }),
    ];

    const result = await orchestrator.runScheduledIngestion(sources);

    expect(result.sources_processed).toBe(2);
    expect(result.pages_fetched).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(calls.upsertPage).toHaveLength(2);
  });

  it("returns empty result for empty sources array", async () => {
    const spiderClient = createMockSpiderClient();
    const voyageClient = createMockVoyageClient();
    const { repository } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const result = await orchestrator.runScheduledIngestion([]);

    expect(result.sources_processed).toBe(0);
    expect(result.pages_fetched).toBe(0);
    expect(result.chunks_created).toBe(0);
    expect(result.embeddings_created).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("processes multiple pages from a single source", async () => {
    const items = [
      makeCrawlItem({ url: "https://example.com/page-1" }),
      makeCrawlItem({ url: "https://example.com/page-2" }),
      makeCrawlItem({ url: "https://example.com/page-3" }),
    ];
    const spiderClient = createMockSpiderClient({ items });
    const voyageClient = createMockVoyageClient();
    const { repository, calls } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const result = await orchestrator.runScheduledIngestion([makeSource()]);

    expect(result.sources_processed).toBe(1);
    expect(result.pages_fetched).toBe(3);
    expect(calls.upsertPage).toHaveLength(3);
    expect(calls.upsertChunks).toHaveLength(3);
    expect(calls.upsertEmbeddings).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });
});
// END_BLOCK_SCHEDULED_INGESTION_TESTS_M_SITES_INGESTION_TEST_002

// START_BLOCK_ERROR_ISOLATION_TESTS_M_SITES_INGESTION_TEST_003
describe("error isolation", () => {
  it("accumulates source-level crawl errors without stopping the batch", async () => {
    let callCount = 0;
    const spiderClient: SpiderCloudClient = {
      runCrawl: async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Crawl failed for source 1");
        }
        return { data: [makeCrawlItem()], status: "ok" };
      },
    };

    const voyageClient = createMockVoyageClient();
    const { repository } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const sources = [
      makeSource({ source_id: "fail-src" }),
      makeSource({ source_id: "ok-src" }),
    ];

    const result = await orchestrator.runScheduledIngestion(sources);

    // Both sources counted as processed
    expect(result.sources_processed).toBe(2);
    // Only the second source's page was fetched
    expect(result.pages_fetched).toBe(1);
    // Error accumulated for first source
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source_id).toBe("fail-src");
    expect(result.errors[0].error).toContain("Crawl failed for source 1");
  });

  it("accumulates page-level errors without stopping other pages in the source", async () => {
    const items = [
      makeCrawlItem({ url: "https://example.com/good-page", content: "# Good\n\n" + "Good content. ".repeat(50) }),
      makeCrawlItem({ url: "", content: "bad" }), // Will fail parsing (empty URL)
      makeCrawlItem({ url: "https://example.com/another-good", content: "# Another\n\n" + "More content. ".repeat(50) }),
    ];

    const spiderClient = createMockSpiderClient({ items });
    const voyageClient = createMockVoyageClient();
    const { repository, calls } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const result = await orchestrator.runScheduledIngestion([makeSource()]);

    expect(result.sources_processed).toBe(1);
    expect(result.pages_fetched).toBe(3); // All 3 items fetched
    // 2 good pages + 1 failed parse
    expect(calls.upsertPage).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source_id).toBe("src-001");
  });

  it("accumulates embedding errors per page without stopping other pages", async () => {
    let embedCallCount = 0;
    const voyageClient: VoyageProxyClient = {
      embedDocuments: async (texts: string[]) => {
        embedCallCount++;
        if (embedCallCount === 1) {
          throw new Error("Voyage API error");
        }
        return texts.map(() => [0.1, 0.2, 0.3, 0.4]);
      },
      embedQuery: async () => [0.1, 0.2, 0.3, 0.4],
    };

    const items = [
      makeCrawlItem({ url: "https://example.com/page-1" }),
      makeCrawlItem({ url: "https://example.com/page-2" }),
    ];

    const spiderClient = createMockSpiderClient({ items });
    const { repository, calls } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const result = await orchestrator.runScheduledIngestion([makeSource()]);

    expect(result.sources_processed).toBe(1);
    expect(result.pages_fetched).toBe(2);
    // First page embedding fails, second succeeds
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("Voyage API error");
    // Second page should have embeddings
    expect(result.embeddings_created).toBeGreaterThan(0);
  });

  it("accumulates repository upsertPage errors per page", async () => {
    let upsertCallCount = 0;
    const { repository: baseRepo, calls } = createMockRepository();
    const repository: SitesIndexRepository = {
      ...baseRepo,
      upsertPage: async (input: UpsertPageInput) => {
        upsertCallCount++;
        if (upsertCallCount === 1) {
          throw new Error("DB connection lost");
        }
        return `page-${upsertCallCount}`;
      },
    };

    const items = [
      makeCrawlItem({ url: "https://example.com/page-1" }),
      makeCrawlItem({ url: "https://example.com/page-2" }),
    ];

    const spiderClient = createMockSpiderClient({ items });
    const voyageClient = createMockVoyageClient();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const result = await orchestrator.runScheduledIngestion([makeSource()]);

    expect(result.sources_processed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("DB connection lost");
  });
});
// END_BLOCK_ERROR_ISOLATION_TESTS_M_SITES_INGESTION_TEST_003

// START_BLOCK_TARGETED_RECRAWL_TESTS_M_SITES_INGESTION_TEST_004
describe("runTargetedRecrawl", () => {
  it("crawls a single URL with limit=1", async () => {
    let capturedRequest: { url: string; limit?: number; return_format?: string } | null = null;
    const spiderClient: SpiderCloudClient = {
      runCrawl: async (request) => {
        capturedRequest = request;
        return { data: [makeCrawlItem({ url: "https://example.com/specific-page" })], status: "ok" };
      },
    };

    const voyageClient = createMockVoyageClient();
    const { repository, calls } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const result = await orchestrator.runTargetedRecrawl("https://example.com/specific-page", "src-target");

    expect(result.sources_processed).toBe(1);
    expect(result.pages_fetched).toBe(1);
    expect(result.chunks_created).toBeGreaterThan(0);
    expect(result.embeddings_created).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    // Verify crawl was called with exact URL and limit=1
    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.url).toBe("https://example.com/specific-page");
    expect(capturedRequest!.limit).toBe(1);
    expect(capturedRequest!.return_format).toBe("markdown");

    // Verify source_id was passed through
    expect(calls.upsertPage[0].input.source_id).toBe("src-target");
  });

  it("handles crawl failure in targeted recrawl", async () => {
    const spiderClient: SpiderCloudClient = {
      runCrawl: async () => {
        throw new Error("Targeted crawl failed");
      },
    };

    const voyageClient = createMockVoyageClient();
    const { repository } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const result = await orchestrator.runTargetedRecrawl("https://example.com/broken", "src-fail");

    expect(result.sources_processed).toBe(1);
    expect(result.pages_fetched).toBe(0);
    expect(result.chunks_created).toBe(0);
    expect(result.embeddings_created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source_id).toBe("src-fail");
    expect(result.errors[0].url).toBe("https://example.com/broken");
    expect(result.errors[0].error).toContain("Targeted crawl failed");
  });

  it("handles page processing failure in targeted recrawl", async () => {
    // Return an item with empty content to trigger parser error
    const spiderClient = createMockSpiderClient({
      items: [makeCrawlItem({ url: "https://example.com/page", content: "" })],
    });

    const voyageClient = createMockVoyageClient();
    const { repository } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const result = await orchestrator.runTargetedRecrawl("https://example.com/page", "src-empty");

    expect(result.sources_processed).toBe(1);
    expect(result.pages_fetched).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source_id).toBe("src-empty");
  });
});
// END_BLOCK_TARGETED_RECRAWL_TESTS_M_SITES_INGESTION_TEST_004

// START_BLOCK_RESULT_COUNTER_TESTS_M_SITES_INGESTION_TEST_005
describe("result counters", () => {
  it("chunk IDs follow the pageId:chunkIndex format", async () => {
    const spiderClient = createMockSpiderClient({ items: [makeCrawlItem()] });
    const voyageClient = createMockVoyageClient();
    const { repository, calls } = createMockRepository({ pageIdPrefix: "pg" });
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    await orchestrator.runScheduledIngestion([makeSource()]);

    const chunks = calls.upsertChunks[0].chunks;
    for (const chunk of chunks) {
      expect(chunk.chunk_id).toMatch(/^pg-001:\d+$/);
    }
  });

  it("chunk inputs include correct chunking_version and index_version", async () => {
    const spiderClient = createMockSpiderClient({ items: [makeCrawlItem()] });
    const voyageClient = createMockVoyageClient();
    const { repository, calls } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    await orchestrator.runScheduledIngestion([makeSource()]);

    const chunks = calls.upsertChunks[0].chunks;
    for (const chunk of chunks) {
      expect(chunk.chunking_version).toBe("v1");
      expect(chunk.index_version).toBe(INDEX_VERSION);
    }
  });

  it("embedding inputs include correct model and index_version", async () => {
    const spiderClient = createMockSpiderClient({ items: [makeCrawlItem()] });
    const voyageClient = createMockVoyageClient();
    const { repository, calls } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    await orchestrator.runScheduledIngestion([makeSource()]);

    const embeddings = calls.upsertEmbeddings[0].embeddings;
    for (const emb of embeddings) {
      expect(emb.embedding_model).toBe("voyage-4");
      expect(emb.index_version).toBe(INDEX_VERSION);
    }
  });

  it("embedding count matches chunk count per page", async () => {
    const spiderClient = createMockSpiderClient({ items: [makeCrawlItem()] });
    const voyageClient = createMockVoyageClient();
    const { repository, calls } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    const result = await orchestrator.runScheduledIngestion([makeSource()]);

    const chunkCount = calls.upsertChunks[0].chunks.length;
    const embeddingCount = calls.upsertEmbeddings[0].embeddings.length;
    expect(chunkCount).toBe(embeddingCount);
    expect(result.chunks_created).toBe(result.embeddings_created);
  });

  it("chunk content_hash is a valid SHA-256 hex string", async () => {
    const spiderClient = createMockSpiderClient({ items: [makeCrawlItem()] });
    const voyageClient = createMockVoyageClient();
    const { repository, calls } = createMockRepository();
    const logger = createNoopLogger();

    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger,
    });

    await orchestrator.runScheduledIngestion([makeSource()]);

    const chunks = calls.upsertChunks[0].chunks;
    for (const chunk of chunks) {
      expect(chunk.content_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
// END_BLOCK_RESULT_COUNTER_TESTS_M_SITES_INGESTION_TEST_005

// START_BLOCK_CONSTANTS_TESTS_M_SITES_INGESTION_TEST_006
describe("constants", () => {
  it("INDEX_VERSION is 'v1'", () => {
    expect(INDEX_VERSION).toBe("v1");
  });

  it("SitesIngestionError has correct code", () => {
    const error = new SitesIngestionError("test error", { key: "value" });
    expect(error.code).toBe("SITES_INGESTION_ERROR");
    expect(error.name).toBe("SitesIngestionError");
    expect(error.message).toBe("test error");
    expect(error.details).toEqual({ key: "value" });
    expect(error).toBeInstanceOf(Error);
  });
});
// END_BLOCK_CONSTANTS_TESTS_M_SITES_INGESTION_TEST_006
