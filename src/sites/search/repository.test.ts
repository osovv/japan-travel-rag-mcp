// FILE: src/sites/search/repository.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate SitesIndexRepository data access layer with mock DB interactions.
//   SCOPE: Assert upsert, hybrid search, chunk lookup, error wrapping, and type correctness.
//   DEPENDS: M-SITES-INDEX-REPOSITORY, M-LOGGER
//   LINKS: M-SITES-INDEX-REPOSITORY-TEST, M-SITES-INDEX-REPOSITORY, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build inert logger for deterministic repository tests.
//   createMockDb - Build mock NodePgDatabase with configurable execute responses.
//   ErrorClassTests - Validate SitesIndexRepositoryError with code and details.
//   UpsertPageTests - Validate upsertPage SQL generation and page_id return.
//   UpsertChunksTests - Validate upsertChunks iterates and calls execute per chunk.
//   UpsertEmbeddingsTests - Validate upsertEmbeddings iterates and calls execute per embedding.
//   SearchHybridTests - Validate searchHybrid result mapping and snippet truncation.
//   GetChunkWithNeighborsTests - Validate chunk lookup and neighbor retrieval.
//   ErrorWrappingTests - Validate all methods wrap DB errors in SitesIndexRepositoryError.
//   SnippetTruncationTests - Validate truncation to ~300 chars.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial test suite for M-SITES-INDEX-REPOSITORY.
// END_CHANGE_SUMMARY

import { describe, expect, it, mock } from "bun:test";
import type { Logger } from "../../logger/index";
import {
  createSitesIndexRepository,
  SitesIndexRepositoryError,
  type UpsertPageInput,
  type UpsertChunkInput,
  type UpsertEmbeddingInput,
  type HybridSearchParams,
  type SearchResult,
  type ChunkWithNeighbors,
  type SitesIndexRepository,
} from "./repository";

// START_BLOCK_CREATE_NOOP_LOGGER_M_SITES_INDEX_REPOSITORY_TEST_001
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
// END_BLOCK_CREATE_NOOP_LOGGER_M_SITES_INDEX_REPOSITORY_TEST_001

// START_BLOCK_CREATE_MOCK_DB_M_SITES_INDEX_REPOSITORY_TEST_002
type MockExecuteFn = (...args: unknown[]) => Promise<{ rows: unknown[] }>;

function createMockDb(executeFn?: MockExecuteFn) {
  const defaultExecute = async () => ({ rows: [] });
  const executeMock = mock(executeFn ?? defaultExecute);

  return {
    db: { execute: executeMock } as unknown as import("drizzle-orm/node-postgres").NodePgDatabase,
    executeMock,
  };
}
// END_BLOCK_CREATE_MOCK_DB_M_SITES_INDEX_REPOSITORY_TEST_002

// START_BLOCK_SAMPLE_DATA_M_SITES_INDEX_REPOSITORY_TEST_003
function samplePageInput(): UpsertPageInput {
  return {
    source_id: "src-001",
    url: "https://example.com/tokyo-guide",
    canonical_url: "https://example.com/tokyo-guide",
    title: "Tokyo Travel Guide",
    text_hash: "abc123def456",
    http_status: 200,
    fetched_at: new Date("2026-01-15T10:00:00Z"),
  };
}

function sampleChunkInput(): UpsertChunkInput {
  return {
    chunk_id: "chunk-001",
    chunk_index: 0,
    chunk_text: "Tokyo is the capital of Japan.",
    char_count: 30,
    token_estimate: 8,
    content_hash: "hash-001",
    chunking_version: "v1",
    index_version: "v1",
    start_offset: 0,
    end_offset: 30,
  };
}

function sampleEmbeddingInput(): UpsertEmbeddingInput {
  return {
    chunk_id: "chunk-001",
    embedding: Array(1024).fill(0.1),
    embedding_model: "voyage-3-lite",
    embedding_version: "v1",
    index_version: "v1",
  };
}

function sampleHybridSearchParams(): HybridSearchParams {
  return {
    query_embedding: Array(1024).fill(0.1),
    query_text: "best ramen in tokyo",
    index_version: "v1",
    top_k: 5,
  };
}
// END_BLOCK_SAMPLE_DATA_M_SITES_INDEX_REPOSITORY_TEST_003

describe("M-SITES-INDEX-REPOSITORY", () => {
  // START_BLOCK_ERROR_CLASS_TESTS_M_SITES_INDEX_REPOSITORY_TEST_004
  describe("SitesIndexRepositoryError", () => {
    it("should have code SITES_INDEX_REPOSITORY_ERROR", () => {
      const err = new SitesIndexRepositoryError("test error");
      expect(err.code).toBe("SITES_INDEX_REPOSITORY_ERROR");
    });

    it("should have name SitesIndexRepositoryError", () => {
      const err = new SitesIndexRepositoryError("test error");
      expect(err.name).toBe("SitesIndexRepositoryError");
    });

    it("should extend Error", () => {
      const err = new SitesIndexRepositoryError("test error");
      expect(err).toBeInstanceOf(Error);
    });

    it("should store message", () => {
      const err = new SitesIndexRepositoryError("something went wrong");
      expect(err.message).toBe("something went wrong");
    });

    it("should store details when provided", () => {
      const details = { pageId: "p1", chunkCount: 5 };
      const err = new SitesIndexRepositoryError("test", details);
      expect(err.details).toEqual(details);
    });

    it("should have undefined details when not provided", () => {
      const err = new SitesIndexRepositoryError("test");
      expect(err.details).toBeUndefined();
    });
  });
  // END_BLOCK_ERROR_CLASS_TESTS_M_SITES_INDEX_REPOSITORY_TEST_004

  // START_BLOCK_FACTORY_TESTS_M_SITES_INDEX_REPOSITORY_TEST_005
  describe("createSitesIndexRepository", () => {
    it("should return an object with all required methods", () => {
      const { db } = createMockDb();
      const repo = createSitesIndexRepository(db, createNoopLogger());

      expect(typeof repo.upsertPage).toBe("function");
      expect(typeof repo.upsertChunks).toBe("function");
      expect(typeof repo.upsertEmbeddings).toBe("function");
      expect(typeof repo.searchHybrid).toBe("function");
      expect(typeof repo.getChunkWithNeighbors).toBe("function");
    });
  });
  // END_BLOCK_FACTORY_TESTS_M_SITES_INDEX_REPOSITORY_TEST_005

  // START_BLOCK_UPSERT_PAGE_TESTS_M_SITES_INDEX_REPOSITORY_TEST_006
  describe("upsertPage", () => {
    it("should call db.execute and return page_id from RETURNING clause", async () => {
      const expectedPageId = "returned-page-id";
      const { db } = createMockDb(async () => ({
        rows: [{ page_id: expectedPageId }],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const result = await repo.upsertPage(samplePageInput());
      expect(result).toBe(expectedPageId);
    });

    it("should call db.execute exactly once", async () => {
      const { db, executeMock } = createMockDb(async () => ({
        rows: [{ page_id: "p1" }],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await repo.upsertPage(samplePageInput());
      expect(executeMock).toHaveBeenCalledTimes(1);
    });

    it("should return a UUID when RETURNING yields no rows", async () => {
      const { db } = createMockDb(async () => ({ rows: [] }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const result = await repo.upsertPage(samplePageInput());
      // Should still return a UUID-like string (the one we generated)
      expect(result).toMatch(/^[a-f0-9-]{36}$/);
    });

    it("should throw SitesIndexRepositoryError on DB failure", async () => {
      const { db } = createMockDb(async () => {
        throw new Error("connection refused");
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await expect(repo.upsertPage(samplePageInput())).rejects.toThrow(
        SitesIndexRepositoryError,
      );
    });

    it("should include canonical_url in error details", async () => {
      const { db } = createMockDb(async () => {
        throw new Error("connection refused");
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      try {
        await repo.upsertPage(samplePageInput());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SitesIndexRepositoryError);
        const repoErr = err as SitesIndexRepositoryError;
        expect(repoErr.details?.canonicalUrl).toBe("https://example.com/tokyo-guide");
      }
    });
  });
  // END_BLOCK_UPSERT_PAGE_TESTS_M_SITES_INDEX_REPOSITORY_TEST_006

  // START_BLOCK_UPSERT_CHUNKS_TESTS_M_SITES_INDEX_REPOSITORY_TEST_007
  describe("upsertChunks", () => {
    it("should call db.execute once per chunk", async () => {
      const { db, executeMock } = createMockDb();
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const chunks: UpsertChunkInput[] = [
        { ...sampleChunkInput(), chunk_id: "c1", chunk_index: 0 },
        { ...sampleChunkInput(), chunk_id: "c2", chunk_index: 1 },
        { ...sampleChunkInput(), chunk_id: "c3", chunk_index: 2 },
      ];

      await repo.upsertChunks("page-001", chunks);
      expect(executeMock).toHaveBeenCalledTimes(3);
    });

    it("should not call db.execute for empty chunks array", async () => {
      const { db, executeMock } = createMockDb();
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await repo.upsertChunks("page-001", []);
      expect(executeMock).toHaveBeenCalledTimes(0);
    });

    it("should resolve without error on success", async () => {
      const { db } = createMockDb();
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await expect(
        repo.upsertChunks("page-001", [sampleChunkInput()]),
      ).resolves.toBeUndefined();
    });

    it("should throw SitesIndexRepositoryError on DB failure", async () => {
      const { db } = createMockDb(async () => {
        throw new Error("disk full");
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await expect(
        repo.upsertChunks("page-001", [sampleChunkInput()]),
      ).rejects.toThrow(SitesIndexRepositoryError);
    });

    it("should include pageId in error details", async () => {
      const { db } = createMockDb(async () => {
        throw new Error("disk full");
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      try {
        await repo.upsertChunks("page-001", [sampleChunkInput()]);
        expect.unreachable("should have thrown");
      } catch (err) {
        const repoErr = err as SitesIndexRepositoryError;
        expect(repoErr.details?.pageId).toBe("page-001");
      }
    });
  });
  // END_BLOCK_UPSERT_CHUNKS_TESTS_M_SITES_INDEX_REPOSITORY_TEST_007

  // START_BLOCK_UPSERT_EMBEDDINGS_TESTS_M_SITES_INDEX_REPOSITORY_TEST_008
  describe("upsertEmbeddings", () => {
    it("should call db.execute once per embedding", async () => {
      const { db, executeMock } = createMockDb();
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const embeddings: UpsertEmbeddingInput[] = [
        { ...sampleEmbeddingInput(), chunk_id: "c1" },
        { ...sampleEmbeddingInput(), chunk_id: "c2" },
      ];

      await repo.upsertEmbeddings(embeddings);
      expect(executeMock).toHaveBeenCalledTimes(2);
    });

    it("should not call db.execute for empty embeddings array", async () => {
      const { db, executeMock } = createMockDb();
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await repo.upsertEmbeddings([]);
      expect(executeMock).toHaveBeenCalledTimes(0);
    });

    it("should resolve without error on success", async () => {
      const { db } = createMockDb();
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await expect(
        repo.upsertEmbeddings([sampleEmbeddingInput()]),
      ).resolves.toBeUndefined();
    });

    it("should throw SitesIndexRepositoryError on DB failure", async () => {
      const { db } = createMockDb(async () => {
        throw new Error("timeout");
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await expect(
        repo.upsertEmbeddings([sampleEmbeddingInput()]),
      ).rejects.toThrow(SitesIndexRepositoryError);
    });

    it("should include count in error details", async () => {
      const { db } = createMockDb(async () => {
        throw new Error("timeout");
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      try {
        await repo.upsertEmbeddings([sampleEmbeddingInput()]);
        expect.unreachable("should have thrown");
      } catch (err) {
        const repoErr = err as SitesIndexRepositoryError;
        expect(repoErr.details?.count).toBe(1);
      }
    });
  });
  // END_BLOCK_UPSERT_EMBEDDINGS_TESTS_M_SITES_INDEX_REPOSITORY_TEST_008

  // START_BLOCK_SEARCH_HYBRID_TESTS_M_SITES_INDEX_REPOSITORY_TEST_009
  describe("searchHybrid", () => {
    it("should return mapped SearchResult array from DB rows", async () => {
      const { db } = createMockDb(async () => ({
        rows: [
          {
            chunk_id: "c1",
            source_id: "src-001",
            page_url: "https://example.com/page1",
            title: "Page 1",
            chunk_text: "Tokyo ramen is amazing.",
            combined_score: 0.85,
            tier: 1,
            domain: "example.com",
          },
        ],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const results = await repo.searchHybrid(sampleHybridSearchParams());

      expect(results).toHaveLength(1);
      expect(results[0].chunk_id).toBe("c1");
      expect(results[0].source_id).toBe("src-001");
      expect(results[0].page_url).toBe("https://example.com/page1");
      expect(results[0].title).toBe("Page 1");
      expect(results[0].snippet).toBe("Tokyo ramen is amazing.");
      expect(results[0].score).toBe(0.85);
      expect(results[0].tier).toBe(1);
      expect(results[0].domain).toBe("example.com");
    });

    it("should return empty array when no rows", async () => {
      const { db } = createMockDb(async () => ({ rows: [] }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const results = await repo.searchHybrid(sampleHybridSearchParams());
      expect(results).toEqual([]);
    });

    it("should truncate snippet to ~300 chars with ellipsis", async () => {
      const longText = "A".repeat(500);
      const { db } = createMockDb(async () => ({
        rows: [
          {
            chunk_id: "c1",
            source_id: "src-001",
            page_url: "https://example.com/page1",
            title: "Page 1",
            chunk_text: longText,
            combined_score: 0.9,
            tier: 0,
            domain: "example.com",
          },
        ],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const results = await repo.searchHybrid(sampleHybridSearchParams());
      expect(results[0].snippet.length).toBe(303); // 300 + "..."
      expect(results[0].snippet.endsWith("...")).toBe(true);
    });

    it("should not truncate snippet when text is under 300 chars", async () => {
      const shortText = "Short text about Tokyo.";
      const { db } = createMockDb(async () => ({
        rows: [
          {
            chunk_id: "c1",
            source_id: "src-001",
            page_url: "https://example.com/page1",
            title: "Page 1",
            chunk_text: shortText,
            combined_score: 0.9,
            tier: 0,
            domain: "example.com",
          },
        ],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const results = await repo.searchHybrid(sampleHybridSearchParams());
      expect(results[0].snippet).toBe(shortText);
    });

    it("should call db.execute with source_ids filter when provided", async () => {
      const { db, executeMock } = createMockDb(async () => ({ rows: [] }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const params = {
        ...sampleHybridSearchParams(),
        source_ids: ["src-001", "src-002"],
      };

      await repo.searchHybrid(params);
      expect(executeMock).toHaveBeenCalledTimes(1);
    });

    it("should call db.execute without source_ids filter when not provided", async () => {
      const { db, executeMock } = createMockDb(async () => ({ rows: [] }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await repo.searchHybrid(sampleHybridSearchParams());
      expect(executeMock).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple result rows", async () => {
      const { db } = createMockDb(async () => ({
        rows: [
          {
            chunk_id: "c1",
            source_id: "src-001",
            page_url: "https://example.com/p1",
            title: "P1",
            chunk_text: "Text 1",
            combined_score: 0.9,
            tier: 0,
            domain: "example.com",
          },
          {
            chunk_id: "c2",
            source_id: "src-002",
            page_url: "https://example.com/p2",
            title: "P2",
            chunk_text: "Text 2",
            combined_score: 0.8,
            tier: 1,
            domain: "other.com",
          },
        ],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const results = await repo.searchHybrid(sampleHybridSearchParams());
      expect(results).toHaveLength(2);
      expect(results[0].score).toBe(0.9);
      expect(results[1].score).toBe(0.8);
    });

    it("should throw SitesIndexRepositoryError on DB failure", async () => {
      const { db } = createMockDb(async () => {
        throw new Error("query failed");
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await expect(
        repo.searchHybrid(sampleHybridSearchParams()),
      ).rejects.toThrow(SitesIndexRepositoryError);
    });

    it("should include indexVersion and topK in error details", async () => {
      const { db } = createMockDb(async () => {
        throw new Error("query failed");
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      try {
        await repo.searchHybrid(sampleHybridSearchParams());
        expect.unreachable("should have thrown");
      } catch (err) {
        const repoErr = err as SitesIndexRepositoryError;
        expect(repoErr.details?.indexVersion).toBe("v1");
        expect(repoErr.details?.topK).toBe(5);
      }
    });

    it("should handle null tier and domain gracefully", async () => {
      const { db } = createMockDb(async () => ({
        rows: [
          {
            chunk_id: "c1",
            source_id: "src-001",
            page_url: "https://example.com/p1",
            title: "P1",
            chunk_text: "Text",
            combined_score: 0.7,
            tier: null,
            domain: null,
          },
        ],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const results = await repo.searchHybrid(sampleHybridSearchParams());
      expect(results[0].tier).toBeUndefined();
      expect(results[0].domain).toBeUndefined();
    });
  });
  // END_BLOCK_SEARCH_HYBRID_TESTS_M_SITES_INDEX_REPOSITORY_TEST_009

  // START_BLOCK_GET_CHUNK_WITH_NEIGHBORS_TESTS_M_SITES_INDEX_REPOSITORY_TEST_010
  describe("getChunkWithNeighbors", () => {
    it("should return null when chunk not found", async () => {
      const { db } = createMockDb(async () => ({ rows: [] }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const result = await repo.getChunkWithNeighbors("nonexistent", false);
      expect(result).toBeNull();
    });

    it("should return chunk without neighbors when includeNeighbors is false", async () => {
      const { db, executeMock } = createMockDb(async () => ({
        rows: [
          {
            chunk_id: "c1",
            page_id: "p1",
            chunk_index: 2,
            chunk_text: "Chunk text content.",
            source_id: "src-001",
            page_url: "https://example.com/page1",
            title: "Page Title",
          },
        ],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const result = await repo.getChunkWithNeighbors("c1", false);

      expect(result).not.toBeNull();
      expect(result!.chunk_id).toBe("c1");
      expect(result!.source_id).toBe("src-001");
      expect(result!.page_url).toBe("https://example.com/page1");
      expect(result!.title).toBe("Page Title");
      expect(result!.chunk_text).toBe("Chunk text content.");
      expect(result!.chunk_index).toBe(2);
      expect(result!.neighbor_before).toBeUndefined();
      expect(result!.neighbor_after).toBeUndefined();
      // Should only call execute once (no neighbor query)
      expect(executeMock).toHaveBeenCalledTimes(1);
    });

    it("should return chunk with neighbors when includeNeighbors is true", async () => {
      let callCount = 0;
      const { db } = createMockDb(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: get the target chunk
          return {
            rows: [
              {
                chunk_id: "c2",
                page_id: "p1",
                chunk_index: 1,
                chunk_text: "Middle chunk.",
                source_id: "src-001",
                page_url: "https://example.com/page1",
                title: "Page",
              },
            ],
          };
        }
        // Second call: get neighbors
        return {
          rows: [
            { chunk_index: 0, chunk_text: "Before chunk." },
            { chunk_index: 2, chunk_text: "After chunk." },
          ],
        };
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const result = await repo.getChunkWithNeighbors("c2", true);

      expect(result).not.toBeNull();
      expect(result!.chunk_id).toBe("c2");
      expect(result!.chunk_index).toBe(1);
      expect(result!.neighbor_before).toBe("Before chunk.");
      expect(result!.neighbor_after).toBe("After chunk.");
    });

    it("should handle only neighbor_before when chunk is last", async () => {
      let callCount = 0;
      const { db } = createMockDb(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            rows: [
              {
                chunk_id: "c3",
                page_id: "p1",
                chunk_index: 5,
                chunk_text: "Last chunk.",
                source_id: "src-001",
                page_url: "https://example.com/page1",
                title: "Page",
              },
            ],
          };
        }
        return {
          rows: [{ chunk_index: 4, chunk_text: "Previous chunk." }],
        };
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const result = await repo.getChunkWithNeighbors("c3", true);

      expect(result!.neighbor_before).toBe("Previous chunk.");
      expect(result!.neighbor_after).toBeUndefined();
    });

    it("should handle only neighbor_after when chunk is first", async () => {
      let callCount = 0;
      const { db } = createMockDb(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            rows: [
              {
                chunk_id: "c0",
                page_id: "p1",
                chunk_index: 0,
                chunk_text: "First chunk.",
                source_id: "src-001",
                page_url: "https://example.com/page1",
                title: "Page",
              },
            ],
          };
        }
        return {
          rows: [{ chunk_index: 1, chunk_text: "Next chunk." }],
        };
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const result = await repo.getChunkWithNeighbors("c0", true);

      expect(result!.neighbor_before).toBeUndefined();
      expect(result!.neighbor_after).toBe("Next chunk.");
    });

    it("should handle no neighbors found", async () => {
      let callCount = 0;
      const { db } = createMockDb(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            rows: [
              {
                chunk_id: "c-solo",
                page_id: "p1",
                chunk_index: 0,
                chunk_text: "Only chunk.",
                source_id: "src-001",
                page_url: "https://example.com/page1",
                title: "Page",
              },
            ],
          };
        }
        return { rows: [] };
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const result = await repo.getChunkWithNeighbors("c-solo", true);

      expect(result!.neighbor_before).toBeUndefined();
      expect(result!.neighbor_after).toBeUndefined();
    });

    it("should call db.execute twice when includeNeighbors is true", async () => {
      let callCount = 0;
      const { db, executeMock } = createMockDb(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            rows: [
              {
                chunk_id: "c1",
                page_id: "p1",
                chunk_index: 1,
                chunk_text: "Text.",
                source_id: "src-001",
                page_url: "https://example.com/p1",
                title: "T",
              },
            ],
          };
        }
        return { rows: [] };
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await repo.getChunkWithNeighbors("c1", true);
      expect(executeMock).toHaveBeenCalledTimes(2);
    });

    it("should throw SitesIndexRepositoryError on DB failure", async () => {
      const { db } = createMockDb(async () => {
        throw new Error("connection lost");
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      await expect(
        repo.getChunkWithNeighbors("c1", false),
      ).rejects.toThrow(SitesIndexRepositoryError);
    });

    it("should include chunkId in error details", async () => {
      const { db } = createMockDb(async () => {
        throw new Error("connection lost");
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      try {
        await repo.getChunkWithNeighbors("c1", false);
        expect.unreachable("should have thrown");
      } catch (err) {
        const repoErr = err as SitesIndexRepositoryError;
        expect(repoErr.details?.chunkId).toBe("c1");
      }
    });
  });
  // END_BLOCK_GET_CHUNK_WITH_NEIGHBORS_TESTS_M_SITES_INDEX_REPOSITORY_TEST_010

  // START_BLOCK_ERROR_WRAPPING_TESTS_M_SITES_INDEX_REPOSITORY_TEST_011
  describe("Error wrapping", () => {
    it("should wrap non-Error throws in SitesIndexRepositoryError", async () => {
      const { db } = createMockDb(async () => {
        throw "string error";
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      try {
        await repo.upsertPage(samplePageInput());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SitesIndexRepositoryError);
        expect((err as SitesIndexRepositoryError).message).toContain("string error");
      }
    });

    it("should preserve original error message in wrapped error", async () => {
      const { db } = createMockDb(async () => {
        throw new Error("unique_violation");
      });
      const repo = createSitesIndexRepository(db, createNoopLogger());

      try {
        await repo.upsertChunks("p1", [sampleChunkInput()]);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as SitesIndexRepositoryError).message).toContain("unique_violation");
      }
    });
  });
  // END_BLOCK_ERROR_WRAPPING_TESTS_M_SITES_INDEX_REPOSITORY_TEST_011

  // START_BLOCK_SNIPPET_TRUNCATION_TESTS_M_SITES_INDEX_REPOSITORY_TEST_012
  describe("Snippet truncation", () => {
    it("should truncate text exactly at 300 chars when over", async () => {
      const text301 = "B".repeat(301);
      const { db } = createMockDb(async () => ({
        rows: [
          {
            chunk_id: "c1",
            source_id: "s1",
            page_url: "https://example.com",
            title: "T",
            chunk_text: text301,
            combined_score: 0.5,
            tier: 0,
            domain: "example.com",
          },
        ],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const results = await repo.searchHybrid(sampleHybridSearchParams());
      expect(results[0].snippet).toBe("B".repeat(300) + "...");
    });

    it("should not truncate text exactly at 300 chars", async () => {
      const text300 = "C".repeat(300);
      const { db } = createMockDb(async () => ({
        rows: [
          {
            chunk_id: "c1",
            source_id: "s1",
            page_url: "https://example.com",
            title: "T",
            chunk_text: text300,
            combined_score: 0.5,
            tier: 0,
            domain: "example.com",
          },
        ],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const results = await repo.searchHybrid(sampleHybridSearchParams());
      expect(results[0].snippet).toBe(text300);
    });
  });
  // END_BLOCK_SNIPPET_TRUNCATION_TESTS_M_SITES_INDEX_REPOSITORY_TEST_012

  // START_BLOCK_TYPE_CONTRACT_TESTS_M_SITES_INDEX_REPOSITORY_TEST_013
  describe("Type contracts", () => {
    it("should satisfy SitesIndexRepository type", () => {
      const { db } = createMockDb();
      const repo: SitesIndexRepository = createSitesIndexRepository(db, createNoopLogger());

      // Type-level assertion: all methods present
      expect(repo.upsertPage).toBeDefined();
      expect(repo.upsertChunks).toBeDefined();
      expect(repo.upsertEmbeddings).toBeDefined();
      expect(repo.searchHybrid).toBeDefined();
      expect(repo.getChunkWithNeighbors).toBeDefined();
    });

    it("should have correct SearchResult shape", async () => {
      const { db } = createMockDb(async () => ({
        rows: [
          {
            chunk_id: "c1",
            source_id: "s1",
            page_url: "https://example.com",
            title: "Title",
            chunk_text: "Text",
            combined_score: 0.9,
            tier: 1,
            domain: "example.com",
          },
        ],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const results = await repo.searchHybrid(sampleHybridSearchParams());
      const result: SearchResult = results[0];

      expect(typeof result.chunk_id).toBe("string");
      expect(typeof result.source_id).toBe("string");
      expect(typeof result.page_url).toBe("string");
      expect(typeof result.title).toBe("string");
      expect(typeof result.snippet).toBe("string");
      expect(typeof result.score).toBe("number");
    });

    it("should have correct ChunkWithNeighbors shape", async () => {
      const { db } = createMockDb(async () => ({
        rows: [
          {
            chunk_id: "c1",
            page_id: "p1",
            chunk_index: 0,
            chunk_text: "Text",
            source_id: "s1",
            page_url: "https://example.com",
            title: "T",
          },
        ],
      }));
      const repo = createSitesIndexRepository(db, createNoopLogger());

      const result = await repo.getChunkWithNeighbors("c1", false);
      const chunk: ChunkWithNeighbors = result!;

      expect(typeof chunk.chunk_id).toBe("string");
      expect(typeof chunk.source_id).toBe("string");
      expect(typeof chunk.page_url).toBe("string");
      expect(typeof chunk.title).toBe("string");
      expect(typeof chunk.chunk_text).toBe("string");
      expect(typeof chunk.chunk_index).toBe("number");
    });
  });
  // END_BLOCK_TYPE_CONTRACT_TESTS_M_SITES_INDEX_REPOSITORY_TEST_013
});
