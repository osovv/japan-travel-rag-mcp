# MCP Verification Contracts (Dropped)

Date: 2026-02-28
Project: `japan-travel-rag-mcp`
Status: Dropped (removed from active and deferred product plans)

## Scope note

This document remains only as a historical record for previously discussed contracts:
1. `validate_google_map_link`
2. `verify_tabelog`
3. Related POI/HITL policies

These tools are not part of the current roadmap.
Active MCP surface is limited to:
1. `search_messages`
2. `get_message_context`
3. `get_related_messages`
4. `list_sources`

Active auth model:
1. FastMCP OAuth Proxy for `/mcp`
2. `ROOT_AUTH_TOKEN` login/session for `/admin/*`
3. Portal session model for `/portal/*`

## Re-introduction rule

If business priorities change and verification tools return:
1. Create a new planning decision explicitly re-introducing them.
2. Update `docs/requirements.xml`, `docs/technology.xml`, `docs/development-plan.xml`, and `docs/knowledge-graph.xml` in one change set.
3. Create new contracts instead of reusing this archived draft as-is.
