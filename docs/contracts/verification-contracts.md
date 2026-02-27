# MCP Verification Contracts (Deferred)

Date: 2026-02-27
Project: `japan-travel-rag-mcp`
Status: Deferred (not active in current runtime scope)

## Scope note

This document describes future contracts for:
1. `validate_google_map_link`
2. `verify_tabelog`
3. Related POI/HITL policies

These tools are intentionally out of the active MCP surface while current scope focuses on:
1. `search_messages`
2. `get_message_context`
3. `get_related_messages`
4. `list_sources`

Auth model for active scope:
1. FastMCP OAuth Proxy for `/mcp`
2. `ROOT_AUTH_TOKEN` login/session for `/admin/*`

## Re-activation rule

When verification tools return to active scope:
1. Promote this document from Deferred to Active.
2. Synchronize `docs/requirements.xml`, `docs/technology.xml`, and `docs/contracts/mcp-tools.v1.json` in the same change set.
3. Add corresponding modules/contracts to `docs/development-plan.xml` and `docs/knowledge-graph.xml`.
