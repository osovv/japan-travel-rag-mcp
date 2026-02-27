# Session Decisions (2026-02-27)

## Scope alignment for current phase

1. Active MCP tools are only:
   - `search_messages`
   - `get_message_context`
   - `get_related_messages`
   - `list_sources`
2. `search_context`, `validate_google_map_link`, `verify_tabelog` are deferred.
3. `/mcp` authentication model is FastMCP OAuth Proxy (Logto upstream).
4. `/admin/*` remains ROOT_AUTH_TOKEN login/session flow.
5. `ROOT_AUTH_TOKEN` must never authenticate `/mcp`.
6. API-key auth for `/mcp` is removed from active requirements.

## Documentation synchronization decision

1. `docs/requirements.xml` is updated to active current-scope use cases + deferred block.
2. `docs/technology.xml` is updated to FastMCP OAuth Proxy auth model and current tool surface.
3. `docs/contracts/mcp-tools.v1.json` is updated to current four-tool contracts.
4. `docs/contracts/verification-contracts.md` is marked Deferred.
5. `docs/development-plan.xml` and `docs/knowledge-graph.xml` remain source of truth for migration plan.

## Supersession note

This file supersedes runtime/auth/tool-surface decisions from earlier sessions where those decisions conflict with this document.
