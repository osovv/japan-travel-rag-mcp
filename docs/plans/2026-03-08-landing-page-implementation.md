# Landing Page Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current one-card home page with a full public landing page that explains TravelMind in plain English and drives visitors into `/portal`.

**Architecture:** Keep the landing route inside `src/portal/ui-routes.tsx` and continue rendering HTML server-side with `@kitajs/html`. Add landing-route tests first, watch them fail against the current minimal page, then introduce dedicated landing section helpers, richer layout styles, and the approved copy while leaving portal login/home flows untouched.

**Tech Stack:** Bun, TypeScript, `@kitajs/html`, Bun test

---

### Task 1: Add landing route regression tests

**Files:**
- Create: `src/portal/ui-routes.test.ts`
- Modify later: `src/portal/ui-routes.tsx`

**Step 1: Write the failing test**

Create a route-level test that calls `handleLandingRequest()` with stubbed dependencies and asserts that the HTML contains the approved explainer structure.

```ts
import { describe, expect, it } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import type { UsageTracker } from "../usage/tracker";
import { handleLandingRequest } from "./ui-routes";

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

function createTestConfig(): AppConfig {
  return {
    port: 3000,
    publicUrl: "https://travel.example.com",
    rootAuthToken: "root-secret",
    databaseUrl: "postgres://localhost:5432/test",
    oauthSessionSecret: "test-oauth-session-secret-at-least-32-characters",
    devMode: false,
    logto: {
      tenantUrl: "https://travel-app.logto.app/",
      clientId: "travel-client-id",
      clientSecret: "travel-client-secret",
      oidcAuthEndpoint: "https://travel-app.logto.app/oidc/auth",
      oidcTokenEndpoint: "https://travel-app.logto.app/oidc/token",
    },
    tgChatRag: {
      baseUrl: "https://tg-rag.example.com/",
      bearerToken: "bearer-token",
      timeoutMs: 15000,
    },
    portal: {
      sessionSecret: "test-portal-session-secret",
      logtoAppId: "test-portal-app-id",
      logtoAppSecret: "test-portal-app-secret",
      logtoM2mAppId: "test-m2m-app-id",
      logtoM2mAppSecret: "test-m2m-app-secret",
      logtoManagementApiResource: "https://test-mgmt-api.example.com",
      mcpUserRoleId: "test-mcp-user-role-id",
      sessionTtlSeconds: 604800,
    },
    proxy: {
      baseUrl: "https://proxy.example.com/",
      secret: "test-proxy-secret",
      voyageApiKey: "test-voyage-key",
      spiderApiKey: "test-spider-key",
    },
  };
}

function createLandingDeps() {
  return {
    config: createTestConfig(),
    logger: createNoopLogger(),
    identityClient: {} as never,
    usageTracker: {} as UsageTracker,
    db: {} as NodePgDatabase,
  };
}

describe("landing page", () => {
  it("renders explainer sections and portal CTAs", async () => {
    const response = await handleLandingRequest(
      new Request("http://localhost/", { method: "GET" }),
      createLandingDeps(),
    );

    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Understand Japan faster with trusted travel context");
    expect(html).toContain("Travel advice is everywhere. Clarity is not.");
    expect(html).toContain("What you get");
    expect(html).toContain("How it works");
    expect(html).toContain("Who it's for");
    expect(html).toContain("Start with Japan");
    expect(html).toContain("Ready to explore?");
    expect(html).toContain('href="/portal"');
    expect(html).toContain('href="#how-it-works"');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/portal/ui-routes.test.ts`

Expected: FAIL because the current landing page only contains the short tagline and one `Get Started` button.

**Step 3: Write minimal implementation**

Do not make the test pass yet with placeholder copy. First add only the minimum helper structure you need inside `src/portal/ui-routes.tsx` to support a richer landing page, for example:

```ts
function LandingHero() { /* hero JSX */ }
function LandingBenefits() { /* benefit cards JSX */ }
function LandingHowItWorks() { /* three-step section JSX */ }
function LandingAudience() { /* audience cards JSX */ }
function LandingFinalCta() { /* closing CTA JSX */ }
```

Keep all helpers in `src/portal/ui-routes.tsx` unless the file becomes unmanageable.

**Step 4: Run test to verify it still fails for the right reason**

Run: `bun test src/portal/ui-routes.test.ts`

Expected: FAIL only because the landing content is not fully implemented yet, not because the test harness is broken.

**Step 5: Commit**

```bash
git add src/portal/ui-routes.test.ts src/portal/ui-routes.tsx
git commit -m "test: add landing page route coverage"
```

### Task 2: Implement the approved landing page content and layout

**Files:**
- Modify: `src/portal/ui-routes.tsx`
- Test: `src/portal/ui-routes.test.ts`

**Step 1: Write the failing test**

Extend the same test file with focused assertions for the approved copy and structure.

```ts
it("uses plain-language benefit and audience copy", async () => {
  const response = await handleLandingRequest(
    new Request("http://localhost/", { method: "GET" }),
    createLandingDeps(),
  );

  const html = await response.text();

  expect(html).toContain("Curated knowledge");
  expect(html).toContain("Better context");
  expect(html).toContain("Faster research");
  expect(html).toContain("Easy to connect");
  expect(html).toContain("AI users");
  expect(html).toContain("Travel researchers");
  expect(html).toContain("Agencies and teams");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/portal/ui-routes.test.ts`

Expected: FAIL because those sections do not exist on the current landing page.

**Step 3: Write minimal implementation**

Update `handleLandingRequest()` and `PortalStyles()` in `src/portal/ui-routes.tsx` to render the approved landing sections.

Implementation requirements:

- Replace the centered single card with a full-page landing layout.
- Add landing-specific wrappers and section classes instead of relying on inline one-off styles.
- Keep copy in plain English and avoid front-loading terms such as `MCP`, `RAG`, `embeddings`, and `vector search`.
- Use a primary CTA to `/portal` and a secondary CTA to `#how-it-works`.
- Add the signal-card / trust-chip row in the hero.
- Reuse existing response helpers and keep route behavior unchanged.
- Update the module header version and `START_CHANGE_SUMMARY` entry in `src/portal/ui-routes.tsx`.

Suggested JSX shape:

```tsx
const body = (
  <div class="landing-shell">
    <section class="landing-hero">...</section>
    <section class="landing-problem">...</section>
    <section class="landing-benefits">...</section>
    <section id="how-it-works" class="landing-steps">...</section>
    <section class="landing-audience">...</section>
    <section class="landing-scope">...</section>
    <section class="landing-final-cta">...</section>
  </div>
);
```

**Step 4: Run test to verify it passes**

Run: `bun test src/portal/ui-routes.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/portal/ui-routes.tsx src/portal/ui-routes.test.ts
git commit -m "feat(ui): redesign public landing page"
```

### Task 3: Polish responsiveness and protect the existing portal surface

**Files:**
- Modify: `src/portal/ui-routes.tsx`
- Test: `src/portal/ui-routes.test.ts`

**Step 1: Write the failing test**

Add assertions that protect the most important interaction points and page anchors.

```ts
it("keeps both top and bottom portal CTAs and the how-it-works anchor", async () => {
  const response = await handleLandingRequest(
    new Request("http://localhost/", { method: "GET" }),
    createLandingDeps(),
  );

  const html = await response.text();

  expect(html.match(/href="\/portal"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  expect(html).toContain('id="how-it-works"');
  expect(html).toContain("Connect and explore");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/portal/ui-routes.test.ts`

Expected: FAIL if the closing CTA section or section anchor is missing.

**Step 3: Write minimal implementation**

Refine `PortalStyles()` so the landing behaves well on narrow screens.

Implementation checklist:

- Add responsive breakpoints for hero layout, card grids, section spacing, and CTA stacking.
- Ensure buttons remain readable and clickable on mobile.
- Keep the visual direction light and travel-editorial rather than generic SaaS.
- Do not regress login/register/home portal styles while expanding shared CSS.

**Step 4: Run tests to verify everything passes**

Run these commands:

```bash
bun test src/portal/ui-routes.test.ts
bun test src/admin/ui-routes.ops.test.ts
```

Expected: PASS for both commands.

**Step 5: Commit**

```bash
git add src/portal/ui-routes.tsx src/portal/ui-routes.test.ts
git commit -m "refactor(ui): polish landing responsiveness"
```

### Task 4: Final verification

**Files:**
- Verify only: `src/portal/ui-routes.tsx`, `src/portal/ui-routes.test.ts`

**Step 1: Run focused tests**

Run:

```bash
bun test src/portal/ui-routes.test.ts
bun test src/admin/ui-routes.ops.test.ts
```

Expected: PASS.

**Step 2: Run a broader relevant check**

Run: `bun test`

Expected: PASS, or if the suite is too large/noisy, document the exact failing unrelated tests before proceeding.

**Step 3: Manual browser verification**

Run the app locally and verify:

```bash
bun run index.ts
```

Check:

- `/` explains the product before asking for sign-up
- primary CTA goes to `/portal`
- secondary CTA scrolls to `How it works`
- layout remains readable on desktop and mobile widths
- portal login/register pages still render correctly

**Step 4: Commit**

```bash
git add src/portal/ui-routes.tsx src/portal/ui-routes.test.ts
git commit -m "feat(ui): ship public landing page redesign"
```
