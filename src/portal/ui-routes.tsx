// FILE: src/portal/ui-routes.tsx
// VERSION: 1.2.0
// START_MODULE_CONTRACT
//   PURPOSE: Render public landing and user-portal pages with per-page route handlers, expose social OAuth entrypoints/callback flow, render MCP setup instructions for testers, and display available destinations from country_settings.
//   SCOPE: Route /portal/* requests, render landing, login/register social-only auth pages, handle OAuth start/callback flow, render authenticated portal home with destination list and agent setup guide, and manage portal session lifecycle.
//   DEPENDS: M-CONFIG, M-LOGGER, M-PORTAL-AUTH, M-PORTAL-PROVISIONING, M-PORTAL-IDENTITY, M-USAGE-TRACKER, M-COUNTRY-SETTINGS, M-DB
//   LINKS: M-PORTAL-UI, M-CONFIG, M-LOGGER, M-PORTAL-AUTH, M-PORTAL-PROVISIONING, M-PORTAL-IDENTITY, M-USAGE-TRACKER, M-COUNTRY-SETTINGS, M-DB
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   PortalUiError - Typed portal UI error wrapper with PORTAL_UI_ERROR code.
//   PortalUiDependencies - Dependency contract for identity client, config, logger, usage tracker, and database handle.
//   getCountryDisplayName - Map country code to human-readable display name.
//   handleLandingRequest - Serve / landing with primary redirect action to /portal.
//   handlePortalRootRoute - Handle GET /portal and route to login/home by session state.
//   handlePortalRegisterRoute - Handle GET /portal/register social-provider page (no password).
//   handlePortalLoginRoute - Handle GET /portal/login social-provider page (no password).
//   handlePortalOauthStartRoute - Handle GET /portal/auth/start, redirect to Logto OAuth.
//   handlePortalOauthCallbackRoute - Handle GET /portal/auth/callback, code exchange + provisioning + session.
//   handlePortalHomeRoute - Handle GET /portal/home authenticated page with destination list.
//   handlePortalAgentSetupRoute - Handle GET /portal/integrations/agent-setup MCP guide page with multi-country guidance.
//   handlePortalLogoutRoute - Handle POST /portal/logout, clear session.
//   PortalLayout - Render shared portal HTML shell.
//   PortalConnectionGuide - Render MCP setup instructions with platform branding and multi-destination guidance.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.3.0 - Hardcode platform name "TravelMind MCP" as constant, remove config.platformName dependency.
//   v1.2.0 - Replace hardcoded "Japan Travel RAG" with config.platformName, add destination list from country_settings to portal home, update MCP setup guide for single-endpoint multi-country usage, add db to PortalUiDependencies.
//   v1.1.0 - Add per-user usage statistics display to portal home with graceful degradation on stats query failure.
//   v1.0.0 - Initial generation from development plan for M-PORTAL-UI with social-only OAuth pages, landing, portal home, agent setup guide, and session lifecycle handlers.
// END_CHANGE_SUMMARY

import * as Html from "@kitajs/html";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AppConfig } from "../config/index";
import { getCountriesByStatus } from "../countries/index";
import type { Logger } from "../logger/index";
import type { UsageTracker, UserUsageStats } from "../usage/tracker";
import type { PortalIdentityClient } from "./identity-client";
import { authenticatePortalUser, requirePortalSession, clearPortalSession } from "./auth";
import type { RequirePortalSessionResult } from "./auth";
import { provisionTesterAccess } from "./provisioning";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_NAME = "TravelMind MCP";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PortalUiDependencies = {
  config: AppConfig;
  logger: Logger;
  identityClient: PortalIdentityClient;
  usageTracker: UsageTracker;
  db: NodePgDatabase;
};

export class PortalUiError extends Error {
  public readonly code = "PORTAL_UI_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PortalUiError";
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// START_CONTRACT: toPortalUiError
//   PURPOSE: Normalize unknown failures into PortalUiError with safe diagnostics.
//   INPUTS: { error: unknown - Caught runtime failure, message: string - Stable error message, details: Record<string, unknown>|undefined - Optional context }
//   OUTPUTS: { PortalUiError - Typed portal UI error value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: toPortalUiError
function toPortalUiError(
  error: unknown,
  message: string,
  details?: Record<string, unknown>,
): PortalUiError {
  // START_BLOCK_NORMALIZE_UNKNOWN_ERRORS_TO_PORTAL_UI_ERROR_M_PORTAL_UI_001
  if (error instanceof PortalUiError) {
    return error;
  }

  const cause = error instanceof Error ? error.message : String(error);
  return new PortalUiError(message, {
    ...details,
    cause,
  });
  // END_BLOCK_NORMALIZE_UNKNOWN_ERRORS_TO_PORTAL_UI_ERROR_M_PORTAL_UI_001
}

// START_CONTRACT: buildHtmlResponse
//   PURPOSE: Build HTML responses with optional custom headers.
//   INPUTS: { status: number - HTTP status code, html: string - Response HTML body, headers: Record<string, string>|undefined - Additional headers }
//   OUTPUTS: { Response - Bun-compatible HTML response object }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: buildHtmlResponse
function buildHtmlResponse(
  status: number,
  html: string,
  headers?: Record<string, string>,
): Response {
  // START_BLOCK_BUILD_STANDARD_HTML_RESPONSE_OBJECT_M_PORTAL_UI_003
  const responseHeaders = new Headers({ "content-type": HTML_CONTENT_TYPE });
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      responseHeaders.set(key, value);
    }
  }

  return new Response(html, { status, headers: responseHeaders });
  // END_BLOCK_BUILD_STANDARD_HTML_RESPONSE_OBJECT_M_PORTAL_UI_003
}

// START_CONTRACT: buildRedirectResponse
//   PURPOSE: Build redirect responses with optional Set-Cookie propagation.
//   INPUTS: { location: string - Redirect target path, setCookie: string|undefined - Optional cookie update value }
//   OUTPUTS: { Response - 302 redirect response }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: buildRedirectResponse
function buildRedirectResponse(location: string, setCookie?: string): Response {
  // START_BLOCK_BUILD_REDIRECT_RESPONSE_WITH_OPTIONAL_COOKIE_M_PORTAL_UI_004
  const headers: Record<string, string> = { location };
  if (setCookie) {
    headers["set-cookie"] = setCookie;
  }

  return new Response(null, {
    status: 302,
    headers,
  });
  // END_BLOCK_BUILD_REDIRECT_RESPONSE_WITH_OPTIONAL_COOKIE_M_PORTAL_UI_004
}

// START_CONTRACT: deriveMcpEndpointUrl
//   PURPOSE: Derive the public MCP endpoint URL from config, stripping trailing slash.
//   INPUTS: { publicUrl: string - Public base URL from config }
//   OUTPUTS: { string - Fully qualified MCP endpoint URL }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-UI, M-CONFIG]
// END_CONTRACT: deriveMcpEndpointUrl
function deriveMcpEndpointUrl(publicUrl: string): string {
  // START_BLOCK_DERIVE_MCP_ENDPOINT_URL_FROM_CONFIG_M_PORTAL_UI_005
  const baseUrl = publicUrl.replace(/\/+$/, "");
  return `${baseUrl}/mcp`;
  // END_BLOCK_DERIVE_MCP_ENDPOINT_URL_FROM_CONFIG_M_PORTAL_UI_005
}

// START_CONTRACT: getCountryDisplayName
//   PURPOSE: Map a country code to a human-readable display name for portal UI.
//   INPUTS: { code: string - ISO 2-letter country code (lowercase) }
//   OUTPUTS: { string - Human-readable country name }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: getCountryDisplayName
function getCountryDisplayName(code: string): string {
  // START_BLOCK_MAP_COUNTRY_CODE_TO_DISPLAY_NAME_M_PORTAL_UI_020
  const names: Record<string, string> = {
    jp: "Japan",
    it: "Italy",
    cn: "China",
    es: "Spain",
    kr: "South Korea",
    th: "Thailand",
    vn: "Vietnam",
    fr: "France",
    de: "Germany",
    gb: "United Kingdom",
  };
  return names[code] ?? code.toUpperCase();
  // END_BLOCK_MAP_COUNTRY_CODE_TO_DISPLAY_NAME_M_PORTAL_UI_020
}

// START_CONTRACT: PortalStyles
//   PURPOSE: Return inline CSS styles for the portal UI pages.
//   INPUTS: {}
//   OUTPUTS: { string - CSS style element }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: PortalStyles
function PortalStyles(): string {
  // START_BLOCK_DEFINE_PORTAL_CSS_STYLES_M_PORTAL_UI_006
  return (
    <style>{`
      :root { color-scheme: light; --bg:#f0f4f8; --fg:#1e293b; --card:#ffffff; --line:#cbd5e1; --accent:#0d9488; --accent-hover:#0f766e; --accent-soft:#ccfbf1; --muted:#64748b; --danger:#b91c1c; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: linear-gradient(135deg, #dbeafe 0%, #f0f4f8 40%, #e2e8f0 100%); color: var(--fg); min-height: 100vh; }
      .portal-wrapper { max-width: 48rem; margin: 0 auto; padding: 2rem 1rem; }
      .portal-center { display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 1rem; }
      .portal-card { background: var(--card); border: 1px solid var(--line); border-radius: 0.75rem; padding: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); width: 100%; max-width: 28rem; }
      .portal-card-wide { max-width: 48rem; }
      .portal-header { text-align: center; margin-bottom: 1.5rem; }
      .portal-header h1 { font-size: 1.75rem; font-weight: 700; color: var(--fg); margin-bottom: 0.5rem; }
      .portal-header p { color: var(--muted); font-size: 0.95rem; line-height: 1.5; }
      .portal-nav { display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; margin-bottom: 1.5rem; border-bottom: 1px solid var(--line); }
      .portal-nav-brand { font-weight: 700; font-size: 1.1rem; color: var(--accent); text-decoration: none; }
      .portal-nav-actions { display: flex; gap: 0.75rem; align-items: center; }
      .btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.7rem 1.25rem; border-radius: 0.5rem; font-size: 0.95rem; font-weight: 600; text-decoration: none; border: none; cursor: pointer; transition: background 0.15s, box-shadow 0.15s; }
      .btn-primary { background: var(--accent); color: #fff; }
      .btn-primary:hover { background: var(--accent-hover); }
      .btn-outline { background: transparent; color: var(--fg); border: 1px solid var(--line); }
      .btn-outline:hover { background: #f8fafc; }
      .btn-google { background: #ffffff; color: #3c4043; border: 1px solid #dadce0; width: 100%; margin-bottom: 0.75rem; font-weight: 500; }
      .btn-google:hover { background: #f8f9fa; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
      .btn-github { background: #24292f; color: #ffffff; width: 100%; margin-bottom: 0.75rem; font-weight: 500; }
      .btn-github:hover { background: #1b1f23; }
      .btn-logout { background: transparent; color: var(--muted); border: 1px solid var(--line); padding: 0.5rem 1rem; font-size: 0.85rem; }
      .btn-logout:hover { background: #fef2f2; color: var(--danger); border-color: #fecaca; }
      .btn-full { width: 100%; }
      .divider { text-align: center; margin: 1rem 0; color: var(--muted); font-size: 0.85rem; }
      .section-card { background: var(--card); border: 1px solid var(--line); border-radius: 0.75rem; padding: 1.5rem; margin-bottom: 1rem; }
      .section-card h2 { font-size: 1.2rem; font-weight: 700; margin-bottom: 0.75rem; }
      .section-card h3 { font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--fg); }
      .section-card p { color: var(--muted); font-size: 0.92rem; line-height: 1.6; margin-bottom: 0.5rem; }
      .endpoint-box { position: relative; background: #f1f5f9; border: 1px solid var(--line); border-radius: 0.5rem; padding: 0.75rem 2.75rem 0.75rem 1rem; font-family: "SFMono-Regular", "Consolas", "Liberation Mono", monospace; font-size: 0.85rem; word-break: break-all; color: var(--accent-hover); margin: 0.5rem 0; }
      .endpoint-copy { position: absolute; right: 0.5rem; top: 50%; transform: translateY(-50%); background: none; border: 1px solid var(--line); border-radius: 0.375rem; padding: 0.35rem; cursor: pointer; color: var(--muted); display: flex; align-items: center; justify-content: center; transition: color 0.15s, border-color 0.15s; }
      .endpoint-copy:hover { color: var(--accent); border-color: var(--accent); }
      .endpoint-copy.copied { color: var(--accent); }
      .code-block { background: #1e293b; color: #e2e8f0; border-radius: 0.5rem; padding: 1rem; font-family: "SFMono-Regular", "Consolas", "Liberation Mono", monospace; font-size: 0.82rem; line-height: 1.6; overflow-x: auto; margin: 0.75rem 0; white-space: pre; }
      .steps { list-style: none; counter-reset: step; padding: 0; margin: 1rem 0; }
      .steps li { counter-increment: step; padding: 0.6rem 0 0.6rem 2.5rem; position: relative; font-size: 0.92rem; color: var(--fg); line-height: 1.5; }
      .steps li::before { content: counter(step); position: absolute; left: 0; top: 0.55rem; width: 1.75rem; height: 1.75rem; background: var(--accent-soft); color: var(--accent-hover); border-radius: 50%; font-size: 0.82rem; font-weight: 700; display: flex; align-items: center; justify-content: center; }
      .link { color: var(--accent); text-decoration: none; font-weight: 500; }
      .link:hover { text-decoration: underline; }
      .alt-action { text-align: center; margin-top: 1.25rem; font-size: 0.88rem; color: var(--muted); }
      .alt-action a { color: var(--accent); text-decoration: none; font-weight: 500; }
      .alt-action a:hover { text-decoration: underline; }
      .flash { border-radius: 0.5rem; padding: 0.65rem 0.75rem; margin-bottom: 1rem; border: 1px solid transparent; font-size: 0.9rem; }
      .flash-error { background: #fef2f2; color: var(--danger); border-color: #fecaca; }
      details.agent-accordion { background: var(--card); border: 1px solid var(--line); border-radius: 0.75rem; margin-bottom: 0.75rem; overflow: hidden; }
      details.agent-accordion[open] { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
      details.agent-accordion summary { display: flex; align-items: center; gap: 0.75rem; padding: 1rem 1.25rem; cursor: pointer; font-weight: 600; font-size: 0.95rem; color: var(--fg); list-style: none; user-select: none; transition: background 0.15s; }
      details.agent-accordion summary::-webkit-details-marker { display: none; }
      details.agent-accordion summary::before { content: "\\25B6"; font-size: 0.65rem; color: var(--muted); transition: transform 0.2s; flex-shrink: 0; }
      details.agent-accordion[open] summary::before { transform: rotate(90deg); }
      details.agent-accordion summary:hover { background: #f8fafc; }
      details.agent-accordion .agent-body { padding: 0 1.25rem 1.25rem; }
      details.agent-accordion .agent-body ol { padding-left: 1.25rem; margin: 0.5rem 0; }
      details.agent-accordion .agent-body li { font-size: 0.9rem; line-height: 1.7; color: var(--fg); }
      details.agent-accordion .agent-body p { font-size: 0.9rem; color: var(--muted); line-height: 1.6; margin: 0.5rem 0; }
      .agent-badge { font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 999px; font-weight: 600; letter-spacing: 0.02em; flex-shrink: 0; }
      .badge-free { background: #dbeafe; color: #1e40af; }
      .badge-paid { background: #fef3c7; color: #92400e; }
      .badge-enterprise { background: #ede9fe; color: #5b21b6; }
      .badge-soon { background: #f1f5f9; color: var(--muted); }
      .agent-note { font-size: 0.82rem; color: var(--muted); font-style: italic; margin-top: 0.5rem; }
      @media (max-width: 640px) { .portal-card { padding: 1.5rem 1rem; } .portal-wrapper { padding: 1rem 0.5rem; } }
    `}</style>
  ) as string;
  // END_BLOCK_DEFINE_PORTAL_CSS_STYLES_M_PORTAL_UI_006
}

// START_CONTRACT: PortalLayout
//   PURPOSE: Render shared portal HTML shell with head, styles, and body wrapper.
//   INPUTS: { pageTitle: string - HTML page title, bodyHtml: string - Inner body content HTML }
//   OUTPUTS: { string - Full HTML document }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: PortalLayout
export function PortalLayout(pageTitle: string, bodyHtml: string): string {
  // START_BLOCK_RENDER_PORTAL_LAYOUT_DOCUMENT_M_PORTAL_UI_007
  return (
    <>
      {"<!doctype html>"}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title safe>{pageTitle}</title>
          <PortalStyles />
          <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
        </head>
        <body>
          {bodyHtml}
        </body>
      </html>
    </>
  ) as string;
  // END_BLOCK_RENDER_PORTAL_LAYOUT_DOCUMENT_M_PORTAL_UI_007
}

// START_CONTRACT: PortalConnectionGuide
//   PURPOSE: Render MCP setup instructions content for the agent setup guide page with multi-country guidance.
//   INPUTS: { mcpEndpointUrl: string - Fully qualified MCP endpoint URL }
//   OUTPUTS: { string - HTML content fragment with MCP connection guide }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: PortalConnectionGuide
export function PortalConnectionGuide(mcpEndpointUrl: string): string {
  // START_BLOCK_RENDER_MCP_CONNECTION_GUIDE_CONTENT_M_PORTAL_UI_008
  const escapedUrl = Html.escapeHtml(mcpEndpointUrl);
  const escapedPlatformName = Html.escapeHtml(PLATFORM_NAME);
  const serverLabel = "travel-rag-mcp";
  const copyBtnScript = `navigator.clipboard.writeText(document.getElementById('mcp-url').textContent).then(()=>{const b=this;b.classList.add('copied');b.innerHTML='<svg width=&quot;16&quot; height=&quot;16&quot; viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;2.5&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;><polyline points=&quot;20 6 9 17 4 12&quot;/></svg>';setTimeout(()=>{b.classList.remove('copied');b.innerHTML='<svg width=&quot;16&quot; height=&quot;16&quot; viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;2&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;><rect x=&quot;9&quot; y=&quot;9&quot; width=&quot;13&quot; height=&quot;13&quot; rx=&quot;2&quot;/><path d=&quot;M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1&quot;/></svg>';},1500)})`;

  return (
    <>
      <div class="section-card">
        <h2>MCP Connection Setup</h2>
        <p>{"Connect your AI assistant to the "}{escapedPlatformName}{" server using the Model Context Protocol (MCP). A single "}<code>/mcp</code>{" endpoint serves all destinations. Choose your app below and follow the instructions."}</p>
      </div>

      <div class="section-card">
        <h3>Your MCP Endpoint</h3>
        <div class="endpoint-box">
          <span id="mcp-url">{escapedUrl}</span>
          <button class="endpoint-copy" onclick={copyBtnScript}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        </div>
        <p>{"Authentication: "}<strong>OAuth 2.0</strong>{" (automatic — you will be redirected to sign in when connecting)"}</p>
      </div>

      <div class="section-card">
        <h3>Multi-Destination Support</h3>
        <p>{"All travel tools accept a "}<code>country_code</code>{" parameter to specify the destination (e.g. "}<code>"jp"</code>{" for Japan, "}<code>"it"</code>{" for Italy). Your AI assistant will automatically infer the correct "}<code>country_code</code>{" from your query — no manual selection needed."}</p>
      </div>

      <details class="agent-accordion" open>
        <summary>{"Claude "}<span class="agent-badge badge-free">Free (1 connector)</span>{" "}<span class="agent-badge badge-paid">Pro / Max / Team</span></summary>
        <div class="agent-body">
          <p>{"Works on "}<strong>claude.ai</strong>{", the "}<strong>Claude Desktop</strong>{" app (macOS / Windows), and "}<strong>Claude mobile</strong>{" (iOS / Android)."}</p>
          <ol>
            <li>{"Open "}<strong>{"Settings \u2192 Connectors"}</strong></li>
            <li>{"Click "}<strong>"Add custom connector"</strong></li>
            <li>Paste the MCP endpoint URL shown above</li>
            <li>{"Click "}<strong>"Add"</strong></li>
            <li>Complete the OAuth sign-in in your browser</li>
          </ol>
          <p>{"To use in a conversation: click "}<strong>"+"</strong>{" at the bottom of the chat \u2192 "}<strong>Connectors</strong>{" \u2192 toggle on "}{escapedPlatformName}{"."}</p>
          <p class="agent-note">{"Team / Enterprise: an admin must first add the connector in Organization settings \u2192 Connectors, then members connect via Settings \u2192 Connectors."}</p>
        </div>
      </details>

      <details class="agent-accordion">
        <summary>{"ChatGPT "}<span class="agent-badge badge-paid">Pro / Plus / Team / Enterprise / Edu</span></summary>
        <div class="agent-body">
          <p>{"Works on "}<strong>chatgpt.com</strong>{" and the ChatGPT desktop / mobile apps."}</p>
          <ol>
            <li>{"Go to "}<strong>{"Settings \u2192 Apps & Connectors \u2192 Advanced settings"}</strong>{" and enable "}<strong>Developer Mode</strong></li>
            <li>{"Go to "}<strong>{"Settings \u2192 Connectors \u2192 Create"}</strong></li>
            <li>{`Enter a name (e.g. "${escapedPlatformName}") and an optional description`}</li>
            <li>{"Paste the MCP endpoint URL as the "}<strong>Connector URL</strong></li>
            <li>{"Click "}<strong>"Create"</strong></li>
          </ol>
          <p>{"To use: open a new chat \u2192 click "}<strong>"+"</strong>{" \u2192 "}<strong>More</strong>{" \u2192 select the connector."}</p>
          <p class="agent-note">ChatGPT cannot connect to localhost. The server must be publicly accessible via HTTPS.</p>
        </div>
      </details>

      <details class="agent-accordion">
        <summary>{"Google Gemini "}<span class="agent-badge badge-enterprise">Enterprise</span></summary>
        <div class="agent-body">
          <p>{"Custom MCP connectors are available in "}<strong>Gemini Enterprise</strong>{" (Standard, Plus, Frontline editions) via Google Cloud Console."}</p>
          <ol>
            <li>{"Open "}<strong>Gemini Enterprise</strong>{" in Google Cloud Console"}</li>
            <li>{"Go to "}<strong>{"Data stores \u2192 Create data store"}</strong></li>
            <li>{"Select "}<strong>"Custom MCP Server (Preview)"</strong></li>
            <li>Enter the MCP endpoint URL and OAuth details (Authorization URL, Token URL, Client ID, Secret)</li>
            <li>{"Click "}<strong>"Login"</strong>{", authenticate, then "}<strong>"Create"</strong></li>
          </ol>
          <p class="agent-note">Not available in the free Gemini web/mobile app. Requires Discovery Engine Editor role and the enterprise allowlist.</p>
        </div>
      </details>

      <details class="agent-accordion">
        <summary>{"Microsoft Copilot "}<span class="agent-badge badge-enterprise">Copilot Studio</span></summary>
        <div class="agent-body">
          <p>{"Remote MCP servers can be added to agents in "}<strong>Microsoft Copilot Studio</strong>{"."}</p>
          <ol>
            <li>{"Open your agent in "}<strong>Copilot Studio</strong></li>
            <li>{"Go to "}<strong>{"Tools \u2192 Add Tool \u2192 New Tool \u2192 MCP"}</strong></li>
            <li>Paste the MCP endpoint URL</li>
            <li>Complete the setup wizard</li>
          </ol>
          <p class="agent-note">Not available in the consumer Copilot chat. Requires Copilot Studio access (Microsoft 365 business plans).</p>
        </div>
      </details>

      <details class="agent-accordion">
        <summary>{"Perplexity "}<span class="agent-badge badge-soon">{"Remote \u2014 coming soon"}</span></summary>
        <div class="agent-body">
          <p>{"Perplexity supports "}<strong>local</strong>{" MCP servers on the Mac app via "}<strong>{"Settings \u2192 Connectors"}</strong>{". Remote MCP server support is not yet available but has been announced."}</p>
          <p>Once remote support is added, you will be able to paste the MCP endpoint URL directly into the Connectors settings.</p>
        </div>
      </details>

      <details class="agent-accordion">
        <summary>{"Grok (xAI) "}<span class="agent-badge badge-soon">API only</span></summary>
        <div class="agent-body">
          <p>{"Grok currently supports remote MCP servers only via the "}<strong>xAI API</strong>{", not through the grok.com web/mobile interface."}</p>
          <p>Developers can connect via the API by adding an MCP tool to the request:</p>
          <div class="code-block">{`{ "type": "mcp", "server_url": "${escapedUrl}", "server_label": "${serverLabel}" }`}</div>
          <p class="agent-note">Consumer UI support may be added in the future.</p>
        </div>
      </details>

      <details class="agent-accordion">
        <summary>{"Claude Code (CLI) "}<span class="agent-badge badge-paid">Pro / Max / Team</span></summary>
        <div class="agent-body">
          <p>{"For developers using "}<strong>Claude Code</strong>{" in the terminal:"}</p>
          <div class="code-block">{`claude mcp add --transport http ${serverLabel} ${escapedUrl}`}</div>
          <p>Then authenticate inside Claude Code:</p>
          <div class="code-block">/mcp</div>
          <p>Select the server and follow the OAuth flow in your browser.</p>
        </div>
      </details>
    </>
  ) as string;
  // END_BLOCK_RENDER_MCP_CONNECTION_GUIDE_CONTENT_M_PORTAL_UI_008
}

// START_CONTRACT: ErrorPage
//   PURPOSE: Render a generic portal error page for unexpected failures.
//   INPUTS: { message: string - User-facing error message }
//   OUTPUTS: { string - Full HTML error document }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: ErrorPage
function ErrorPage(message: string): string {
  // START_BLOCK_RENDER_PORTAL_ERROR_PAGE_M_PORTAL_UI_009
  const body = (
    <div class="portal-center">
      <div class="portal-card">
        <div class="portal-header">
          <h1>Something went wrong</h1>
          <p safe>{message}</p>
        </div>
        <a href="/portal" class="btn btn-primary btn-full">Back to Portal</a>
      </div>
    </div>
  ) as string;

  return PortalLayout("Portal - Error", body);
  // END_BLOCK_RENDER_PORTAL_ERROR_PAGE_M_PORTAL_UI_009
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// START_CONTRACT: handleLandingRequest
//   PURPOSE: Serve / landing with primary redirect action to /portal.
//   INPUTS: { request: Request - Incoming HTTP request, deps: PortalUiDependencies - Runtime dependencies }
//   OUTPUTS: { Promise<Response> - HTML landing page response }
//   SIDE_EFFECTS: [Writes structured log]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: handleLandingRequest
export async function handleLandingRequest(
  request: Request,
  deps: PortalUiDependencies,
): Promise<Response> {
  // START_BLOCK_RENDER_LANDING_PAGE_M_PORTAL_UI_010
  const logger = deps.logger.child({ module: "PortalUiRoutes", handler: "handleLandingRequest" });

  logger.info(
    "Serving landing page.",
    "handleLandingRequest",
    "RENDER_LANDING_PAGE",
  );

  const body = (
    <div class="portal-center">
      <div class="portal-card" style="text-align: center;">
        <div class="portal-header">
          <h1 style="font-size: 2rem; margin-bottom: 0.75rem;" safe>{PLATFORM_NAME}</h1>
          <p style="font-size: 1rem; max-width: 24rem; margin: 0 auto;">Your AI-powered travel companion. Get curated recommendations, cultural insights, and local knowledge from real traveler conversations.</p>
        </div>
        <a href="/portal" class="btn btn-primary btn-full" style="margin-top: 1rem; font-size: 1.05rem; padding: 0.85rem 1.5rem;">Get Started</a>
      </div>
    </div>
  ) as string;

  return buildHtmlResponse(200, PortalLayout(PLATFORM_NAME, body));
  // END_BLOCK_RENDER_LANDING_PAGE_M_PORTAL_UI_010
}

// START_CONTRACT: handlePortalRootRoute
//   PURPOSE: Handle GET /portal and route to login/home by session state.
//   INPUTS: { request: Request - Incoming HTTP request, deps: PortalUiDependencies - Runtime dependencies }
//   OUTPUTS: { Promise<Response> - 302 redirect response }
//   SIDE_EFFECTS: [Checks portal session, writes structured log]
//   LINKS: [M-PORTAL-UI, M-PORTAL-AUTH]
// END_CONTRACT: handlePortalRootRoute
export async function handlePortalRootRoute(
  request: Request,
  deps: PortalUiDependencies,
): Promise<Response> {
  // START_BLOCK_ROUTE_PORTAL_ROOT_BY_SESSION_STATE_M_PORTAL_UI_011
  const logger = deps.logger.child({ module: "PortalUiRoutes", handler: "handlePortalRootRoute" });

  logger.info(
    "Checking session state for portal root route.",
    "handlePortalRootRoute",
    "ROUTE_PORTAL_ROOT_BY_SESSION_STATE",
  );

  const sessionResult = requirePortalSession(request, deps.config, logger);

  if (sessionResult.isAuthenticated) {
    logger.debug(
      "Session active; redirecting to portal home.",
      "handlePortalRootRoute",
      "ROUTE_PORTAL_ROOT_BY_SESSION_STATE",
    );
    return buildRedirectResponse("/portal/home");
  }

  logger.debug(
    "No active session; redirecting to portal login.",
    "handlePortalRootRoute",
    "ROUTE_PORTAL_ROOT_BY_SESSION_STATE",
  );
  return buildRedirectResponse("/portal/login", sessionResult.setCookie);
  // END_BLOCK_ROUTE_PORTAL_ROOT_BY_SESSION_STATE_M_PORTAL_UI_011
}

// START_CONTRACT: SocialButtons
//   PURPOSE: Render social provider buttons for login/register pages.
//   INPUTS: { intent: "register" | "login" - User intent for OAuth flow }
//   OUTPUTS: { string - HTML fragment with social login buttons }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: SocialButtons
function SocialButtons(intent: "register" | "login"): string {
  // START_BLOCK_RENDER_SOCIAL_PROVIDER_BUTTONS_M_PORTAL_UI_012
  const googleUrl = `/portal/auth/start?provider=google&intent=${intent}`;

  return (
    <a href={googleUrl} class="btn btn-google">
      <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"></path><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.26c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"></path><path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"></path><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 2.58 9 3.58z" fill="#EA4335"></path></svg>
      {"Continue with Google"}
    </a>
  ) as string;
  // END_BLOCK_RENDER_SOCIAL_PROVIDER_BUTTONS_M_PORTAL_UI_012
}

// START_CONTRACT: handlePortalRegisterRoute
//   PURPOSE: Handle GET /portal/register social-provider page (no password).
//   INPUTS: { request: Request - Incoming HTTP request, deps: PortalUiDependencies - Runtime dependencies }
//   OUTPUTS: { Promise<Response> - HTML register page response }
//   SIDE_EFFECTS: [Writes structured log]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: handlePortalRegisterRoute
export async function handlePortalRegisterRoute(
  request: Request,
  deps: PortalUiDependencies,
): Promise<Response> {
  // START_BLOCK_RENDER_REGISTER_PAGE_M_PORTAL_UI_013
  const logger = deps.logger.child({ module: "PortalUiRoutes", handler: "handlePortalRegisterRoute" });

  logger.info(
    "Serving portal register page.",
    "handlePortalRegisterRoute",
    "RENDER_REGISTER_PAGE",
  );

  const body = (
    <div class="portal-center">
      <div class="portal-card">
        <div class="portal-header">
          <h1>Create your account</h1>
          <p>{"Sign up with your social account to get started with "}<span safe>{PLATFORM_NAME}</span>{"."}</p>
        </div>
        {SocialButtons("register")}
        <div class="alt-action">{"Already have an account? "}<a href="/portal/login">Sign in</a></div>
      </div>
    </div>
  ) as string;

  return buildHtmlResponse(200, PortalLayout(`Sign Up - ${PLATFORM_NAME}`, body));
  // END_BLOCK_RENDER_REGISTER_PAGE_M_PORTAL_UI_013
}

// START_CONTRACT: handlePortalLoginRoute
//   PURPOSE: Handle GET /portal/login social-provider page (no password).
//   INPUTS: { request: Request - Incoming HTTP request, deps: PortalUiDependencies - Runtime dependencies }
//   OUTPUTS: { Promise<Response> - HTML login page response }
//   SIDE_EFFECTS: [Writes structured log]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: handlePortalLoginRoute
export async function handlePortalLoginRoute(
  request: Request,
  deps: PortalUiDependencies,
): Promise<Response> {
  // START_BLOCK_RENDER_LOGIN_PAGE_M_PORTAL_UI_014
  const logger = deps.logger.child({ module: "PortalUiRoutes", handler: "handlePortalLoginRoute" });

  logger.info(
    "Serving portal login page.",
    "handlePortalLoginRoute",
    "RENDER_LOGIN_PAGE",
  );

  const body = (
    <div class="portal-center">
      <div class="portal-card">
        <div class="portal-header">
          <h1>Welcome back</h1>
          <p>{"Sign in with your social account to access "}<span safe>{PLATFORM_NAME}</span>{"."}</p>
        </div>
        {SocialButtons("login")}
        <div class="alt-action">{"Don't have an account? "}<a href="/portal/register">Sign up</a></div>
      </div>
    </div>
  ) as string;

  return buildHtmlResponse(200, PortalLayout(`Sign In - ${PLATFORM_NAME}`, body));
  // END_BLOCK_RENDER_LOGIN_PAGE_M_PORTAL_UI_014
}

// START_CONTRACT: handlePortalOauthStartRoute
//   PURPOSE: Handle GET /portal/auth/start, redirect to Logto OAuth.
//   INPUTS: { request: Request - Incoming HTTP request, deps: PortalUiDependencies - Runtime dependencies }
//   OUTPUTS: { Promise<Response> - 302 redirect to OAuth provider }
//   SIDE_EFFECTS: [Calls identity client to build OAuth URL, writes structured log]
//   LINKS: [M-PORTAL-UI, M-PORTAL-IDENTITY]
// END_CONTRACT: handlePortalOauthStartRoute
export async function handlePortalOauthStartRoute(
  request: Request,
  deps: PortalUiDependencies,
): Promise<Response> {
  // START_BLOCK_REDIRECT_TO_OAUTH_PROVIDER_M_PORTAL_UI_015
  const logger = deps.logger.child({ module: "PortalUiRoutes", handler: "handlePortalOauthStartRoute" });

  try {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider") ?? "";
    const intent = url.searchParams.get("intent") ?? "";

    if (!provider) {
      logger.warn(
        "Missing provider query parameter for OAuth start.",
        "handlePortalOauthStartRoute",
        "REDIRECT_TO_OAUTH_PROVIDER",
      );
      return buildRedirectResponse("/portal/login");
    }

    if (intent !== "register" && intent !== "login") {
      logger.warn(
        "Invalid intent query parameter for OAuth start.",
        "handlePortalOauthStartRoute",
        "REDIRECT_TO_OAUTH_PROVIDER",
        { intent },
      );
      return buildRedirectResponse("/portal/login");
    }

    logger.info(
      "Building OAuth authorization URL.",
      "handlePortalOauthStartRoute",
      "REDIRECT_TO_OAUTH_PROVIDER",
      { provider, intent },
    );

    const oauthStart = deps.identityClient.buildPortalOauthStartUrl(provider, intent);

    logger.debug(
      "Redirecting to OAuth provider.",
      "handlePortalOauthStartRoute",
      "REDIRECT_TO_OAUTH_PROVIDER",
      { redirectUrl: oauthStart.url },
    );

    return buildRedirectResponse(oauthStart.url);
  } catch (error: unknown) {
    const portalError = toPortalUiError(error, "Failed to start OAuth flow.");
    logger.error(
      "OAuth start failed.",
      "handlePortalOauthStartRoute",
      "REDIRECT_TO_OAUTH_PROVIDER",
      { code: portalError.code, cause: portalError.details?.cause ?? portalError.message },
    );
    return buildHtmlResponse(500, ErrorPage("Failed to start authentication. Please try again."));
  }
  // END_BLOCK_REDIRECT_TO_OAUTH_PROVIDER_M_PORTAL_UI_015
}

// START_CONTRACT: handlePortalOauthCallbackRoute
//   PURPOSE: Handle GET /portal/auth/callback, code exchange + provisioning + session.
//   INPUTS: { request: Request - Incoming HTTP request, deps: PortalUiDependencies - Runtime dependencies }
//   OUTPUTS: { Promise<Response> - 302 redirect to /portal/home with session cookie }
//   SIDE_EFFECTS: [Exchanges OAuth code, provisions access, creates session, writes structured logs]
//   LINKS: [M-PORTAL-UI, M-PORTAL-IDENTITY, M-PORTAL-PROVISIONING, M-PORTAL-AUTH]
// END_CONTRACT: handlePortalOauthCallbackRoute
export async function handlePortalOauthCallbackRoute(
  request: Request,
  deps: PortalUiDependencies,
): Promise<Response> {
  // START_BLOCK_HANDLE_OAUTH_CALLBACK_AND_PROVISION_SESSION_M_PORTAL_UI_016
  const logger = deps.logger.child({ module: "PortalUiRoutes", handler: "handlePortalOauthCallbackRoute" });

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";

    if (!code || !state) {
      logger.warn(
        "Missing code or state query parameter in OAuth callback.",
        "handlePortalOauthCallbackRoute",
        "HANDLE_OAUTH_CALLBACK_AND_PROVISION_SESSION",
        { hasCode: code.length > 0, hasState: state.length > 0 },
      );
      return buildRedirectResponse("/portal/login");
    }

    logger.info(
      "Processing OAuth callback.",
      "handlePortalOauthCallbackRoute",
      "HANDLE_OAUTH_CALLBACK_AND_PROVISION_SESSION",
    );

    // Step 1: Exchange code for identity
    const identityResult = await deps.identityClient.handlePortalOauthCallback(code, state);

    logger.info(
      "OAuth identity resolved.",
      "handlePortalOauthCallbackRoute",
      "HANDLE_OAUTH_CALLBACK_AND_PROVISION_SESSION",
      {
        userId: identityResult.userId,
        provider: identityResult.provider,
        intent: identityResult.intent,
      },
    );

    // Step 2: Provision tester access
    await provisionTesterAccess(identityResult.userId, deps.identityClient, logger);

    logger.info(
      "Tester access provisioned.",
      "handlePortalOauthCallbackRoute",
      "HANDLE_OAUTH_CALLBACK_AND_PROVISION_SESSION",
      { userId: identityResult.userId },
    );

    // Step 3: Authenticate and create session
    const authResult = authenticatePortalUser(
      {
        userId: identityResult.userId,
        email: identityResult.email,
        name: identityResult.name,
      },
      deps.config,
      logger,
    );

    logger.info(
      "Portal session created; redirecting to home.",
      "handlePortalOauthCallbackRoute",
      "HANDLE_OAUTH_CALLBACK_AND_PROVISION_SESSION",
      { userId: authResult.userId },
    );

    return buildRedirectResponse("/portal/home", authResult.sessionCookie);
  } catch (error: unknown) {
    const portalError = toPortalUiError(error, "OAuth callback processing failed.");
    logger.error(
      "OAuth callback failed.",
      "handlePortalOauthCallbackRoute",
      "HANDLE_OAUTH_CALLBACK_AND_PROVISION_SESSION",
      { code: portalError.code, cause: portalError.details?.cause ?? portalError.message },
    );
    return buildHtmlResponse(500, ErrorPage("Authentication failed. Please try again."));
  }
  // END_BLOCK_HANDLE_OAUTH_CALLBACK_AND_PROVISION_SESSION_M_PORTAL_UI_016
}

// START_CONTRACT: handlePortalHomeRoute
//   PURPOSE: Handle GET /portal/home authenticated page with per-user usage statistics.
//   INPUTS: { request: Request - Incoming HTTP request, deps: PortalUiDependencies - Runtime dependencies }
//   OUTPUTS: { Promise<Response> - HTML portal home page or redirect to login }
//   SIDE_EFFECTS: [Checks portal session, queries usage stats with graceful degradation, writes structured log]
//   LINKS: [M-PORTAL-UI, M-PORTAL-AUTH, M-USAGE-TRACKER]
// END_CONTRACT: handlePortalHomeRoute
export async function handlePortalHomeRoute(
  request: Request,
  deps: PortalUiDependencies,
): Promise<Response> {
  // START_BLOCK_RENDER_PORTAL_HOME_PAGE_M_PORTAL_UI_017
  const logger = deps.logger.child({ module: "PortalUiRoutes", handler: "handlePortalHomeRoute" });

  const sessionResult = requirePortalSession(request, deps.config, logger);

  if (!sessionResult.isAuthenticated) {
    logger.info(
      "Session not found; redirecting to login.",
      "handlePortalHomeRoute",
      "RENDER_PORTAL_HOME_PAGE",
      { reason: sessionResult.reason },
    );
    return buildRedirectResponse(sessionResult.location, sessionResult.setCookie);
  }

  const session = sessionResult.session;
  const userName = session.name || "Tester";
  const mcpEndpointUrl = deriveMcpEndpointUrl(deps.config.publicUrl);

  // Query per-user usage statistics with graceful degradation on failure
  let stats: UserUsageStats | null = null;
  let statsError = false;
  try {
    stats = await deps.usageTracker.getUserStats(session.sub);
  } catch (error: unknown) {
    statsError = true;
    const cause = error instanceof Error ? error.message : String(error);
    logger.warn(
      "Failed to fetch usage stats; rendering page without stats.",
      "handlePortalHomeRoute",
      "RENDER_PORTAL_HOME_PAGE",
      { userId: session.sub, cause },
    );
  }

  logger.info(
    "Serving portal home page.",
    "handlePortalHomeRoute",
    "RENDER_PORTAL_HOME_PAGE",
    { userId: session.sub },
  );

  // Build usage statistics section HTML
  let usageHtml: string = "";
  if (statsError) {
    usageHtml = (
      <div class="section-card" style="margin-bottom: 1rem;">
        <h3>Usage Statistics</h3>
        <p style="color: #b45309;">Unable to load usage statistics at this time. Please try again later.</p>
      </div>
    ) as string;
  } else if (stats && stats.tools.length > 0) {
    usageHtml = (
      <div class="section-card" style="margin-bottom: 1rem;">
        <h3>Usage Statistics</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 0.75rem;">
          <thead><tr><th style="text-align: left; padding: 0.5rem; border-bottom: 1px solid #e5e7eb;">Tool</th><th style="text-align: right; padding: 0.5rem; border-bottom: 1px solid #e5e7eb;">Calls</th></tr></thead>
          <tbody>
            {stats.tools.map((tool) => (
              <tr><td safe>{tool.toolName}</td><td style="text-align: right;">{String(tool.callCount)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td style="padding: 0.5rem; border-top: 1px solid #e5e7eb; font-weight: bold;">Total</td><td style="text-align: right; padding: 0.5rem; border-top: 1px solid #e5e7eb; font-weight: bold;">{String(stats.total)}</td></tr></tfoot>
        </table>
      </div>
    ) as string;
  } else if (stats) {
    usageHtml = (
      <div class="section-card" style="margin-bottom: 1rem;">
        <h3>Usage Statistics</h3>
        <p>No usage yet. Connect your AI agent using the endpoint above to get started.</p>
      </div>
    ) as string;
  }

  // Query destination lists for display with graceful degradation
  let destinationsHtml: string = "";
  try {
    const activeCountries = await getCountriesByStatus(deps.db, "active");
    const comingSoonCountries = await getCountriesByStatus(deps.db, "coming_soon");

    if (activeCountries.length > 0 || comingSoonCountries.length > 0) {
      destinationsHtml = (
        <div class="section-card" style="margin-bottom: 1rem;">
          <h3>Available Destinations</h3>
          <ul style="list-style: none; padding: 0; margin: 0.5rem 0 0 0;">
            {activeCountries.map((c) => (
              <li style="padding: 0.4rem 0;"><strong safe>{getCountryDisplayName(c.countryCode)}</strong>{" "}<span style="color: var(--accent); font-size: 0.85rem; font-weight: 600;">Active</span></li>
            ))}
            {comingSoonCountries.map((c) => (
              <li style="padding: 0.4rem 0;"><strong safe>{getCountryDisplayName(c.countryCode)}</strong>{" "}<span style="color: var(--muted); font-size: 0.85rem; font-weight: 600;">Coming Soon</span></li>
            ))}
          </ul>
        </div>
      ) as string;
    }
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    logger.warn(
      "Failed to fetch destinations; rendering page without destination list.",
      "handlePortalHomeRoute",
      "RENDER_PORTAL_HOME_PAGE",
      { userId: session.sub, cause },
    );
  }

  const body = (
    <div class="portal-wrapper">
      <nav class="portal-nav">
        <a href="/portal" class="portal-nav-brand" safe>{PLATFORM_NAME}</a>
        <div class="portal-nav-actions">
          <form method="post" action="/portal/logout" style="margin: 0;">
            <button type="submit" class="btn btn-logout">Sign out</button>
          </form>
        </div>
      </nav>

      <div class="section-card" style="margin-bottom: 1.5rem;">
        <h2>{"Welcome, "}<span safe>{userName}</span></h2>
        <p>Your tester access is active. Use the MCP endpoint below to connect your AI agent.</p>
      </div>

      <div class="section-card" style="margin-bottom: 1rem;">
        <h3>Your MCP Endpoint</h3>
        <div class="endpoint-box" safe>{mcpEndpointUrl}</div>
        <p>{"Auth type: "}<strong>OAuth 2.0</strong></p>
      </div>

      {usageHtml}
      {destinationsHtml}

      <div class="section-card">
        <h3>MCP Connection Setup</h3>
        <p>Get step-by-step instructions for connecting Claude Desktop, Claude Code, or other MCP clients.</p>
        <a href="/portal/integrations/agent-setup" class="btn btn-primary" style="margin-top: 0.75rem;">View Setup Guide</a>
      </div>
    </div>
  ) as string;

  return buildHtmlResponse(200, PortalLayout(`Portal Home - ${PLATFORM_NAME}`, body));
  // END_BLOCK_RENDER_PORTAL_HOME_PAGE_M_PORTAL_UI_017
}

// START_CONTRACT: handlePortalAgentSetupRoute
//   PURPOSE: Handle GET /portal/integrations/agent-setup MCP guide page.
//   INPUTS: { request: Request - Incoming HTTP request, deps: PortalUiDependencies - Runtime dependencies }
//   OUTPUTS: { Promise<Response> - HTML agent setup guide page or redirect to login }
//   SIDE_EFFECTS: [Checks portal session, writes structured log]
//   LINKS: [M-PORTAL-UI, M-PORTAL-AUTH]
// END_CONTRACT: handlePortalAgentSetupRoute
export async function handlePortalAgentSetupRoute(
  request: Request,
  deps: PortalUiDependencies,
): Promise<Response> {
  // START_BLOCK_RENDER_AGENT_SETUP_GUIDE_PAGE_M_PORTAL_UI_018
  const logger = deps.logger.child({ module: "PortalUiRoutes", handler: "handlePortalAgentSetupRoute" });

  const sessionResult = requirePortalSession(request, deps.config, logger);

  if (!sessionResult.isAuthenticated) {
    logger.info(
      "Session not found; redirecting to login.",
      "handlePortalAgentSetupRoute",
      "RENDER_AGENT_SETUP_GUIDE_PAGE",
      { reason: sessionResult.reason },
    );
    return buildRedirectResponse(sessionResult.location, sessionResult.setCookie);
  }

  const mcpEndpointUrl = deriveMcpEndpointUrl(deps.config.publicUrl);

  logger.info(
    "Serving agent setup guide page.",
    "handlePortalAgentSetupRoute",
    "RENDER_AGENT_SETUP_GUIDE_PAGE",
    { userId: sessionResult.session.sub },
  );

  const guideContent = PortalConnectionGuide(mcpEndpointUrl);

  const body = (
    <div class="portal-wrapper">
      <nav class="portal-nav">
        <a href="/portal" class="portal-nav-brand" safe>{PLATFORM_NAME}</a>
        <div class="portal-nav-actions">
          <a href="/portal/home" class="btn btn-outline">Back to Home</a>
          <form method="post" action="/portal/logout" style="margin: 0;">
            <button type="submit" class="btn btn-logout">Sign out</button>
          </form>
        </div>
      </nav>

      {guideContent}

      <div style="margin-top: 1rem;">
        <a href="/portal/home" class="link">{"\u2190 Back to Portal Home"}</a>
      </div>
    </div>
  ) as string;

  return buildHtmlResponse(200, PortalLayout(`Agent Setup - ${PLATFORM_NAME}`, body));
  // END_BLOCK_RENDER_AGENT_SETUP_GUIDE_PAGE_M_PORTAL_UI_018
}

// START_CONTRACT: handlePortalLogoutRoute
//   PURPOSE: Handle POST /portal/logout, clear session.
//   INPUTS: { request: Request - Incoming HTTP request, deps: PortalUiDependencies - Runtime dependencies }
//   OUTPUTS: { Promise<Response> - 302 redirect to /portal/login with cleared session cookie }
//   SIDE_EFFECTS: [Clears portal session, writes structured log]
//   LINKS: [M-PORTAL-UI, M-PORTAL-AUTH]
// END_CONTRACT: handlePortalLogoutRoute
export async function handlePortalLogoutRoute(
  request: Request,
  deps: PortalUiDependencies,
): Promise<Response> {
  // START_BLOCK_CLEAR_SESSION_AND_REDIRECT_TO_LOGIN_M_PORTAL_UI_019
  const logger = deps.logger.child({ module: "PortalUiRoutes", handler: "handlePortalLogoutRoute" });

  logger.info(
    "Processing portal logout.",
    "handlePortalLogoutRoute",
    "CLEAR_SESSION_AND_REDIRECT_TO_LOGIN",
  );

  const clearCookie = clearPortalSession();

  return buildRedirectResponse("/portal/login", clearCookie);
  // END_BLOCK_CLEAR_SESSION_AND_REDIRECT_TO_LOGIN_M_PORTAL_UI_019
}
