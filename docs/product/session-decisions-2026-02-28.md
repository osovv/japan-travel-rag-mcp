# Session Decisions (2026-02-28)

## Portal UI architecture approval

1. Approved UI stack for portal:
   - Bun JSX server rendering
   - Tailwind CSS (compiled shared stylesheet)
   - HTMX for progressive form interactions
   - Alpine.js only when local micro-interactivity is needed
2. Portal architecture is per-page routes (not SPA client router).
3. Invite-link flow is not required in current phase.

## Portal auth policy approval (social-only)

1. Portal auth is Logto OAuth-based and allows only social login connectors.
2. Local email/password registration/login is not part of this phase.
3. `/portal/register` and `/portal/login` remain custom pages, but they contain social-provider actions only.
4. Portal routes include OAuth entry/callback endpoints:
   - `GET /portal/auth/start?provider=<provider>&intent=<register|login>`
   - `GET /portal/auth/callback`
5. After callback success, server performs provisioning and creates portal session.

## Approved route map (portal-first e2e)

1. `GET /` - simple landing with primary CTA redirect to `/portal`.
2. `GET /portal` - route gate to login/home by portal session state.
3. `GET/POST /portal/register` - registration UI + submit.
4. `GET/POST /portal/login` - login UI + submit.
5. `GET /portal/home` - authenticated onboarding and quick MCP setup.
6. `POST /portal/logout` - clear portal session.
7. `GET /portal/integrations/agent-setup` - detailed MCP connection guide.
8. `GET /portal/auth/start` - start Logto social OAuth flow from custom portal UI.
9. `GET /portal/auth/callback` - complete OAuth callback, provisioning, and session issue.

## Interaction model constraints

1. Business authority stays server-side in route handlers.
2. HTMX returns deterministic HTML fragments/pages for form result states.
3. Alpine.js must not replace server auth/provisioning logic.
4. MCP/admin/portal auth contexts remain isolated.

## Build and asset decision

1. Tailwind build command is tracked in technology docs:
   - `bunx tailwindcss -i src/portal/styles/tailwind.css -o public/assets/portal.css --minify`
2. Portal layout includes compiled CSS asset.

## Supersession note

This decision complements the portal-first planning update from 2026-02-28 and is the source of truth for UI stack and route architecture details.

## Legal posture (Telegram indexing, current limited scope)

1. Current legal posture for Telegram indexing is documented in:
   - `docs/product/legal-telegram-indexing-policy-2026-02-28.md`
2. Scope is explicitly limited to two allowlisted public Telegram sources.
3. Production launch remains conditional on source approval status and implemented takedown/process controls.

## Legal packaging decision (infra vs product)

1. `wren-chat` is positioned as Dev2Dev infrastructure layer (index/search API with policy controls).
2. `japan-travel-rag-mcp` is positioned as end-user product layer (B2C/B2B distribution and UX).
3. Reference document:
   - `docs/product/legal-structure-wren-vs-japan-travel-rag-2026-02-28.md`
