// FILE: src/sites/search/service.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Serve the local search_sites and get_page_chunk tool logic as a bridge between MCP tool handlers and the search index.
//   SCOPE: Embed queries via VoyageProxyClient, execute hybrid search via SitesIndexRepository, map results to tool-facing types, and retrieve bounded chunk excerpts with optional neighbors.
//   DEPENDS: M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-SITES-INGESTION, M-LOGGER
//   LINKS: M-SITES-SEARCH, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-SITES-INGESTION, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SitesSearchError - Typed error for search service failures with SITES_SEARCH_ERROR code.
//   SitesSearchDeps - Dependencies injected into the search service factory.
//   SearchSitesParams - Parameters for the search_sites tool.
//   SearchSitesResult - Result shape returned by the search_sites tool.
//   GetPageChunkParams - Parameters for the get_page_chunk tool.
//   GetPageChunkResult - Result shape returned by the get_page_chunk tool.
//   SitesSearchService - Runtime service interface exposing searchSites and getPageChunk.
//   createSitesSearchService - Factory that builds a SitesSearchService bound to its dependencies.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Add bounded output enforcement: snippet max 500 chars, chunk_excerpt max 2000 chars, neighbor excerpts max 1000 chars.
// END_CHANGE_SUMMARY

import type { VoyageProxyClient } from "../../integrations/voyage-proxy-client";
import type { SitesIndexRepository } from "./repository";
import type { Logger } from "../../logger/index";
import { INDEX_VERSION } from "../ingestion/orchestrator";

// START_BLOCK_DEFINE_OUTPUT_BOUNDS_M_SITES_SEARCH_000
export const MAX_SNIPPET_LENGTH = 500;
export const MAX_CHUNK_EXCERPT_LENGTH = 2000;
export const MAX_NEIGHBOR_EXCERPT_LENGTH = 1000;

// START_CONTRACT: boundText
//   PURPOSE: Truncate text to a maximum length, appending ellipsis if truncated.
//   INPUTS: { text: string | undefined, maxLength: number }
//   OUTPUTS: { string | undefined - Truncated text or undefined if input is undefined }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-SEARCH]
// END_CONTRACT: boundText
export function boundText(text: string | undefined, maxLength: number): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength);
}
// END_BLOCK_DEFINE_OUTPUT_BOUNDS_M_SITES_SEARCH_000

// START_BLOCK_DEFINE_ERROR_CLASS_M_SITES_SEARCH_001
export class SitesSearchError extends Error {
  public readonly code: "SITES_SEARCH_ERROR" = "SITES_SEARCH_ERROR";
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SitesSearchError";
    this.details = details;
  }
}
// END_BLOCK_DEFINE_ERROR_CLASS_M_SITES_SEARCH_001

// START_BLOCK_DEFINE_SERVICE_TYPES_M_SITES_SEARCH_002
export type SitesSearchDeps = {
  voyageClient: VoyageProxyClient;
  repository: SitesIndexRepository;
  logger: Logger;
};

export type SearchSitesParams = {
  query: string;
  top_k: number;
  source_ids?: string[];
};

export type SearchSitesResult = {
  results: Array<{
    result_id: string;
    source_id: string;
    tier?: number;
    domain?: string;
    original_page_url: string;
    title: string;
    snippet: string;
    chunk_id: string;
    score: number;
  }>;
};

export type GetPageChunkParams = {
  chunk_id: string;
  include_neighbors: boolean;
};

export type GetPageChunkResult = {
  chunk_id: string;
  source_id: string;
  original_page_url: string;
  title: string;
  chunk_excerpt: string;
  neighbor_excerpt_before?: string;
  neighbor_excerpt_after?: string;
};

export type SitesSearchService = {
  searchSites(params: SearchSitesParams): Promise<SearchSitesResult>;
  getPageChunk(params: GetPageChunkParams): Promise<GetPageChunkResult>;
};
// END_BLOCK_DEFINE_SERVICE_TYPES_M_SITES_SEARCH_002

// START_CONTRACT: createSitesSearchService
//   PURPOSE: Factory that builds a SitesSearchService bound to VoyageProxyClient, SitesIndexRepository, and Logger.
//   INPUTS: { deps: SitesSearchDeps - Voyage client, repository, and logger }
//   OUTPUTS: { SitesSearchService - Service with searchSites and getPageChunk methods }
//   SIDE_EFFECTS: [none at factory time; methods perform I/O through injected deps]
//   LINKS: [M-SITES-SEARCH, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-LOGGER]
// END_CONTRACT: createSitesSearchService
export function createSitesSearchService(deps: SitesSearchDeps): SitesSearchService {
  const { voyageClient, repository, logger } = deps;

  // START_BLOCK_SEARCH_SITES_M_SITES_SEARCH_003
  // START_CONTRACT: searchSites
  //   PURPOSE: Embed the query via Voyage, execute hybrid search, and map results to tool-facing shape.
  //   INPUTS: { params: SearchSitesParams - Query text, top_k, optional source_ids filter }
  //   OUTPUTS: { Promise<SearchSitesResult> - Ranked search results with result_id prefixed "sr:" }
  //   SIDE_EFFECTS: [Calls Voyage embedding API, reads from search index]
  //   LINKS: [M-SITES-SEARCH, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY]
  // END_CONTRACT: searchSites
  async function searchSites(params: SearchSitesParams): Promise<SearchSitesResult> {
    const functionName = "searchSites";

    try {
      // Step 1: Embed query
      logger.info(
        `Embedding query for search: "${params.query}".`,
        functionName,
        "EMBED_QUERY",
        { query: params.query, topK: params.top_k, sourceIds: params.source_ids },
      );

      const queryEmbedding = await voyageClient.embedQuery(params.query);

      // Step 2: Hybrid search
      logger.info(
        "Executing hybrid search.",
        functionName,
        "HYBRID_SEARCH",
        { topK: params.top_k, indexVersion: INDEX_VERSION },
      );

      const searchResults = await repository.searchHybrid({
        query_embedding: queryEmbedding,
        query_text: params.query,
        index_version: INDEX_VERSION,
        top_k: params.top_k,
        source_ids: params.source_ids,
      });

      // Step 3: Map to SearchSitesResult with bounded output
      const results = searchResults.map((sr) => ({
        result_id: `sr:${sr.chunk_id}`,
        source_id: sr.source_id,
        tier: sr.tier,
        domain: sr.domain,
        original_page_url: sr.page_url,
        title: sr.title,
        snippet: boundText(sr.snippet, MAX_SNIPPET_LENGTH) ?? "",
        chunk_id: sr.chunk_id,
        score: sr.score,
      }));

      logger.info(
        `Search returned ${results.length} results.`,
        functionName,
        "SEARCH_COMPLETE",
        { resultCount: results.length, topK: params.top_k },
      );

      return { results };
    } catch (error: unknown) {
      if (error instanceof SitesSearchError) {
        throw error;
      }
      const cause = error instanceof Error ? error.message : String(error);
      throw new SitesSearchError(`Search failed: ${cause}`, {
        query: params.query,
        topK: params.top_k,
      });
    }
  }
  // END_BLOCK_SEARCH_SITES_M_SITES_SEARCH_003

  // START_BLOCK_GET_PAGE_CHUNK_M_SITES_SEARCH_004
  // START_CONTRACT: getPageChunk
  //   PURPOSE: Retrieve a chunk by ID with optional neighbor excerpts, or throw if not found.
  //   INPUTS: { params: GetPageChunkParams - chunk_id and include_neighbors flag }
  //   OUTPUTS: { Promise<GetPageChunkResult> - Chunk excerpt with optional neighbor excerpts }
  //   SIDE_EFFECTS: [Reads from search index]
  //   LINKS: [M-SITES-SEARCH, M-SITES-INDEX-REPOSITORY]
  // END_CONTRACT: getPageChunk
  async function getPageChunk(params: GetPageChunkParams): Promise<GetPageChunkResult> {
    const functionName = "getPageChunk";

    try {
      logger.info(
        `Retrieving chunk ${params.chunk_id}.`,
        functionName,
        "GET_CHUNK",
        { chunkId: params.chunk_id, includeNeighbors: params.include_neighbors },
      );

      // Step 1: Get chunk with neighbors
      const chunkData = await repository.getChunkWithNeighbors(
        params.chunk_id,
        params.include_neighbors,
      );

      // Step 2: Throw if not found
      if (chunkData === null) {
        throw new SitesSearchError(
          `Chunk not found: ${params.chunk_id}`,
          { chunkId: params.chunk_id },
        );
      }

      // Step 3: Map to GetPageChunkResult with bounded output
      const result: GetPageChunkResult = {
        chunk_id: chunkData.chunk_id,
        source_id: chunkData.source_id,
        original_page_url: chunkData.page_url,
        title: chunkData.title,
        chunk_excerpt: boundText(chunkData.chunk_text, MAX_CHUNK_EXCERPT_LENGTH) ?? "",
        neighbor_excerpt_before: boundText(chunkData.neighbor_before, MAX_NEIGHBOR_EXCERPT_LENGTH),
        neighbor_excerpt_after: boundText(chunkData.neighbor_after, MAX_NEIGHBOR_EXCERPT_LENGTH),
      };

      logger.info(
        `Chunk ${params.chunk_id} retrieved successfully.`,
        functionName,
        "GET_CHUNK_COMPLETE",
        {
          chunkId: params.chunk_id,
          hasNeighborBefore: !!result.neighbor_excerpt_before,
          hasNeighborAfter: !!result.neighbor_excerpt_after,
        },
      );

      return result;
    } catch (error: unknown) {
      if (error instanceof SitesSearchError) {
        throw error;
      }
      const cause = error instanceof Error ? error.message : String(error);
      throw new SitesSearchError(`Failed to get chunk: ${cause}`, {
        chunkId: params.chunk_id,
      });
    }
  }
  // END_BLOCK_GET_PAGE_CHUNK_M_SITES_SEARCH_004

  return {
    searchSites,
    getPageChunk,
  };
}
