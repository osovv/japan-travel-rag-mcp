// FILE: src/server/oauth-challenge.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify server-level OAuth challenge response behavior for unauthorized /mcp paths.
//   SCOPE: Assert consistent 401 body and OAuth WWW-Authenticate header composition from challenge metadata, including required Bearer parameters and optional issuer/resource handling.
//   DEPENDS: M-SERVER
//   LINKS: M-SERVER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ServerOAuthChallengeTests - Focused tests for createUnauthorizedMcpResponse OAuth challenge behavior.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Added focused server tests to verify OAuth challenge headers and unauthorized payload consistency.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import { createUnauthorizedMcpResponse } from "./index";

describe("M-SERVER OAuth challenge response behavior", () => {
  it("returns 401 UNAUTHORIZED body with Bearer challenge including error/scope/issuer/resource", async () => {
    const response = createUnauthorizedMcpResponse({
      error: "invalid_token",
      errorDescription: "Access token is invalid or expired.",
      requiredScopes: ["mcp:access", "profile:read"],
      issuer: "https://issuer.example.com",
      resource: "https://travel.example.com/mcp",
    });

    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };
    const challengeHeader = response.headers.get("www-authenticate");

    expect(response.status).toBe(401);
    expect(payload).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing OAuth access token.",
      },
    });
    expect(challengeHeader).not.toBeNull();
    if (challengeHeader === null) {
      throw new Error("Expected WWW-Authenticate header.");
    }
    expect(challengeHeader).toContain('Bearer error="invalid_token"');
    expect(challengeHeader).toContain('scope="mcp:access profile:read"');
    expect(challengeHeader).toContain('issuer="https://issuer.example.com"');
    expect(challengeHeader).toContain('resource="https://travel.example.com/mcp"');
  });

  it("omits optional issuer/resource params when challenge metadata does not provide them", () => {
    const response = createUnauthorizedMcpResponse({
      error: "insufficient_scope",
      errorDescription: "Token does not include required scope.",
      requiredScopes: ["mcp:access"],
    });

    const challengeHeader = response.headers.get("www-authenticate");
    expect(challengeHeader).not.toBeNull();
    if (challengeHeader === null) {
      throw new Error("Expected WWW-Authenticate header.");
    }
    expect(challengeHeader).toContain('Bearer error="insufficient_scope"');
    expect(challengeHeader).toContain('scope="mcp:access"');
    expect(challengeHeader).not.toContain('issuer="');
    expect(challengeHeader).not.toContain('resource="');
  });
});
