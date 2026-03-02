// FILE: src/sites/chunking/index.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Deterministic structural + token split chunking for curated site text.
//   SCOPE: Split cleaned page text into ordered chunks using markdown structure, sentence boundaries, and token-based sizing.
//   DEPENDS: M-LOGGER
//   LINKS: M-SITES-CHUNKER, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   PageChunk - Typed chunk record with index, text, offsets, and token estimate.
//   SitesChunkerError - Typed error for chunker failures with SITES_CHUNKER_ERROR code.
//   CHUNKING_VERSION - Semantic version tag for the chunking algorithm.
//   CHUNKING_CONFIG - Fixed configuration constants for chunk sizing and overlap.
//   chunkPage - Split cleaned page text into deterministic ordered chunks.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial implementation with structural splitting, tiny-segment merging, oversized splitting, and token estimation.
// END_CHANGE_SUMMARY

import type { Logger } from "../../logger/index";

// START_BLOCK_DEFINE_PAGE_CHUNK_TYPE_M_SITES_CHUNKER_001
export type PageChunk = {
  chunk_index: number;
  chunk_text: string;
  char_count: number;
  token_estimate: number;
  start_offset: number;
  end_offset: number;
};
// END_BLOCK_DEFINE_PAGE_CHUNK_TYPE_M_SITES_CHUNKER_001

// START_BLOCK_DEFINE_SITES_CHUNKER_ERROR_M_SITES_CHUNKER_002
export class SitesChunkerError extends Error {
  public readonly code: "SITES_CHUNKER_ERROR" = "SITES_CHUNKER_ERROR";
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SitesChunkerError";
    this.details = details;
  }
}
// END_BLOCK_DEFINE_SITES_CHUNKER_ERROR_M_SITES_CHUNKER_002

// START_BLOCK_DEFINE_CHUNKING_VERSION_M_SITES_CHUNKER_003
export const CHUNKING_VERSION = "v1" as const;
// END_BLOCK_DEFINE_CHUNKING_VERSION_M_SITES_CHUNKER_003

// START_BLOCK_DEFINE_CHUNKING_CONFIG_M_SITES_CHUNKER_004
export const CHUNKING_CONFIG = {
  target_tokens: 450,
  max_tokens: 650,
  overlap_tokens: 80,
  min_merge_tokens: 120,
} as const;
// END_BLOCK_DEFINE_CHUNKING_CONFIG_M_SITES_CHUNKER_004

// START_CONTRACT: estimateTokens
//   PURPOSE: Estimate token count from character length using a character-based approximation.
//   INPUTS: { text: string - Text to estimate tokens for }
//   OUTPUTS: { number - Estimated token count }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-CHUNKER]
// END_CONTRACT: estimateTokens
// TODO: Switch to tiktoken in v2 for accurate token counting. This v1 approximation uses ~4 chars per token.
function estimateTokens(text: string): number {
  // START_BLOCK_ESTIMATE_TOKENS_M_SITES_CHUNKER_005
  return Math.ceil(text.length / 4);
  // END_BLOCK_ESTIMATE_TOKENS_M_SITES_CHUNKER_005
}

// START_CONTRACT: structuralSplit
//   PURPOSE: Split text into structural segments by markdown headers and double newlines (paragraph breaks).
//   INPUTS: { text: string - Cleaned page text }
//   OUTPUTS: { { text: string; startOffset: number }[] - Ordered segments with their start offsets }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-CHUNKER]
// END_CONTRACT: structuralSplit
function structuralSplit(
  text: string,
): { text: string; startOffset: number }[] {
  // START_BLOCK_STRUCTURAL_SPLIT_M_SITES_CHUNKER_006
  // Split on markdown headers (lines starting with #) or double newlines (paragraph breaks).
  // We use a regex that matches either a markdown header line or a double-newline boundary.
  // The split points are: just before a markdown header line, or at a double newline.
  const segments: { text: string; startOffset: number }[] = [];

  // Split by double-newline first, then further split if a segment contains markdown headers.
  // Strategy: find all split boundaries (double newlines and lines beginning with #).
  // Use a regex to split at boundaries: \n\n or \n(?=#)
  const parts = text.split(/\n\n+/);

  let currentOffset = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) continue;

    // Further split on markdown headers within this part.
    // A header starts at the beginning of a line with one or more #.
    const headerSplitParts = splitOnHeaders(part);

    for (const hsPart of headerSplitParts) {
      if (hsPart.length > 0) {
        // Find the actual start offset in the original text
        const actualOffset = text.indexOf(hsPart, currentOffset);
        segments.push({
          text: hsPart,
          startOffset: actualOffset >= 0 ? actualOffset : currentOffset,
        });
        if (actualOffset >= 0) {
          currentOffset = actualOffset + hsPart.length;
        }
      }
    }
  }

  return segments;
  // END_BLOCK_STRUCTURAL_SPLIT_M_SITES_CHUNKER_006
}

// START_CONTRACT: splitOnHeaders
//   PURPOSE: Split a text block on markdown header boundaries (lines starting with #).
//   INPUTS: { text: string - Text block that may contain headers }
//   OUTPUTS: { string[] - Sub-blocks split at header boundaries }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-CHUNKER]
// END_CONTRACT: splitOnHeaders
function splitOnHeaders(text: string): string[] {
  // START_BLOCK_SPLIT_ON_HEADERS_M_SITES_CHUNKER_007
  // Split just before lines that start with #, keeping the header with the content that follows it.
  const results: string[] = [];
  const lines = text.split("\n");
  let currentBlock: string[] = [];

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && currentBlock.length > 0) {
      // Push accumulated block and start new one with this header
      results.push(currentBlock.join("\n"));
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    results.push(currentBlock.join("\n"));
  }

  return results;
  // END_BLOCK_SPLIT_ON_HEADERS_M_SITES_CHUNKER_007
}

// START_CONTRACT: mergeTinySegments
//   PURPOSE: Merge segments with fewer than min_merge_tokens into adjacent segments.
//   INPUTS: { segments: { text: string; startOffset: number }[] - Structural segments }
//   OUTPUTS: { { text: string; startOffset: number }[] - Merged segments }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-CHUNKER]
// END_CONTRACT: mergeTinySegments
function mergeTinySegments(
  segments: { text: string; startOffset: number }[],
): { text: string; startOffset: number }[] {
  // START_BLOCK_MERGE_TINY_SEGMENTS_M_SITES_CHUNKER_008
  if (segments.length <= 1) {
    return segments;
  }

  const merged: { text: string; startOffset: number }[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === undefined) continue;
    const tokens = estimateTokens(seg.text);

    if (tokens < CHUNKING_CONFIG.min_merge_tokens && merged.length > 0) {
      // Merge with previous segment
      const prev = merged[merged.length - 1];
      if (prev !== undefined) {
        prev.text = prev.text + "\n\n" + seg.text;
      }
    } else if (
      tokens < CHUNKING_CONFIG.min_merge_tokens &&
      merged.length === 0 &&
      i < segments.length - 1
    ) {
      // First segment is tiny: merge with next by prepending to next
      const next = segments[i + 1];
      if (next !== undefined) {
        segments[i + 1] = {
          text: seg.text + "\n\n" + next.text,
          startOffset: seg.startOffset,
        };
      }
    } else {
      merged.push({ text: seg.text, startOffset: seg.startOffset });
    }
  }

  return merged;
  // END_BLOCK_MERGE_TINY_SEGMENTS_M_SITES_CHUNKER_008
}

// START_CONTRACT: splitAtSentences
//   PURPOSE: Split a text block at sentence boundaries (. ! ? followed by space or newline).
//   INPUTS: { text: string - Oversized text block }
//   OUTPUTS: { string[] - Sentence-boundary sub-blocks }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-CHUNKER]
// END_CONTRACT: splitAtSentences
function splitAtSentences(text: string): string[] {
  // START_BLOCK_SPLIT_AT_SENTENCES_M_SITES_CHUNKER_009
  // Split after sentence-ending punctuation followed by whitespace.
  const parts = text.split(/(?<=[.!?])(?:\s+)/);
  return parts.filter((p) => p.length > 0);
  // END_BLOCK_SPLIT_AT_SENTENCES_M_SITES_CHUNKER_009
}

// START_CONTRACT: splitAtWords
//   PURPOSE: Split text at word boundaries to produce chunks under max token count.
//   INPUTS: { text: string - Oversized sentence, maxTokens: number - Maximum tokens per chunk }
//   OUTPUTS: { string[] - Word-boundary sub-blocks }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-CHUNKER]
// END_CONTRACT: splitAtWords
function splitAtWords(text: string, maxTokens: number): string[] {
  // START_BLOCK_SPLIT_AT_WORDS_M_SITES_CHUNKER_010
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let currentWords: string[] = [];

  for (const word of words) {
    currentWords.push(word);
    const currentText = currentWords.join(" ");
    if (estimateTokens(currentText) >= maxTokens) {
      // Remove last word and push chunk
      if (currentWords.length > 1) {
        currentWords.pop();
        chunks.push(currentWords.join(" "));
        currentWords = [word];
      } else {
        // Single word exceeds max — push it anyway
        chunks.push(currentText);
        currentWords = [];
      }
    }
  }

  if (currentWords.length > 0) {
    chunks.push(currentWords.join(" "));
  }

  return chunks;
  // END_BLOCK_SPLIT_AT_WORDS_M_SITES_CHUNKER_010
}

// START_CONTRACT: splitOversizedSegment
//   PURPOSE: Split an oversized segment into sub-chunks that fit within max_tokens, applying overlap on forced splits.
//   INPUTS: { text: string - Oversized segment text, logger: Logger }
//   OUTPUTS: { string[] - Sub-chunks within size limits }
//   SIDE_EFFECTS: [Logs warning when chunk still exceeds max_tokens after all splitting attempts]
//   LINKS: [M-SITES-CHUNKER, M-LOGGER]
// END_CONTRACT: splitOversizedSegment
function splitOversizedSegment(text: string, logger: Logger): string[] {
  // START_BLOCK_SPLIT_OVERSIZED_SEGMENT_M_SITES_CHUNKER_011
  const functionName = "splitOversizedSegment";

  // Try sentence-level splitting first
  const sentences = splitAtSentences(text);
  const chunks: string[] = [];
  let accumulator: string[] = [];

  for (const sentence of sentences) {
    const candidateText =
      accumulator.length > 0
        ? accumulator.join(" ") + " " + sentence
        : sentence;

    if (estimateTokens(candidateText) > CHUNKING_CONFIG.max_tokens) {
      // Push accumulated if non-empty
      if (accumulator.length > 0) {
        chunks.push(accumulator.join(" "));
      }

      // Check if single sentence is oversized
      if (estimateTokens(sentence) > CHUNKING_CONFIG.max_tokens) {
        // Split at word boundaries
        const wordChunks = splitAtWords(sentence, CHUNKING_CONFIG.max_tokens);
        chunks.push(...wordChunks);
      } else {
        accumulator = [sentence];
        continue;
      }
      accumulator = [];
    } else {
      accumulator.push(sentence);
    }
  }

  if (accumulator.length > 0) {
    chunks.push(accumulator.join(" "));
  }

  // Apply overlap on forced splits
  const overlappedChunks = applyOverlap(chunks);

  // Warn about any chunks still exceeding max_tokens
  for (let i = 0; i < overlappedChunks.length; i++) {
    const chunk = overlappedChunks[i];
    if (chunk === undefined) continue;
    const tokens = estimateTokens(chunk);
    if (tokens > CHUNKING_CONFIG.max_tokens) {
      logger.warn(
        `Chunk still exceeds max_tokens after splitting: ${tokens} estimated tokens.`,
        functionName,
        "WARN_OVERSIZED_CHUNK",
        { chunkIndex: i, tokenEstimate: tokens },
      );
    }
  }

  return overlappedChunks;
  // END_BLOCK_SPLIT_OVERSIZED_SEGMENT_M_SITES_CHUNKER_011
}

// START_CONTRACT: applyOverlap
//   PURPOSE: Apply token overlap between consecutive forced-split chunks.
//   INPUTS: { chunks: string[] - Forced-split chunks }
//   OUTPUTS: { string[] - Chunks with overlap applied }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-CHUNKER]
// END_CONTRACT: applyOverlap
function applyOverlap(chunks: string[]): string[] {
  // START_BLOCK_APPLY_OVERLAP_M_SITES_CHUNKER_012
  if (chunks.length <= 1) {
    return chunks;
  }

  const overlapChars = CHUNKING_CONFIG.overlap_tokens * 4; // Convert token estimate back to chars
  const firstChunk = chunks[0];
  if (firstChunk === undefined) return chunks;
  const result: string[] = [firstChunk];

  for (let i = 1; i < chunks.length; i++) {
    const prevChunk = chunks[i - 1];
    const currentChunk = chunks[i];
    if (prevChunk === undefined || currentChunk === undefined) continue;
    // Take the tail of the previous chunk as overlap prefix
    const overlapText =
      prevChunk.length > overlapChars
        ? prevChunk.slice(prevChunk.length - overlapChars)
        : prevChunk;

    // Find a clean word boundary for the overlap
    const wordBoundary = overlapText.indexOf(" ");
    const cleanOverlap =
      wordBoundary >= 0 ? overlapText.slice(wordBoundary + 1) : overlapText;

    result.push(cleanOverlap + " " + currentChunk);
  }

  return result;
  // END_BLOCK_APPLY_OVERLAP_M_SITES_CHUNKER_012
}

// START_CONTRACT: findOffsetInOriginal
//   PURPOSE: Find the start offset of a chunk text within the original text, searching from a given position.
//   INPUTS: { original: string - Full original text, chunkText: string - Chunk to locate, searchFrom: number - Position to search from }
//   OUTPUTS: { number - Start offset in original, or searchFrom if not found }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-CHUNKER]
// END_CONTRACT: findOffsetInOriginal
function findOffsetInOriginal(
  original: string,
  chunkText: string,
  searchFrom: number,
): number {
  // START_BLOCK_FIND_OFFSET_IN_ORIGINAL_M_SITES_CHUNKER_013
  // For chunks produced by splitting (which may have overlap or joined separators),
  // try to find the core content. Use the first 60 chars as a search anchor.
  const anchor = chunkText.slice(0, 60);
  const idx = original.indexOf(anchor, searchFrom);
  return idx >= 0 ? idx : searchFrom;
  // END_BLOCK_FIND_OFFSET_IN_ORIGINAL_M_SITES_CHUNKER_013
}

// START_CONTRACT: chunkPage
//   PURPOSE: Split cleaned page text into deterministic ordered chunks suitable for embedding and storage.
//   INPUTS: { text: string - Cleaned page text, logger: Logger - Module logger }
//   OUTPUTS: { PageChunk[] - Ordered chunks with offsets and token estimates }
//   SIDE_EFFECTS: [Logs warnings for oversized chunks that could not be split below max_tokens]
//   LINKS: [M-SITES-CHUNKER, M-LOGGER]
// END_CONTRACT: chunkPage
export function chunkPage(text: string, logger: Logger): PageChunk[] {
  // START_BLOCK_CHUNK_PAGE_MAIN_M_SITES_CHUNKER_014

  // Empty text returns empty array (not an error)
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Step 1: Structural split
  let segments = structuralSplit(text);

  // Handle edge case: no segments produced
  if (segments.length === 0) {
    return [];
  }

  // Step 2: Merge tiny segments
  segments = mergeTinySegments(segments);

  // Step 3: Split oversized segments and assemble final chunk texts
  const finalChunkTexts: string[] = [];

  for (const segment of segments) {
    const tokens = estimateTokens(segment.text);

    if (tokens > CHUNKING_CONFIG.max_tokens) {
      // Split oversized segment
      const subChunks = splitOversizedSegment(segment.text, logger);
      finalChunkTexts.push(...subChunks);
    } else {
      finalChunkTexts.push(segment.text);
    }
  }

  // Step 4: Build PageChunk records with offsets
  const chunks: PageChunk[] = [];
  let searchFrom = 0;

  for (let i = 0; i < finalChunkTexts.length; i++) {
    const chunkText = finalChunkTexts[i];
    if (chunkText === undefined) continue;
    const startOffset = findOffsetInOriginal(text, chunkText, searchFrom);
    const endOffset = startOffset + chunkText.length;

    chunks.push({
      chunk_index: i,
      chunk_text: chunkText,
      char_count: chunkText.length,
      token_estimate: estimateTokens(chunkText),
      start_offset: startOffset,
      end_offset: endOffset,
    });

    // Advance search position (but not past the end of text)
    searchFrom = Math.min(startOffset + 1, text.length);
  }

  return chunks;
  // END_BLOCK_CHUNK_PAGE_MAIN_M_SITES_CHUNKER_014
}
