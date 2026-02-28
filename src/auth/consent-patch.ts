// FILE: src/auth/consent-patch.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Replace FastMCP's built-in consent screen with portal-styled HTML that matches the Japan Travel RAG portal design.
//   SCOPE: Provide generatePortalConsentScreen, formatScopeLabel, portalConsentStyles, escapeHtml, and patchOAuthProxyConsent.
//   DEPENDS: M-AUTH-PROXY
//   LINKS: M-AUTH-CONSENT-PATCH, M-AUTH-PROXY
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   escapeHtml - Escape HTML special characters to prevent XSS in user-provided values.
//   formatScopeLabel - Map OAuth scope strings to human-readable labels.
//   portalConsentStyles - Return inline CSS string with portal CSS variables and classes.
//   generatePortalConsentScreen - Return full HTML document for consent screen with portal styling.
//   patchOAuthProxyConsent - Replace oauthProxy.consentManager.generateConsentScreen with portal version.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial implementation of portal-styled consent screen patch.
// END_CHANGE_SUMMARY

import type { OAuthProxy } from "fastmcp/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Mirrors FastMCP's ConsentData. The timestamp field is provided by FastMCP
// but not rendered in the consent screen HTML.
type ConsentScreenData = {
  clientName: string;
  provider: string;
  scope: string[];
  timestamp?: number;
  transactionId: string;
};

// ---------------------------------------------------------------------------
// Scope label mappings
// ---------------------------------------------------------------------------

const SCOPE_LABELS: Record<string, string> = {
  "mcp:access": "Access MCP tools",
  openid: "Verify your identity",
  profile: "View your basic profile",
  email: "Access your email address",
};

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ---------------------------------------------------------------------------
// formatScopeLabel
// ---------------------------------------------------------------------------

export function formatScopeLabel(scope: string): string {
  const known = SCOPE_LABELS[scope];
  if (known) {
    return known;
  }
  return scope.replace(/_/g, " ").replace(/:/g, " \u2014 ");
}

// ---------------------------------------------------------------------------
// portalConsentStyles
// ---------------------------------------------------------------------------

function portalConsentStyles(): string {
  return `
    :root {
      --bg: #f0f4f8;
      --fg: #1e293b;
      --card: #ffffff;
      --line: #cbd5e1;
      --accent: #0d9488;
      --accent-hover: #0f766e;
      --accent-soft: #ccfbf1;
      --muted: #64748b;
      --danger: #b91c1c;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #dbeafe 0%, #f0f4f8 40%, #e2e8f0 100%);
      color: var(--fg);
      min-height: 100vh;
    }

    .portal-center {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }

    .portal-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 0.75rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      max-width: 28rem;
      width: 100%;
      padding: 2rem;
    }

    .portal-header {
      text-align: center;
      margin-bottom: 1.5rem;
    }

    .portal-header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--fg);
      margin-bottom: 0.5rem;
    }

    .portal-header p {
      color: var(--muted);
      font-size: 0.95rem;
    }

    .permissions {
      margin-bottom: 1.5rem;
    }

    .permissions h3 {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--fg);
      margin-bottom: 0.75rem;
    }

    .permissions ul {
      list-style: none;
      padding: 0;
    }

    .permissions li {
      padding: 0.5rem 0.75rem;
      background: var(--accent-soft);
      border-radius: 0.375rem;
      font-size: 0.9rem;
      color: var(--fg);
      margin-bottom: 0.5rem;
    }

    .permissions li:last-child {
      margin-bottom: 0;
    }

    .consent-actions {
      display: flex;
      flex-direction: row;
      gap: 0.75rem;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.7rem 1.25rem;
      border-radius: 0.5rem;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      text-decoration: none;
      transition: background-color 0.15s, border-color 0.15s;
      border: none;
    }

    .btn-primary {
      background: var(--accent);
      color: #ffffff;
    }

    .btn-primary:hover {
      background: var(--accent-hover);
    }

    .btn-outline {
      background: transparent;
      border: 1px solid var(--line);
      color: var(--fg);
    }

    .btn-outline:hover {
      border-color: var(--muted);
    }

    .btn-full {
      width: 100%;
    }
  `;
}

// ---------------------------------------------------------------------------
// generatePortalConsentScreen
// ---------------------------------------------------------------------------

export function generatePortalConsentScreen(data: ConsentScreenData): string {
  const escapedTransactionId = escapeHtml(data.transactionId);

  const scopeItems = data.scope
    .map((s) => `        <li>${escapeHtml(formatScopeLabel(s))}</li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize - Japan Travel RAG</title>
  <style>${portalConsentStyles()}</style>
</head>
<body>
  <div class="portal-center">
    <div class="portal-card">
      <div class="portal-header">
        <h1>Japan Travel RAG</h1>
        <p><strong>${escapeHtml(data.clientName)}</strong> is requesting access to your account</p>
      </div>
      <div class="permissions">
        <h3>Requested permissions:</h3>
        <ul>
${scopeItems}
        </ul>
      </div>
      <form method="POST" action="/oauth/consent">
        <input type="hidden" name="transaction_id" value="${escapedTransactionId}">
        <div class="consent-actions">
          <button name="action" value="deny" class="btn btn-outline btn-full">Deny</button>
          <button name="action" value="approve" class="btn btn-primary btn-full">Approve</button>
        </div>
      </form>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// patchOAuthProxyConsent
// ---------------------------------------------------------------------------

export function patchOAuthProxyConsent(oauthProxy: OAuthProxy): void {
  // OAuthProxy.consentManager is a private member; we access it via an unsafe
  // cast so we can replace the default consent screen with portal-styled HTML.
  // The runtime guard below ensures we fail loudly if FastMCP internals change.
  const proxy = oauthProxy as unknown as {
    consentManager?: { generateConsentScreen?: (data: any) => string };
  };

  if (
    !proxy.consentManager ||
    typeof proxy.consentManager.generateConsentScreen !== "function"
  ) {
    throw new Error(
      "patchOAuthProxyConsent: OAuthProxy.consentManager.generateConsentScreen not found. " +
        "FastMCP internals may have changed.",
    );
  }

  proxy.consentManager.generateConsentScreen = (data: any) =>
    generatePortalConsentScreen({
      clientName: data.clientName,
      provider: data.provider,
      scope: data.scope,
      transactionId: data.transactionId,
    });
}
