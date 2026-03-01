// FILE: src/sites/search/service.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate SitesSearchService search_sites and get_page_chunk logic with mock dependencies.
//   SCOPE: Assert query embedding, hybrid search mapping, chunk retrieval, error handling, and type correctness.
//   DEPENDS: M-SITES-SEARCH, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-LOGGER
//   LINKS: M-SITES-SEARCH-TEST, M-SITES-SEARCH, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build inert logger for deterministic service tests.
//   createMockVoyageClient - Build mock VoyageProxyClient with configurable embedQuery.
//   createMockRepository - Build mock SitesIndexRepository with configurable search and lookup.
//   SearchSitesTests - Validate searchSites embedding, hybrid search dispatch, and result mapping.
//   GetPageChunkTests - Validate getPageChunk retrieval, not-found error, and neighbor mapping.
//   ErrorHandlingTests - Validate error wrapping from upstream dependencies.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial test suite for M-SITES-SEARCH service.
// END_CHANGE_SUMMARY

import { describe, expect, it, mock } from "bun:test";
import type { Logger } from "../../logger/index";
import type { VoyageProxyClient } from "../../integrations/voyage-proxy-client";
import type { SitesIndexRepository, SearchResult, ChunkWithNeighbors } from "./repository";
import {
  boundText,
  createSitesSearchService,
  MAX_CHUNK_EXCERPT_LENGTH,
  MAX_NEIGHBOR_EXCERPT_LENGTH,
  MAX_SNIPPET_LENGTH,
  SitesSearchError,
  type SitesSearchService,
  type SearchSitesParams,
  type GetPageChunkParams,
} from "./service";

// START_BLOCK_CREATE_NOOP_LOGGER_M_SITES_SEARCH_TEST_001
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
// END_BLOCK_CREATE_NOOP_LOGGER_M_SITES_SEARCH_TEST_001

// START_BLOCK_MOCK_FACTORIES_M_SITES_SEARCH_TEST_002
function createMockVoyageClient(overrides?: Partial<VoyageProxyClient>): VoyageProxyClient {
  return {
    embedDocuments: mock(async (_texts: string[]) => [[0.1, 0.2, 0.3]]),
    embedQuery: mock(async (_text: string) => [0.1, 0.2, 0.3]),
    ...overrides,
  };
}

function createMockRepository(overrides?: Partial<SitesIndexRepository>): SitesIndexRepository {
  return {
    upsertPage: mock(async () => "page-001"),
    upsertChunks: mock(async () => {}),
    upsertEmbeddings: mock(async () => {}),
    searchHybrid: mock(async () => []),
    getChunkWithNeighbors: mock(async () => null),
    ...overrides,
  };
}
// END_BLOCK_MOCK_FACTORIES_M_SITES_SEARCH_TEST_002

// START_BLOCK_SAMPLE_DATA_M_SITES_SEARCH_TEST_003
function sampleSearchResults(): SearchResult[] {
  return [
    {
      chunk_id: "chunk-001",
      source_id: "src-001",
      page_url: "https://example.com/tokyo",
      title: "Tokyo Guide",
      snippet: "Tokyo is the capital of Japan...",
      score: 0.95,
      tier: 1,
      domain: "example.com",
    },
    {
      chunk_id: "chunk-002",
      source_id: "src-002",
      page_url: "https://example.com/kyoto",
      title: "Kyoto Guide",
      snippet: "Kyoto is known for its temples...",
      score: 0.88,
      tier: 2,
      domain: "example.com",
    },
  ];
}

function sampleChunkWithNeighbors(): ChunkWithNeighbors {
  return {
    chunk_id: "chunk-001",
    source_id: "src-001",
    page_url: "https://example.com/tokyo",
    title: "Tokyo Guide",
    chunk_text: "Tokyo is the capital of Japan and one of the most populous cities in the world.",
    chunk_index: 1,
    neighbor_before: "Japan is an island nation in East Asia.",
    neighbor_after: "The city has a population of over 13 million.",
  };
}
// END_BLOCK_SAMPLE_DATA_M_SITES_SEARCH_TEST_003

// START_BLOCK_SEARCH_SITES_TESTS_M_SITES_SEARCH_TEST_004
describe("SitesSearchService", () => {
  describe("searchSites", () => {
    it("should embed the query and return mapped search results", async () => {
      const mockEmbedQuery = mock(async (_text: string) => [0.5, 0.6, 0.7]);
      const mockSearchHybrid = mock(async () => sampleSearchResults());

      const voyageClient = createMockVoyageClient({ embedQuery: mockEmbedQuery });
      const repository = createMockRepository({ searchHybrid: mockSearchHybrid });
      const service = createSitesSearchService({
        voyageClient,
        repository,
        logger: createNoopLogger(),
      });

      const params: SearchSitesParams = { query: "best temples in Kyoto", top_k: 5 };
      const result = await service.searchSites(params);

      // Verify embedQuery was called with the query text
      expect(mockEmbedQuery).toHaveBeenCalledTimes(1);
      expect(mockEmbedQuery).toHaveBeenCalledWith("best temples in Kyoto");

      // Verify searchHybrid was called with embedded query
      expect(mockSearchHybrid).toHaveBeenCalledTimes(1);
      const hybridCall = mockSearchHybrid.mock.calls[0][0] as Record<string, unknown>;
      expect(hybridCall.query_embedding).toEqual([0.5, 0.6, 0.7]);
      expect(hybridCall.query_text).toBe("best temples in Kyoto");
      expect(hybridCall.top_k).toBe(5);
      expect(hybridCall.index_version).toBe("v1");
      expect(hybridCall.source_ids).toBeUndefined();

      // Verify result mapping
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({
        result_id: "sr:chunk-001",
        source_id: "src-001",
        tier: 1,
        domain: "example.com",
        original_page_url: "https://example.com/tokyo",
        title: "Tokyo Guide",
        snippet: "Tokyo is the capital of Japan...",
        chunk_id: "chunk-001",
        score: 0.95,
      });
      expect(result.results[1].result_id).toBe("sr:chunk-002");
    });

    it("should pass source_ids filter to hybrid search", async () => {
      const mockSearchHybrid = mock(async () => []);
      const repository = createMockRepository({ searchHybrid: mockSearchHybrid });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      const params: SearchSitesParams = {
        query: "ramen shops",
        top_k: 3,
        source_ids: ["src-001", "src-003"],
      };
      await service.searchSites(params);

      const hybridCall = mockSearchHybrid.mock.calls[0][0] as Record<string, unknown>;
      expect(hybridCall.source_ids).toEqual(["src-001", "src-003"]);
    });

    it("should return empty results when no matches found", async () => {
      const mockSearchHybrid = mock(async () => []);
      const repository = createMockRepository({ searchHybrid: mockSearchHybrid });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      const result = await service.searchSites({ query: "nonexistent topic", top_k: 5 });
      expect(result.results).toHaveLength(0);
    });

    it("should handle results without tier and domain", async () => {
      const resultsNoTierDomain: SearchResult[] = [
        {
          chunk_id: "chunk-010",
          source_id: "src-010",
          page_url: "https://example.com/generic",
          title: "Generic Page",
          snippet: "Some generic content.",
          score: 0.7,
        },
      ];
      const mockSearchHybrid = mock(async () => resultsNoTierDomain);
      const repository = createMockRepository({ searchHybrid: mockSearchHybrid });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      const result = await service.searchSites({ query: "generic", top_k: 5 });
      expect(result.results[0].tier).toBeUndefined();
      expect(result.results[0].domain).toBeUndefined();
    });
  });
  // END_BLOCK_SEARCH_SITES_TESTS_M_SITES_SEARCH_TEST_004

  // START_BLOCK_GET_PAGE_CHUNK_TESTS_M_SITES_SEARCH_TEST_005
  describe("getPageChunk", () => {
    it("should retrieve a chunk with neighbors and map to result", async () => {
      const chunkData = sampleChunkWithNeighbors();
      const mockGetChunk = mock(async () => chunkData);
      const repository = createMockRepository({ getChunkWithNeighbors: mockGetChunk });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      const params: GetPageChunkParams = { chunk_id: "chunk-001", include_neighbors: true };
      const result = await service.getPageChunk(params);

      expect(mockGetChunk).toHaveBeenCalledTimes(1);
      expect(mockGetChunk).toHaveBeenCalledWith("chunk-001", true);

      expect(result).toEqual({
        chunk_id: "chunk-001",
        source_id: "src-001",
        original_page_url: "https://example.com/tokyo",
        title: "Tokyo Guide",
        chunk_excerpt: "Tokyo is the capital of Japan and one of the most populous cities in the world.",
        neighbor_excerpt_before: "Japan is an island nation in East Asia.",
        neighbor_excerpt_after: "The city has a population of over 13 million.",
      });
    });

    it("should retrieve a chunk without neighbors", async () => {
      const chunkData: ChunkWithNeighbors = {
        chunk_id: "chunk-005",
        source_id: "src-002",
        page_url: "https://example.com/osaka",
        title: "Osaka Guide",
        chunk_text: "Osaka is known for its street food.",
        chunk_index: 0,
      };
      const mockGetChunk = mock(async () => chunkData);
      const repository = createMockRepository({ getChunkWithNeighbors: mockGetChunk });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      const params: GetPageChunkParams = { chunk_id: "chunk-005", include_neighbors: false };
      const result = await service.getPageChunk(params);

      expect(mockGetChunk).toHaveBeenCalledWith("chunk-005", false);
      expect(result.chunk_excerpt).toBe("Osaka is known for its street food.");
      expect(result.neighbor_excerpt_before).toBeUndefined();
      expect(result.neighbor_excerpt_after).toBeUndefined();
    });

    it("should throw SitesSearchError when chunk is not found", async () => {
      const mockGetChunk = mock(async () => null);
      const repository = createMockRepository({ getChunkWithNeighbors: mockGetChunk });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      const params: GetPageChunkParams = { chunk_id: "nonexistent-chunk", include_neighbors: false };

      try {
        await service.getPageChunk(params);
        expect(true).toBe(false); // Should not reach here
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(SitesSearchError);
        const searchError = error as SitesSearchError;
        expect(searchError.code).toBe("SITES_SEARCH_ERROR");
        expect(searchError.message).toContain("Chunk not found");
        expect(searchError.message).toContain("nonexistent-chunk");
        expect(searchError.details?.chunkId).toBe("nonexistent-chunk");
      }
    });
  });
  // END_BLOCK_GET_PAGE_CHUNK_TESTS_M_SITES_SEARCH_TEST_005

  // START_BLOCK_ERROR_HANDLING_TESTS_M_SITES_SEARCH_TEST_006
  describe("error handling", () => {
    it("should wrap voyage client errors in SitesSearchError for searchSites", async () => {
      const voyageClient = createMockVoyageClient({
        embedQuery: mock(async () => {
          throw new Error("Voyage API unavailable");
        }),
      });
      const service = createSitesSearchService({
        voyageClient,
        repository: createMockRepository(),
        logger: createNoopLogger(),
      });

      try {
        await service.searchSites({ query: "test", top_k: 5 });
        expect(true).toBe(false);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(SitesSearchError);
        const searchError = error as SitesSearchError;
        expect(searchError.code).toBe("SITES_SEARCH_ERROR");
        expect(searchError.message).toContain("Voyage API unavailable");
      }
    });

    it("should wrap repository errors in SitesSearchError for searchSites", async () => {
      const repository = createMockRepository({
        searchHybrid: mock(async () => {
          throw new Error("Database connection lost");
        }),
      });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      try {
        await service.searchSites({ query: "test", top_k: 5 });
        expect(true).toBe(false);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(SitesSearchError);
        const searchError = error as SitesSearchError;
        expect(searchError.message).toContain("Database connection lost");
      }
    });

    it("should wrap repository errors in SitesSearchError for getPageChunk", async () => {
      const repository = createMockRepository({
        getChunkWithNeighbors: mock(async () => {
          throw new Error("Unexpected DB error");
        }),
      });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      try {
        await service.getPageChunk({ chunk_id: "chunk-001", include_neighbors: true });
        expect(true).toBe(false);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(SitesSearchError);
        const searchError = error as SitesSearchError;
        expect(searchError.message).toContain("Unexpected DB error");
        expect(searchError.details?.chunkId).toBe("chunk-001");
      }
    });

    it("should re-throw SitesSearchError without wrapping", async () => {
      const originalError = new SitesSearchError("Custom search error", { custom: true });
      const repository = createMockRepository({
        getChunkWithNeighbors: mock(async () => {
          throw originalError;
        }),
      });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      try {
        await service.getPageChunk({ chunk_id: "chunk-001", include_neighbors: false });
        expect(true).toBe(false);
      } catch (error: unknown) {
        expect(error).toBe(originalError);
        expect((error as SitesSearchError).message).toBe("Custom search error");
      }
    });
  });
  // END_BLOCK_ERROR_HANDLING_TESTS_M_SITES_SEARCH_TEST_006

  // START_BLOCK_ERROR_CLASS_TESTS_M_SITES_SEARCH_TEST_007
  describe("SitesSearchError", () => {
    it("should have correct code and name", () => {
      const error = new SitesSearchError("test message");
      expect(error.code).toBe("SITES_SEARCH_ERROR");
      expect(error.name).toBe("SitesSearchError");
      expect(error.message).toBe("test message");
      expect(error).toBeInstanceOf(Error);
    });

    it("should include details when provided", () => {
      const error = new SitesSearchError("test", { foo: "bar" });
      expect(error.details).toEqual({ foo: "bar" });
    });

    it("should have undefined details when not provided", () => {
      const error = new SitesSearchError("test");
      expect(error.details).toBeUndefined();
    });
  });
  // END_BLOCK_ERROR_CLASS_TESTS_M_SITES_SEARCH_TEST_007

  // START_BLOCK_BOUNDED_OUTPUT_TESTS_M_SITES_SEARCH_TEST_008
  describe("bounded output enforcement", () => {
    it("should truncate snippet to MAX_SNIPPET_LENGTH in searchSites", async () => {
      const longSnippet = "x".repeat(1000);
      const searchResults: SearchResult[] = [
        {
          chunk_id: "chunk-long",
          source_id: "src-001",
          page_url: "https://example.com/long",
          title: "Long Page",
          snippet: longSnippet,
          score: 0.9,
        },
      ];
      const mockSearchHybrid = mock(async () => searchResults);
      const repository = createMockRepository({ searchHybrid: mockSearchHybrid });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      const result = await service.searchSites({ query: "test", top_k: 5 });

      expect(result.results[0].snippet.length).toBeLessThanOrEqual(MAX_SNIPPET_LENGTH);
      expect(result.results[0].snippet.length).toBe(MAX_SNIPPET_LENGTH);
    });

    it("should not truncate snippet shorter than MAX_SNIPPET_LENGTH", async () => {
      const shortSnippet = "short snippet";
      const searchResults: SearchResult[] = [
        {
          chunk_id: "chunk-short",
          source_id: "src-001",
          page_url: "https://example.com/short",
          title: "Short Page",
          snippet: shortSnippet,
          score: 0.9,
        },
      ];
      const mockSearchHybrid = mock(async () => searchResults);
      const repository = createMockRepository({ searchHybrid: mockSearchHybrid });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      const result = await service.searchSites({ query: "test", top_k: 5 });

      expect(result.results[0].snippet).toBe(shortSnippet);
    });

    it("should truncate chunk_excerpt to MAX_CHUNK_EXCERPT_LENGTH in getPageChunk", async () => {
      const longText = "y".repeat(3000);
      const chunkData: ChunkWithNeighbors = {
        chunk_id: "chunk-long",
        source_id: "src-001",
        page_url: "https://example.com/long",
        title: "Long Page",
        chunk_text: longText,
        chunk_index: 0,
      };
      const mockGetChunk = mock(async () => chunkData);
      const repository = createMockRepository({ getChunkWithNeighbors: mockGetChunk });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      const result = await service.getPageChunk({ chunk_id: "chunk-long", include_neighbors: false });

      expect(result.chunk_excerpt.length).toBeLessThanOrEqual(MAX_CHUNK_EXCERPT_LENGTH);
      expect(result.chunk_excerpt.length).toBe(MAX_CHUNK_EXCERPT_LENGTH);
    });

    it("should truncate neighbor excerpts to MAX_NEIGHBOR_EXCERPT_LENGTH", async () => {
      const longNeighbor = "z".repeat(2000);
      const chunkData: ChunkWithNeighbors = {
        chunk_id: "chunk-neigh",
        source_id: "src-001",
        page_url: "https://example.com/neigh",
        title: "Neighbor Page",
        chunk_text: "Short main text",
        chunk_index: 1,
        neighbor_before: longNeighbor,
        neighbor_after: longNeighbor,
      };
      const mockGetChunk = mock(async () => chunkData);
      const repository = createMockRepository({ getChunkWithNeighbors: mockGetChunk });
      const service = createSitesSearchService({
        voyageClient: createMockVoyageClient(),
        repository,
        logger: createNoopLogger(),
      });

      const result = await service.getPageChunk({ chunk_id: "chunk-neigh", include_neighbors: true });

      expect(result.neighbor_excerpt_before!.length).toBeLessThanOrEqual(MAX_NEIGHBOR_EXCERPT_LENGTH);
      expect(result.neighbor_excerpt_before!.length).toBe(MAX_NEIGHBOR_EXCERPT_LENGTH);
      expect(result.neighbor_excerpt_after!.length).toBeLessThanOrEqual(MAX_NEIGHBOR_EXCERPT_LENGTH);
      expect(result.neighbor_excerpt_after!.length).toBe(MAX_NEIGHBOR_EXCERPT_LENGTH);
    });
  });
  // END_BLOCK_BOUNDED_OUTPUT_TESTS_M_SITES_SEARCH_TEST_008

  // START_BLOCK_BOUND_TEXT_TESTS_M_SITES_SEARCH_TEST_009
  describe("boundText", () => {
    it("returns undefined for undefined input", () => {
      expect(boundText(undefined, 100)).toBeUndefined();
    });

    it("returns original text if within limit", () => {
      expect(boundText("hello", 100)).toBe("hello");
    });

    it("truncates text exceeding limit", () => {
      const text = "abcdefghij";
      expect(boundText(text, 5)).toBe("abcde");
    });

    it("returns original text if exactly at limit", () => {
      const text = "abcde";
      expect(boundText(text, 5)).toBe("abcde");
    });
  });
  // END_BLOCK_BOUND_TEXT_TESTS_M_SITES_SEARCH_TEST_009
});
