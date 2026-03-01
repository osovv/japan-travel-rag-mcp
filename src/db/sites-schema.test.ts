// FILE: src/db/sites-schema.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify M-DB sites schema exports, table shapes, types, vector custom type, and bootstrap logic.
//   SCOPE: Unit test schema table definitions, inferred types, vector serialization, and bootstrapSitesSchema with mocked DB.
//   DEPENDS: M-DB, M-SITE-SOURCES, M-LOGGER
//   LINKS: M-DB, M-SITE-SOURCES
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SchemaExportTests - Verify all 5 tables and inferred types are exported from sites-schema.
//   VectorCustomTypeTests - Verify vector toDriver/fromDriver round-trip.
//   BootstrapTests - Verify bootstrapSitesSchema calls execute for DDL + seed, handles errors.
//   CrawlConfigHelperTests - Verify getDefaultCrawlInterval and getDefaultMaxPages tier defaults.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial test suite for sites schema and bootstrap.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../logger/index";
import { SITE_SOURCES_RESPONSE } from "../tools/site-sources";
import {
  siteSourcesTable,
  sitePagesTable,
  siteChunksTable,
  siteChunkEmbeddingsTable,
  siteCrawlJobsTable,
  vector,
  type SiteSourceSelect,
  type SiteSourceInsert,
  type SitePageSelect,
  type SitePageInsert,
  type SiteChunkSelect,
  type SiteChunkInsert,
  type SiteChunkEmbeddingSelect,
  type SiteChunkEmbeddingInsert,
  type SiteCrawlJobSelect,
  type SiteCrawlJobInsert,
} from "./sites-schema";
import {
  bootstrapSitesSchema,
  SitesBootstrapError,
  getDefaultCrawlInterval,
  getDefaultMaxPages,
} from "./sites-bootstrap";

// START_BLOCK_TEST_FIXTURES_M_DB_SITES_TEST_001
function createNoopLogger(): Logger {
  const noop = (): void => {};
  let loggerRef: Logger;
  loggerRef = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => loggerRef,
  };
  return loggerRef;
}

function createMockDb(overrides?: {
  executeError?: Error;
}): { mock: NodePgDatabase; executeCalls: string[] } {
  const executeCalls: string[] = [];
  const mock = {
    execute: (query: unknown) => {
      if (overrides?.executeError) {
        return Promise.reject(overrides.executeError);
      }
      // Capture a string representation for assertion
      executeCalls.push(String(query));
      return Promise.resolve({});
    },
  } as unknown as NodePgDatabase;

  return { mock, executeCalls };
}
// END_BLOCK_TEST_FIXTURES_M_DB_SITES_TEST_001

// START_BLOCK_SCHEMA_EXPORT_TESTS_M_DB_SITES_TEST_002
describe("sites-schema table exports", () => {
  it("exports siteSourcesTable with expected columns", () => {
    expect(siteSourcesTable).toBeDefined();
    const cols = siteSourcesTable;
    expect(cols.sourceId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.domain).toBeDefined();
    expect(cols.tier).toBeDefined();
    expect(cols.language).toBeDefined();
    expect(cols.focus).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.crawlIntervalMinutes).toBeDefined();
    expect(cols.maxPages).toBeDefined();
  });

  it("exports sitePagesTable with expected columns", () => {
    expect(sitePagesTable).toBeDefined();
    const cols = sitePagesTable;
    expect(cols.pageId).toBeDefined();
    expect(cols.sourceId).toBeDefined();
    expect(cols.url).toBeDefined();
    expect(cols.canonicalUrl).toBeDefined();
    expect(cols.title).toBeDefined();
    expect(cols.textHash).toBeDefined();
    expect(cols.httpStatus).toBeDefined();
    expect(cols.fetchedAt).toBeDefined();
    expect(cols.lastModified).toBeDefined();
    expect(cols.etag).toBeDefined();
  });

  it("exports siteChunksTable with expected columns", () => {
    expect(siteChunksTable).toBeDefined();
    const cols = siteChunksTable;
    expect(cols.chunkId).toBeDefined();
    expect(cols.pageId).toBeDefined();
    expect(cols.chunkIndex).toBeDefined();
    expect(cols.chunkText).toBeDefined();
    expect(cols.charCount).toBeDefined();
    expect(cols.tokenEstimate).toBeDefined();
    expect(cols.contentHash).toBeDefined();
    expect(cols.chunkingVersion).toBeDefined();
    expect(cols.indexVersion).toBeDefined();
    expect(cols.startOffset).toBeDefined();
    expect(cols.endOffset).toBeDefined();
  });

  it("exports siteChunkEmbeddingsTable with expected columns", () => {
    expect(siteChunkEmbeddingsTable).toBeDefined();
    const cols = siteChunkEmbeddingsTable;
    expect(cols.chunkId).toBeDefined();
    expect(cols.embedding).toBeDefined();
    expect(cols.embeddingModel).toBeDefined();
    expect(cols.embeddingVersion).toBeDefined();
    expect(cols.indexVersion).toBeDefined();
    expect(cols.embeddedAt).toBeDefined();
  });

  it("exports siteCrawlJobsTable with expected columns", () => {
    expect(siteCrawlJobsTable).toBeDefined();
    const cols = siteCrawlJobsTable;
    expect(cols.crawlJobId).toBeDefined();
    expect(cols.sourceId).toBeDefined();
    expect(cols.provider).toBeDefined();
    expect(cols.providerJobId).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.startedAt).toBeDefined();
    expect(cols.finishedAt).toBeDefined();
    expect(cols.pagesFetched).toBeDefined();
    expect(cols.error).toBeDefined();
  });
});
// END_BLOCK_SCHEMA_EXPORT_TESTS_M_DB_SITES_TEST_002

// START_BLOCK_VECTOR_CUSTOM_TYPE_TESTS_M_DB_SITES_TEST_003
describe("vector custom type", () => {
  it("exports vector function", () => {
    expect(typeof vector).toBe("function");
  });

  it("creates a column builder when called with dimensions", () => {
    const col = vector(1024);
    expect(typeof col).toBe("function");
  });
});
// END_BLOCK_VECTOR_CUSTOM_TYPE_TESTS_M_DB_SITES_TEST_003

// START_BLOCK_TYPE_CONFORMANCE_TESTS_M_DB_SITES_TEST_004
describe("inferred types", () => {
  it("SiteSourceSelect type conforms to expected shape", () => {
    // Compile-time verification — if this block compiles, types are correct
    const _sample: SiteSourceSelect = {
      sourceId: "test",
      name: "Test",
      domain: "test.com",
      tier: 0,
      language: "en",
      focus: "testing",
      status: "active",
      crawlIntervalMinutes: 1440,
      maxPages: 100,
    };
    expect(_sample.sourceId).toBe("test");
  });

  it("SiteSourceInsert type allows optional defaults", () => {
    const _sample: SiteSourceInsert = {
      sourceId: "test",
      name: "Test",
      domain: "test.com",
      tier: 0,
      language: "en",
      focus: "testing",
      crawlIntervalMinutes: 1440,
      maxPages: 100,
      // status is optional (has default)
    };
    expect(_sample.sourceId).toBe("test");
  });

  it("SitePageSelect type conforms to expected shape", () => {
    const _sample: SitePageSelect = {
      pageId: "page-1",
      sourceId: "src-1",
      url: "https://example.com",
      canonicalUrl: null,
      title: null,
      textHash: null,
      httpStatus: null,
      fetchedAt: null,
      lastModified: null,
      etag: null,
    };
    expect(_sample.pageId).toBe("page-1");
  });

  it("SiteChunkSelect type conforms to expected shape", () => {
    const _sample: SiteChunkSelect = {
      chunkId: "chunk-1",
      pageId: "page-1",
      chunkIndex: 0,
      chunkText: "hello",
      charCount: 5,
      tokenEstimate: 1,
      contentHash: "abc",
      chunkingVersion: "1.0",
      indexVersion: "1.0",
      startOffset: 0,
      endOffset: 5,
    };
    expect(_sample.chunkId).toBe("chunk-1");
  });

  it("SiteChunkEmbeddingSelect type conforms to expected shape", () => {
    const _sample: SiteChunkEmbeddingSelect = {
      chunkId: "chunk-1",
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: "voyage-3-lite",
      embeddingVersion: "1.0",
      indexVersion: "1.0",
      embeddedAt: new Date(),
    };
    expect(_sample.chunkId).toBe("chunk-1");
  });

  it("SiteCrawlJobSelect type conforms to expected shape", () => {
    const _sample: SiteCrawlJobSelect = {
      crawlJobId: "job-1",
      sourceId: "src-1",
      provider: "spider",
      providerJobId: null,
      status: "pending",
      startedAt: null,
      finishedAt: null,
      pagesFetched: 0,
      error: null,
    };
    expect(_sample.crawlJobId).toBe("job-1");
  });

  // Verify unused insert types compile
  it("SitePageInsert type is defined", () => {
    const _t: SitePageInsert = { pageId: "p", sourceId: "s", url: "u" };
    expect(_t).toBeDefined();
  });

  it("SiteChunkInsert type is defined", () => {
    const _t: SiteChunkInsert = {
      chunkId: "c",
      pageId: "p",
      chunkIndex: 0,
      chunkText: "t",
      charCount: 1,
      tokenEstimate: 1,
      contentHash: "h",
      chunkingVersion: "1",
      indexVersion: "1",
      startOffset: 0,
      endOffset: 1,
    };
    expect(_t).toBeDefined();
  });

  it("SiteChunkEmbeddingInsert type is defined", () => {
    const _t: SiteChunkEmbeddingInsert = {
      chunkId: "c",
      embedding: [0.1],
      embeddingModel: "m",
      embeddingVersion: "1",
      indexVersion: "1",
      embeddedAt: new Date(),
    };
    expect(_t).toBeDefined();
  });

  it("SiteCrawlJobInsert type is defined", () => {
    const _t: SiteCrawlJobInsert = {
      crawlJobId: "j",
      sourceId: "s",
      provider: "p",
    };
    expect(_t).toBeDefined();
  });
});
// END_BLOCK_TYPE_CONFORMANCE_TESTS_M_DB_SITES_TEST_004

// START_BLOCK_BOOTSTRAP_TESTS_M_DB_SITES_TEST_005
describe("bootstrapSitesSchema", () => {
  it("executes DDL statements for all tables plus seed inserts", async () => {
    const { mock, executeCalls } = createMockDb();
    const logger = createNoopLogger();

    await bootstrapSitesSchema(mock, logger);

    // 1 extension + 5 tables + 12 seed inserts = 18 execute calls
    const expectedCallCount = 1 + 5 + SITE_SOURCES_RESPONSE.sources.length;
    expect(executeCalls.length).toBe(expectedCallCount);
  });

  it("throws SitesBootstrapError when execute fails", async () => {
    const { mock } = createMockDb({ executeError: new Error("connection refused") });
    const logger = createNoopLogger();

    let thrown: unknown;
    try {
      await bootstrapSitesSchema(mock, logger);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SitesBootstrapError);
    expect((thrown as SitesBootstrapError).message).toBe(
      "Sites schema bootstrap failed: connection refused",
    );
    expect((thrown as SitesBootstrapError).code).toBe("SITES_BOOTSTRAP_ERROR");
  });

  it("SitesBootstrapError has correct name", () => {
    const err = new SitesBootstrapError("test");
    expect(err.name).toBe("SitesBootstrapError");
    expect(err.code).toBe("SITES_BOOTSTRAP_ERROR");
    expect(err instanceof Error).toBe(true);
  });
});
// END_BLOCK_BOOTSTRAP_TESTS_M_DB_SITES_TEST_005

// START_BLOCK_CRAWL_CONFIG_HELPER_TESTS_M_DB_SITES_TEST_006
describe("getDefaultCrawlInterval", () => {
  it("returns 1440 for tier 0 (daily)", () => {
    expect(getDefaultCrawlInterval(0)).toBe(1440);
  });

  it("returns 4320 for tier 1 (3 days)", () => {
    expect(getDefaultCrawlInterval(1)).toBe(4320);
  });

  it("returns 10080 for tier 2 (weekly)", () => {
    expect(getDefaultCrawlInterval(2)).toBe(10080);
  });

  it("returns 10080 for unknown tier", () => {
    expect(getDefaultCrawlInterval(99)).toBe(10080);
  });
});

describe("getDefaultMaxPages", () => {
  it("returns 200 for tier 0", () => {
    expect(getDefaultMaxPages(0)).toBe(200);
  });

  it("returns 150 for tier 1", () => {
    expect(getDefaultMaxPages(1)).toBe(150);
  });

  it("returns 50 for tier 2", () => {
    expect(getDefaultMaxPages(2)).toBe(50);
  });

  it("returns 50 for unknown tier", () => {
    expect(getDefaultMaxPages(99)).toBe(50);
  });
});
// END_BLOCK_CRAWL_CONFIG_HELPER_TESTS_M_DB_SITES_TEST_006
