// FILE: src/admin/ui-routes.tsx
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Render admin HTML pages and HTMX fragments for login and API key lifecycle management.
//   SCOPE: Route /admin/login and /admin/api-keys requests, enforce admin session checks, and render safe HTML for API key list/create/revoke flows.
//   DEPENDS: M-ADMIN-AUTH, M-API-KEY-REPOSITORY, M-LOGGER, M-CONFIG
//   LINKS: M-ADMIN-UI, M-ADMIN-AUTH, M-API-KEY-REPOSITORY, M-LOGGER, M-CONFIG
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AdminUiError - Typed admin UI error wrapper with ADMIN_UI_ERROR code.
//   AdminUiDependencies - Dependency contract for auth helpers, config, logger, and API key repository.
//   handleAdminRequest - Route /admin/login and /admin/api-keys GET/POST/DELETE admin UI actions.
//   renderAdminLayout - Render admin shell with sidebar and active Api Keys tab.
//   renderApiKeysTable - Render HTMX-refreshable API keys table fragment with revoke controls.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v1.0.0 - Initial generation for M-ADMIN-UI admin route handling and HTMX UI rendering.]
// END_CHANGE_SUMMARY

import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import type { ApiKeyRecord, ApiKeyRepository } from "./api-key-repository";
import {
  authenticateAdmin as authenticateAdminHelper,
  clearAdminSession as clearAdminSessionHelper,
  requireAdminSession as requireAdminSessionHelper,
} from "./auth";

const ADMIN_ROOT_PATH = "/admin";
const ADMIN_LOGIN_PATH = "/admin/login";
const ADMIN_API_KEYS_PATH = "/admin/api-keys";
const HX_REQUEST_HEADER = "HX-Request";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const API_KEYS_TAB_LABEL = "Api Keys";

type ActiveTab = "api-keys";

type RenderAdminLayoutParams = {
  pageTitle: string;
  activeTab: ActiveTab;
  contentHtml: string;
};

type RenderApiKeysPanelParams = {
  records: ApiKeyRecord[];
  errorMessage?: string;
  successMessage?: string;
  revealedApiKey?: string;
  draftLabel?: string;
  draftExpiresAt?: string;
};

type RevokeRouteMatch = {
  id: string;
  source: "delete" | "post-revoke";
};

type ResolvedAdminUiDependencies = {
  config: AppConfig;
  logger: Logger;
  apiKeyRepository: ApiKeyRepository;
  authenticateAdmin: typeof authenticateAdminHelper;
  requireAdminSession: typeof requireAdminSessionHelper;
  clearAdminSession: typeof clearAdminSessionHelper;
};

export type AdminUiDependencies = {
  config: AppConfig;
  logger: Logger;
  apiKeyRepository: ApiKeyRepository;
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
//   INPUTS: { error: unknown - Caught runtime failure, message: string - Stable error message, details: Record<string, unknown>|undefined - Optional structured context }
//   OUTPUTS: { AdminUiError - Typed admin UI error value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: toAdminUiError
function toAdminUiError(
  error: unknown,
  message: string,
  details?: Record<string, unknown>,
): AdminUiError {
  // START_BLOCK_NORMALIZE_UNKNOWN_ERRORS_TO_ADMIN_UI_ERROR_M_ADMIN_UI_023
  if (error instanceof AdminUiError) {
    return error;
  }

  const cause = error instanceof Error ? error.message : String(error);
  return new AdminUiError(message, {
    ...details,
    cause,
  });
  // END_BLOCK_NORMALIZE_UNKNOWN_ERRORS_TO_ADMIN_UI_ERROR_M_ADMIN_UI_023
}

// START_CONTRACT: escapeHtml
//   PURPOSE: Escape user-provided text before interpolation into HTML output.
//   INPUTS: { value: string - Raw text value that may contain special HTML characters }
//   OUTPUTS: { string - HTML-escaped text safe for text and attribute contexts }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: escapeHtml
function escapeHtml(value: string): string {
  // START_BLOCK_ESCAPE_USER_PROVIDED_HTML_TEXT_M_ADMIN_UI_001
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  // END_BLOCK_ESCAPE_USER_PROVIDED_HTML_TEXT_M_ADMIN_UI_001
}

// START_CONTRACT: formatDateTimeUtc
//   PURPOSE: Render optional Date values in a stable UTC format for admin tables.
//   INPUTS: { value: Date|null - Date value from repository metadata }
//   OUTPUTS: { string - ISO timestamp string or em dash placeholder }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: formatDateTimeUtc
function formatDateTimeUtc(value: Date | null): string {
  // START_BLOCK_FORMAT_OPTIONAL_DATE_AS_UTC_STRING_M_ADMIN_UI_002
  if (value === null) {
    return "&mdash;";
  }
  return escapeHtml(value.toISOString());
  // END_BLOCK_FORMAT_OPTIONAL_DATE_AS_UTC_STRING_M_ADMIN_UI_002
}

// START_CONTRACT: buildHtmlResponse
//   PURPOSE: Build HTML responses with optional extra headers.
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
  // START_BLOCK_BUILD_STANDARD_HTML_RESPONSE_OBJECT_M_ADMIN_UI_003
  const responseHeaders = new Headers({ "content-type": HTML_CONTENT_TYPE });
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      responseHeaders.set(key, value);
    }
  }
  return new Response(html, { status, headers: responseHeaders });
  // END_BLOCK_BUILD_STANDARD_HTML_RESPONSE_OBJECT_M_ADMIN_UI_003
}

// START_CONTRACT: buildRedirectResponse
//   PURPOSE: Build redirect responses with optional Set-Cookie propagation.
//   INPUTS: { location: string - Redirect target path, setCookie: string|undefined - Optional cookie update value }
//   OUTPUTS: { Response - 302 redirect response }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: buildRedirectResponse
function buildRedirectResponse(location: string, setCookie?: string): Response {
  // START_BLOCK_BUILD_REDIRECT_RESPONSE_WITH_OPTIONAL_COOKIE_M_ADMIN_UI_004
  const headers: Record<string, string> = {
    location,
  };
  if (setCookie) {
    headers["set-cookie"] = setCookie;
  }
  return new Response(null, {
    status: 302,
    headers,
  });
  // END_BLOCK_BUILD_REDIRECT_RESPONSE_WITH_OPTIONAL_COOKIE_M_ADMIN_UI_004
}

// START_CONTRACT: isHtmxRequest
//   PURPOSE: Determine whether a request originated from HTMX progressive enhancement.
//   INPUTS: { request: Request - Incoming HTTP request }
//   OUTPUTS: { boolean - True when HX-Request header equals "true" }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: isHtmxRequest
function isHtmxRequest(request: Request): boolean {
  // START_BLOCK_DETECT_HTMX_REQUEST_HEADER_M_ADMIN_UI_005
  const headerValue = request.headers.get(HX_REQUEST_HEADER);
  return typeof headerValue === "string" && headerValue.toLowerCase() === "true";
  // END_BLOCK_DETECT_HTMX_REQUEST_HEADER_M_ADMIN_UI_005
}

// START_CONTRACT: asFormString
//   PURPOSE: Normalize FormData values to string values and trim surrounding whitespace.
//   INPUTS: { value: unknown - Raw form field value from request }
//   OUTPUTS: { string - Trimmed string form of field value, empty when missing or non-text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: asFormString
function asFormString(value: unknown): string {
  // START_BLOCK_NORMALIZE_FORMDATA_FIELD_TO_STRING_M_ADMIN_UI_006
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
  // END_BLOCK_NORMALIZE_FORMDATA_FIELD_TO_STRING_M_ADMIN_UI_006
}

// START_CONTRACT: parseOptionalExpiryField
//   PURPOSE: Parse optional expires_at form input into Date|null with validation feedback.
//   INPUTS: { rawExpiresAt: string - Form field value for expires_at }
//   OUTPUTS: { { expiresAt: Date|null, errorMessage?: string } - Parsed expiry data and validation error state }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: parseOptionalExpiryField
function parseOptionalExpiryField(rawExpiresAt: string): { expiresAt: Date | null; errorMessage?: string } {
  // START_BLOCK_PARSE_AND_VALIDATE_OPTIONAL_EXPIRY_FIELD_M_ADMIN_UI_007
  if (!rawExpiresAt) {
    return { expiresAt: null };
  }

  const parsed = new Date(rawExpiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return {
      expiresAt: null,
      errorMessage: "Expiration timestamp is invalid.",
    };
  }

  return { expiresAt: parsed };
  // END_BLOCK_PARSE_AND_VALIDATE_OPTIONAL_EXPIRY_FIELD_M_ADMIN_UI_007
}

// START_CONTRACT: classifyApiKeyStatus
//   PURPOSE: Build human-readable API key status from record lifecycle fields.
//   INPUTS: { record: ApiKeyRecord - API key metadata record }
//   OUTPUTS: { string - Status label for table rendering }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: classifyApiKeyStatus
function classifyApiKeyStatus(record: ApiKeyRecord): string {
  // START_BLOCK_CLASSIFY_API_KEY_STATUS_FOR_TABLE_M_ADMIN_UI_008
  if (record.revokedAt !== null) {
    return "Revoked";
  }

  if (record.expiresAt !== null && record.expiresAt.getTime() <= Date.now()) {
    return "Expired";
  }

  return "Active";
  // END_BLOCK_CLASSIFY_API_KEY_STATUS_FOR_TABLE_M_ADMIN_UI_008
}

// START_CONTRACT: parseRevokeRoute
//   PURPOSE: Parse /admin/api-keys/:id and /admin/api-keys/:id/revoke route variants.
//   INPUTS: { pathname: string - URL pathname, method: string - HTTP method in uppercase }
//   OUTPUTS: { RevokeRouteMatch|null - Parsed key id and route source when route is a revoke action }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: parseRevokeRoute
function parseRevokeRoute(pathname: string, method: string): RevokeRouteMatch | null {
  // START_BLOCK_PARSE_API_KEY_REVOKE_ROUTE_VARIANTS_M_ADMIN_UI_009
  const parts = pathname.split("/").filter((segment) => segment.length > 0);
  if (parts.length < 3 || parts[0] !== "admin" || parts[1] !== "api-keys") {
    return null;
  }

  const rawId = parts[2];
  if (!rawId) {
    return null;
  }

  let decodedId: string;
  try {
    decodedId = decodeURIComponent(rawId);
  } catch {
    return null;
  }

  if (method === "DELETE" && parts.length === 3) {
    return { id: decodedId, source: "delete" };
  }

  if (method === "POST" && parts.length === 4 && parts[3] === "revoke") {
    return { id: decodedId, source: "post-revoke" };
  }

  return null;
  // END_BLOCK_PARSE_API_KEY_REVOKE_ROUTE_VARIANTS_M_ADMIN_UI_009
}

// START_CONTRACT: resolveDependencies
//   PURPOSE: Resolve optional dependency overrides to concrete auth helpers for route execution.
//   INPUTS: { deps: AdminUiDependencies - Admin UI dependency object with optional helper overrides }
//   OUTPUTS: { ResolvedAdminUiDependencies - Fully resolved dependencies }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-ADMIN-AUTH]
// END_CONTRACT: resolveDependencies
function resolveDependencies(deps: AdminUiDependencies): ResolvedAdminUiDependencies {
  // START_BLOCK_RESOLVE_OPTIONAL_AUTH_HELPER_DEPENDENCIES_M_ADMIN_UI_010
  return {
    config: deps.config,
    logger: deps.logger,
    apiKeyRepository: deps.apiKeyRepository,
    authenticateAdmin: deps.authenticateAdmin ?? authenticateAdminHelper,
    requireAdminSession: deps.requireAdminSession ?? requireAdminSessionHelper,
    clearAdminSession: deps.clearAdminSession ?? clearAdminSessionHelper,
  };
  // END_BLOCK_RESOLVE_OPTIONAL_AUTH_HELPER_DEPENDENCIES_M_ADMIN_UI_010
}

// START_CONTRACT: renderFlash
//   PURPOSE: Render status flash messages safely for admin UI panels.
//   INPUTS: { message: string|undefined - Message content, tone: "error"|"success" - Visual tone }
//   OUTPUTS: { string - HTML fragment for message or empty string }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: renderFlash
function renderFlash(message: string | undefined, tone: "error" | "success"): string {
  // START_BLOCK_RENDER_FLASH_MESSAGE_FRAGMENT_M_ADMIN_UI_011
  if (!message) {
    return "";
  }

  const toneClass = tone === "error" ? "flash flash-error" : "flash flash-success";
  return `<div class="${toneClass}">${escapeHtml(message)}</div>`;
  // END_BLOCK_RENDER_FLASH_MESSAGE_FRAGMENT_M_ADMIN_UI_011
}

// START_CONTRACT: renderApiKeyReveal
//   PURPOSE: Render one-time API key reveal panel used immediately after key creation.
//   INPUTS: { revealedApiKey: string|undefined - Newly created raw key value }
//   OUTPUTS: { string - HTML fragment for reveal panel or empty string }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: renderApiKeyReveal
function renderApiKeyReveal(revealedApiKey: string | undefined): string {
  // START_BLOCK_RENDER_ONE_TIME_API_KEY_REVEAL_PANEL_M_ADMIN_UI_012
  if (!revealedApiKey) {
    return "";
  }

  return [
    `<section class="card reveal-card" aria-live="polite">`,
    `<h3>New API key generated</h3>`,
    `<p class="warning">Warning: this raw API key is shown exactly once. Copy it now.</p>`,
    `<code class="raw-key">${escapeHtml(revealedApiKey)}</code>`,
    `</section>`,
  ].join("");
  // END_BLOCK_RENDER_ONE_TIME_API_KEY_REVEAL_PANEL_M_ADMIN_UI_012
}

// START_CONTRACT: renderApiKeysPanel
//   PURPOSE: Render API key management section including warning banner, create form, optional reveal, and table.
//   INPUTS: { params: RenderApiKeysPanelParams - UI state for the API key management panel }
//   OUTPUTS: { string - HTML fragment for panel body }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-API-KEY-REPOSITORY]
// END_CONTRACT: renderApiKeysPanel
function renderApiKeysPanel(params: RenderApiKeysPanelParams): string {
  // START_BLOCK_RENDER_API_KEY_MANAGEMENT_PANEL_M_ADMIN_UI_013
  const draftLabel = escapeHtml(params.draftLabel ?? "");
  const draftExpiresAt = escapeHtml(params.draftExpiresAt ?? "");

  return [
    `<section id="api-keys-panel" class="stack">`,
    `<section class="card warning-card">`,
    `<h2>API key lifecycle</h2>`,
    `<p class="warning">Warning: raw API keys are displayed only once after creation.</p>`,
    `</section>`,
    renderFlash(params.errorMessage, "error"),
    renderFlash(params.successMessage, "success"),
    renderApiKeyReveal(params.revealedApiKey),
    `<section class="card">`,
    `<h3>Create API key</h3>`,
    `<form method="post" action="${ADMIN_API_KEYS_PATH}" hx-post="${ADMIN_API_KEYS_PATH}" hx-target="#api-keys-panel" hx-swap="outerHTML" class="create-form">`,
    `<label for="label">Label</label>`,
    `<input id="label" name="label" type="text" maxlength="128" required value="${draftLabel}" />`,
    `<label for="expires_at">Expires at (optional)</label>`,
    `<input id="expires_at" name="expires_at" type="datetime-local" value="${draftExpiresAt}" />`,
    `<button type="submit">Create API key</button>`,
    `</form>`,
    `</section>`,
    renderApiKeysTable(params.records),
    `</section>`,
  ].join("");
  // END_BLOCK_RENDER_API_KEY_MANAGEMENT_PANEL_M_ADMIN_UI_013
}

// START_CONTRACT: renderLoginDocument
//   PURPOSE: Render the login page for admin authentication requests.
//   INPUTS: { errorMessage: string|undefined - Optional authentication failure message }
//   OUTPUTS: { string - Full login HTML document }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-ADMIN-AUTH]
// END_CONTRACT: renderLoginDocument
function renderLoginDocument(errorMessage?: string): string {
  // START_BLOCK_RENDER_ADMIN_LOGIN_DOCUMENT_M_ADMIN_UI_014
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
    `body { margin:0; font-family: "IBM Plex Sans", ui-sans-serif, sans-serif; background: var(--bg); color: var(--fg); min-height: 100vh; display:grid; place-items:center; padding:1rem; }`,
    `.card { width:min(28rem, 100%); background: var(--card); border:1px solid var(--line); border-radius:0.75rem; padding:1.25rem; display:grid; gap:0.75rem; }`,
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
    `<p>Enter the root admin token to access API key management.</p>`,
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
  // END_BLOCK_RENDER_ADMIN_LOGIN_DOCUMENT_M_ADMIN_UI_014
}

// START_CONTRACT: renderAdminLayout
//   PURPOSE: Render admin page shell with sidebar navigation and injected content body.
//   INPUTS: { params: RenderAdminLayoutParams - Layout title, active tab, and content HTML }
//   OUTPUTS: { string - Full admin HTML document with HTMX script }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: renderAdminLayout
export function renderAdminLayout(params: RenderAdminLayoutParams): string {
  // START_BLOCK_RENDER_ADMIN_LAYOUT_DOCUMENT_WITH_SIDEBAR_M_ADMIN_UI_015
  const escapedPageTitle = escapeHtml(params.pageTitle);
  const isApiKeysTab = params.activeTab === "api-keys";
  const apiKeysTabClass = isApiKeysTab ? "nav-link nav-link-active" : "nav-link";

  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>${escapedPageTitle}</title>`,
    `<script src="https://unpkg.com/htmx.org@1.9.12"></script>`,
    `<style>`,
    `:root { color-scheme: light; --bg:#eef3f8; --fg:#1e293b; --card:#fff; --line:#cbd5e1; --accent:#0f766e; --accent-soft:#ccfbf1; --warning:#9a3412; --warning-bg:#fff7ed; --danger:#991b1b; --danger-bg:#fef2f2; --ok:#14532d; --ok-bg:#f0fdf4; }`,
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
    `.flash-success { background:var(--ok-bg); color:var(--ok); border-color:#bbf7d0; }`,
    `.create-form { display:grid; gap:0.55rem; }`,
    `label { font-weight:600; }`,
    `input, button { font: inherit; border-radius:0.5rem; border:1px solid var(--line); padding:0.55rem 0.7rem; }`,
    `button { cursor:pointer; background:var(--accent); color:#fff; border:none; font-weight:600; width:fit-content; }`,
    `.table-wrap { overflow-x:auto; }`,
    `table { width:100%; border-collapse:collapse; }`,
    `th, td { text-align:left; border-bottom:1px solid var(--line); padding:0.6rem; vertical-align:top; }`,
    `.status-pill { display:inline-block; border-radius:999px; padding:0.2rem 0.55rem; font-size:0.8rem; border:1px solid var(--line); background:#f8fafc; }`,
    `.raw-key { display:block; border-radius:0.5rem; border:1px dashed #fb923c; background:#fff; color:#9a3412; padding:0.65rem; overflow-wrap:anywhere; margin-top:0.5rem; }`,
    `.reveal-card { border-color:#fb923c; background:#fff7ed; }`,
    `.muted { color:#475569; font-size:0.9rem; }`,
    `.table-action { margin:0; }`,
    `.table-action button { background:#b91c1c; }`,
    `@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } .sidebar { border-right:none; border-bottom:1px solid var(--line); } .content { padding:0.85rem; } }`,
    `</style>`,
    `</head>`,
    `<body>`,
    `<div class="layout">`,
    `<aside class="sidebar">`,
    `<p class="brand">Admin Console</p>`,
    `<nav>`,
    `<a class="${apiKeysTabClass}" href="${ADMIN_API_KEYS_PATH}">${API_KEYS_TAB_LABEL}</a>`,
    `</nav>`,
    `</aside>`,
    `<main class="content">`,
    params.contentHtml,
    `</main>`,
    `</div>`,
    `</body>`,
    `</html>`,
  ].join("");
  // END_BLOCK_RENDER_ADMIN_LAYOUT_DOCUMENT_WITH_SIDEBAR_M_ADMIN_UI_015
}

// START_CONTRACT: renderApiKeysTable
//   PURPOSE: Render API key metadata rows and revoke controls as an HTMX-refreshable table fragment.
//   INPUTS: { records: ApiKeyRecord[] - API key metadata list }
//   OUTPUTS: { string - HTML table container fragment }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI, M-API-KEY-REPOSITORY]
// END_CONTRACT: renderApiKeysTable
export function renderApiKeysTable(records: ApiKeyRecord[]): string {
  // START_BLOCK_RENDER_API_KEYS_TABLE_FRAGMENT_M_ADMIN_UI_016
  const rowsHtml = records.length
    ? records
        .map((record) => {
          const encodedId = encodeURIComponent(record.id);
          const escapedLabel = escapeHtml(record.label);
          const escapedPrefix = escapeHtml(record.keyPrefix);
          const status = classifyApiKeyStatus(record);
          const canRevoke = record.revokedAt === null;
          const actionHtml = canRevoke
            ? [
                `<form class="table-action" method="post" action="${ADMIN_API_KEYS_PATH}/${encodedId}/revoke" hx-post="${ADMIN_API_KEYS_PATH}/${encodedId}/revoke" hx-target="#api-keys-table-container" hx-swap="outerHTML">`,
                `<button type="submit">Revoke</button>`,
                `</form>`,
              ].join("")
            : `<span class="muted">Already revoked</span>`;

          return [
            `<tr>`,
            `<td><code>${escapedPrefix}</code></td>`,
            `<td>${escapedLabel}</td>`,
            `<td><span class="status-pill">${escapeHtml(status)}</span></td>`,
            `<td>${formatDateTimeUtc(record.expiresAt)}</td>`,
            `<td>${formatDateTimeUtc(record.revokedAt)}</td>`,
            `<td>${formatDateTimeUtc(record.createdAt)}</td>`,
            `<td>${actionHtml}</td>`,
            `</tr>`,
          ].join("");
        })
        .join("")
    : `<tr><td colspan="7" class="muted">No API keys created yet.</td></tr>`;

  return [
    `<section id="api-keys-table-container" class="card table-wrap">`,
    `<h3>API keys</h3>`,
    `<table>`,
    `<thead>`,
    `<tr>`,
    `<th>Prefix</th>`,
    `<th>Label</th>`,
    `<th>Status</th>`,
    `<th>Expires At (UTC)</th>`,
    `<th>Revoked At (UTC)</th>`,
    `<th>Created At (UTC)</th>`,
    `<th>Actions</th>`,
    `</tr>`,
    `</thead>`,
    `<tbody>`,
    rowsHtml,
    `</tbody>`,
    `</table>`,
    `</section>`,
  ].join("");
  // END_BLOCK_RENDER_API_KEYS_TABLE_FRAGMENT_M_ADMIN_UI_016
}

// START_CONTRACT: handleAdminRequest
//   PURPOSE: Dispatch admin route requests for login, API key list/create actions, and API key revocation.
//   INPUTS: { request: Request - Incoming admin HTTP request, deps: AdminUiDependencies - Runtime dependencies and auth helper hooks }
//   OUTPUTS: { Promise<Response> - HTML response, HTMX fragment, or redirect response }
//   SIDE_EFFECTS: [Calls auth and repository dependencies, emits structured logs]
//   LINKS: [M-ADMIN-UI, M-ADMIN-AUTH, M-API-KEY-REPOSITORY, M-LOGGER, M-CONFIG]
// END_CONTRACT: handleAdminRequest
export async function handleAdminRequest(
  request: Request,
  deps: AdminUiDependencies,
): Promise<Response> {
  // START_BLOCK_ROUTE_AND_DISPATCH_ADMIN_REQUESTS_M_ADMIN_UI_017
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
  // END_BLOCK_ROUTE_AND_DISPATCH_ADMIN_REQUESTS_M_ADMIN_UI_017

  try {
    // START_BLOCK_HANDLE_ADMIN_LOGIN_ROUTE_M_ADMIN_UI_018
    if (pathname === ADMIN_LOGIN_PATH) {
      if (method === "GET") {
        const sessionCheck = resolvedDeps.requireAdminSession(request, resolvedDeps.config, logger);
        if (sessionCheck.isAuthenticated) {
          logger.debug(
            "Session already authenticated; redirecting away from login.",
            "handleAdminRequest",
            "HANDLE_ADMIN_LOGIN_ROUTE",
          );
          return buildRedirectResponse(ADMIN_API_KEYS_PATH);
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

        if (authResult.isAuthenticated) {
          logger.info(
            "Admin login successful.",
            "handleAdminRequest",
            "HANDLE_ADMIN_LOGIN_ROUTE",
          );
          return buildRedirectResponse(ADMIN_API_KEYS_PATH, authResult.sessionCookie);
        }

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

      return buildHtmlResponse(405, renderLoginDocument("Method not allowed."));
    }
    // END_BLOCK_HANDLE_ADMIN_LOGIN_ROUTE_M_ADMIN_UI_018

    // START_BLOCK_ENFORCE_ADMIN_SESSION_FOR_PROTECTED_ROUTES_M_ADMIN_UI_019
    if (!pathname.startsWith(ADMIN_ROOT_PATH)) {
      return buildHtmlResponse(404, "<h1>Not Found</h1>");
    }

    const sessionCheck = resolvedDeps.requireAdminSession(request, resolvedDeps.config, logger);
    if (!sessionCheck.isAuthenticated) {
      logger.info(
        "Admin session rejected; redirecting to login.",
        "handleAdminRequest",
        "ENFORCE_ADMIN_SESSION_FOR_PROTECTED_ROUTES",
        { reason: sessionCheck.reason },
      );
      return buildRedirectResponse(sessionCheck.location, sessionCheck.setCookie);
    }
    // END_BLOCK_ENFORCE_ADMIN_SESSION_FOR_PROTECTED_ROUTES_M_ADMIN_UI_019

    // START_BLOCK_HANDLE_API_KEY_COLLECTION_ROUTES_M_ADMIN_UI_020
    if (pathname === ADMIN_ROOT_PATH && method === "GET") {
      return buildRedirectResponse(ADMIN_API_KEYS_PATH);
    }

    if (pathname === ADMIN_API_KEYS_PATH && method === "GET") {
      const records = await resolvedDeps.apiKeyRepository.listApiKeys();
      const panelHtml = renderApiKeysPanel({ records });

      if (htmx) {
        return buildHtmlResponse(200, panelHtml);
      }

      return buildHtmlResponse(
        200,
        renderAdminLayout({
          pageTitle: "Admin - Api Keys",
          activeTab: "api-keys",
          contentHtml: panelHtml,
        }),
      );
    }

    if (pathname === ADMIN_API_KEYS_PATH && method === "POST") {
      const formData = await request.formData();
      const label = asFormString(formData.get("label"));
      const rawExpiresAt = asFormString(formData.get("expires_at"));
      const parsedExpiry = parseOptionalExpiryField(rawExpiresAt);

      if (!label) {
        const records = await resolvedDeps.apiKeyRepository.listApiKeys();
        const panelHtml = renderApiKeysPanel({
          records,
          errorMessage: "Label is required.",
          draftLabel: label,
          draftExpiresAt: rawExpiresAt,
        });
        if (htmx) {
          return buildHtmlResponse(400, panelHtml);
        }
        return buildHtmlResponse(
          400,
          renderAdminLayout({
            pageTitle: "Admin - Api Keys",
            activeTab: "api-keys",
            contentHtml: panelHtml,
          }),
        );
      }

      if (parsedExpiry.errorMessage) {
        const records = await resolvedDeps.apiKeyRepository.listApiKeys();
        const panelHtml = renderApiKeysPanel({
          records,
          errorMessage: parsedExpiry.errorMessage,
          draftLabel: label,
          draftExpiresAt: rawExpiresAt,
        });
        if (htmx) {
          return buildHtmlResponse(400, panelHtml);
        }
        return buildHtmlResponse(
          400,
          renderAdminLayout({
            pageTitle: "Admin - Api Keys",
            activeTab: "api-keys",
            contentHtml: panelHtml,
          }),
        );
      }

      const created = await resolvedDeps.apiKeyRepository.createApiKey(label, parsedExpiry.expiresAt);
      const records = await resolvedDeps.apiKeyRepository.listApiKeys();

      logger.info(
        "Created API key via admin UI.",
        "handleAdminRequest",
        "HANDLE_API_KEY_COLLECTION_ROUTES",
        {
          id: created.record.id,
          keyPrefix: created.record.keyPrefix,
        },
      );

      const panelHtml = renderApiKeysPanel({
        records,
        successMessage: "API key created successfully.",
        revealedApiKey: created.rawApiKey,
      });

      if (htmx) {
        return buildHtmlResponse(200, panelHtml);
      }

      return buildHtmlResponse(
        200,
        renderAdminLayout({
          pageTitle: "Admin - Api Keys",
          activeTab: "api-keys",
          contentHtml: panelHtml,
        }),
      );
    }
    // END_BLOCK_HANDLE_API_KEY_COLLECTION_ROUTES_M_ADMIN_UI_020

    // START_BLOCK_HANDLE_API_KEY_REVOKE_ROUTES_M_ADMIN_UI_021
    const revokeRoute = parseRevokeRoute(pathname, method);
    if (revokeRoute) {
      const revoked = await resolvedDeps.apiKeyRepository.revokeApiKey(revokeRoute.id);
      const records = await resolvedDeps.apiKeyRepository.listApiKeys();

      logger.info(
        "Processed API key revoke action.",
        "handleAdminRequest",
        "HANDLE_API_KEY_REVOKE_ROUTES",
        {
          id: revokeRoute.id,
          source: revokeRoute.source,
          existed: revoked !== null,
        },
      );

      if (htmx) {
        return buildHtmlResponse(200, renderApiKeysTable(records));
      }

      const panelHtml = renderApiKeysPanel({
        records,
        successMessage: revoked ? "API key revoked." : "API key not found.",
      });

      return buildHtmlResponse(
        200,
        renderAdminLayout({
          pageTitle: "Admin - Api Keys",
          activeTab: "api-keys",
          contentHtml: panelHtml,
        }),
      );
    }
    // END_BLOCK_HANDLE_API_KEY_REVOKE_ROUTES_M_ADMIN_UI_021

    // START_BLOCK_RETURN_ADMIN_ROUTE_ERRORS_M_ADMIN_UI_022
    if (pathname.startsWith(ADMIN_API_KEYS_PATH)) {
      return buildHtmlResponse(405, "<h1>Method Not Allowed</h1>");
    }

    return buildHtmlResponse(404, "<h1>Not Found</h1>");
    // END_BLOCK_RETURN_ADMIN_ROUTE_ERRORS_M_ADMIN_UI_022
  } catch (error: unknown) {
    // START_BLOCK_MAP_ROUTE_FAILURES_TO_SAFE_HTML_RESPONSES_M_ADMIN_UI_024
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
        activeTab: "api-keys",
        contentHtml: `<section class="card"><h2>Unexpected admin error</h2><p class="warning">Try again or check server logs.</p></section>`,
      }),
    );
    // END_BLOCK_MAP_ROUTE_FAILURES_TO_SAFE_HTML_RESPONSES_M_ADMIN_UI_024
  }
}
