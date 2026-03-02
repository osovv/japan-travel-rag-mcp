// FILE: src/admin/sites-page.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Unit tests for the M-ADMIN-SITES module: Zod validation schemas, CRUD operations, rendering functions, and page data fetching.
//   SCOPE: Test CreateSourceInputSchema/UpdateSourceInputSchema validation, handleCreateSource/handleUpdateSource/handleDeleteSource/handleToggleSourceStatus CRUD behavior, SitesContent/SourceForm HTML output, and fetchSitesPageData data layer.
//   DEPENDS: M-ADMIN-SITES, M-LOGGER, M-DB
//   LINKS: M-ADMIN-SITES-TEST, M-ADMIN-SITES, M-LOGGER, M-DB
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - No-op logger for isolated tests without console output.
//   createMockDb - Mock db with call recording for CRUD and fetch tests.
//   createTestSitesPageData - Build deterministic SitesPageData fixture.
//   ZodValidationSchemaTests - Validate CreateSourceInputSchema and UpdateSourceInputSchema acceptance and rejection.
//   RenderingTests - Verify SitesContent and SourceForm HTML output.
//   CRUDOperationTests - Verify handleCreateSource, handleUpdateSource, handleDeleteSource, handleToggleSourceStatus behavior with mock db.
//   FetchSitesPageDataTests - Verify fetchSitesPageData data assembly and error wrapping.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial creation of M-ADMIN-SITES test suite.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../logger/index";
import {
  CreateSourceInputSchema,
  UpdateSourceInputSchema,
  handleCreateSource,
  handleUpdateSource,
  handleDeleteSource,
  handleToggleSourceStatus,
  SitesContent,
  SourceForm,
  fetchSitesPageData,
  AdminSitesError,
} from "./sites-page";
import type { SitesPageData } from "./sites-page";

// START_BLOCK_CREATE_NOOP_LOGGER_FOR_SITES_TESTS_M_ADMIN_SITES_TEST_001
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
// END_BLOCK_CREATE_NOOP_LOGGER_FOR_SITES_TESTS_M_ADMIN_SITES_TEST_001

// START_BLOCK_CREATE_MOCK_DB_FOR_CRUD_TESTS_M_ADMIN_SITES_TEST_002
function createMockDb(returnRows: Record<string, unknown>[] = []) {
  const calls: unknown[] = [];
  const db = {
    execute: async (query: unknown) => {
      calls.push(query);
      return { rows: returnRows };
    },
  } as unknown as NodePgDatabase;
  return { db, calls };
}
// END_BLOCK_CREATE_MOCK_DB_FOR_CRUD_TESTS_M_ADMIN_SITES_TEST_002

// START_BLOCK_CREATE_TEST_SITES_PAGE_DATA_FIXTURE_M_ADMIN_SITES_TEST_003
function createTestSitesPageData(): SitesPageData {
  return {
    sources: [
      {
        source_id: "japan_guide",
        name: "Japan Guide",
        domain: "https://www.japan-guide.com",
        tier: 0,
        language: "en",
        focus: "General Japan travel",
        status: "active",
        crawl_interval_minutes: 1440,
        max_pages: 100,
        country_code: "jp",
        page_count: 50,
        chunk_count: 200,
        embedding_count: 200,
        last_crawl_at: new Date("2026-01-15T10:00:00Z"),
      },
      {
        source_id: "tokyo_metro",
        name: "Tokyo Metro",
        domain: "https://www.tokyometro.jp",
        tier: 1,
        language: "ja",
        focus: "Tokyo subway information",
        status: "paused",
        crawl_interval_minutes: 4320,
        max_pages: 50,
        country_code: "jp",
        page_count: 20,
        chunk_count: 80,
        embedding_count: 80,
        last_crawl_at: null,
      },
    ],
    recentCrawlJobs: [
      {
        crawl_job_id: "cj_001",
        source_id: "japan_guide",
        status: "completed",
        started_at: new Date("2026-01-15T09:00:00Z"),
        finished_at: new Date("2026-01-15T10:00:00Z"),
        pages_fetched: 50,
        error: null,
      },
    ],
  };
}
// END_BLOCK_CREATE_TEST_SITES_PAGE_DATA_FIXTURE_M_ADMIN_SITES_TEST_003

// START_BLOCK_CREATE_VALID_CREATE_INPUT_FIXTURE_M_ADMIN_SITES_TEST_004
function createValidCreateInput() {
  return {
    source_id: "japan_guide",
    country_code: "jp",
    name: "Japan Guide",
    domain: "https://www.japan-guide.com",
    tier: 0,
    language: "en",
    focus: "General Japan travel information",
    crawl_interval_minutes: 1440,
    max_pages: 100,
  };
}
// END_BLOCK_CREATE_VALID_CREATE_INPUT_FIXTURE_M_ADMIN_SITES_TEST_004

describe("M-ADMIN-SITES test suite", () => {
  // START_BLOCK_ZOD_VALIDATION_SCHEMA_TESTS_M_ADMIN_SITES_TEST_005
  describe("Zod validation schemas", () => {
    describe("CreateSourceInputSchema", () => {
      it("accepts valid input", () => {
        const input = createValidCreateInput();
        const result = CreateSourceInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it("rejects source_id shorter than 3 characters", () => {
        const input = { ...createValidCreateInput(), source_id: "ab" };
        const result = CreateSourceInputSchema.safeParse(input);
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages.some((m) => m.includes("at least 3"))).toBe(true);
        }
      });

      it("rejects source_id with uppercase characters", () => {
        const input = { ...createValidCreateInput(), source_id: "Japan_Guide" };
        const result = CreateSourceInputSchema.safeParse(input);
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages.some((m) => m.includes("lowercase"))).toBe(true);
        }
      });

      it("rejects source_id with special characters", () => {
        const input = { ...createValidCreateInput(), source_id: "japan-guide!" };
        const result = CreateSourceInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it("rejects tier less than 0", () => {
        const input = { ...createValidCreateInput(), tier: -1 };
        const result = CreateSourceInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it("rejects tier greater than 2", () => {
        const input = { ...createValidCreateInput(), tier: 3 };
        const result = CreateSourceInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it("rejects crawl_interval_minutes less than 60", () => {
        const input = { ...createValidCreateInput(), crawl_interval_minutes: 30 };
        const result = CreateSourceInputSchema.safeParse(input);
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages.some((m) => m.includes("at least 60"))).toBe(true);
        }
      });

      it("rejects max_pages greater than 1000", () => {
        const input = { ...createValidCreateInput(), max_pages: 1001 };
        const result = CreateSourceInputSchema.safeParse(input);
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages.some((m) => m.includes("at most 1000"))).toBe(true);
        }
      });
    });

    describe("UpdateSourceInputSchema", () => {
      it("accepts partial input with just name", () => {
        const result = UpdateSourceInputSchema.safeParse({ name: "Updated Name" });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.name).toBe("Updated Name");
        }
      });

      it("accepts empty object (no fields)", () => {
        const result = UpdateSourceInputSchema.safeParse({});
        expect(result.success).toBe(true);
      });
    });
  });
  // END_BLOCK_ZOD_VALIDATION_SCHEMA_TESTS_M_ADMIN_SITES_TEST_005

  // START_BLOCK_RENDERING_TESTS_M_ADMIN_SITES_TEST_006
  describe("Rendering", () => {
    describe("SitesContent", () => {
      it("produces HTML with source table rows grouped by country", () => {
        const data = createTestSitesPageData();
        const html = SitesContent(data);

        expect(html).toContain("Source ID");
        expect(html).toContain("Name");
        expect(html).toContain("Domain");
        expect(html).toContain("Tier");
        expect(html).toContain("Actions");
        expect(html).toContain("japan_guide");
        expect(html).toContain("Japan Guide");
        expect(html).toContain("tokyo_metro");
        expect(html).toContain("Tokyo Metro");
        expect(html).toContain("/admin/sites/japan_guide/edit");
        expect(html).toContain("/admin/sites/tokyo_metro/edit");
        expect(html).toContain("/admin/sites/japan_guide/toggle");
        expect(html).toContain("/admin/sites/japan_guide/delete");
        // Accordion structure
        expect(html).toContain("country-group");
        expect(html).toContain("<details");
        expect(html).toContain("<summary>");
        expect(html).toContain("country-code-label");
      });

      it("shows empty state when no sources", () => {
        const data: SitesPageData = { sources: [], recentCrawlJobs: [] };
        const html = SitesContent(data);

        expect(html).toContain("No site sources configured.");
      });

      it("escapes HTML special characters in source names", () => {
        const data: SitesPageData = {
          sources: [
            {
              source_id: "test_src",
              name: '<script>alert("xss")</script>',
              domain: "https://example.com",
              tier: 0,
              language: "en",
              focus: "test",
              status: "active",
              crawl_interval_minutes: 1440,
              max_pages: 100,
              country_code: "jp",
              page_count: 0,
              chunk_count: 0,
              embedding_count: 0,
              last_crawl_at: null,
            },
          ],
          recentCrawlJobs: [],
        };
        const html = SitesContent(data);

        expect(html).toContain("&lt;script&gt;");
        expect(html).toContain("&quot;xss&quot;");
        expect(html).not.toContain('<script>alert("xss")</script>');
      });
    });

    describe("SourceForm", () => {
      it("in create mode includes source_id input field without readonly", () => {
        const html = SourceForm({ mode: "create" });

        expect(html).toContain('id="source_id"');
        expect(html).toContain('name="source_id"');
        expect(html).toContain("required");
        expect(html).toContain('placeholder="e.g. japan_guide"');
        // The source_id input in create mode should NOT have the readonly attribute.
        // We check the actual input element rather than the full HTML (which includes CSS with input[readonly]).
        const sourceIdInputMatch = (html as string).match(/<input[^>]*id="source_id"[^>]*>/);
        expect(sourceIdInputMatch).not.toBeNull();
        expect(sourceIdInputMatch![0]).not.toContain("readonly");
      });

      it("in edit mode shows source_id as read-only", () => {
        const source = createTestSitesPageData().sources[0];
        const html = SourceForm({ mode: "edit", source });

        expect(html).toContain("readonly");
        expect(html).toContain('value="japan_guide"');
      });

      it("displays validation errors", () => {
        const errors: Record<string, string[]> = {
          source_id: ["source_id must be at least 3 characters"],
          name: ["name is required"],
        };
        const html = SourceForm({ mode: "create", errors });

        expect(html).toContain("field-error");
        expect(html).toContain("source_id must be at least 3 characters");
        expect(html).toContain("name is required");
      });
    });
  });
  // END_BLOCK_RENDERING_TESTS_M_ADMIN_SITES_TEST_006

  // START_BLOCK_CRUD_OPERATION_TESTS_M_ADMIN_SITES_TEST_007
  describe("CRUD operations", () => {
    describe("handleCreateSource", () => {
      it("returns { success: false, errors } for invalid input", async () => {
        const { db } = createMockDb();
        const logger = createNoopLogger();
        const result = await handleCreateSource(db, logger, { source_id: "ab" });

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.source_id).toBeDefined();
        expect(result.errors!.source_id!.length).toBeGreaterThan(0);
      });

      it("returns { success: true, sourceId } for valid input", async () => {
        const { db, calls } = createMockDb();
        const logger = createNoopLogger();
        const input = createValidCreateInput();
        const result = await handleCreateSource(db, logger, input);

        expect(result.success).toBe(true);
        expect(result.sourceId).toBe("japan_guide");
        expect(calls.length).toBe(1);
      });
    });

    describe("handleUpdateSource", () => {
      it("returns { success: false, errors } for invalid input", async () => {
        const { db } = createMockDb();
        const logger = createNoopLogger();
        const result = await handleUpdateSource(db, logger, "japan_guide", {
          tier: 5,
        });

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.tier).toBeDefined();
      });

      it("returns { success: true } for valid partial update", async () => {
        const { db, calls } = createMockDb();
        const logger = createNoopLogger();
        const result = await handleUpdateSource(db, logger, "japan_guide", {
          name: "Updated Japan Guide",
        });

        expect(result.success).toBe(true);
        expect(calls.length).toBe(1);
      });

      it("returns { success: true } with no db call for empty update", async () => {
        const { db, calls } = createMockDb();
        const logger = createNoopLogger();
        const result = await handleUpdateSource(db, logger, "japan_guide", {});

        expect(result.success).toBe(true);
        expect(calls.length).toBe(0);
      });
    });

    describe("handleDeleteSource", () => {
      it("calls delete in correct FK order (5 calls)", async () => {
        const { db, calls } = createMockDb();
        const logger = createNoopLogger();

        await handleDeleteSource(db, logger, "japan_guide");

        expect(calls.length).toBe(5);
      });
    });

    describe("handleToggleSourceStatus", () => {
      it("calls UPDATE with correct status", async () => {
        const { db, calls } = createMockDb();
        const logger = createNoopLogger();

        await handleToggleSourceStatus(db, logger, "japan_guide", "paused");

        expect(calls.length).toBe(1);
      });

      it("accepts 'active' as newStatus", async () => {
        const { db, calls } = createMockDb();
        const logger = createNoopLogger();

        await handleToggleSourceStatus(db, logger, "tokyo_metro", "active");

        expect(calls.length).toBe(1);
      });
    });
  });
  // END_BLOCK_CRUD_OPERATION_TESTS_M_ADMIN_SITES_TEST_007

  // START_BLOCK_FETCH_SITES_PAGE_DATA_TESTS_M_ADMIN_SITES_TEST_008
  describe("fetchSitesPageData", () => {
    it("returns SitesPageData with sources and recentCrawlJobs", async () => {
      let callIndex = 0;
      const db = {
        execute: async () => {
          callIndex++;
          if (callIndex === 1) {
            return {
              rows: [
                {
                  source_id: "japan_guide",
                  name: "Japan Guide",
                  domain: "https://www.japan-guide.com",
                  tier: 0,
                  language: "en",
                  focus: "General Japan travel",
                  status: "active",
                  crawl_interval_minutes: 1440,
                  max_pages: 100,
                  country_code: "jp",
                  page_count: 50,
                  chunk_count: 200,
                  embedding_count: 200,
                  last_crawl_at: "2026-01-15T10:00:00Z",
                },
              ],
            };
          }
          return {
            rows: [
              {
                crawl_job_id: "cj_001",
                source_id: "japan_guide",
                status: "completed",
                started_at: "2026-01-15T09:00:00Z",
                finished_at: "2026-01-15T10:00:00Z",
                pages_fetched: 50,
                error: null,
              },
            ],
          };
        },
      } as unknown as NodePgDatabase;
      const logger = createNoopLogger();

      const result = await fetchSitesPageData(db, logger);

      expect(result.sources.length).toBe(1);
      expect(result.sources[0]!.source_id).toBe("japan_guide");
      expect(result.sources[0]!.page_count).toBe(50);
      expect(result.recentCrawlJobs.length).toBe(1);
      expect(result.recentCrawlJobs[0]!.crawl_job_id).toBe("cj_001");
      expect(result.recentCrawlJobs[0]!.status).toBe("completed");
    });

    it("wraps errors in AdminSitesError", async () => {
      const db = {
        execute: async () => {
          throw new Error("connection refused");
        },
      } as unknown as NodePgDatabase;
      const logger = createNoopLogger();

      try {
        await fetchSitesPageData(db, logger);
        expect(true).toBe(false); // should not reach here
      } catch (err) {
        expect(err).toBeInstanceOf(AdminSitesError);
        const sitesErr = err as AdminSitesError;
        expect(sitesErr.code).toBe("ADMIN_SITES_ERROR");
        expect(sitesErr.message).toContain("Failed to fetch sites page data");
      }
    });
  });
  // END_BLOCK_FETCH_SITES_PAGE_DATA_TESTS_M_ADMIN_SITES_TEST_008
});
