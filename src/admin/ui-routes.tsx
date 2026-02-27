// FILE: src/admin/ui-routes.tsx
// VERSION: 2.3.0
// START_MODULE_CONTRACT
//   PURPOSE: Render admin login and authenticated operator diagnostics surfaces without legacy API-key route handling.
//   SCOPE: Route /admin/login and /admin/ops requests, enforce admin session checks, and render safe HTML diagnostics from runtime config.
//   DEPENDS: M-ADMIN-AUTH, M-LOGGER, M-CONFIG
//   LINKS: M-ADMIN-UI, M-ADMIN-AUTH, M-LOGGER, M-CONFIG
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AdminUiError - Typed admin UI error wrapper with ADMIN_UI_ERROR code.
//   AdminUiDependencies - Dependency contract for auth helpers, config, and logger.
//   renderAdminLayout - Render admin shell with Ops Diagnostics navigation.
//   renderOpsStatus - Render operator diagnostics panel derived from runtime config.
//   handleAdminRequest - Route login and ops diagnostics while enforcing session checks.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v2.3.0 - Rebased ops diagnostics on AppConfig.logto fields, removed legacy config.oauth references, and masked Logto client secret in rendered status output.
// END_CHANGE_SUMMARY

import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import {
  authenticateAdmin as authenticateAdminHelper,
  clearAdminSession as clearAdminSessionHelper,
  requireAdminSession as requireAdminSessionHelper,
} from "./auth";

const ADMIN_ROOT_PATH = "/admin";
const ADMIN_LOGIN_PATH = "/admin/login";
export const ADMIN_OPS_PATH = "/admin/ops";
const HX_REQUEST_HEADER = "HX-Request";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const OPS_TAB_LABEL = "Ops Diagnostics";

type ActiveTab = "ops";

type RenderAdminLayoutParams = {
  pageTitle: string;
  activeTab: ActiveTab;
  contentHtml: string;
};

type AuthenticateAdminResult = ReturnType<typeof authenticateAdminHelper>;
type RequireAdminSessionResult = ReturnType<typeof requireAdminSessionHelper>;

type AdminLoginSuccessResult = Extract<AuthenticateAdminResult, { isAuthenticated: true }>;
type AdminLoginFailureResult = Extract<AuthenticateAdminResult, { isAuthenticated: false }>;
type AdminSessionAllowResult = Extract<RequireAdminSessionResult, { isAuthenticated: true }>;
type AdminSessionDenyResult = Extract<RequireAdminSessionResult, { isAuthenticated: false }>;

type RenderOpsStatusModel = {
  publicUrl: string;
  logtoTenantUrl: string;
  logtoClientId: string;
  logtoClientSecretMasked: string;
  logtoOidcAuthEndpoint: string;
  logtoOidcTokenEndpoint: string;
  mcpUrl: string;
  wellKnownResourceUrl: string;
  wellKnownMcpResourceUrl: string;
};

type ResolvedAdminUiDependencies = {
  config: AppConfig;
  logger: Logger;
  authenticateAdmin: typeof authenticateAdminHelper;
  requireAdminSession: typeof requireAdminSessionHelper;
  clearAdminSession: typeof clearAdminSessionHelper;
};

export type AdminUiDependencies = {
  config: AppConfig;
  logger: Logger;
  authenticateAdmin?: typeof authenticateAdminHelper;
  requireAdminSession?: typeof requireAdminSessionHelper;
  clearAdminSession?: typeof clearAdminSessionHelper;
};

export class AdminUiError extends Error {
  public readonly code = "ADMIN_UI_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AdminUiError";
    this.details = details;
  }
}

// START_CONTRACT: toAdminUiError
//   PURPOSE: Normalize unknown failures into AdminUiError with safe diagnostics.
//   INPUTS: { error: unknown - Caught runtime failure, message: string - Stable error message, details: Record<string, unknown>|undefined - Optional context }
//   OUTPUTS: { AdminUiError - Typed admin UI error value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: toAdminUiError
function toAdminUiError(
  error: unknown,
  message: string,
  details?: Record<string, unknown>,
): AdminUiError {
  // START_BLOCK_NORMALIZE_UNKNOWN_ERRORS_TO_ADMIN_UI_ERROR_M_ADMIN_UI_101
  if (error instanceof AdminUiError) {
    return error;
  }

  const cause = error instanceof Error ? error.message : String(error);
  return new AdminUiError(message, {
    ...details,
    cause,
  });
  // END_BLOCK_NORMALIZE_UNKNOWN_ERRORS_TO_ADMIN_UI_ERROR_M_ADMIN_UI_101
}

// START_CONTRACT: escapeHtml
//   PURPOSE: Escape text before interpolation into HTML output.
//   INPUTS: { value: string - Raw text value that may contain special characters }
//   OUTPUTS: { string - HTML-escaped text safe for text and attribute contexts }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: escapeHtml
function escapeHtml(value: string): string {
  // START_BLOCK_ESCAPE_TEXT_FOR_SAFE_HTML_RENDERING_M_ADMIN_UI_102
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  // END_BLOCK_ESCAPE_TEXT_FOR_SAFE_HTML_RENDERING_M_ADMIN_UI_102
}

// START_CONTRACT: buildHtmlResponse
//   PURPOSE: Build HTML responses with optional custom headers.
//   INPUTS: { status: number - HTTP status code, html: string - Response HTML body, headers: Record<string, string>|undefined - Additional headers }
//   OUTPUTS: { Response - Bun-compatible HTML response object }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: buildHtmlResponse
function buildHtmlResponse(
  status: number,
  html: string,
  headers?: Record<string, string>,
): Response {
  // START_BLOCK_BUILD_STANDARD_HTML_RESPONSE_OBJECT_M_ADMIN_UI_103
  const responseHeaders = new Headers({ "content-type": HTML_CONTENT_TYPE });
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      responseHeaders.set(key, value);
    }
  }

  return new Response(html, { status, headers: responseHeaders });
  // END_BLOCK_BUILD_STANDARD_HTML_RESPONSE_OBJECT_M_ADMIN_UI_103
}

// START_CONTRACT: buildRedirectResponse
//   PURPOSE: Build redirect responses with optional Set-Cookie propagation.
//   INPUTS: { location: string - Redirect target path, setCookie: string|undefined - Optional cookie update value }
//   OUTPUTS: { Response - 302 redirect response }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: buildRedirectResponse
function buildRedirectResponse(location: string, setCookie?: string): Response {
  // START_BLOCK_BUILD_REDIRECT_RESPONSE_WITH_OPTIONAL_COOKIE_M_ADMIN_UI_104
  const headers: Record<string, string> = { location };
  if (setCookie) {
    headers["set-cookie"] = setCookie;
  }

  return new Response(null, {
    status: 302,
    headers,
  });
  // END_BLOCK_BUILD_REDIRECT_RESPONSE_WITH_OPTIONAL_COOKIE_M_ADMIN_UI_104
}

// START_CONTRACT: isHtmxRequest
//   PURPOSE: Determine whether a request originated from HTMX progressive enhancement.
//   INPUTS: { request: Request - Incoming HTTP request }
//   OUTPUTS: { boolean - True when HX-Request header equals "true" }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: isHtmxRequest
function isHtmxRequest(request: Request): boolean {
  // START_BLOCK_DETECT_HTMX_REQUEST_HEADER_M_ADMIN_UI_105
  const headerValue = request.headers.get(HX_REQUEST_HEADER);
  return typeof headerValue === "string" && headerValue.toLowerCase() === "true";
  // END_BLOCK_DETECT_HTMX_REQUEST_HEADER_M_ADMIN_UI_105
}

// START_CONTRACT: asFormString
//   PURPOSE: Normalize FormData values to trimmed string text.
//   INPUTS: { value: unknown - Raw form field value from request }
//   OUTPUTS: { string - Trimmed string value or empty string when non-text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: asFormString
function asFormString(value: unknown): string {
  // START_BLOCK_NORMALIZE_FORMDATA_FIELD_TO_STRING_M_ADMIN_UI_106
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
  // END_BLOCK_NORMALIZE_FORMDATA_FIELD_TO_STRING_M_ADMIN_UI_106
}

// START_CONTRACT: maskSecretValueForDiagnostics
//   PURPOSE: Prevent secret disclosure in rendered diagnostics while still signaling value presence.
//   INPUTS: { secretValue: string - Raw secret value from runtime config }
//   OUTPUTS: { string - Redacted secret placeholder text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: maskSecretValueForDiagnostics
function maskSecretValueForDiagnostics(secretValue: string): string {
  // START_BLOCK_MASK_SECRET_VALUE_FOR_SAFE_DIAGNOSTICS_RENDERING_M_ADMIN_UI_126
  const normalizedSecret = secretValue.trim();
  if (!normalizedSecret) {
    return "(missing)";
  }
  return "[REDACTED]";
  // END_BLOCK_MASK_SECRET_VALUE_FOR_SAFE_DIAGNOSTICS_RENDERING_M_ADMIN_UI_126
}

// START_CONTRACT: resolveDependencies
//   PURPOSE: Resolve optional dependency overrides to concrete auth helpers for route execution.
//   INPUTS: { deps: AdminUiDependencies - Admin UI dependency object with optional helper overrides }
//   OUTPUTS: { ResolvedAdminUiDependencies - Fully resolved dependencies }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-ADMIN-AUTH]
// END_CONTRACT: resolveDependencies
function resolveDependencies(deps: AdminUiDependencies): ResolvedAdminUiDependencies {
  // START_BLOCK_RESOLVE_OPTIONAL_AUTH_HELPER_DEPENDENCIES_M_ADMIN_UI_107
  return {
    config: deps.config,
    logger: deps.logger,
    authenticateAdmin: deps.authenticateAdmin ?? authenticateAdminHelper,
    requireAdminSession: deps.requireAdminSession ?? requireAdminSessionHelper,
    clearAdminSession: deps.clearAdminSession ?? clearAdminSessionHelper,
  };
  // END_BLOCK_RESOLVE_OPTIONAL_AUTH_HELPER_DEPENDENCIES_M_ADMIN_UI_107
}

// START_CONTRACT: isAdminSessionAllowResult
//   PURPOSE: Narrow admin session result union to authenticated allow branch.
//   INPUTS: { result: RequireAdminSessionResult - Session validation result }
//   OUTPUTS: { result is AdminSessionAllowResult - True when authenticated }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-ADMIN-AUTH]
// END_CONTRACT: isAdminSessionAllowResult
function isAdminSessionAllowResult(result: RequireAdminSessionResult): result is AdminSessionAllowResult {
  // START_BLOCK_NARROW_ADMIN_SESSION_ALLOW_RESULT_M_ADMIN_UI_122
  return result.isAuthenticated;
  // END_BLOCK_NARROW_ADMIN_SESSION_ALLOW_RESULT_M_ADMIN_UI_122
}

// START_CONTRACT: isAdminSessionDenyResult
//   PURPOSE: Narrow admin session result union to denied redirect branch.
//   INPUTS: { result: RequireAdminSessionResult - Session validation result }
//   OUTPUTS: { result is AdminSessionDenyResult - True when unauthenticated }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-ADMIN-AUTH]
// END_CONTRACT: isAdminSessionDenyResult
function isAdminSessionDenyResult(result: RequireAdminSessionResult): result is AdminSessionDenyResult {
  // START_BLOCK_NARROW_ADMIN_SESSION_DENY_RESULT_M_ADMIN_UI_123
  return !result.isAuthenticated;
  // END_BLOCK_NARROW_ADMIN_SESSION_DENY_RESULT_M_ADMIN_UI_123
}

// START_CONTRACT: isAdminLoginSuccessResult
//   PURPOSE: Narrow authenticateAdmin result union to success branch.
//   INPUTS: { result: AuthenticateAdminResult - Admin login result }
//   OUTPUTS: { result is AdminLoginSuccessResult - True when login succeeded }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-ADMIN-AUTH]
// END_CONTRACT: isAdminLoginSuccessResult
function isAdminLoginSuccessResult(result: AuthenticateAdminResult): result is AdminLoginSuccessResult {
  // START_BLOCK_NARROW_ADMIN_LOGIN_SUCCESS_RESULT_M_ADMIN_UI_124
  return result.isAuthenticated;
  // END_BLOCK_NARROW_ADMIN_LOGIN_SUCCESS_RESULT_M_ADMIN_UI_124
}

// START_CONTRACT: isAdminLoginFailureResult
//   PURPOSE: Narrow authenticateAdmin result union to failure branch.
//   INPUTS: { result: AuthenticateAdminResult - Admin login result }
//   OUTPUTS: { result is AdminLoginFailureResult - True when login failed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-ADMIN-AUTH]
// END_CONTRACT: isAdminLoginFailureResult
function isAdminLoginFailureResult(result: AuthenticateAdminResult): result is AdminLoginFailureResult {
  // START_BLOCK_NARROW_ADMIN_LOGIN_FAILURE_RESULT_M_ADMIN_UI_125
  return !result.isAuthenticated;
  // END_BLOCK_NARROW_ADMIN_LOGIN_FAILURE_RESULT_M_ADMIN_UI_125
}

// START_CONTRACT: buildOpsStatusModel
//   PURPOSE: Derive diagnostics fields and URLs from runtime configuration for operator panel rendering.
//   INPUTS: { config: AppConfig - Runtime app configuration }
//   OUTPUTS: { RenderOpsStatusModel - Diagnostics model with derived resource URLs }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-CONFIG]
// END_CONTRACT: buildOpsStatusModel
function buildOpsStatusModel(config: AppConfig): RenderOpsStatusModel {
  // START_BLOCK_DERIVE_DIAGNOSTICS_MODEL_FROM_RUNTIME_CONFIG_M_ADMIN_UI_108
  return {
    publicUrl: config.publicUrl,
    logtoTenantUrl: config.logto.tenantUrl,
    logtoClientId: config.logto.clientId,
    logtoClientSecretMasked: maskSecretValueForDiagnostics(config.logto.clientSecret),
    logtoOidcAuthEndpoint: config.logto.oidcAuthEndpoint,
    logtoOidcTokenEndpoint: config.logto.oidcTokenEndpoint,
    mcpUrl: new URL("/mcp", config.publicUrl).toString(),
    wellKnownResourceUrl: new URL("/.well-known/oauth-protected-resource", config.publicUrl).toString(),
    wellKnownMcpResourceUrl: new URL(
      "/.well-known/oauth-protected-resource/mcp",
      config.publicUrl,
    ).toString(),
  };
  // END_BLOCK_DERIVE_DIAGNOSTICS_MODEL_FROM_RUNTIME_CONFIG_M_ADMIN_UI_108
}

// START_CONTRACT: renderDiagnosticsTableRows
//   PURPOSE: Render escaped diagnostics key-value rows for operator status table.
//   INPUTS: { rows: Array<[label: string, value: string]> - Diagnostics table rows }
//   OUTPUTS: { string - HTML rows fragment }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: renderDiagnosticsTableRows
function renderDiagnosticsTableRows(rows: Array<[label: string, value: string]>): string {
  // START_BLOCK_RENDER_ESCAPED_DIAGNOSTICS_TABLE_ROWS_M_ADMIN_UI_109
  return rows
    .map(([label, value]) => {
      return [
        `<tr>`,
        `<th scope="row">${escapeHtml(label)}</th>`,
        `<td><code>${escapeHtml(value)}</code></td>`,
        `</tr>`,
      ].join("");
    })
    .join("");
  // END_BLOCK_RENDER_ESCAPED_DIAGNOSTICS_TABLE_ROWS_M_ADMIN_UI_109
}

// START_CONTRACT: renderOpsStatus
//   PURPOSE: Render operator diagnostics panel from config with Logto runtime settings and derived endpoint URLs.
//   INPUTS: { config: AppConfig - Runtime app configuration }
//   OUTPUTS: { string - HTML diagnostics panel fragment }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-CONFIG]
// END_CONTRACT: renderOpsStatus
export function renderOpsStatus(config: AppConfig): string {
  // START_BLOCK_RENDER_OPERATIONS_DIAGNOSTICS_PANEL_M_ADMIN_UI_110
  const diagnostics = buildOpsStatusModel(config);

  const rows = renderDiagnosticsTableRows([
    ["PUBLIC_URL", diagnostics.publicUrl],
    ["LOGTO_TENANT_URL", diagnostics.logtoTenantUrl],
    ["LOGTO_CLIENT_ID", diagnostics.logtoClientId],
    ["LOGTO_CLIENT_SECRET", diagnostics.logtoClientSecretMasked],
    ["LOGTO_OIDC_AUTH_ENDPOINT", diagnostics.logtoOidcAuthEndpoint],
    ["LOGTO_OIDC_TOKEN_ENDPOINT", diagnostics.logtoOidcTokenEndpoint],
    ["Derived /mcp URL", diagnostics.mcpUrl],
    ["Derived protected resource URL", diagnostics.wellKnownResourceUrl],
    ["Derived MCP protected resource URL", diagnostics.wellKnownMcpResourceUrl],
  ]);

  return [
    `<section id="ops-status-panel" class="stack">`,
    `<section class="card">`,
    `<h2>Ops diagnostics</h2>`,
    `<p class="muted">Runtime admin and Logto OAuth proxy settings loaded from environment and used by server routing.</p>`,
    `</section>`,
    `<section class="card table-wrap">`,
    `<h3>Configuration status</h3>`,
    `<table class="diag-table">`,
    `<tbody>`,
    rows,
    `</tbody>`,
    `</table>`,
    `</section>`,
    `</section>`,
  ].join("");
  // END_BLOCK_RENDER_OPERATIONS_DIAGNOSTICS_PANEL_M_ADMIN_UI_110
}

// START_CONTRACT: renderLoginDocument
//   PURPOSE: Render the login page for admin authentication requests.
//   INPUTS: { errorMessage: string|undefined - Optional authentication failure message }
//   OUTPUTS: { string - Full login HTML document }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-ADMIN-AUTH]
// END_CONTRACT: renderLoginDocument
function renderLoginDocument(errorMessage?: string): string {
  // START_BLOCK_RENDER_ADMIN_LOGIN_DOCUMENT_M_ADMIN_UI_112
  const escapedError = errorMessage ? `<div class="flash flash-error">${escapeHtml(errorMessage)}</div>` : "";
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>Admin Login</title>`,
    `<style>`,
    `:root { color-scheme: light; --bg:#f4f7fb; --fg:#0f172a; --card:#ffffff; --line:#cbd5e1; --accent:#0f766e; --danger:#b91c1c; }`,
    `* { box-sizing: border-box; }`,
    `body { margin:0; font-family:"IBM Plex Sans", ui-sans-serif, sans-serif; background: var(--bg); color: var(--fg); min-height: 100vh; display:grid; place-items:center; padding:1rem; }`,
    `.card { width:min(30rem, 100%); background: var(--card); border:1px solid var(--line); border-radius:0.75rem; padding:1.25rem; display:grid; gap:0.75rem; }`,
    `h1 { margin:0; font-size:1.5rem; }`,
    `label { font-weight:600; font-size:0.9rem; }`,
    `input, button { width:100%; border-radius:0.5rem; padding:0.65rem 0.75rem; border:1px solid var(--line); font: inherit; }`,
    `button { background: var(--accent); color:#fff; border:none; cursor:pointer; font-weight:600; }`,
    `.flash { border-radius:0.5rem; padding:0.6rem 0.75rem; border:1px solid #fecaca; background:#fef2f2; color:var(--danger); }`,
    `</style>`,
    `</head>`,
    `<body>`,
    `<main class="card">`,
    `<h1>Admin Login</h1>`,
    `<p>Enter the root admin token to access operator diagnostics.</p>`,
    escapedError,
    `<form method="post" action="${ADMIN_LOGIN_PATH}">`,
    `<label for="token">ROOT_AUTH_TOKEN</label>`,
    `<input id="token" name="token" type="password" autocomplete="current-password" required />`,
    `<button type="submit">Sign in</button>`,
    `</form>`,
    `</main>`,
    `</body>`,
    `</html>`,
  ].join("");
  // END_BLOCK_RENDER_ADMIN_LOGIN_DOCUMENT_M_ADMIN_UI_112
}

// START_CONTRACT: renderAdminLayout
//   PURPOSE: Render admin page shell with sidebar navigation and injected content body.
//   INPUTS: { params: RenderAdminLayoutParams - Layout title, active tab, and content HTML }
//   OUTPUTS: { string - Full admin HTML document with HTMX script }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: renderAdminLayout
export function renderAdminLayout(params: RenderAdminLayoutParams): string {
  // START_BLOCK_RENDER_ADMIN_LAYOUT_DOCUMENT_WITH_OPS_NAV_M_ADMIN_UI_113
  const escapedPageTitle = escapeHtml(params.pageTitle);
  const isOpsTab = params.activeTab === "ops";
  const opsTabClass = isOpsTab ? "nav-link nav-link-active" : "nav-link";

  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>${escapedPageTitle}</title>`,
    `<script src="https://unpkg.com/htmx.org@1.9.12"></script>`,
    `<style>`,
    `:root { color-scheme: light; --bg:#eef3f8; --fg:#1e293b; --card:#fff; --line:#cbd5e1; --accent:#0f766e; --accent-soft:#ccfbf1; --warning:#9a3412; --warning-bg:#fff7ed; --danger:#991b1b; --danger-bg:#fef2f2; }`,
    `* { box-sizing: border-box; }`,
    `body { margin:0; min-height:100vh; background: radial-gradient(circle at top left, #dbeafe 0%, #eef3f8 45%); color:var(--fg); font-family:"IBM Plex Sans", ui-sans-serif, sans-serif; }`,
    `.layout { display:grid; grid-template-columns: 16rem 1fr; min-height:100vh; }`,
    `.sidebar { border-right:1px solid var(--line); background:#f8fafc; padding:1rem; }`,
    `.brand { font-weight:700; margin:0 0 1rem; }`,
    `.nav-link { display:block; text-decoration:none; color:var(--fg); border-radius:0.5rem; padding:0.65rem 0.75rem; font-weight:600; border:1px solid transparent; }`,
    `.nav-link-active { background:var(--accent-soft); border-color:#99f6e4; color:#115e59; }`,
    `.content { padding:1rem; }`,
    `.stack { display:grid; gap:0.85rem; }`,
    `.card { border:1px solid var(--line); border-radius:0.75rem; background:var(--card); padding:1rem; }`,
    `.warning-card { background:var(--warning-bg); }`,
    `.warning { color:var(--warning); font-weight:600; }`,
    `.flash { border-radius:0.65rem; padding:0.65rem 0.75rem; border:1px solid transparent; }`,
    `.flash-error { background:var(--danger-bg); color:var(--danger); border-color:#fecaca; }`,
    `.muted { color:#475569; font-size:0.92rem; }`,
    `.table-wrap { overflow-x:auto; }`,
    `.diag-table { width:100%; border-collapse:collapse; }`,
    `.diag-table th, .diag-table td { text-align:left; border-bottom:1px solid var(--line); padding:0.6rem; vertical-align:top; }`,
    `.diag-table th { min-width: 18rem; width: 34%; }`,
    `.diag-table code { overflow-wrap:anywhere; }`,
    `@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } .sidebar { border-right:none; border-bottom:1px solid var(--line); } .content { padding:0.85rem; } .diag-table th { min-width: auto; width: 45%; } }`,
    `</style>`,
    `</head>`,
    `<body>`,
    `<div class="layout">`,
    `<aside class="sidebar">`,
    `<p class="brand">Admin Console</p>`,
    `<nav>`,
    `<a class="${opsTabClass}" href="${ADMIN_OPS_PATH}">${OPS_TAB_LABEL}</a>`,
    `</nav>`,
    `</aside>`,
    `<main class="content">`,
    params.contentHtml,
    `</main>`,
    `</div>`,
    `</body>`,
    `</html>`,
  ].join("");
  // END_BLOCK_RENDER_ADMIN_LAYOUT_DOCUMENT_WITH_OPS_NAV_M_ADMIN_UI_113
}

// START_CONTRACT: handleAdminRequest
//   PURPOSE: Dispatch admin route requests for login and authenticated ops diagnostics.
//   INPUTS: { request: Request - Incoming admin HTTP request, deps: AdminUiDependencies - Runtime dependencies and auth helper hooks }
//   OUTPUTS: { Promise<Response> - HTML response, HTMX fragment, or redirect response }
//   SIDE_EFFECTS: [Calls auth dependencies, emits structured logs]
//   LINKS: [M-ADMIN-UI, M-ADMIN-AUTH, M-LOGGER, M-CONFIG]
// END_CONTRACT: handleAdminRequest
export async function handleAdminRequest(
  request: Request,
  deps: AdminUiDependencies,
): Promise<Response> {
  // START_BLOCK_ROUTE_AND_DISPATCH_ADMIN_REQUESTS_M_ADMIN_UI_115
  const resolvedDeps = resolveDependencies(deps);
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();
  const htmx = isHtmxRequest(request);
  const logger = resolvedDeps.logger.child({
    module: "AdminUiRoutes",
    pathname,
    method,
    htmx,
  });

  logger.info("Handling admin request.", "handleAdminRequest", "ROUTE_AND_DISPATCH_ADMIN_REQUESTS", {
    pathname,
    method,
    htmx,
  });
  // END_BLOCK_ROUTE_AND_DISPATCH_ADMIN_REQUESTS_M_ADMIN_UI_115

  try {
    // START_BLOCK_HANDLE_ADMIN_LOGIN_ROUTE_M_ADMIN_UI_116
    if (pathname === ADMIN_LOGIN_PATH) {
      if (method === "GET") {
        const sessionCheck = resolvedDeps.requireAdminSession(request, resolvedDeps.config, logger);
        if (isAdminSessionAllowResult(sessionCheck)) {
          logger.debug(
            "Session already authenticated; redirecting away from login.",
            "handleAdminRequest",
            "HANDLE_ADMIN_LOGIN_ROUTE",
          );
          return buildRedirectResponse(ADMIN_OPS_PATH);
        }

        return buildHtmlResponse(
          200,
          renderLoginDocument(),
          sessionCheck.setCookie ? { "set-cookie": sessionCheck.setCookie } : undefined,
        );
      }

      if (method === "POST") {
        const formData = await request.formData();
        const token = asFormString(formData.get("token"));
        const authResult = resolvedDeps.authenticateAdmin(token, resolvedDeps.config, logger);

        if (isAdminLoginSuccessResult(authResult)) {
          logger.info(
            "Admin login successful.",
            "handleAdminRequest",
            "HANDLE_ADMIN_LOGIN_ROUTE",
          );
          return buildRedirectResponse(ADMIN_OPS_PATH, authResult.sessionCookie);
        }

        if (isAdminLoginFailureResult(authResult)) {
          logger.warn(
            "Admin login failed.",
            "handleAdminRequest",
            "HANDLE_ADMIN_LOGIN_ROUTE",
            { reason: authResult.reason },
          );

          const errorMessage =
            authResult.reason === "DISALLOWED_MCP_BEARER_FORMAT"
              ? "Use the root admin token value directly (without Bearer prefix)."
              : "Invalid root admin token.";

          return buildHtmlResponse(401, renderLoginDocument(errorMessage), {
            "set-cookie": resolvedDeps.clearAdminSession(),
          });
        }

        throw new AdminUiError("Unexpected authenticateAdmin result state.");
      }

      return buildHtmlResponse(405, renderLoginDocument("Method not allowed."));
    }
    // END_BLOCK_HANDLE_ADMIN_LOGIN_ROUTE_M_ADMIN_UI_116

    // START_BLOCK_ENFORCE_ADMIN_SESSION_FOR_PROTECTED_ROUTES_M_ADMIN_UI_117
    if (!pathname.startsWith(ADMIN_ROOT_PATH)) {
      return buildHtmlResponse(404, "<h1>Not Found</h1>");
    }

    const sessionCheck = resolvedDeps.requireAdminSession(request, resolvedDeps.config, logger);
    if (isAdminSessionDenyResult(sessionCheck)) {
      logger.info(
        "Admin session rejected; redirecting to login.",
        "handleAdminRequest",
        "ENFORCE_ADMIN_SESSION_FOR_PROTECTED_ROUTES",
        { reason: sessionCheck.reason },
      );
      return buildRedirectResponse(sessionCheck.location, sessionCheck.setCookie);
    }
    // END_BLOCK_ENFORCE_ADMIN_SESSION_FOR_PROTECTED_ROUTES_M_ADMIN_UI_117

    // START_BLOCK_HANDLE_ADMIN_OPS_ROUTE_M_ADMIN_UI_118
    if (pathname === ADMIN_ROOT_PATH && method === "GET") {
      return buildRedirectResponse(ADMIN_OPS_PATH);
    }

    if (pathname === ADMIN_OPS_PATH && method === "GET") {
      const opsPanelHtml = renderOpsStatus(resolvedDeps.config);
      if (htmx) {
        return buildHtmlResponse(200, opsPanelHtml);
      }

      return buildHtmlResponse(
        200,
        renderAdminLayout({
          pageTitle: "Admin - Ops Diagnostics",
          activeTab: "ops",
          contentHtml: opsPanelHtml,
        }),
      );
    }
    // END_BLOCK_HANDLE_ADMIN_OPS_ROUTE_M_ADMIN_UI_118

    // START_BLOCK_RETURN_ADMIN_ROUTE_ERRORS_M_ADMIN_UI_120
    return buildHtmlResponse(404, "<h1>Not Found</h1>");
    // END_BLOCK_RETURN_ADMIN_ROUTE_ERRORS_M_ADMIN_UI_120
  } catch (error: unknown) {
    // START_BLOCK_MAP_ROUTE_FAILURES_TO_SAFE_HTML_RESPONSES_M_ADMIN_UI_121
    const adminUiError = toAdminUiError(error, "Admin UI request handling failed.", {
      pathname,
      method,
    });

    logger.error(
      "Admin UI request failed unexpectedly.",
      "handleAdminRequest",
      "MAP_ROUTE_FAILURES_TO_SAFE_HTML_RESPONSES",
      {
        code: adminUiError.code,
        pathname,
        method,
        cause: adminUiError.details?.cause ?? adminUiError.message,
      },
    );

    if (htmx) {
      return buildHtmlResponse(
        500,
        `<div class="flash flash-error">Unexpected admin error. Try again.</div>`,
      );
    }

    if (pathname === ADMIN_LOGIN_PATH) {
      return buildHtmlResponse(500, renderLoginDocument("Unexpected admin error. Try again."));
    }

    return buildHtmlResponse(
      500,
      renderAdminLayout({
        pageTitle: "Admin - Error",
        activeTab: "ops",
        contentHtml: `<section class="card"><h2>Unexpected admin error</h2><p class="warning">Try again or check server logs.</p></section>`,
      }),
    );
    // END_BLOCK_MAP_ROUTE_FAILURES_TO_SAFE_HTML_RESPONSES_M_ADMIN_UI_121
  }
}
