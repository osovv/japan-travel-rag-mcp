# Session Decisions (2026-02-28)

## Portal UI architecture approval

1. Approved UI stack for portal:
   - Bun JSX server rendering
   - Tailwind CSS (compiled shared stylesheet)
   - HTMX for progressive form interactions
   - Alpine.js only when local micro-interactivity is needed
2. Portal architecture is per-page routes (not SPA client router).
3. Invite-link flow is not required in current phase.

## Approved route map (portal-first e2e)

1. `GET /` - simple landing with primary CTA redirect to `/portal`.
2. `GET /portal` - route gate to login/home by portal session state.
3. `GET/POST /portal/register` - registration UI + submit.
4. `GET/POST /portal/login` - login UI + submit.
5. `GET /portal/home` - authenticated onboarding and quick MCP setup.
6. `POST /portal/logout` - clear portal session.
7. `GET /portal/integrations/agent-setup` - detailed MCP connection guide.

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
