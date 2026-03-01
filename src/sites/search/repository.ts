// FILE: src/sites/search/repository.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Data access layer for persisting curated-site pages, chunks, and embeddings, and for serving hybrid search and chunk lookup queries.
//   SCOPE: Upsert pages/chunks/embeddings via ON CONFLICT, execute hybrid vector+FTS search, and retrieve chunks with neighbors.
//   DEPENDS: M-DB, M-LOGGER
//   LINKS: M-SITES-INDEX-REPOSITORY, M-DB, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SitesIndexRepositoryError - Typed error for repository failures with SITES_INDEX_REPOSITORY_ERROR code.
//   UpsertPageInput - Input for upserting a page record.
//   UpsertChunkInput - Input for upserting a chunk record.
//   UpsertEmbeddingInput - Input for upserting an embedding record.
//   HybridSearchParams - Parameters for hybrid vector+FTS search.
//   SearchResult - Single result from hybrid search.
//   ChunkWithNeighbors - Chunk with optional neighbor chunk texts.
//   SitesIndexRepository - Repository type with upsert, search, and lookup methods.
//   createSitesIndexRepository - Factory that returns a SitesIndexRepository bound to a Drizzle DB handle.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial implementation with upsert, hybrid search, and chunk neighbor lookup.
// END_CHANGE_SUMMARY

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../../logger/index";

// START_BLOCK_DEFINE_ERROR_CLASS_M_SITES_INDEX_REPOSITORY_001
export class SitesIndexRepositoryError extends Error {
  public readonly code: "SITES_INDEX_REPOSITORY_ERROR" = "SITES_INDEX_REPOSITORY_ERROR";
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SitesIndexRepositoryError";
    this.details = details;
  }
}
// END_BLOCK_DEFINE_ERROR_CLASS_M_SITES_INDEX_REPOSITORY_001

// START_BLOCK_DEFINE_INPUT_TYPES_M_SITES_INDEX_REPOSITORY_002
export type UpsertPageInput = {
  source_id: string;
  url: string;
  canonical_url: string;
  title: string;
  text_hash: string;
  http_status: number;
  fetched_at: Date;
};

export type UpsertChunkInput = {
  chunk_id: string;
  chunk_index: number;
  chunk_text: string;
  char_count: number;
  token_estimate: number;
  content_hash: string;
  chunking_version: string;
  index_version: string;
  start_offset: number;
  end_offset: number;
};

export type UpsertEmbeddingInput = {
  chunk_id: string;
  embedding: number[];
  embedding_model: string;
  embedding_version: string;
  index_version: string;
};

export type HybridSearchParams = {
  query_embedding: number[];
  query_text: string;
  index_version: string;
  top_k: number;
  source_ids?: string[];
};
// END_BLOCK_DEFINE_INPUT_TYPES_M_SITES_INDEX_REPOSITORY_002

// START_BLOCK_DEFINE_OUTPUT_TYPES_M_SITES_INDEX_REPOSITORY_003
export type SearchResult = {
  chunk_id: string;
  source_id: string;
  page_url: string;
  title: string;
  snippet: string;
  score: number;
  tier?: number;
  domain?: string;
};

export type ChunkWithNeighbors = {
  chunk_id: string;
  source_id: string;
  page_url: string;
  title: string;
  chunk_text: string;
  chunk_index: number;
  neighbor_before?: string;
  neighbor_after?: string;
};
// END_BLOCK_DEFINE_OUTPUT_TYPES_M_SITES_INDEX_REPOSITORY_003

// START_BLOCK_DEFINE_REPOSITORY_TYPE_M_SITES_INDEX_REPOSITORY_004
export type SitesIndexRepository = {
  upsertPage(page: UpsertPageInput): Promise<string>;
  upsertChunks(pageId: string, chunks: UpsertChunkInput[]): Promise<void>;
  upsertEmbeddings(embeddings: UpsertEmbeddingInput[]): Promise<void>;
  searchHybrid(params: HybridSearchParams): Promise<SearchResult[]>;
  getChunkWithNeighbors(chunkId: string, includeNeighbors: boolean): Promise<ChunkWithNeighbors | null>;
};
// END_BLOCK_DEFINE_REPOSITORY_TYPE_M_SITES_INDEX_REPOSITORY_004

// START_BLOCK_DEFINE_SNIPPET_HELPER_M_SITES_INDEX_REPOSITORY_005
function truncateToSnippet(text: string, maxLen: number = 300): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.slice(0, maxLen) + "...";
}
// END_BLOCK_DEFINE_SNIPPET_HELPER_M_SITES_INDEX_REPOSITORY_005

// START_BLOCK_DEFINE_VECTOR_LITERAL_HELPER_M_SITES_INDEX_REPOSITORY_006
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
// END_BLOCK_DEFINE_VECTOR_LITERAL_HELPER_M_SITES_INDEX_REPOSITORY_006

// START_CONTRACT: createSitesIndexRepository
//   PURPOSE: Factory that returns a SitesIndexRepository bound to a Drizzle DB handle and logger.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Module logger }
//   OUTPUTS: { SitesIndexRepository - Repository with upsert, search, and lookup methods }
//   SIDE_EFFECTS: [none at factory time; methods execute SQL against database]
//   LINKS: [M-SITES-INDEX-REPOSITORY, M-DB, M-LOGGER]
// END_CONTRACT: createSitesIndexRepository
export function createSitesIndexRepository(db: NodePgDatabase, logger: Logger): SitesIndexRepository {
  const moduleName = "SitesIndexRepository";

  // START_BLOCK_UPSERT_PAGE_M_SITES_INDEX_REPOSITORY_007
  // START_CONTRACT: upsertPage
  //   PURPOSE: Insert or update a page record by canonical_url, generating a UUID page_id for new rows.
  //   INPUTS: { page: UpsertPageInput }
  //   OUTPUTS: { Promise<string> - page_id }
  //   SIDE_EFFECTS: [Writes to site_pages table]
  //   LINKS: [M-SITES-INDEX-REPOSITORY, M-DB]
  // END_CONTRACT: upsertPage
  async function upsertPage(page: UpsertPageInput): Promise<string> {
    const functionName = "upsertPage";
    try {
      const pageId = crypto.randomUUID();

      const result = await db.execute(sql`
        INSERT INTO site_pages (page_id, source_id, url, canonical_url, title, text_hash, http_status, fetched_at)
        VALUES (
          ${pageId},
          ${page.source_id},
          ${page.url},
          ${page.canonical_url},
          ${page.title},
          ${page.text_hash},
          ${page.http_status},
          ${page.fetched_at.toISOString()}
        )
        ON CONFLICT (canonical_url) DO UPDATE SET
          url         = EXCLUDED.url,
          title       = EXCLUDED.title,
          text_hash   = EXCLUDED.text_hash,
          http_status = EXCLUDED.http_status,
          fetched_at  = EXCLUDED.fetched_at
        RETURNING page_id
      `);

      const rows = result.rows as Array<{ page_id: string }>;
      const returnedPageId = rows[0]?.page_id ?? pageId;

      logger.info(
        "Page upserted.",
        functionName,
        "UPSERT_PAGE",
        { pageId: returnedPageId, canonicalUrl: page.canonical_url },
      );

      return returnedPageId;
    } catch (error: unknown) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new SitesIndexRepositoryError(`Failed to upsert page: ${cause}`, {
        canonicalUrl: page.canonical_url,
      });
    }
  }
  // END_BLOCK_UPSERT_PAGE_M_SITES_INDEX_REPOSITORY_007

  // START_BLOCK_UPSERT_CHUNKS_M_SITES_INDEX_REPOSITORY_008
  // START_CONTRACT: upsertChunks
  //   PURPOSE: Insert or update chunk records for a given page.
  //   INPUTS: { pageId: string, chunks: UpsertChunkInput[] }
  //   OUTPUTS: { Promise<void> }
  //   SIDE_EFFECTS: [Writes to site_chunks table]
  //   LINKS: [M-SITES-INDEX-REPOSITORY, M-DB]
  // END_CONTRACT: upsertChunks
  async function upsertChunks(pageId: string, chunks: UpsertChunkInput[]): Promise<void> {
    const functionName = "upsertChunks";
    try {
      for (const chunk of chunks) {
        await db.execute(sql`
          INSERT INTO site_chunks (
            chunk_id, page_id, chunk_index, chunk_text, char_count,
            token_estimate, content_hash, chunking_version, index_version,
            start_offset, end_offset
          )
          VALUES (
            ${chunk.chunk_id},
            ${pageId},
            ${chunk.chunk_index},
            ${chunk.chunk_text},
            ${chunk.char_count},
            ${chunk.token_estimate},
            ${chunk.content_hash},
            ${chunk.chunking_version},
            ${chunk.index_version},
            ${chunk.start_offset},
            ${chunk.end_offset}
          )
          ON CONFLICT (chunk_id) DO UPDATE SET
            page_id          = EXCLUDED.page_id,
            chunk_index      = EXCLUDED.chunk_index,
            chunk_text       = EXCLUDED.chunk_text,
            char_count       = EXCLUDED.char_count,
            token_estimate   = EXCLUDED.token_estimate,
            content_hash     = EXCLUDED.content_hash,
            chunking_version = EXCLUDED.chunking_version,
            index_version    = EXCLUDED.index_version,
            start_offset     = EXCLUDED.start_offset,
            end_offset       = EXCLUDED.end_offset
        `);
      }

      logger.info(
        `Upserted ${chunks.length} chunks.`,
        functionName,
        "UPSERT_CHUNKS",
        { pageId, chunkCount: chunks.length },
      );
    } catch (error: unknown) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new SitesIndexRepositoryError(`Failed to upsert chunks: ${cause}`, {
        pageId,
        chunkCount: chunks.length,
      });
    }
  }
  // END_BLOCK_UPSERT_CHUNKS_M_SITES_INDEX_REPOSITORY_008

  // START_BLOCK_UPSERT_EMBEDDINGS_M_SITES_INDEX_REPOSITORY_009
  // START_CONTRACT: upsertEmbeddings
  //   PURPOSE: Insert or update embedding records for chunks.
  //   INPUTS: { embeddings: UpsertEmbeddingInput[] }
  //   OUTPUTS: { Promise<void> }
  //   SIDE_EFFECTS: [Writes to site_chunk_embeddings table]
  //   LINKS: [M-SITES-INDEX-REPOSITORY, M-DB]
  // END_CONTRACT: upsertEmbeddings
  async function upsertEmbeddings(embeddings: UpsertEmbeddingInput[]): Promise<void> {
    const functionName = "upsertEmbeddings";
    try {
      for (const emb of embeddings) {
        const vectorLiteral = toVectorLiteral(emb.embedding);
        await db.execute(sql`
          INSERT INTO site_chunk_embeddings (
            chunk_id, embedding, embedding_model, embedding_version, index_version, embedded_at
          )
          VALUES (
            ${emb.chunk_id},
            ${vectorLiteral}::vector,
            ${emb.embedding_model},
            ${emb.embedding_version},
            ${emb.index_version},
            NOW()
          )
          ON CONFLICT (chunk_id) DO UPDATE SET
            embedding         = EXCLUDED.embedding,
            embedding_model   = EXCLUDED.embedding_model,
            embedding_version = EXCLUDED.embedding_version,
            index_version     = EXCLUDED.index_version,
            embedded_at       = EXCLUDED.embedded_at
        `);
      }

      logger.info(
        `Upserted ${embeddings.length} embeddings.`,
        functionName,
        "UPSERT_EMBEDDINGS",
        { count: embeddings.length },
      );
    } catch (error: unknown) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new SitesIndexRepositoryError(`Failed to upsert embeddings: ${cause}`, {
        count: embeddings.length,
      });
    }
  }
  // END_BLOCK_UPSERT_EMBEDDINGS_M_SITES_INDEX_REPOSITORY_009

  // START_BLOCK_SEARCH_HYBRID_M_SITES_INDEX_REPOSITORY_010
  // START_CONTRACT: searchHybrid
  //   PURPOSE: Execute hybrid vector similarity + full-text search across indexed site chunks.
  //   INPUTS: { params: HybridSearchParams }
  //   OUTPUTS: { Promise<SearchResult[]> - Ranked search results }
  //   SIDE_EFFECTS: [Reads from site_chunks, site_chunk_embeddings, site_pages, site_sources]
  //   LINKS: [M-SITES-INDEX-REPOSITORY, M-DB]
  // END_CONTRACT: searchHybrid
  async function searchHybrid(params: HybridSearchParams): Promise<SearchResult[]> {
    const functionName = "searchHybrid";
    try {
      const vectorLiteral = toVectorLiteral(params.query_embedding);
      const hasSourceFilter = params.source_ids && params.source_ids.length > 0;

      let result;

      if (hasSourceFilter) {
        result = await db.execute(sql`
          SELECT
            sc.chunk_id,
            sp.source_id,
            sp.url AS page_url,
            sp.title,
            sc.chunk_text,
            (1 - (sce.embedding <=> ${vectorLiteral}::vector)) AS vector_score,
            ts_rank(to_tsvector('simple', sc.chunk_text), plainto_tsquery('simple', ${params.query_text})) AS fts_score,
            (0.7 * (1 - (sce.embedding <=> ${vectorLiteral}::vector)) + 0.3 * ts_rank(to_tsvector('simple', sc.chunk_text), plainto_tsquery('simple', ${params.query_text}))) AS combined_score,
            ss.tier,
            ss.domain
          FROM site_chunks sc
          JOIN site_chunk_embeddings sce ON sce.chunk_id = sc.chunk_id
          JOIN site_pages sp ON sp.page_id = sc.page_id
          JOIN site_sources ss ON ss.source_id = sp.source_id
          WHERE sc.index_version = ${params.index_version}
            AND sp.source_id = ANY(${params.source_ids!})
          ORDER BY combined_score DESC
          LIMIT ${params.top_k}
        `);
      } else {
        result = await db.execute(sql`
          SELECT
            sc.chunk_id,
            sp.source_id,
            sp.url AS page_url,
            sp.title,
            sc.chunk_text,
            (1 - (sce.embedding <=> ${vectorLiteral}::vector)) AS vector_score,
            ts_rank(to_tsvector('simple', sc.chunk_text), plainto_tsquery('simple', ${params.query_text})) AS fts_score,
            (0.7 * (1 - (sce.embedding <=> ${vectorLiteral}::vector)) + 0.3 * ts_rank(to_tsvector('simple', sc.chunk_text), plainto_tsquery('simple', ${params.query_text}))) AS combined_score,
            ss.tier,
            ss.domain
          FROM site_chunks sc
          JOIN site_chunk_embeddings sce ON sce.chunk_id = sc.chunk_id
          JOIN site_pages sp ON sp.page_id = sc.page_id
          JOIN site_sources ss ON ss.source_id = sp.source_id
          WHERE sc.index_version = ${params.index_version}
          ORDER BY combined_score DESC
          LIMIT ${params.top_k}
        `);
      }

      const rows = result.rows as Array<{
        chunk_id: string;
        source_id: string;
        page_url: string;
        title: string;
        chunk_text: string;
        combined_score: number;
        tier: number;
        domain: string;
      }>;

      const results: SearchResult[] = rows.map((row) => ({
        chunk_id: row.chunk_id,
        source_id: row.source_id,
        page_url: row.page_url,
        title: row.title ?? "",
        snippet: truncateToSnippet(row.chunk_text),
        score: Number(row.combined_score),
        tier: row.tier != null ? Number(row.tier) : undefined,
        domain: row.domain ?? undefined,
      }));

      logger.info(
        `Hybrid search returned ${results.length} results.`,
        functionName,
        "SEARCH_HYBRID",
        { resultCount: results.length, topK: params.top_k, indexVersion: params.index_version },
      );

      return results;
    } catch (error: unknown) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new SitesIndexRepositoryError(`Hybrid search failed: ${cause}`, {
        indexVersion: params.index_version,
        topK: params.top_k,
      });
    }
  }
  // END_BLOCK_SEARCH_HYBRID_M_SITES_INDEX_REPOSITORY_010

  // START_BLOCK_GET_CHUNK_WITH_NEIGHBORS_M_SITES_INDEX_REPOSITORY_011
  // START_CONTRACT: getChunkWithNeighbors
  //   PURPOSE: Retrieve a chunk by ID, optionally including neighbor chunk texts (chunk_index +/- 1 from same page).
  //   INPUTS: { chunkId: string, includeNeighbors: boolean }
  //   OUTPUTS: { Promise<ChunkWithNeighbors | null> }
  //   SIDE_EFFECTS: [Reads from site_chunks, site_pages]
  //   LINKS: [M-SITES-INDEX-REPOSITORY, M-DB]
  // END_CONTRACT: getChunkWithNeighbors
  async function getChunkWithNeighbors(
    chunkId: string,
    includeNeighbors: boolean,
  ): Promise<ChunkWithNeighbors | null> {
    const functionName = "getChunkWithNeighbors";
    try {
      // Fetch the target chunk with page info
      const chunkResult = await db.execute(sql`
        SELECT
          sc.chunk_id,
          sc.page_id,
          sc.chunk_index,
          sc.chunk_text,
          sp.source_id,
          sp.url AS page_url,
          sp.title
        FROM site_chunks sc
        JOIN site_pages sp ON sp.page_id = sc.page_id
        WHERE sc.chunk_id = ${chunkId}
      `);

      const chunkRows = chunkResult.rows as Array<{
        chunk_id: string;
        page_id: string;
        chunk_index: number;
        chunk_text: string;
        source_id: string;
        page_url: string;
        title: string;
      }>;

      if (chunkRows.length === 0) {
        return null;
      }

      const chunk = chunkRows[0];
      let neighborBefore: string | undefined;
      let neighborAfter: string | undefined;

      if (includeNeighbors) {
        const neighborsResult = await db.execute(sql`
          SELECT chunk_index, chunk_text
          FROM site_chunks
          WHERE page_id = ${chunk.page_id}
            AND chunk_index IN (${chunk.chunk_index - 1}, ${chunk.chunk_index + 1})
          ORDER BY chunk_index ASC
        `);

        const neighborRows = neighborsResult.rows as Array<{
          chunk_index: number;
          chunk_text: string;
        }>;

        for (const neighbor of neighborRows) {
          if (neighbor.chunk_index === chunk.chunk_index - 1) {
            neighborBefore = neighbor.chunk_text;
          } else if (neighbor.chunk_index === chunk.chunk_index + 1) {
            neighborAfter = neighbor.chunk_text;
          }
        }
      }

      logger.info(
        "Chunk retrieved with neighbors.",
        functionName,
        "GET_CHUNK_WITH_NEIGHBORS",
        { chunkId, includeNeighbors, hasNeighborBefore: !!neighborBefore, hasNeighborAfter: !!neighborAfter },
      );

      return {
        chunk_id: chunk.chunk_id,
        source_id: chunk.source_id,
        page_url: chunk.page_url,
        title: chunk.title ?? "",
        chunk_text: chunk.chunk_text,
        chunk_index: Number(chunk.chunk_index),
        neighbor_before: neighborBefore,
        neighbor_after: neighborAfter,
      };
    } catch (error: unknown) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new SitesIndexRepositoryError(`Failed to get chunk with neighbors: ${cause}`, {
        chunkId,
      });
    }
  }
  // END_BLOCK_GET_CHUNK_WITH_NEIGHBORS_M_SITES_INDEX_REPOSITORY_011

  return {
    upsertPage,
    upsertChunks,
    upsertEmbeddings,
    searchHybrid,
    getChunkWithNeighbors,
  };
}
