// FILE: src/runtime/extract-user-id.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Unit tests for extractUserIdFromSession JWT sub claim extraction helper.
//   SCOPE: Verify sub extraction from idToken, accessToken fallback, and null returns for all failure paths.
//   DEPENDS: M-FASTMCP-RUNTIME
//   LINKS: M-FASTMCP-RUNTIME-EXTRACT-USER-ID-TEST, M-FASTMCP-RUNTIME
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   makeJwt - Build a minimal unsigned JWT string from a payload object for testing.
//   extractUserIdFromSession tests - Unit coverage for all extraction and failure paths.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial unit test coverage for extractUserIdFromSession.
// END_CHANGE_SUMMARY

import { describe, expect, test } from "bun:test";
import { extractUserIdFromSession } from "./fastmcp-runtime";

// START_CONTRACT: makeJwt
//   PURPOSE: Build a minimal unsigned JWT string from a payload object for testing purposes.
//   INPUTS: { payload: Record<string, unknown> - JWT payload claims }
//   OUTPUTS: { string - A three-segment JWT string with base64url-encoded header and payload }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME-EXTRACT-USER-ID-TEST]
// END_CONTRACT: makeJwt
function makeJwt(payload: Record<string, unknown>): string {
  // START_BLOCK_BUILD_UNSIGNED_JWT_FOR_TESTING_M_EXTRACT_USER_ID_TEST_001
  const header = { alg: "RS256", typ: "JWT" };
  const encode = (obj: Record<string, unknown>): string =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode(header)}.${encode(payload)}.fake-signature`;
  // END_BLOCK_BUILD_UNSIGNED_JWT_FOR_TESTING_M_EXTRACT_USER_ID_TEST_001
}

describe("extractUserIdFromSession", () => {
  test("returns sub from valid idToken JWT", () => {
    // START_BLOCK_TEST_EXTRACT_SUB_FROM_IDTOKEN_M_EXTRACT_USER_ID_TEST_002
    const session = {
      authenticated: true as const,
      accessToken: makeJwt({ sub: "access-user-456" }),
      scopes: ["mcp:access"],
      idToken: makeJwt({ sub: "id-user-123", name: "Test User" }),
    };

    const result = extractUserIdFromSession(session);
    expect(result).toBe("id-user-123");
    // END_BLOCK_TEST_EXTRACT_SUB_FROM_IDTOKEN_M_EXTRACT_USER_ID_TEST_002
  });

  test("returns sub from accessToken when idToken is missing", () => {
    // START_BLOCK_TEST_EXTRACT_SUB_FROM_ACCESSTOKEN_FALLBACK_M_EXTRACT_USER_ID_TEST_003
    const session = {
      authenticated: true as const,
      accessToken: makeJwt({ sub: "access-user-789" }),
      scopes: ["mcp:access"],
    };

    const result = extractUserIdFromSession(session);
    expect(result).toBe("access-user-789");
    // END_BLOCK_TEST_EXTRACT_SUB_FROM_ACCESSTOKEN_FALLBACK_M_EXTRACT_USER_ID_TEST_003
  });

  test("returns null when session is undefined", () => {
    // START_BLOCK_TEST_NULL_FOR_UNDEFINED_SESSION_M_EXTRACT_USER_ID_TEST_004
    const result = extractUserIdFromSession(undefined);
    expect(result).toBeNull();
    // END_BLOCK_TEST_NULL_FOR_UNDEFINED_SESSION_M_EXTRACT_USER_ID_TEST_004
  });

  test("returns null when JWT is malformed (not 3 parts)", () => {
    // START_BLOCK_TEST_NULL_FOR_MALFORMED_JWT_M_EXTRACT_USER_ID_TEST_005
    const session = {
      authenticated: true as const,
      accessToken: "not-a-jwt",
      scopes: ["mcp:access"],
    };

    const result = extractUserIdFromSession(session);
    expect(result).toBeNull();
    // END_BLOCK_TEST_NULL_FOR_MALFORMED_JWT_M_EXTRACT_USER_ID_TEST_005
  });

  test("returns null when JWT payload is not valid JSON", () => {
    // START_BLOCK_TEST_NULL_FOR_INVALID_JSON_PAYLOAD_M_EXTRACT_USER_ID_TEST_006
    const invalidBase64Payload = btoa("this is not json{{{")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const session = {
      authenticated: true as const,
      accessToken: `eyJhbGciOiJSUzI1NiJ9.${invalidBase64Payload}.fake-sig`,
      scopes: ["mcp:access"],
    };

    const result = extractUserIdFromSession(session);
    expect(result).toBeNull();
    // END_BLOCK_TEST_NULL_FOR_INVALID_JSON_PAYLOAD_M_EXTRACT_USER_ID_TEST_006
  });

  test("returns null when JWT payload has no sub claim", () => {
    // START_BLOCK_TEST_NULL_FOR_MISSING_SUB_CLAIM_M_EXTRACT_USER_ID_TEST_007
    const session = {
      authenticated: true as const,
      accessToken: makeJwt({ iss: "https://issuer.example.com", aud: "client-id" }),
      scopes: ["mcp:access"],
    };

    const result = extractUserIdFromSession(session);
    expect(result).toBeNull();
    // END_BLOCK_TEST_NULL_FOR_MISSING_SUB_CLAIM_M_EXTRACT_USER_ID_TEST_007
  });

  test("returns null when sub claim is not a string", () => {
    // START_BLOCK_TEST_NULL_FOR_NON_STRING_SUB_M_EXTRACT_USER_ID_TEST_008
    const session = {
      authenticated: true as const,
      accessToken: makeJwt({ sub: 12345 }),
      scopes: ["mcp:access"],
    };

    const result = extractUserIdFromSession(session);
    expect(result).toBeNull();
    // END_BLOCK_TEST_NULL_FOR_NON_STRING_SUB_M_EXTRACT_USER_ID_TEST_008
  });

  test("prefers idToken sub over accessToken sub", () => {
    // START_BLOCK_TEST_IDTOKEN_PREFERRED_OVER_ACCESSTOKEN_M_EXTRACT_USER_ID_TEST_009
    const session = {
      authenticated: true as const,
      accessToken: makeJwt({ sub: "access-user" }),
      scopes: ["mcp:access"],
      idToken: makeJwt({ sub: "id-user" }),
    };

    const result = extractUserIdFromSession(session);
    expect(result).toBe("id-user");
    // END_BLOCK_TEST_IDTOKEN_PREFERRED_OVER_ACCESSTOKEN_M_EXTRACT_USER_ID_TEST_009
  });

  test("falls back to accessToken when idToken has no sub", () => {
    // START_BLOCK_TEST_FALLBACK_ACCESSTOKEN_WHEN_IDTOKEN_NO_SUB_M_EXTRACT_USER_ID_TEST_010
    const session = {
      authenticated: true as const,
      accessToken: makeJwt({ sub: "access-user-fallback" }),
      scopes: ["mcp:access"],
      idToken: makeJwt({ iss: "https://issuer.example.com" }),
    };

    const result = extractUserIdFromSession(session);
    expect(result).toBe("access-user-fallback");
    // END_BLOCK_TEST_FALLBACK_ACCESSTOKEN_WHEN_IDTOKEN_NO_SUB_M_EXTRACT_USER_ID_TEST_010
  });
});
