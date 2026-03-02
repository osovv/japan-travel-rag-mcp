// FILE: src/auth/consent-patch.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify portal-styled consent screen generation, scope label formatting, XSS escaping, and OAuthProxy monkey-patching.
//   SCOPE: Unit tests for generatePortalConsentScreen, formatScopeLabel, escapeHtml, and patchOAuthProxyConsent.
//   DEPENDS: M-AUTH-CONSENT-PATCH
//   LINKS: M-AUTH-CONSENT-PATCH
// END_MODULE_CONTRACT
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial test suite for consent-patch module.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import {
  formatScopeLabel,
  generatePortalConsentScreen,
  patchOAuthProxyConsent,
} from "./consent-patch";

// ---------------------------------------------------------------------------
// formatScopeLabel
// ---------------------------------------------------------------------------

describe("formatScopeLabel", () => {
  it("maps mcp:access to human-readable label", () => {
    expect(formatScopeLabel("mcp:access")).toBe("Access MCP tools");
  });

  it("maps openid to human-readable label", () => {
    expect(formatScopeLabel("openid")).toBe("Verify your identity");
  });

  it("maps profile to human-readable label", () => {
    expect(formatScopeLabel("profile")).toBe("View your basic profile");
  });

  it("maps email to human-readable label", () => {
    expect(formatScopeLabel("email")).toBe("Access your email address");
  });

  it("falls back for unknown scopes with underscores and colons", () => {
    expect(formatScopeLabel("custom_scope:read")).toBe("custom scope — read");
  });

  it("returns unknown scope string as-is when no special chars", () => {
    expect(formatScopeLabel("something")).toBe("something");
  });
});

// ---------------------------------------------------------------------------
// generatePortalConsentScreen
// ---------------------------------------------------------------------------

describe("generatePortalConsentScreen", () => {
  const baseData = {
    clientName: "Test Client",
    provider: "logto",
    scope: ["mcp:access", "openid"],
    transactionId: "txn-abc-123",
  };

  it("returns HTML containing portal CSS classes", () => {
    const html = generatePortalConsentScreen(baseData);
    expect(html).toContain("portal-center");
    expect(html).toContain("portal-card");
    expect(html).toContain("portal-header");
  });

  it("contains portal CSS variables", () => {
    const html = generatePortalConsentScreen(baseData);
    expect(html).toContain("--accent");
    expect(html).toContain("--card");
    expect(html).toContain("--fg");
    expect(html).toContain("--muted");
    expect(html).toContain("#0d9488");
  });

  it("contains correct form action and hidden transaction_id field", () => {
    const html = generatePortalConsentScreen(baseData);
    expect(html).toContain('action="/oauth/consent"');
    expect(html).toContain('method="POST"');
    expect(html).toContain('name="transaction_id"');
    expect(html).toContain('value="txn-abc-123"');
  });

  it("contains approve and deny buttons", () => {
    const html = generatePortalConsentScreen(baseData);
    expect(html).toContain('value="approve"');
    expect(html).toContain('value="deny"');
    expect(html).toContain("Approve");
    expect(html).toContain("Deny");
  });

  it("renders formatted scope labels", () => {
    const html = generatePortalConsentScreen(baseData);
    expect(html).toContain("Access MCP tools");
    expect(html).toContain("Verify your identity");
  });

  it("renders all provided scopes", () => {
    const data = {
      ...baseData,
      scope: ["mcp:access", "openid", "profile", "email"],
    };
    const html = generatePortalConsentScreen(data);
    expect(html).toContain("Access MCP tools");
    expect(html).toContain("Verify your identity");
    expect(html).toContain("View your basic profile");
    expect(html).toContain("Access your email address");
  });

  it("contains the app title", () => {
    const html = generatePortalConsentScreen(baseData);
    expect(html).toContain("TravelMind MCP");
  });

  it("contains the consent explanation text with clientName", () => {
    const html = generatePortalConsentScreen(baseData);
    expect(html).toContain("<strong>Test Client</strong> is requesting access to your account");
  });

  it("contains consent-actions container and btn classes", () => {
    const html = generatePortalConsentScreen(baseData);
    expect(html).toContain("consent-actions");
    expect(html).toContain("btn-primary");
    expect(html).toContain("btn-outline");
    expect(html).toContain("btn-full");
  });

  it("returns a full HTML document with doctype", () => {
    const html = generatePortalConsentScreen(baseData);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });
});

// ---------------------------------------------------------------------------
// XSS escaping
// ---------------------------------------------------------------------------

describe("XSS escaping", () => {
  it("escapes transactionId containing HTML special chars", () => {
    const data = {
      clientName: "Test",
      provider: "logto",
      scope: ["mcp:access"],
      transactionId: '<script>alert("xss")</script>',
    };
    const html = generatePortalConsentScreen(data);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes scope values containing HTML special chars", () => {
    const data = {
      clientName: "Test",
      provider: "logto",
      scope: ['<img src=x onerror="alert(1)">'],
      transactionId: "txn-safe",
    };
    const html = generatePortalConsentScreen(data);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes clientName containing HTML special chars", () => {
    const data = {
      clientName: '<b>Evil"App</b>',
      provider: "logto",
      scope: ["mcp:access"],
      transactionId: "txn-safe",
    };
    const html = generatePortalConsentScreen(data);
    expect(html).not.toContain("<b>Evil");
    expect(html).toContain("&lt;b&gt;Evil&quot;App&lt;/b&gt;");
  });

  it("escapes ampersands and quotes", () => {
    const data = {
      clientName: "Test",
      provider: "logto",
      scope: ["mcp:access"],
      transactionId: 'a&b"c\'d',
    };
    const html = generatePortalConsentScreen(data);
    expect(html).toContain("a&amp;b&quot;c&#x27;d");
  });
});

// ---------------------------------------------------------------------------
// patchOAuthProxyConsent
// ---------------------------------------------------------------------------

describe("patchOAuthProxyConsent", () => {
  it("throws when consentManager is missing", () => {
    const mockProxy = {} as any;
    expect(() => patchOAuthProxyConsent(mockProxy)).toThrow(
      "patchOAuthProxyConsent: OAuthProxy.consentManager.generateConsentScreen not found.",
    );
  });

  it("throws when generateConsentScreen is missing", () => {
    const mockProxy = { consentManager: {} } as any;
    expect(() => patchOAuthProxyConsent(mockProxy)).toThrow(
      "patchOAuthProxyConsent: OAuthProxy.consentManager.generateConsentScreen not found.",
    );
  });

  it("replaces generateConsentScreen on consentManager", () => {
    // Create a mock OAuthProxy-like object with consentManager
    const originalFn = () => "<p>original</p>";
    const mockProxy = {
      consentManager: {
        generateConsentScreen: originalFn,
      },
    };

    patchOAuthProxyConsent(mockProxy as any);

    expect(mockProxy.consentManager.generateConsentScreen).not.toBe(originalFn);
  });

  it("patched generateConsentScreen returns portal-styled HTML", () => {
    const mockProxy = {
      consentManager: {
        generateConsentScreen: (_data?: unknown) => "<p>original</p>",
      },
    };

    patchOAuthProxyConsent(mockProxy as any);

    const html = mockProxy.consentManager.generateConsentScreen({
      clientName: "Test",
      provider: "logto",
      scope: ["mcp:access"],
      timestamp: Date.now(),
      transactionId: "txn-123",
    });

    expect(html).toContain("portal-card");
    expect(html).toContain("Access MCP tools");
    expect(html).toContain('value="txn-123"');
  });
});
