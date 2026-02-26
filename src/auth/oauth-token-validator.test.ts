// FILE: src/auth/oauth-token-validator.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate OAuth token validator behavior for signature, claims, and scope decisions.
//   SCOPE: Cover valid token success, malformed/invalid-signature invalid_token results, issuer/audience/time claim invalid_token results, and insufficient_scope results using local crypto and mocked JWKS resolver.
//   DEPENDS: M-OAUTH-TOKEN-VALIDATOR, M-OAUTH-JWKS, M-CONFIG, M-LOGGER
//   LINKS: M-OAUTH-TOKEN-VALIDATOR, M-OAUTH-JWKS, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build no-op logger for deterministic validator unit tests.
//   createTestConfig - Build valid AppConfig fixture for OAuth validator tests.
//   createRsaSigningFixture - Generate local RSA keypair and JWT signer fixture for RS256 tests.
//   OAuthTokenValidatorTests - Focused decision tests for valid_token, invalid_token, and insufficient_scope outcomes.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Added focused tests for M-OAUTH-TOKEN-VALIDATOR decision model and claim/signature validation.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import type { OAuthJwksKey } from "./oauth-jwks-client";
import { createOAuthTokenValidator } from "./oauth-token-validator";

type JwtPayloadFixture = {
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  scope: string;
  sub?: string;
};

// START_CONTRACT: createNoopLogger
//   PURPOSE: Provide no-op logger implementation for focused validator tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger interface implementation with inert methods }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_FOR_TOKEN_VALIDATOR_TESTS_M_OAUTH_TOKEN_VALIDATOR_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_FOR_TOKEN_VALIDATOR_TESTS_M_OAUTH_TOKEN_VALIDATOR_TEST_001
}

// START_CONTRACT: createTestConfig
//   PURPOSE: Build deterministic valid AppConfig fixture for OAuth validator tests.
//   INPUTS: {}
//   OUTPUTS: { AppConfig - Runtime config fixture with OAuth validation settings }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG, M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: createTestConfig
function createTestConfig(): AppConfig {
  // START_BLOCK_CREATE_TEST_CONFIG_FIXTURE_M_OAUTH_TOKEN_VALIDATOR_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com",
    rootAuthToken: "root-token",
    databaseUrl: "postgresql://localhost:5432/testdb",
    oauth: {
      issuer: "https://issuer.example.com",
      audience: "mcp-audience",
      requiredScopes: ["mcp:access", "profile:read"],
      jwksCacheTtlMs: 300000,
      jwksTimeoutMs: 5000,
      clockSkewSec: 60,
    },
    tgChatRag: {
      baseUrl: "https://tg.example.com",
      bearerToken: "tg-token",
      chatIds: ["chat-1"],
      timeoutMs: 15000,
    },
  };
  // END_BLOCK_CREATE_TEST_CONFIG_FIXTURE_M_OAUTH_TOKEN_VALIDATOR_TEST_002
}

// START_CONTRACT: encodeBase64UrlBytes
//   PURPOSE: Encode raw bytes to base64url without padding for JWT compact serialization.
//   INPUTS: { bytes: Uint8Array - Raw byte array }
//   OUTPUTS: { string - Base64url encoded string }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: encodeBase64UrlBytes
function encodeBase64UrlBytes(bytes: Uint8Array): string {
  // START_BLOCK_ENCODE_BASE64URL_BYTES_FOR_JWT_TESTS_M_OAUTH_TOKEN_VALIDATOR_TEST_003
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  // END_BLOCK_ENCODE_BASE64URL_BYTES_FOR_JWT_TESTS_M_OAUTH_TOKEN_VALIDATOR_TEST_003
}

// START_CONTRACT: encodeBase64UrlJson
//   PURPOSE: Encode JSON object into compact base64url segment for JWT building.
//   INPUTS: { value: Record<string, unknown> - JSON object value }
//   OUTPUTS: { string - Base64url encoded JSON segment }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: encodeBase64UrlJson
function encodeBase64UrlJson(value: Record<string, unknown>): string {
  // START_BLOCK_ENCODE_JSON_TO_BASE64URL_M_OAUTH_TOKEN_VALIDATOR_TEST_004
  return encodeBase64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
  // END_BLOCK_ENCODE_JSON_TO_BASE64URL_M_OAUTH_TOKEN_VALIDATOR_TEST_004
}

// START_CONTRACT: createRsaSigningFixture
//   PURPOSE: Create RS256 signing fixture with local keypair and JWKS-compatible public key.
//   INPUTS: { kid: string - Key identifier to assign to JWT header and JWK }
//   OUTPUTS: { Promise<{ kid: string; jwk: OAuthJwksKey; signToken: (payload: JwtPayloadFixture) => Promise<string> }> - Signing fixture and exported public key material }
//   SIDE_EFFECTS: [Generates cryptographic keypair in memory]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR, M-OAUTH-JWKS]
// END_CONTRACT: createRsaSigningFixture
async function createRsaSigningFixture(kid: string): Promise<{
  kid: string;
  jwk: OAuthJwksKey;
  signToken: (payload: JwtPayloadFixture) => Promise<string>;
}> {
  // START_BLOCK_CREATE_RSA_SIGNING_FIXTURE_M_OAUTH_TOKEN_VALIDATOR_TEST_005
  const keyPair = (await globalThis.crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const exportedJwk = (await globalThis.crypto.subtle.exportKey(
    "jwk",
    keyPair.publicKey,
  )) as Record<string, unknown>;
  const jwk: OAuthJwksKey = {
    ...exportedJwk,
    kty: "RSA",
    kid,
    use: "sig",
    alg: "RS256",
  };

  return {
    kid,
    jwk,
    signToken: async (payload: JwtPayloadFixture): Promise<string> => {
      const header: Record<string, unknown> = {
        alg: "RS256",
        typ: "JWT",
        kid,
      };
      const headerSegment = encodeBase64UrlJson(header);
      const payloadSegment = encodeBase64UrlJson(payload as unknown as Record<string, unknown>);
      const signingInput = `${headerSegment}.${payloadSegment}`;
      const signatureBuffer = await globalThis.crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        keyPair.privateKey,
        new TextEncoder().encode(signingInput),
      );
      const signatureSegment = encodeBase64UrlBytes(new Uint8Array(signatureBuffer));
      return `${signingInput}.${signatureSegment}`;
    },
  };
  // END_BLOCK_CREATE_RSA_SIGNING_FIXTURE_M_OAUTH_TOKEN_VALIDATOR_TEST_005
}

describe("M-OAUTH-TOKEN-VALIDATOR contract", () => {
  it("returns valid result for a correctly signed token with required claims and scopes", async () => {
    const nowEpochMs = 1_720_000_000_000;
    const nowEpochSec = Math.floor(nowEpochMs / 1000);
    const config = createTestConfig();
    const fixture = await createRsaSigningFixture("kid-valid");
    const token = await fixture.signToken({
      iss: config.oauth.issuer,
      aud: config.oauth.audience,
      exp: nowEpochSec + 300,
      nbf: nowEpochSec - 30,
      iat: nowEpochSec - 10,
      scope: "mcp:access profile:read extra:scope",
      sub: "user-123",
    });

    const validator = createOAuthTokenValidator({
      config,
      logger: createNoopLogger(),
      now: () => nowEpochMs,
      getSigningKey: async (kid: string) => {
        if (kid === fixture.kid) {
          return fixture.jwk;
        }
        throw new Error("Unexpected kid.");
      },
    });

    const result = await validator.validateAccessToken(`Bearer ${token}`);

    expect(result.isValid).toBe(true);
    if (!result.isValid) {
      throw new Error("Expected valid token result.");
    }
    expect(result.subject).toBe("user-123");
    expect(result.grantedScopes).toContain("mcp:access");
    expect(result.grantedScopes).toContain("profile:read");
  });

  it("maps invalid signature and malformed token cases to invalid_token", async () => {
    const nowEpochMs = 1_720_000_000_000;
    const nowEpochSec = Math.floor(nowEpochMs / 1000);
    const config = createTestConfig();
    const validFixture = await createRsaSigningFixture("kid-signature");
    const wrongFixture = await createRsaSigningFixture("kid-signature");
    const token = await validFixture.signToken({
      iss: config.oauth.issuer,
      aud: config.oauth.audience,
      exp: nowEpochSec + 300,
      scope: "mcp:access profile:read",
      sub: "user-123",
    });

    const validator = createOAuthTokenValidator({
      config,
      logger: createNoopLogger(),
      now: () => nowEpochMs,
      getSigningKey: async () => wrongFixture.jwk,
    });

    const invalidSignatureResult = await validator.validateAccessToken(`Bearer ${token}`);
    expect(invalidSignatureResult.isValid).toBe(false);
    if (invalidSignatureResult.isValid) {
      throw new Error("Expected invalid signature deny result.");
    }
    expect(invalidSignatureResult.error).toBe("invalid_token");

    const malformedResult = await validator.validateAccessToken("Bearer not-a-jwt");
    expect(malformedResult.isValid).toBe(false);
    if (malformedResult.isValid) {
      throw new Error("Expected malformed token deny result.");
    }
    expect(malformedResult.error).toBe("invalid_token");
  });

  it("maps wrong issuer, wrong audience, and expired tokens to invalid_token", async () => {
    const nowEpochMs = 1_720_000_000_000;
    const nowEpochSec = Math.floor(nowEpochMs / 1000);
    const config = createTestConfig();
    const fixture = await createRsaSigningFixture("kid-claims");
    const validator = createOAuthTokenValidator({
      config,
      logger: createNoopLogger(),
      now: () => nowEpochMs,
      getSigningKey: async () => fixture.jwk,
    });

    const wrongIssuerToken = await fixture.signToken({
      iss: "https://wrong-issuer.example.com",
      aud: config.oauth.audience,
      exp: nowEpochSec + 300,
      scope: "mcp:access profile:read",
      sub: "user-issuer",
    });
    const wrongAudienceToken = await fixture.signToken({
      iss: config.oauth.issuer,
      aud: "wrong-audience",
      exp: nowEpochSec + 300,
      scope: "mcp:access profile:read",
      sub: "user-aud",
    });
    const expiredToken = await fixture.signToken({
      iss: config.oauth.issuer,
      aud: config.oauth.audience,
      exp: nowEpochSec - 1200,
      scope: "mcp:access profile:read",
      sub: "user-expired",
    });

    const wrongIssuerResult = await validator.validateAccessToken(`Bearer ${wrongIssuerToken}`);
    expect(wrongIssuerResult.isValid).toBe(false);
    if (wrongIssuerResult.isValid) {
      throw new Error("Expected wrong issuer deny result.");
    }
    expect(wrongIssuerResult.error).toBe("invalid_token");

    const wrongAudienceResult = await validator.validateAccessToken(`Bearer ${wrongAudienceToken}`);
    expect(wrongAudienceResult.isValid).toBe(false);
    if (wrongAudienceResult.isValid) {
      throw new Error("Expected wrong audience deny result.");
    }
    expect(wrongAudienceResult.error).toBe("invalid_token");

    const expiredResult = await validator.validateAccessToken(`Bearer ${expiredToken}`);
    expect(expiredResult.isValid).toBe(false);
    if (expiredResult.isValid) {
      throw new Error("Expected expired token deny result.");
    }
    expect(expiredResult.error).toBe("invalid_token");
  });

  it("maps missing required scope to insufficient_scope", async () => {
    const nowEpochMs = 1_720_000_000_000;
    const nowEpochSec = Math.floor(nowEpochMs / 1000);
    const config = createTestConfig();
    const fixture = await createRsaSigningFixture("kid-scope");
    const token = await fixture.signToken({
      iss: config.oauth.issuer,
      aud: config.oauth.audience,
      exp: nowEpochSec + 300,
      scope: "mcp:access",
      sub: "user-limited",
    });
    const validator = createOAuthTokenValidator({
      config,
      logger: createNoopLogger(),
      now: () => nowEpochMs,
      getSigningKey: async () => fixture.jwk,
    });

    const result = await validator.validateAccessToken(`Bearer ${token}`);

    expect(result.isValid).toBe(false);
    if (result.isValid) {
      throw new Error("Expected insufficient scope deny result.");
    }
    expect(result.error).toBe("insufficient_scope");
  });
});
