// FILE: src/portal/identity-client.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Wrap identity-provider operations needed by portal social OAuth flows: start URL construction, callback token exchange, identity resolution, and role/permission updates for tester access.
//   SCOPE: Build Logto authorization URL with social direct-sign-in parameters, exchange callback authorization code and resolve portal identity profile, and ensure tester has required MCP access role.
//   DEPENDS: M-CONFIG, M-LOGGER
//   LINKS: M-PORTAL-IDENTITY, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   PortalIdentityError - Typed portal identity failure with PORTAL_IDENTITY_ERROR code.
//   PortalIdentityResult - Resolved identity profile from OIDC callback token exchange.
//   OauthStartResult - Authorization URL and encoded state from buildPortalOauthStartUrl.
//   RoleProvisionResult - Result of ensureMcpAccessRole provisioning call.
//   PortalIdentityClient - Client interface exposing buildPortalOauthStartUrl, handlePortalOauthCallback, and ensureMcpAccessRole.
//   toPortalIdentityError - Normalize unknown runtime failures into PortalIdentityError.
//   encodeBase64Url - Encode a string to base64url without padding.
//   decodeBase64Url - Decode a base64url string back to UTF-8.
//   buildRedirectUri - Derive the portal OAuth callback redirect URI from publicUrl.
//   decodeIdTokenPayload - Extract and decode the payload section of a JWT id_token.
//   createPortalIdentityClient - Factory to build a PortalIdentityClient bound to config and logger.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Fixed ensureMcpAccessRole to use dedicated M2M app credentials (LOGTO_M2M_APP_ID/SECRET) for client_credentials grant and configurable role ID (LOGTO_MCP_USER_ROLE_ID) instead of hardcoded constant.
// END_CHANGE_SUMMARY

import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORTAL_OAUTH_CALLBACK_PATH = "/portal/auth/callback" as const;
const PORTAL_OAUTH_SCOPES = "openid profile email" as const;
const PORTAL_OAUTH_RESPONSE_TYPE = "code" as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export class PortalIdentityError extends Error {
  public readonly code = "PORTAL_IDENTITY_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PortalIdentityError";
    this.details = details;
  }
}

export type PortalIdentityResult = {
  userId: string;
  email: string;
  name: string;
  picture: string;
  provider: string;
  intent: "register" | "login";
};

export type OauthStartResult = {
  url: string;
  state: string;
};

export type RoleProvisionResult = {
  provisioned: boolean;
  roleId: string;
};

export type PortalIdentityClient = {
  buildPortalOauthStartUrl: (
    provider: string,
    intent: "register" | "login",
  ) => OauthStartResult;
  handlePortalOauthCallback: (
    code: string,
    state: string,
  ) => Promise<PortalIdentityResult>;
  ensureMcpAccessRole: (userId: string) => Promise<RoleProvisionResult>;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// START_CONTRACT: toPortalIdentityError
//   PURPOSE: Normalize unknown runtime failures into PortalIdentityError with safe diagnostics.
//   INPUTS: { error: unknown - Runtime failure, message: string - Stable error message, details: Record<string, unknown>|undefined - Additional context }
//   OUTPUTS: { PortalIdentityError - Typed portal identity error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-IDENTITY]
// END_CONTRACT: toPortalIdentityError
function toPortalIdentityError(
  error: unknown,
  message: string,
  details?: Record<string, unknown>,
): PortalIdentityError {
  // START_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_PORTAL_IDENTITY_ERROR_M_PORTAL_IDENTITY_001
  if (error instanceof PortalIdentityError) {
    return error;
  }

  const cause = error instanceof Error ? error.message : String(error);
  return new PortalIdentityError(message, {
    ...details,
    cause,
  });
  // END_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_PORTAL_IDENTITY_ERROR_M_PORTAL_IDENTITY_001
}

// START_CONTRACT: encodeBase64Url
//   PURPOSE: Encode a UTF-8 string to base64url without padding characters.
//   INPUTS: { input: string - UTF-8 text to encode }
//   OUTPUTS: { string - Base64url encoded string }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-IDENTITY]
// END_CONTRACT: encodeBase64Url
function encodeBase64Url(input: string): string {
  // START_BLOCK_ENCODE_STRING_TO_BASE64URL_M_PORTAL_IDENTITY_002
  return Buffer.from(input, "utf8").toString("base64url");
  // END_BLOCK_ENCODE_STRING_TO_BASE64URL_M_PORTAL_IDENTITY_002
}

// START_CONTRACT: decodeBase64Url
//   PURPOSE: Decode a base64url encoded string back to UTF-8 text.
//   INPUTS: { input: string - Base64url encoded string }
//   OUTPUTS: { string - Decoded UTF-8 text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-IDENTITY]
// END_CONTRACT: decodeBase64Url
function decodeBase64Url(input: string): string {
  // START_BLOCK_DECODE_BASE64URL_TO_STRING_M_PORTAL_IDENTITY_003
  return Buffer.from(input, "base64url").toString("utf8");
  // END_BLOCK_DECODE_BASE64URL_TO_STRING_M_PORTAL_IDENTITY_003
}

// START_CONTRACT: buildRedirectUri
//   PURPOSE: Derive the portal OAuth callback redirect URI from the public URL, stripping trailing slashes.
//   INPUTS: { publicUrl: string - Public base URL from config }
//   OUTPUTS: { string - Fully qualified redirect URI for portal OAuth callback }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-IDENTITY, M-CONFIG]
// END_CONTRACT: buildRedirectUri
function buildRedirectUri(publicUrl: string): string {
  // START_BLOCK_BUILD_PORTAL_REDIRECT_URI_M_PORTAL_IDENTITY_004
  const baseUrl = publicUrl.replace(/\/+$/, "");
  return `${baseUrl}${PORTAL_OAUTH_CALLBACK_PATH}`;
  // END_BLOCK_BUILD_PORTAL_REDIRECT_URI_M_PORTAL_IDENTITY_004
}

// START_CONTRACT: decodeIdTokenPayload
//   PURPOSE: Extract and decode the payload section of a JWT id_token (base64url decode only, no signature verification).
//   INPUTS: { idToken: string - Raw JWT id_token from token endpoint response }
//   OUTPUTS: { Record<string, unknown> - Decoded JWT payload claims }
//   SIDE_EFFECTS: [Throws PortalIdentityError if token structure is invalid]
//   LINKS: [M-PORTAL-IDENTITY]
// END_CONTRACT: decodeIdTokenPayload
function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
  // START_BLOCK_DECODE_JWT_PAYLOAD_SECTION_M_PORTAL_IDENTITY_005
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    throw new PortalIdentityError("Invalid id_token structure: expected three JWT segments.", {
      segmentCount: segments.length,
    });
  }

  const payloadSegment = segments[1];
  if (!payloadSegment) {
    throw new PortalIdentityError("Invalid id_token structure: empty payload segment.");
  }

  try {
    const payloadJson = decodeBase64Url(payloadSegment);
    const parsed = JSON.parse(payloadJson) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      throw new PortalIdentityError("Invalid id_token payload: expected JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error: unknown) {
    if (error instanceof PortalIdentityError) {
      throw error;
    }
    throw new PortalIdentityError("Failed to decode id_token payload.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  // END_BLOCK_DECODE_JWT_PAYLOAD_SECTION_M_PORTAL_IDENTITY_005
}

// START_CONTRACT: validateStatePayload
//   PURPOSE: Decode and validate the base64url-encoded state parameter from OAuth callback.
//   INPUTS: { state: string - Base64url JSON encoded state string }
//   OUTPUTS: { { provider: string; intent: "register" | "login"; ts: number } - Decoded state payload }
//   SIDE_EFFECTS: [Throws PortalIdentityError if state is malformed or contains invalid values]
//   LINKS: [M-PORTAL-IDENTITY]
// END_CONTRACT: validateStatePayload
function validateStatePayload(
  state: string,
): { provider: string; intent: "register" | "login"; ts: number } {
  // START_BLOCK_VALIDATE_OAUTH_STATE_PAYLOAD_M_PORTAL_IDENTITY_006
  try {
    const stateJson = decodeBase64Url(state);
    const parsed = JSON.parse(stateJson) as unknown;

    if (typeof parsed !== "object" || parsed === null) {
      throw new PortalIdentityError("Invalid state parameter: expected JSON object.");
    }

    const candidate = parsed as Record<string, unknown>;
    const provider = candidate["provider"];
    const intent = candidate["intent"];
    const ts = candidate["ts"];

    if (typeof provider !== "string" || !provider.trim()) {
      throw new PortalIdentityError("Invalid state parameter: missing or empty provider.");
    }

    if (intent !== "register" && intent !== "login") {
      throw new PortalIdentityError("Invalid state parameter: intent must be 'register' or 'login'.", {
        intent: String(intent),
      });
    }

    if (typeof ts !== "number" || !Number.isFinite(ts)) {
      throw new PortalIdentityError("Invalid state parameter: missing or invalid timestamp.");
    }

    return { provider: provider.trim(), intent, ts };
  } catch (error: unknown) {
    if (error instanceof PortalIdentityError) {
      throw error;
    }
    throw new PortalIdentityError("Failed to decode state parameter.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  // END_BLOCK_VALIDATE_OAUTH_STATE_PAYLOAD_M_PORTAL_IDENTITY_006
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

// START_CONTRACT: createPortalIdentityClient
//   PURPOSE: Build a PortalIdentityClient bound to runtime config and logger for portal social OAuth identity flows.
//   INPUTS: { config: AppConfig - Runtime configuration from M-CONFIG, logger: Logger - Structured logger from M-LOGGER }
//   OUTPUTS: { PortalIdentityClient - Client with buildPortalOauthStartUrl, handlePortalOauthCallback, and ensureMcpAccessRole }
//   SIDE_EFFECTS: [none at construction time; methods perform HTTP calls and logging at invocation time]
//   LINKS: [M-PORTAL-IDENTITY, M-CONFIG, M-LOGGER]
// END_CONTRACT: createPortalIdentityClient
export function createPortalIdentityClient(
  config: AppConfig,
  logger: Logger,
): PortalIdentityClient {
  // START_BLOCK_CREATE_CHILD_LOGGER_FOR_IDENTITY_CLIENT_M_PORTAL_IDENTITY_007
  const log = logger.child({ module: "M-PORTAL-IDENTITY" });
  // END_BLOCK_CREATE_CHILD_LOGGER_FOR_IDENTITY_CLIENT_M_PORTAL_IDENTITY_007

  // START_CONTRACT: buildPortalOauthStartUrl
  //   PURPOSE: Build Logto authorization URL with social direct-sign-in parameters and portal callback target.
  //   INPUTS: { provider: string - Social connector name (e.g. "google", "github"), intent: "register" | "login" - User intent }
  //   OUTPUTS: { OauthStartResult - Authorization URL and base64url encoded state string }
  //   SIDE_EFFECTS: [Writes structured debug log]
  //   LINKS: [M-PORTAL-IDENTITY, M-CONFIG]
  // END_CONTRACT: buildPortalOauthStartUrl
  function buildPortalOauthStartUrl(
    provider: string,
    intent: "register" | "login",
  ): OauthStartResult {
    // START_BLOCK_BUILD_LOGTO_AUTHORIZATION_URL_M_PORTAL_IDENTITY_008
    const trimmedProvider = provider.trim();
    if (!trimmedProvider) {
      throw new PortalIdentityError("Provider must be a non-empty string.", {
        field: "provider",
      });
    }

    if (intent !== "register" && intent !== "login") {
      throw new PortalIdentityError("Intent must be 'register' or 'login'.", {
        field: "intent",
        intent,
      });
    }

    const statePayload = JSON.stringify({
      provider: trimmedProvider,
      intent,
      ts: Date.now(),
    });
    const encodedState = encodeBase64Url(statePayload);

    const redirectUri = buildRedirectUri(config.publicUrl);
    const portalAppId = config.portal.logtoAppId;

    const params = new URLSearchParams();
    params.set("client_id", portalAppId);
    params.set("redirect_uri", redirectUri);
    params.set("response_type", PORTAL_OAUTH_RESPONSE_TYPE);
    params.set("scope", PORTAL_OAUTH_SCOPES);
    params.set("state", encodedState);
    params.set("direct_sign_in", `social:${trimmedProvider}`);

    const authUrl = `${config.logto.oidcAuthEndpoint}?${params.toString()}`;

    log.debug(
      "Built portal OAuth authorization URL.",
      "buildPortalOauthStartUrl",
      "BUILD_LOGTO_AUTHORIZATION_URL",
      {
        provider: trimmedProvider,
        intent,
        redirectUri,
      },
    );

    return { url: authUrl, state: encodedState };
    // END_BLOCK_BUILD_LOGTO_AUTHORIZATION_URL_M_PORTAL_IDENTITY_008
  }

  // START_CONTRACT: handlePortalOauthCallback
  //   PURPOSE: Exchange callback authorization code with Logto token endpoint and resolve portal identity profile.
  //   INPUTS: { code: string - Authorization code from callback, state: string - Base64url JSON encoded state from callback }
  //   OUTPUTS: { Promise<PortalIdentityResult> - Resolved identity profile }
  //   SIDE_EFFECTS: [HTTP POST to Logto token endpoint, structured logging]
  //   LINKS: [M-PORTAL-IDENTITY, M-CONFIG]
  // END_CONTRACT: handlePortalOauthCallback
  async function handlePortalOauthCallback(
    code: string,
    state: string,
  ): Promise<PortalIdentityResult> {
    // START_BLOCK_VALIDATE_CALLBACK_INPUTS_M_PORTAL_IDENTITY_009
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      throw new PortalIdentityError("Authorization code must be a non-empty string.", {
        field: "code",
      });
    }

    const trimmedState = state.trim();
    if (!trimmedState) {
      throw new PortalIdentityError("State parameter must be a non-empty string.", {
        field: "state",
      });
    }
    // END_BLOCK_VALIDATE_CALLBACK_INPUTS_M_PORTAL_IDENTITY_009

    // START_BLOCK_DECODE_AND_VALIDATE_STATE_PARAMETER_M_PORTAL_IDENTITY_010
    const statePayload = validateStatePayload(trimmedState);
    // END_BLOCK_DECODE_AND_VALIDATE_STATE_PARAMETER_M_PORTAL_IDENTITY_010

    // START_BLOCK_EXCHANGE_AUTHORIZATION_CODE_FOR_TOKENS_M_PORTAL_IDENTITY_011
    try {
      const redirectUri = buildRedirectUri(config.publicUrl);
      const portalAppId = config.portal.logtoAppId;
      const portalAppSecret = config.portal.logtoAppSecret;

      const tokenBody = new URLSearchParams();
      tokenBody.set("grant_type", "authorization_code");
      tokenBody.set("code", trimmedCode);
      tokenBody.set("redirect_uri", redirectUri);
      tokenBody.set("client_id", portalAppId);
      tokenBody.set("client_secret", portalAppSecret);

      log.debug(
        "Exchanging authorization code with Logto token endpoint.",
        "handlePortalOauthCallback",
        "EXCHANGE_AUTHORIZATION_CODE_FOR_TOKENS",
        {
          tokenEndpoint: config.logto.oidcTokenEndpoint,
          redirectUri,
        },
      );

      const tokenResponse = await fetch(config.logto.oidcTokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: tokenBody.toString(),
      });

      if (!tokenResponse.ok) {
        const responseText = await tokenResponse.text().catch(() => "(unreadable body)");
        throw new PortalIdentityError("Token exchange failed with non-OK response.", {
          status: tokenResponse.status,
          statusText: tokenResponse.statusText,
          body: responseText,
        });
      }

      const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
      const idToken = tokenData["id_token"];

      if (typeof idToken !== "string" || !idToken.trim()) {
        throw new PortalIdentityError("Token response missing id_token.", {
          receivedKeys: Object.keys(tokenData),
        });
      }

      log.info(
        "Token exchange successful; received id_token.",
        "handlePortalOauthCallback",
        "EXCHANGE_AUTHORIZATION_CODE_FOR_TOKENS",
      );
      // END_BLOCK_EXCHANGE_AUTHORIZATION_CODE_FOR_TOKENS_M_PORTAL_IDENTITY_011

      // START_BLOCK_DECODE_ID_TOKEN_AND_BUILD_IDENTITY_RESULT_M_PORTAL_IDENTITY_012
      const claims = decodeIdTokenPayload(idToken);

      const userId = typeof claims["sub"] === "string" ? claims["sub"] : "";
      const email = typeof claims["email"] === "string" ? claims["email"] : "";
      const name = typeof claims["name"] === "string" ? claims["name"] : "";
      const picture = typeof claims["picture"] === "string" ? claims["picture"] : "";

      if (!userId) {
        throw new PortalIdentityError("id_token missing required 'sub' claim.", {
          claimKeys: Object.keys(claims),
        });
      }

      const result: PortalIdentityResult = {
        userId,
        email,
        name,
        picture,
        provider: statePayload.provider,
        intent: statePayload.intent,
      };

      log.info(
        "Portal identity resolved from id_token claims.",
        "handlePortalOauthCallback",
        "DECODE_ID_TOKEN_AND_BUILD_IDENTITY_RESULT",
        {
          userId,
          provider: statePayload.provider,
          intent: statePayload.intent,
          hasEmail: email.length > 0,
          hasName: name.length > 0,
        },
      );

      return result;
      // END_BLOCK_DECODE_ID_TOKEN_AND_BUILD_IDENTITY_RESULT_M_PORTAL_IDENTITY_012
    } catch (error: unknown) {
      throw toPortalIdentityError(error, "Failed to handle portal OAuth callback.");
    }
  }

  // START_CONTRACT: ensureMcpAccessRole
  //   PURPOSE: Ensure tester has required MCP access role/policy without manual admin action via Logto Management API.
  //   INPUTS: { userId: string - Logto user ID to provision role for }
  //   OUTPUTS: { Promise<RoleProvisionResult> - Whether role was provisioned and the role ID }
  //   SIDE_EFFECTS: [HTTP POST to Logto Management API for M2M token and role assignment, structured logging]
  //   LINKS: [M-PORTAL-IDENTITY, M-CONFIG]
  // END_CONTRACT: ensureMcpAccessRole
  async function ensureMcpAccessRole(userId: string): Promise<RoleProvisionResult> {
    // START_BLOCK_VALIDATE_USER_ID_INPUT_M_PORTAL_IDENTITY_013
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) {
      throw new PortalIdentityError("userId must be a non-empty string.", {
        field: "userId",
      });
    }
    // END_BLOCK_VALIDATE_USER_ID_INPUT_M_PORTAL_IDENTITY_013

    try {
      // START_BLOCK_ACQUIRE_M2M_ACCESS_TOKEN_M_PORTAL_IDENTITY_014
      const tenantBaseUrl = config.logto.tenantUrl.replace(/\/+$/, "");
      const managementApiResource = config.portal.logtoManagementApiResource;

      const m2mBody = new URLSearchParams();
      m2mBody.set("grant_type", "client_credentials");
      m2mBody.set("resource", managementApiResource);
      m2mBody.set("scope", "all");

      const m2mAppId = config.portal.logtoM2mAppId;
      const m2mAppSecret = config.portal.logtoM2mAppSecret;

      log.debug(
        "Acquiring M2M access token for Logto Management API.",
        "ensureMcpAccessRole",
        "ACQUIRE_M2M_ACCESS_TOKEN",
        {
          tokenEndpoint: config.logto.oidcTokenEndpoint,
          resource: managementApiResource,
        },
      );

      const m2mResponse = await fetch(config.logto.oidcTokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${m2mAppId}:${m2mAppSecret}`, "utf8").toString("base64")}`,
        },
        body: m2mBody.toString(),
      });

      if (!m2mResponse.ok) {
        const responseText = await m2mResponse.text().catch(() => "(unreadable body)");
        throw new PortalIdentityError("M2M token request failed.", {
          status: m2mResponse.status,
          statusText: m2mResponse.statusText,
          body: responseText,
        });
      }

      const m2mData = (await m2mResponse.json()) as Record<string, unknown>;
      const accessToken = m2mData["access_token"];

      if (typeof accessToken !== "string" || !accessToken.trim()) {
        throw new PortalIdentityError("M2M token response missing access_token.", {
          receivedKeys: Object.keys(m2mData),
        });
      }

      log.debug(
        "M2M access token acquired successfully.",
        "ensureMcpAccessRole",
        "ACQUIRE_M2M_ACCESS_TOKEN",
      );
      // END_BLOCK_ACQUIRE_M2M_ACCESS_TOKEN_M_PORTAL_IDENTITY_014

      // START_BLOCK_ASSIGN_MCP_USER_ROLE_TO_USER_M_PORTAL_IDENTITY_015
      const mcpUserRoleId = config.portal.mcpUserRoleId;
      const roleAssignUrl = `${tenantBaseUrl}/api/users/${encodeURIComponent(trimmedUserId)}/roles`;
      const rolePayload = JSON.stringify({ roleIds: [mcpUserRoleId] });

      log.debug(
        "Assigning MCP user role to user via Management API.",
        "ensureMcpAccessRole",
        "ASSIGN_MCP_USER_ROLE_TO_USER",
        {
          userId: trimmedUserId,
          roleId: mcpUserRoleId,
          roleAssignUrl,
        },
      );

      const roleResponse = await fetch(roleAssignUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: rolePayload,
      });

      // 200/201 = assigned, 409/422 = already assigned (treat as success)
      if (roleResponse.ok || roleResponse.status === 409 || roleResponse.status === 422) {
        const alreadyAssigned = roleResponse.status === 409 || roleResponse.status === 422;

        log.info(
          alreadyAssigned
            ? "MCP user role already assigned to user."
            : "MCP user role assigned to user successfully.",
          "ensureMcpAccessRole",
          "ASSIGN_MCP_USER_ROLE_TO_USER",
          {
            userId: trimmedUserId,
            roleId: mcpUserRoleId,
            alreadyAssigned,
            status: roleResponse.status,
          },
        );

        return { provisioned: true, roleId: mcpUserRoleId };
      }

      const roleResponseText = await roleResponse.text().catch(() => "(unreadable body)");
      throw new PortalIdentityError("Role assignment request failed.", {
        status: roleResponse.status,
        statusText: roleResponse.statusText,
        body: roleResponseText,
        userId: trimmedUserId,
        roleId: mcpUserRoleId,
      });
      // END_BLOCK_ASSIGN_MCP_USER_ROLE_TO_USER_M_PORTAL_IDENTITY_015
    } catch (error: unknown) {
      throw toPortalIdentityError(error, "Failed to ensure MCP access role.", {
        userId: trimmedUserId,
      });
    }
  }

  // START_BLOCK_RETURN_PORTAL_IDENTITY_CLIENT_M_PORTAL_IDENTITY_016
  return {
    buildPortalOauthStartUrl,
    handlePortalOauthCallback,
    ensureMcpAccessRole,
  };
  // END_BLOCK_RETURN_PORTAL_IDENTITY_CLIENT_M_PORTAL_IDENTITY_016
}
