// FILE: src/runtime/fastmcp-runtime.ts
// VERSION: 1.9.0
// START_MODULE_CONTRACT
//   PURPOSE: Create and configure FastMCP runtime with OAuth metadata, authenticate hook, fixed tool surface (4 proxied + 3 local) with per-user usage tracking and country_code routing, health endpoint, delegated /admin routes, and portal/landing routes.
//   SCOPE: Instantiate FastMCP, map M-AUTH-PROXY metadata into FastMCP oauth configuration, authenticate /mcp requests through OAuthProxy token loading, register four proxied tools and three local tools (get_site_sources, search_sites, get_page_chunk) with zod schemas and canAccess guards, route tool execution to ToolProxyService or local handler with fire-and-forget usage tracking and per-country context, mount OAuth diagnostics notFound routes, mount /admin routes, and mount / and /portal/* routes through FastMCP.getApp().
//   DEPENDS: M-CONFIG, M-LOGGER, M-AUTH-PROXY, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-ADMIN-UI, M-PORTAL-UI, M-USAGE-TRACKER, M-SITE-SOURCES, M-SITES-SEARCH, M-COUNTRY-SETTINGS
//   LINKS: M-FASTMCP-RUNTIME, M-CONFIG, M-LOGGER, M-AUTH-PROXY, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-ADMIN-UI, M-PORTAL-UI, M-USAGE-TRACKER, M-SITE-SOURCES, M-SITES-SEARCH, M-COUNTRY-SETTINGS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   FastMcpRuntimeDependencies - Runtime dependency contract for FastMCP wiring.
//   FastMcpRuntimeError - Typed runtime error with FASTMCP_RUNTIME_ERROR code.
//   createFastMcpRuntime - Build a FastMCP runtime with auth, oauth, health, tools, admin, and portal routes.
//   maskSensitiveTextValue - Mask sensitive OAuth query values for diagnostics logs.
//   readUrlOriginIfParseable - Read URL origin from optional URI query values when parseable.
//   countScopesFromQueryValue - Count normalized scope entries from OAuth scope query value.
//   mountOauthDiagnosticsNotFoundRoutes - Mount OAuth diagnostics notFound routes to log sanitized authorize/callback query diagnostics.
//   registerProxyTools - Register fixed four-tool proxy surface on FastMCP with country_code context extraction and per-country chat ID routing.
//   registerLocalTools - Register local tools (get_site_sources, search_sites, get_page_chunk) with canAccess guard, country_code extraction, and per-country usage tracking.
//   mountAdminRoutes - Mount /admin and /admin/* handlers via FastMCP.getApp().
//   mountPortalRoutes - Mount / landing and /portal/* handlers via FastMCP.getApp().
//   extractUserIdFromSession - Extract user sub claim from MCP OAuth session JWT tokens for usage tracking.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.9.0 - Wired country_code through proxy and local tools: extract from args, resolve CountryContext via CountryCache, pass to proxyService.executeTool and getSiteSources, update recordToolCall with countryCode, genericize tool descriptions.
//   PREVIOUS: v1.8.0 - Registered search_sites and get_page_chunk local tools with SitesSearchService dependency wiring and usage tracking.
// END_CHANGE_SUMMARY

import { FastMCP, type ServerOptions } from "fastmcp";
import type { IncomingMessage } from "node:http";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { OauthProxyContext } from "../auth/oauth-proxy";
import type { AppConfig } from "../config/index";
import type { CountryCache } from "../countries/index";
import type { Logger } from "../logger/index";
import type { SitesSearchService } from "../sites/search/service";
import {
  GetMessageContextInputSchema,
  GetPageChunkInputSchema,
  GetRelatedMessagesInputSchema,
  ListSourcesInputSchema,
  SearchMessagesInputPublicSchema,
  SearchSitesInputSchema,
  TOOL_INPUT_JSON_SCHEMAS,
} from "../tools/contracts";
import type { CountryContext } from "../tools/proxy-service";
import { ProxyExecutionError, type ToolProxyService } from "../tools/proxy-service";
import { GetSiteSourcesInputSchema, getSiteSources } from "../tools/site-sources";
import type { UsageTracker } from "../usage/tracker";

const FASTMCP_SERVER_NAME = "travel-rag-mcp";
const FASTMCP_SERVER_VERSION: `${number}.${number}.${number}` = "0.4.0";
const FASTMCP_HEALTH_PATH = "/healthz";

type RuntimeOauthSession = {
  authenticated: true;
  accessToken: string;
  scopes: string[];
  expiresAt?: number;
  idToken?: string;
  refreshToken?: string;
};
type RuntimeSessionAuth = RuntimeOauthSession | undefined;

// START_CONTRACT: extractUserIdFromSession
//   PURPOSE: Extract user identity (sub claim) from MCP OAuth session JWT tokens for per-user usage tracking.
//   INPUTS: { session: RuntimeSessionAuth - OAuth session with optional idToken and accessToken, or undefined }
//   OUTPUTS: { string | null - The sub claim value from the JWT payload, or null on any failure }
//   SIDE_EFFECTS: [none]
//   INVARIANTS:
//     - MUST NEVER THROW under any input
//     - Prefers idToken over accessToken when both are present
//     - Performs JWT payload extraction only (no cryptographic verification)
//     - Returns null for missing session, missing tokens, malformed JWTs, invalid JSON payloads, or absent sub claim
//   LINKS: [M-FASTMCP-RUNTIME, M-USAGE-TRACKER]
// END_CONTRACT: extractUserIdFromSession
export function extractUserIdFromSession(session: RuntimeSessionAuth): string | null {
  // START_BLOCK_EXTRACT_USER_ID_FROM_SESSION_JWT_M_FASTMCP_RUNTIME_010
  if (!session) {
    return null;
  }

  const tokens: string[] = [];
  if (session.idToken) {
    tokens.push(session.idToken);
  }
  if (session.accessToken) {
    tokens.push(session.accessToken);
  }

  for (const token of tokens) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        continue;
      }

      const payloadSegment = parts[1];
      const decoded = atob(payloadSegment.replace(/-/g, "+").replace(/_/g, "/"));
      const payload: unknown = JSON.parse(decoded);

      if (
        typeof payload === "object" &&
        payload !== null &&
        "sub" in payload &&
        typeof (payload as Record<string, unknown>).sub === "string"
      ) {
        return (payload as Record<string, unknown>).sub as string;
      }
    } catch {
      continue;
    }
  }

  return null;
  // END_BLOCK_EXTRACT_USER_ID_FROM_SESSION_JWT_M_FASTMCP_RUNTIME_010
}

type RuntimeToolName =
  | "search_messages"
  | "get_message_context"
  | "get_related_messages"
  | "list_sources";

type RuntimeToolParameters =
  | typeof SearchMessagesInputPublicSchema
  | typeof GetMessageContextInputSchema
  | typeof GetRelatedMessagesInputSchema
  | typeof ListSourcesInputSchema;

type RuntimeToolDescriptor = {
  name: RuntimeToolName;
  description: string;
  parameters: RuntimeToolParameters;
};

const RUNTIME_TOOL_DESCRIPTORS: readonly RuntimeToolDescriptor[] = [
  {
    name: "search_messages",
    description: TOOL_INPUT_JSON_SCHEMAS.search_messages.description,
    parameters: SearchMessagesInputPublicSchema,
  },
  {
    name: "get_message_context",
    description: TOOL_INPUT_JSON_SCHEMAS.get_message_context.description,
    parameters: GetMessageContextInputSchema,
  },
  {
    name: "get_related_messages",
    description: TOOL_INPUT_JSON_SCHEMAS.get_related_messages.description,
    parameters: GetRelatedMessagesInputSchema,
  },
  {
    name: "list_sources",
    description: TOOL_INPUT_JSON_SCHEMAS.list_sources.description,
    parameters: ListSourcesInputSchema,
  },
];

type FastMcpOauthConfig = NonNullable<ServerOptions<RuntimeSessionAuth>["oauth"]>;
type FastMcpAuthorizationServerMetadata = NonNullable<FastMcpOauthConfig["authorizationServer"]>;
type FastMcpProtectedResourceMetadata = NonNullable<FastMcpOauthConfig["protectedResource"]>;
type OauthUpstreamTokenSet = NonNullable<
  Awaited<ReturnType<OauthProxyContext["oauthProxy"]["loadUpstreamTokens"]>>
>;

type FastMcpRuntimeErrorDetails = {
  field?: string;
  cause?: string;
};

type RegisterProxyToolsDependencies = {
  logger: Logger;
  proxyService: ToolProxyService;
  usageTracker: UsageTracker;
  countryCache: CountryCache;
};

type MountAdminRoutesDependencies = {
  logger: Logger;
  adminHandler: (request: Request) => Promise<Response>;
};

type MountPortalRoutesDependencies = {
  logger: Logger;
  portalLandingHandler: (request: Request) => Promise<Response>;
  portalHandler: (request: Request) => Promise<Response>;
};

type MountOauthDiagnosticsRoutesDependencies = {
  logger: Logger;
};

export type FastMcpRuntimeDependencies = {
  config: AppConfig;
  logger: Logger;
  oauthProxyContext: OauthProxyContext;
  proxyService: ToolProxyService;
  adminHandler: (request: Request) => Promise<Response>;
  portalLandingHandler: (request: Request) => Promise<Response>;
  portalHandler: (request: Request) => Promise<Response>;
  usageTracker: UsageTracker;
  sitesSearchService: SitesSearchService;
  countryCache: CountryCache;
  db: NodePgDatabase;
};

export class FastMcpRuntimeError extends Error {
  public readonly code = "FASTMCP_RUNTIME_ERROR" as const;
  public readonly details?: FastMcpRuntimeErrorDetails;

  public constructor(message: string, details?: FastMcpRuntimeErrorDetails) {
    super(message);
    this.name = "FastMcpRuntimeError";
    this.details = details;
  }
}

// START_CONTRACT: normalizeOptionalText
//   PURPOSE: Normalize optional text values by trimming and coercing empty values to undefined.
//   INPUTS: { value: unknown - Candidate runtime value }
//   OUTPUTS: { string|undefined - Trimmed text or undefined }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: normalizeOptionalText
function normalizeOptionalText(value: unknown): string | undefined {
  // START_BLOCK_NORMALIZE_OPTIONAL_TEXT_VALUE_M_FASTMCP_RUNTIME_001
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
  // END_BLOCK_NORMALIZE_OPTIONAL_TEXT_VALUE_M_FASTMCP_RUNTIME_001
}

// START_CONTRACT: asObjectRecord
//   PURPOSE: Narrow unknown values to object records for metadata field access.
//   INPUTS: { value: unknown - Candidate runtime value, field: string - Source field name }
//   OUTPUTS: { Record<string, unknown> - Narrowed object record }
//   SIDE_EFFECTS: [Throws FastMcpRuntimeError when value is not object-like]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: asObjectRecord
function asObjectRecord(value: unknown, field: string): Record<string, unknown> {
  // START_BLOCK_NARROW_UNKNOWN_TO_OBJECT_RECORD_M_FASTMCP_RUNTIME_002
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FastMcpRuntimeError("Expected object record for FastMCP oauth metadata.", {
      field,
    });
  }

  return value as Record<string, unknown>;
  // END_BLOCK_NARROW_UNKNOWN_TO_OBJECT_RECORD_M_FASTMCP_RUNTIME_002
}

// START_CONTRACT: toCamelCaseKey
//   PURPOSE: Convert snake_case metadata field keys to camelCase for FastMCP oauth option compatibility.
//   INPUTS: { key: string - Source metadata key }
//   OUTPUTS: { string - camelCase field key }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: toCamelCaseKey
function toCamelCaseKey(key: string): string {
  // START_BLOCK_CONVERT_SNAKE_CASE_KEY_TO_CAMEL_CASE_M_FASTMCP_RUNTIME_003
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  // END_BLOCK_CONVERT_SNAKE_CASE_KEY_TO_CAMEL_CASE_M_FASTMCP_RUNTIME_003
}

// START_CONTRACT: toCamelCaseRecord
//   PURPOSE: Convert top-level metadata object keys from snake_case to camelCase.
//   INPUTS: { record: Record<string, unknown> - Source metadata object }
//   OUTPUTS: { Record<string, unknown> - Metadata object keyed by camelCase }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: toCamelCaseRecord
function toCamelCaseRecord(record: Record<string, unknown>): Record<string, unknown> {
  // START_BLOCK_CONVERT_METADATA_RECORD_KEYS_TO_CAMEL_CASE_M_FASTMCP_RUNTIME_004
  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    converted[toCamelCaseKey(key)] = value;
  }
  return converted;
  // END_BLOCK_CONVERT_METADATA_RECORD_KEYS_TO_CAMEL_CASE_M_FASTMCP_RUNTIME_004
}

// START_CONTRACT: readRequiredStringField
//   PURPOSE: Read required non-empty string fields from metadata objects.
//   INPUTS: { record: Record<string, unknown> - Metadata object, fieldName: string - Required field key, contextField: string - Diagnostics scope }
//   OUTPUTS: { string - Required normalized string value }
//   SIDE_EFFECTS: [Throws FastMcpRuntimeError for missing/invalid field values]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: readRequiredStringField
function readRequiredStringField(
  record: Record<string, unknown>,
  fieldName: string,
  contextField: string,
): string {
  // START_BLOCK_READ_REQUIRED_STRING_FIELD_M_FASTMCP_RUNTIME_005
  const normalized = normalizeOptionalText(record[fieldName]);
  if (!normalized) {
    throw new FastMcpRuntimeError("Missing required string field for FastMCP oauth metadata.", {
      field: `${contextField}.${fieldName}`,
    });
  }
  return normalized;
  // END_BLOCK_READ_REQUIRED_STRING_FIELD_M_FASTMCP_RUNTIME_005
}

// START_CONTRACT: readRequiredUrlField
//   PURPOSE: Validate required URL-like values and return normalized absolute URL strings.
//   INPUTS: { value: unknown - Candidate value, field: string - Diagnostic field path }
//   OUTPUTS: { string - Normalized URL string }
//   SIDE_EFFECTS: [Throws FastMcpRuntimeError when value is missing/invalid URL]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: readRequiredUrlField
function readRequiredUrlField(value: unknown, field: string): string {
  // START_BLOCK_VALIDATE_REQUIRED_URL_FIELD_M_FASTMCP_RUNTIME_021
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    throw new FastMcpRuntimeError("Missing required URL field for FastMCP runtime configuration.", {
      field,
    });
  }

  try {
    return new URL(normalizedValue).toString();
  } catch {
    throw new FastMcpRuntimeError("Invalid URL field for FastMCP runtime configuration.", {
      field,
    });
  }
  // END_BLOCK_VALIDATE_REQUIRED_URL_FIELD_M_FASTMCP_RUNTIME_021
}

// START_CONTRACT: readOptionalStringField
//   PURPOSE: Read optional non-empty string fields from metadata objects.
//   INPUTS: { record: Record<string, unknown> - Metadata object, fieldName: string - Optional field key }
//   OUTPUTS: { string|undefined - Optional normalized string value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: readOptionalStringField
function readOptionalStringField(
  record: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  // START_BLOCK_READ_OPTIONAL_STRING_FIELD_M_FASTMCP_RUNTIME_006
  return normalizeOptionalText(record[fieldName]);
  // END_BLOCK_READ_OPTIONAL_STRING_FIELD_M_FASTMCP_RUNTIME_006
}

// START_CONTRACT: readOptionalBooleanField
//   PURPOSE: Read optional boolean fields from metadata objects.
//   INPUTS: { record: Record<string, unknown> - Metadata object, fieldName: string - Optional field key }
//   OUTPUTS: { boolean|undefined - Optional boolean value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: readOptionalBooleanField
function readOptionalBooleanField(
  record: Record<string, unknown>,
  fieldName: string,
): boolean | undefined {
  // START_BLOCK_READ_OPTIONAL_BOOLEAN_FIELD_M_FASTMCP_RUNTIME_007
  const value = record[fieldName];
  return typeof value === "boolean" ? value : undefined;
  // END_BLOCK_READ_OPTIONAL_BOOLEAN_FIELD_M_FASTMCP_RUNTIME_007
}

// START_CONTRACT: readStringArrayField
//   PURPOSE: Normalize unknown metadata values into deduplicated non-empty string arrays.
//   INPUTS: { value: unknown - Candidate field value }
//   OUTPUTS: { string[]|undefined - Normalized array when value is an array of strings; otherwise undefined }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: readStringArrayField
function readStringArrayField(value: unknown): string[] | undefined {
  // START_BLOCK_NORMALIZE_STRING_ARRAY_FIELD_M_FASTMCP_RUNTIME_008
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalizedValues: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    const normalized = normalizeOptionalText(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    normalizedValues.push(normalized);
  }

  return normalizedValues;
  // END_BLOCK_NORMALIZE_STRING_ARRAY_FIELD_M_FASTMCP_RUNTIME_008
}

// START_CONTRACT: readRequiredStringArrayField
//   PURPOSE: Read required string-array metadata fields.
//   INPUTS: { record: Record<string, unknown> - Metadata object, fieldName: string - Required field key, contextField: string - Diagnostics scope }
//   OUTPUTS: { string[] - Required normalized non-empty string array }
//   SIDE_EFFECTS: [Throws FastMcpRuntimeError for missing/invalid field values]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: readRequiredStringArrayField
function readRequiredStringArrayField(
  record: Record<string, unknown>,
  fieldName: string,
  contextField: string,
): string[] {
  // START_BLOCK_READ_REQUIRED_STRING_ARRAY_FIELD_M_FASTMCP_RUNTIME_009
  const normalizedValues = readStringArrayField(record[fieldName]);
  if (!normalizedValues || normalizedValues.length === 0) {
    throw new FastMcpRuntimeError("Missing required string-array field for FastMCP oauth metadata.", {
      field: `${contextField}.${fieldName}`,
    });
  }
  return normalizedValues;
  // END_BLOCK_READ_REQUIRED_STRING_ARRAY_FIELD_M_FASTMCP_RUNTIME_009
}

// START_CONTRACT: readOptionalStringArrayField
//   PURPOSE: Read optional string-array metadata fields.
//   INPUTS: { record: Record<string, unknown> - Metadata object, fieldName: string - Optional field key }
//   OUTPUTS: { string[]|undefined - Optional normalized string array }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: readOptionalStringArrayField
function readOptionalStringArrayField(
  record: Record<string, unknown>,
  fieldName: string,
): string[] | undefined {
  // START_BLOCK_READ_OPTIONAL_STRING_ARRAY_FIELD_M_FASTMCP_RUNTIME_010
  const normalizedValues = readStringArrayField(record[fieldName]);
  return normalizedValues && normalizedValues.length > 0 ? normalizedValues : undefined;
  // END_BLOCK_READ_OPTIONAL_STRING_ARRAY_FIELD_M_FASTMCP_RUNTIME_010
}

// START_CONTRACT: applyOptionalField
//   PURPOSE: Copy optional metadata values into target objects only when value is defined.
//   INPUTS: { target: Record<string, unknown> - Target object, key: string - Target field key, value: unknown - Candidate optional value }
//   OUTPUTS: { void - No return value }
//   SIDE_EFFECTS: [Mutates target object]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: applyOptionalField
function applyOptionalField(target: Record<string, unknown>, key: string, value: unknown): void {
  // START_BLOCK_ASSIGN_OPTIONAL_FIELD_WHEN_DEFINED_M_FASTMCP_RUNTIME_011
  if (value !== undefined) {
    target[key] = value;
  }
  // END_BLOCK_ASSIGN_OPTIONAL_FIELD_WHEN_DEFINED_M_FASTMCP_RUNTIME_011
}

// START_CONTRACT: buildAuthorizationServerMetadata
//   PURPOSE: Map authorization-server metadata from OauthProxyContext payload into FastMCP oauth option shape.
//   INPUTS: { oauthProxyContext: OauthProxyContext - Initialized OAuth proxy context payload }
//   OUTPUTS: { FastMcpAuthorizationServerMetadata - FastMCP-compatible authorization server metadata }
//   SIDE_EFFECTS: [Throws FastMcpRuntimeError on invalid metadata shape]
//   LINKS: [M-FASTMCP-RUNTIME, M-AUTH-PROXY]
// END_CONTRACT: buildAuthorizationServerMetadata
function buildAuthorizationServerMetadata(
  oauthProxyContext: OauthProxyContext,
): FastMcpAuthorizationServerMetadata {
  // START_BLOCK_MAP_AUTHORIZATION_SERVER_METADATA_TO_FASTMCP_SHAPE_M_FASTMCP_RUNTIME_012
  const sourceRecord = asObjectRecord(
    oauthProxyContext.authorizationServerMetadata,
    "oauthProxyContext.authorizationServerMetadata",
  );
  const metadata = toCamelCaseRecord(sourceRecord);

  const authorizationServer: FastMcpAuthorizationServerMetadata = {
    issuer: readRequiredStringField(metadata, "issuer", "authorizationServerMetadata"),
    authorizationEndpoint: readRequiredStringField(
      metadata,
      "authorizationEndpoint",
      "authorizationServerMetadata",
    ),
    tokenEndpoint: readRequiredStringField(
      metadata,
      "tokenEndpoint",
      "authorizationServerMetadata",
    ),
    responseTypesSupported: readRequiredStringArrayField(
      metadata,
      "responseTypesSupported",
      "authorizationServerMetadata",
    ),
  };

  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "codeChallengeMethodsSupported",
    readOptionalStringArrayField(metadata, "codeChallengeMethodsSupported"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "dpopSigningAlgValuesSupported",
    readOptionalStringArrayField(metadata, "dpopSigningAlgValuesSupported"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "grantTypesSupported",
    readOptionalStringArrayField(metadata, "grantTypesSupported"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "introspectionEndpoint",
    readOptionalStringField(metadata, "introspectionEndpoint"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "jwksUri",
    readOptionalStringField(metadata, "jwksUri"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "opPolicyUri",
    readOptionalStringField(metadata, "opPolicyUri"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "opTosUri",
    readOptionalStringField(metadata, "opTosUri"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "registrationEndpoint",
    readOptionalStringField(metadata, "registrationEndpoint"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "responseModesSupported",
    readOptionalStringArrayField(metadata, "responseModesSupported"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "revocationEndpoint",
    readOptionalStringField(metadata, "revocationEndpoint"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "scopesSupported",
    readOptionalStringArrayField(metadata, "scopesSupported"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "serviceDocumentation",
    readOptionalStringField(metadata, "serviceDocumentation"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "tokenEndpointAuthMethodsSupported",
    readOptionalStringArrayField(metadata, "tokenEndpointAuthMethodsSupported"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "tokenEndpointAuthSigningAlgValuesSupported",
    readOptionalStringArrayField(metadata, "tokenEndpointAuthSigningAlgValuesSupported"),
  );
  applyOptionalField(
    authorizationServer as Record<string, unknown>,
    "uiLocalesSupported",
    readOptionalStringArrayField(metadata, "uiLocalesSupported"),
  );

  return authorizationServer;
  // END_BLOCK_MAP_AUTHORIZATION_SERVER_METADATA_TO_FASTMCP_SHAPE_M_FASTMCP_RUNTIME_012
}

// START_CONTRACT: buildProtectedResourceMetadata
//   PURPOSE: Build protected-resource metadata from runtime AppConfig and OAuth proxy authorization-server issuer for /mcp OAuth resource discovery.
//   INPUTS: { config: AppConfig - Runtime config with PUBLIC_URL, authorizationServerMetadata: FastMcpAuthorizationServerMetadata - OAuth proxy authorization-server metadata }
//   OUTPUTS: { FastMcpProtectedResourceMetadata - FastMCP-compatible protected resource metadata }
//   SIDE_EFFECTS: [Throws FastMcpRuntimeError on invalid configuration values]
//   LINKS: [M-FASTMCP-RUNTIME, M-CONFIG, M-AUTH-PROXY]
// END_CONTRACT: buildProtectedResourceMetadata
function buildProtectedResourceMetadata(
  config: AppConfig,
  authorizationServerMetadata: FastMcpAuthorizationServerMetadata,
): FastMcpProtectedResourceMetadata {
  // START_BLOCK_MAP_PROTECTED_RESOURCE_METADATA_TO_FASTMCP_SHAPE_M_FASTMCP_RUNTIME_013
  const publicUrl = readRequiredUrlField(config.publicUrl, "config.publicUrl");
  const resourceUrl = new URL("/mcp", publicUrl).toString();
  const authorizationServerIssuer = readRequiredUrlField(
    authorizationServerMetadata.issuer,
    "oauthProxyContext.authorizationServerMetadata.issuer",
  );
  return {
    resource: resourceUrl,
    authorizationServers: [authorizationServerIssuer],
    bearerMethodsSupported: ["header"],
  };
  // END_BLOCK_MAP_PROTECTED_RESOURCE_METADATA_TO_FASTMCP_SHAPE_M_FASTMCP_RUNTIME_013
}

// START_CONTRACT: buildOauthConfig
//   PURPOSE: Build FastMCP oauth configuration object from runtime config and OauthProxyContext metadata.
//   INPUTS: { config: AppConfig - Runtime app config, oauthProxyContext: OauthProxyContext - Initialized OAuth proxy context payload }
//   OUTPUTS: { FastMcpOauthConfig - FastMCP oauth option configuration }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME, M-CONFIG, M-AUTH-PROXY]
// END_CONTRACT: buildOauthConfig
function buildOauthConfig(
  config: AppConfig,
  oauthProxyContext: OauthProxyContext,
): FastMcpOauthConfig {
  // START_BLOCK_BUILD_FASTMCP_OAUTH_CONFIGURATION_M_FASTMCP_RUNTIME_014
  const authorizationServer = buildAuthorizationServerMetadata(oauthProxyContext);
  return {
    enabled: true,
    proxy: oauthProxyContext.oauthProxy,
    authorizationServer,
    protectedResource: buildProtectedResourceMetadata(config, authorizationServer),
  };
  // END_BLOCK_BUILD_FASTMCP_OAUTH_CONFIGURATION_M_FASTMCP_RUNTIME_014
}

// START_CONTRACT: extractBearerToken
//   PURPOSE: Parse a strict Bearer token from IncomingMessage authorization headers.
//   INPUTS: { request: IncomingMessage|undefined - FastMCP incoming request }
//   OUTPUTS: { string|undefined - Bearer token when header is valid; otherwise undefined }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: extractBearerToken
function extractBearerToken(request: IncomingMessage | undefined): string | undefined {
  // START_BLOCK_EXTRACT_BEARER_TOKEN_FROM_INCOMING_REQUEST_M_FASTMCP_RUNTIME_022
  if (!request || !request.headers) {
    return undefined;
  }

  const authorizationHeaderRaw = request.headers.authorization;
  const authorizationHeader = Array.isArray(authorizationHeaderRaw)
    ? authorizationHeaderRaw[0]
    : authorizationHeaderRaw;
  const normalizedAuthorizationHeader = normalizeOptionalText(authorizationHeader);
  if (!normalizedAuthorizationHeader) {
    return undefined;
  }

  const matched = /^Bearer\s+(.+)$/i.exec(normalizedAuthorizationHeader);
  if (!matched || matched.length < 2) {
    return undefined;
  }

  return normalizeOptionalText(matched[1]);
  // END_BLOCK_EXTRACT_BEARER_TOKEN_FROM_INCOMING_REQUEST_M_FASTMCP_RUNTIME_022
}

// START_CONTRACT: mapUpstreamTokensToRuntimeSession
//   PURPOSE: Convert OAuthProxy upstream token payload into runtime authenticated session shape.
//   INPUTS: { upstreamTokens: OauthUpstreamTokenSet - Upstream token payload from OAuthProxy }
//   OUTPUTS: { RuntimeOauthSession - Authenticated runtime session for FastMCP tools canAccess checks }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME, M-AUTH-PROXY]
// END_CONTRACT: mapUpstreamTokensToRuntimeSession
function mapUpstreamTokensToRuntimeSession(upstreamTokens: OauthUpstreamTokenSet): RuntimeOauthSession {
  // START_BLOCK_MAP_UPSTREAM_TOKENS_TO_RUNTIME_OAUTH_SESSION_M_FASTMCP_RUNTIME_023
  const normalizedScopes = readStringArrayField(upstreamTokens.scope) ?? [];
  const accessToken = normalizeOptionalText(upstreamTokens.accessToken);

  if (!accessToken) {
    throw new FastMcpRuntimeError("OAuthProxy returned upstream tokens without access token.", {
      field: "oauthProxyContext.oauthProxy.loadUpstreamTokens.accessToken",
    });
  }

  const issuedAtMs =
    upstreamTokens.issuedAt instanceof Date ? upstreamTokens.issuedAt.getTime() : Date.now();
  const issuedAtSeconds = Math.floor(issuedAtMs / 1000);
  const expiresAt =
    Number.isFinite(upstreamTokens.expiresIn) && upstreamTokens.expiresIn > 0
      ? issuedAtSeconds + upstreamTokens.expiresIn
      : undefined;

  return {
    authenticated: true,
    accessToken,
    scopes: normalizedScopes,
    expiresAt,
    idToken: normalizeOptionalText(upstreamTokens.idToken),
    refreshToken: normalizeOptionalText(upstreamTokens.refreshToken),
  };
  // END_BLOCK_MAP_UPSTREAM_TOKENS_TO_RUNTIME_OAUTH_SESSION_M_FASTMCP_RUNTIME_023
}

// START_CONTRACT: authenticateOauthProxyRequest
//   PURPOSE: Authenticate /mcp requests by loading upstream tokens through OAuthProxy bearer token validation.
//   INPUTS: { request: IncomingMessage|undefined - FastMCP incoming request, oauthProxyContext: OauthProxyContext - OAuth proxy dependencies, logger: Logger - Runtime logger }
//   OUTPUTS: { Promise<RuntimeSessionAuth> - Authenticated session or undefined for unauthorized requests }
//   SIDE_EFFECTS: [Emits structured logs]
//   LINKS: [M-FASTMCP-RUNTIME, M-AUTH-PROXY, M-LOGGER]
// END_CONTRACT: authenticateOauthProxyRequest
async function authenticateOauthProxyRequest(
  request: IncomingMessage | undefined,
  oauthProxyContext: OauthProxyContext,
  logger: Logger,
): Promise<RuntimeSessionAuth> {
  // START_BLOCK_AUTHENTICATE_REQUEST_VIA_OAUTH_PROXY_TOKEN_LOADING_M_FASTMCP_RUNTIME_024
  const bearerToken = extractBearerToken(request);
  if (!bearerToken) {
    logger.warn(
      "Rejected unauthenticated /mcp request because Bearer token is missing or malformed.",
      "authenticateOauthProxyRequest",
      "AUTHENTICATE_REQUEST_VIA_OAUTH_PROXY_TOKEN_LOADING",
    );
    return undefined;
  }

  try {
    const upstreamTokens = await oauthProxyContext.oauthProxy.loadUpstreamTokens(bearerToken);
    if (!upstreamTokens) {
      logger.warn(
        "Rejected /mcp request because OAuthProxy token lookup returned no upstream token set.",
        "authenticateOauthProxyRequest",
        "AUTHENTICATE_REQUEST_VIA_OAUTH_PROXY_TOKEN_LOADING",
      );
      return undefined;
    }

    const session = mapUpstreamTokensToRuntimeSession(upstreamTokens);
    logger.info(
      "Authenticated /mcp request through OAuthProxy token loading.",
      "authenticateOauthProxyRequest",
      "AUTHENTICATE_REQUEST_VIA_OAUTH_PROXY_TOKEN_LOADING",
      {
        scopes: session.scopes,
      },
    );
    return session;
  } catch (error: unknown) {
    logger.warn(
      "Rejected /mcp request because OAuthProxy token loading failed.",
      "authenticateOauthProxyRequest",
      "AUTHENTICATE_REQUEST_VIA_OAUTH_PROXY_TOKEN_LOADING",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
    return undefined;
  }
  // END_BLOCK_AUTHENTICATE_REQUEST_VIA_OAUTH_PROXY_TOKEN_LOADING_M_FASTMCP_RUNTIME_024
}

// START_CONTRACT: canAccessAuthenticatedProxyTools
//   PURPOSE: Enforce that proxied tools are executable only for authenticated OAuth sessions.
//   INPUTS: { auth: RuntimeSessionAuth - FastMCP session auth payload }
//   OUTPUTS: { boolean - True only when session contains authenticated marker and access token }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: canAccessAuthenticatedProxyTools
function canAccessAuthenticatedProxyTools(auth: RuntimeSessionAuth): boolean {
  // START_BLOCK_ENFORCE_CAN_ACCESS_AUTHENTICATED_SESSION_M_FASTMCP_RUNTIME_025
  return (
    auth?.authenticated === true &&
    typeof auth.accessToken === "string" &&
    auth.accessToken !== ""
  );
  // END_BLOCK_ENFORCE_CAN_ACCESS_AUTHENTICATED_SESSION_M_FASTMCP_RUNTIME_025
}

// START_CONTRACT: maskSensitiveTextValue
//   PURPOSE: Mask potentially sensitive query values before writing runtime diagnostics logs.
//   INPUTS: { value: unknown - Candidate sensitive value }
//   OUTPUTS: { string|undefined - Masked value preserving only limited edge characters }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME, M-LOGGER]
// END_CONTRACT: maskSensitiveTextValue
function maskSensitiveTextValue(value: unknown): string | undefined {
  // START_BLOCK_MASK_SENSITIVE_QUERY_VALUE_FOR_DIAGNOSTICS_M_FASTMCP_RUNTIME_026
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    return undefined;
  }

  if (normalizedValue.length <= 2) {
    return "*".repeat(normalizedValue.length);
  }

  if (normalizedValue.length <= 6) {
    return `${normalizedValue.slice(0, 1)}***${normalizedValue.slice(-1)}`;
  }

  return `${normalizedValue.slice(0, 2)}***${normalizedValue.slice(-2)}`;
  // END_BLOCK_MASK_SENSITIVE_QUERY_VALUE_FOR_DIAGNOSTICS_M_FASTMCP_RUNTIME_026
}

// START_CONTRACT: readUrlOriginIfParseable
//   PURPOSE: Parse URL origin for diagnostics-safe logging from redirect URI query values.
//   INPUTS: { value: unknown - Candidate redirect URI query value }
//   OUTPUTS: { string|undefined - URL origin when parseable; otherwise undefined }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: readUrlOriginIfParseable
function readUrlOriginIfParseable(value: unknown): string | undefined {
  // START_BLOCK_PARSE_URL_ORIGIN_FOR_DIAGNOSTICS_LOGGING_M_FASTMCP_RUNTIME_027
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    return undefined;
  }

  try {
    return new URL(normalizedValue).origin;
  } catch {
    return undefined;
  }
  // END_BLOCK_PARSE_URL_ORIGIN_FOR_DIAGNOSTICS_LOGGING_M_FASTMCP_RUNTIME_027
}

// START_CONTRACT: countScopesFromQueryValue
//   PURPOSE: Count normalized OAuth scope entries from an incoming scope query value.
//   INPUTS: { value: unknown - Candidate OAuth scope query value }
//   OUTPUTS: { number - Number of non-empty scopes in the value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: countScopesFromQueryValue
function countScopesFromQueryValue(value: unknown): number {
  // START_BLOCK_COUNT_NORMALIZED_SCOPE_ENTRIES_M_FASTMCP_RUNTIME_028
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    return 0;
  }

  return normalizedValue
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0).length;
  // END_BLOCK_COUNT_NORMALIZED_SCOPE_ENTRIES_M_FASTMCP_RUNTIME_028
}

// START_CONTRACT: mountOauthDiagnosticsNotFoundRoutes
//   PURPOSE: Mount OAuth authorize/callback diagnostics routes that log sanitized request query data and return notFound for FastMCP fallback handling.
//   INPUTS: { fastMcpServer: FastMCP<RuntimeSessionAuth> - Runtime instance, deps: MountOauthDiagnosticsRoutesDependencies - Diagnostics route dependencies }
//   OUTPUTS: { void - Diagnostics routes are mounted on Hono app }
//   SIDE_EFFECTS: [Mutates FastMCP Hono app route table and emits structured logs]
//   LINKS: [M-FASTMCP-RUNTIME, M-LOGGER]
// END_CONTRACT: mountOauthDiagnosticsNotFoundRoutes
export function mountOauthDiagnosticsNotFoundRoutes(
  fastMcpServer: FastMCP<RuntimeSessionAuth>,
  deps: MountOauthDiagnosticsRoutesDependencies,
): void {
  // START_BLOCK_MOUNT_OAUTH_DIAGNOSTIC_NOT_FOUND_ROUTES_M_FASTMCP_RUNTIME_029
  const app = fastMcpServer.getApp();

  app.all("/oauth/authorize", (context) => {
    const requestUrl = new URL(context.req.url);
    const scopeValue = requestUrl.searchParams.get("scope");

    deps.logger.info(
      "Captured OAuth authorize diagnostics at Hono proxy route boundary.",
      "mountOauthDiagnosticsNotFoundRoutes",
      "LOG_OAUTH_AUTHORIZE_PROXY_DIAGNOSTICS",
      {
        clientIdMasked: maskSensitiveTextValue(requestUrl.searchParams.get("client_id")),
        redirectUriOrigin: readUrlOriginIfParseable(requestUrl.searchParams.get("redirect_uri")),
        hasScope: requestUrl.searchParams.has("scope"),
        scopeCount: countScopesFromQueryValue(scopeValue),
      },
    );

    return context.notFound();
  });

  app.all("/oauth/callback", (context) => {
    const requestUrl = new URL(context.req.url);
    const codeValue = normalizeOptionalText(requestUrl.searchParams.get("code"));
    const stateValue = normalizeOptionalText(requestUrl.searchParams.get("state"));

    deps.logger.info(
      "Captured OAuth callback diagnostics at Hono proxy route boundary.",
      "mountOauthDiagnosticsNotFoundRoutes",
      "LOG_OAUTH_CALLBACK_PROXY_DIAGNOSTICS",
      {
        error: normalizeOptionalText(requestUrl.searchParams.get("error")),
        errorDescription: normalizeOptionalText(requestUrl.searchParams.get("error_description")),
        iss: normalizeOptionalText(requestUrl.searchParams.get("iss")),
        hasCode: codeValue !== undefined,
        hasState: stateValue !== undefined,
      },
    );

    return context.notFound();
  });

  deps.logger.info(
    "Mounted OAuth diagnostics notFound routes on FastMCP Hono app.",
    "mountOauthDiagnosticsNotFoundRoutes",
    "MOUNT_OAUTH_DIAGNOSTIC_NOT_FOUND_ROUTES",
    {
      routes: ["/oauth/authorize", "/oauth/callback"],
    },
  );
  // END_BLOCK_MOUNT_OAUTH_DIAGNOSTIC_NOT_FOUND_ROUTES_M_FASTMCP_RUNTIME_029
}

// START_CONTRACT: toFastMcpRuntimeError
//   PURPOSE: Normalize unknown failures to typed FastMcpRuntimeError with stable diagnostics.
//   INPUTS: { error: unknown - Runtime failure, message: string - Stable user-safe message, field: string|undefined - Optional diagnostics field }
//   OUTPUTS: { FastMcpRuntimeError - Typed runtime error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: toFastMcpRuntimeError
function toFastMcpRuntimeError(
  error: unknown,
  message: string,
  field?: string,
): FastMcpRuntimeError {
  // START_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_FASTMCP_RUNTIME_ERROR_M_FASTMCP_RUNTIME_015
  if (error instanceof FastMcpRuntimeError) {
    return error;
  }

  const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new FastMcpRuntimeError(message, { field, cause });
  // END_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_FASTMCP_RUNTIME_ERROR_M_FASTMCP_RUNTIME_015
}

// START_CONTRACT: assertRuntimeDependencies
//   PURPOSE: Validate runtime dependency object contains required callable/object references.
//   INPUTS: { deps: FastMcpRuntimeDependencies - Runtime dependencies }
//   OUTPUTS: { void - Returns only when dependency contract is valid }
//   SIDE_EFFECTS: [Throws FastMcpRuntimeError for invalid dependency shape]
//   LINKS: [M-FASTMCP-RUNTIME]
// END_CONTRACT: assertRuntimeDependencies
function assertRuntimeDependencies(deps: FastMcpRuntimeDependencies): void {
  // START_BLOCK_VALIDATE_FASTMCP_RUNTIME_DEPENDENCIES_M_FASTMCP_RUNTIME_016
  if (!deps || typeof deps !== "object") {
    throw new FastMcpRuntimeError("FastMCP runtime dependencies are required.", {
      field: "deps",
    });
  }

  if (!deps.config || typeof deps.config !== "object") {
    throw new FastMcpRuntimeError("AppConfig dependency is required for FastMCP runtime.", {
      field: "deps.config",
    });
  }

  if (!deps.oauthProxyContext || typeof deps.oauthProxyContext !== "object") {
    throw new FastMcpRuntimeError("OauthProxyContext dependency is required for FastMCP runtime.", {
      field: "deps.oauthProxyContext",
    });
  }

  if (
    !deps.oauthProxyContext.oauthProxy ||
    typeof deps.oauthProxyContext.oauthProxy.loadUpstreamTokens !== "function"
  ) {
    throw new FastMcpRuntimeError(
      "OauthProxyContext.oauthProxy.loadUpstreamTokens dependency is required for FastMCP runtime.",
      {
        field: "deps.oauthProxyContext.oauthProxy.loadUpstreamTokens",
      },
    );
  }

  if (
    !deps.oauthProxyContext.authorizationServerMetadata ||
    typeof deps.oauthProxyContext.authorizationServerMetadata !== "object"
  ) {
    throw new FastMcpRuntimeError(
      "OauthProxyContext.authorizationServerMetadata dependency is required for FastMCP runtime.",
      {
        field: "deps.oauthProxyContext.authorizationServerMetadata",
      },
    );
  }

  if (!deps.logger || typeof deps.logger !== "object") {
    throw new FastMcpRuntimeError("Logger dependency is required for FastMCP runtime.", {
      field: "deps.logger",
    });
  }

  if (!deps.proxyService || typeof deps.proxyService.executeTool !== "function") {
    throw new FastMcpRuntimeError("ToolProxyService dependency is required for FastMCP runtime.", {
      field: "deps.proxyService.executeTool",
    });
  }

  if (typeof deps.adminHandler !== "function") {
    throw new FastMcpRuntimeError("Admin route handler dependency is required for FastMCP runtime.", {
      field: "deps.adminHandler",
    });
  }

  if (typeof deps.portalLandingHandler !== "function") {
    throw new FastMcpRuntimeError("Portal landing handler dependency is required for FastMCP runtime.", {
      field: "deps.portalLandingHandler",
    });
  }

  if (typeof deps.portalHandler !== "function") {
    throw new FastMcpRuntimeError("Portal route handler dependency is required for FastMCP runtime.", {
      field: "deps.portalHandler",
    });
  }

  if (!deps.usageTracker || typeof deps.usageTracker.recordToolCall !== "function") {
    throw new FastMcpRuntimeError("UsageTracker dependency is required for FastMCP runtime.", {
      field: "deps.usageTracker.recordToolCall",
    });
  }

  if (
    !deps.sitesSearchService ||
    typeof deps.sitesSearchService.searchSites !== "function" ||
    typeof deps.sitesSearchService.getPageChunk !== "function"
  ) {
    throw new FastMcpRuntimeError("SitesSearchService dependency is required for FastMCP runtime.", {
      field: "deps.sitesSearchService",
    });
  }

  if (!deps.countryCache || typeof deps.countryCache.get !== "function") {
    throw new FastMcpRuntimeError("CountryCache dependency is required for FastMCP runtime.", {
      field: "deps.countryCache",
    });
  }

  if (!deps.db || typeof deps.db !== "object") {
    throw new FastMcpRuntimeError("Database dependency is required for FastMCP runtime.", {
      field: "deps.db",
    });
  }
  // END_BLOCK_VALIDATE_FASTMCP_RUNTIME_DEPENDENCIES_M_FASTMCP_RUNTIME_016
}

// START_CONTRACT: createToolErrorResult
//   PURPOSE: Build deterministic MCP-compatible tool error responses for proxy execution failures.
//   INPUTS: { toolName: RuntimeToolName - Tool name, error: unknown - Thrown execution failure }
//   OUTPUTS: { {isError: true; content: [{type: \"text\"; text: string}]} - MCP tool error result payload }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME, M-TOOL-PROXY]
// END_CONTRACT: createToolErrorResult
function createToolErrorResult(
  toolName: RuntimeToolName,
  error: unknown,
): { isError: true; content: Array<{ type: "text"; text: string }> } {
  // START_BLOCK_BUILD_DETERMINISTIC_TOOL_ERROR_RESULT_M_FASTMCP_RUNTIME_017
  if (error instanceof ProxyExecutionError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `${toolName} failed: ${error.code} - ${error.message}`,
        },
      ],
    };
  }

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `${toolName} failed: INTERNAL_RUNTIME_ERROR - Tool execution failed unexpectedly.`,
      },
    ],
  };
  // END_BLOCK_BUILD_DETERMINISTIC_TOOL_ERROR_RESULT_M_FASTMCP_RUNTIME_017
}

// START_CONTRACT: registerProxyTools
//   PURPOSE: Register exactly four proxy tools on FastMCP with schemas from M-TOOLS-CONTRACTS, proxy dispatch handlers, and fire-and-forget per-user usage tracking.
//   INPUTS: { fastMcpServer: FastMCP<RuntimeSessionAuth> - Runtime instance, deps: RegisterProxyToolsDependencies - Tool registration dependencies including usageTracker }
//   OUTPUTS: { void - Tools are registered on FastMCP instance }
//   SIDE_EFFECTS: [Mutates FastMCP tool registry, emits structured logs, fires usage tracking after successful execution]
//   INVARIANTS:
//     - Usage tracking failure MUST NEVER affect tool result
//     - recordToolCall is fire-and-forget (never throws, returns void)
//     - userId extracted from session JWT sub claim via extractUserIdFromSession
//   LINKS: [M-FASTMCP-RUNTIME, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-LOGGER, M-USAGE-TRACKER]
// END_CONTRACT: registerProxyTools
export function registerProxyTools(
  fastMcpServer: FastMCP<RuntimeSessionAuth>,
  deps: RegisterProxyToolsDependencies,
): void {
  // START_BLOCK_REGISTER_FIXED_PROXY_TOOL_SET_ON_FASTMCP_M_FASTMCP_RUNTIME_018
  for (const descriptor of RUNTIME_TOOL_DESCRIPTORS) {
    const toolName = descriptor.name;
    fastMcpServer.addTool({
      name: toolName,
      description: descriptor.description,
      parameters: descriptor.parameters,
      canAccess: canAccessAuthenticatedProxyTools,
      execute: async (args, context) => {
        try {
          const typedArgs = (args ?? {}) as Record<string, unknown>;
          const countryCode = typeof typedArgs.country_code === "string" ? typedArgs.country_code : "";
          const country = deps.countryCache.get(countryCode);
          const countryContext: CountryContext = {
            chatIds: country ? (country.settings.tg_chat_ids as string[] ?? []) : [],
          };
          const result = await deps.proxyService.executeTool(toolName, typedArgs, countryContext);
          deps.logger.info(
            "Executed proxied MCP tool through ToolProxyService.",
            "registerProxyTools",
            "REGISTER_FIXED_PROXY_TOOL_SET_ON_FASTMCP",
            { toolName, countryCode: countryCode || "global" },
          );

          // Fire-and-forget usage tracking after successful execution
          const userId = extractUserIdFromSession(context.session);
          if (userId !== null) {
            deps.usageTracker.recordToolCall(userId, toolName, countryCode || "global");
          } else {
            deps.logger.warn(
              "Could not extract user ID from session for usage tracking.",
              "registerProxyTools",
              "TRACK_TOOL_USAGE",
              { toolName },
            );
          }

          return result;
        } catch (error: unknown) {
          if (error instanceof ProxyExecutionError) {
            deps.logger.warn(
              "Proxy execution error returned deterministic MCP tool failure.",
              "registerProxyTools",
              "HANDLE_PROXY_TOOL_EXECUTION_FAILURE",
              { toolName, code: error.code },
            );
          } else {
            deps.logger.error(
              "Unexpected tool execution failure returned deterministic MCP tool failure.",
              "registerProxyTools",
              "HANDLE_PROXY_TOOL_EXECUTION_FAILURE",
              {
                toolName,
                cause: error instanceof Error ? error.message : String(error),
              },
            );
          }

          return createToolErrorResult(toolName, error);
        }
      },
    });
  }

  deps.logger.info(
    "Registered fixed FastMCP proxy tool surface.",
    "registerProxyTools",
    "REGISTER_FIXED_PROXY_TOOL_SET_ON_FASTMCP",
    {
      toolNames: RUNTIME_TOOL_DESCRIPTORS.map((descriptor) => descriptor.name),
      listChatsRegistered: false,
    },
  );
  // END_BLOCK_REGISTER_FIXED_PROXY_TOOL_SET_ON_FASTMCP_M_FASTMCP_RUNTIME_018
}

type RegisterLocalToolsDependencies = {
  logger: Logger;
  usageTracker: UsageTracker;
  sitesSearchService: SitesSearchService;
  countryCache: CountryCache;
  db: NodePgDatabase;
};

// START_CONTRACT: registerLocalTools
//   PURPOSE: Register local tools (get_site_sources, search_sites, get_page_chunk) on FastMCP with canAccess guard and fire-and-forget usage tracking.
//   INPUTS: { fastMcpServer: FastMCP<RuntimeSessionAuth> - Runtime instance, deps: RegisterLocalToolsDependencies - Logger, usage tracker, and sites search service }
//   OUTPUTS: { void - Local tools are registered on FastMCP instance }
//   SIDE_EFFECTS: [Mutates FastMCP tool registry, emits structured logs, fires usage tracking after successful execution]
//   INVARIANTS:
//     - get_site_sources returns frozen SITE_SOURCES_RESPONSE without upstream calls
//     - search_sites and get_page_chunk delegate to SitesSearchService
//     - Usage tracking failure MUST NEVER affect tool result
//   LINKS: [M-FASTMCP-RUNTIME, M-SITE-SOURCES, M-SITES-SEARCH, M-USAGE-TRACKER, M-LOGGER]
// END_CONTRACT: registerLocalTools
export function registerLocalTools(
  fastMcpServer: FastMCP<RuntimeSessionAuth>,
  deps: RegisterLocalToolsDependencies,
): void {
  // START_BLOCK_REGISTER_LOCAL_TOOLS_ON_FASTMCP_M_FASTMCP_RUNTIME_022
  fastMcpServer.addTool({
    name: "get_site_sources",
    description:
      "Returns a curated registry of trusted sources for travel research. Metadata-only: domains, tiers, language hints. No page content. Use country_code to specify destination.",
    parameters: GetSiteSourcesInputSchema,
    canAccess: canAccessAuthenticatedProxyTools,
    execute: async (args, context) => {
      const countryCode = typeof args?.country_code === "string" ? args.country_code : "jp";
      // Fire-and-forget usage tracking
      const userId = extractUserIdFromSession(context.session);
      if (userId !== null) {
        deps.usageTracker.recordToolCall(userId, "get_site_sources", countryCode);
      } else {
        deps.logger.warn(
          "Could not extract user ID from session for usage tracking.",
          "registerLocalTools",
          "TRACK_LOCAL_TOOL_USAGE",
          { toolName: "get_site_sources" },
        );
      }

      const result = await getSiteSources(deps.db, deps.logger, countryCode);

      deps.logger.info(
        "Executed local MCP tool get_site_sources.",
        "registerLocalTools",
        "REGISTER_LOCAL_TOOLS_ON_FASTMCP",
        { toolName: "get_site_sources", countryCode },
      );

      return JSON.stringify(result);
    },
  });

  fastMcpServer.addTool({
    name: "search_sites",
    description:
      "Search curated travel site pages by semantic similarity. Returns ranked snippets with source attribution and links. Use country_code to specify destination.",
    parameters: SearchSitesInputSchema,
    canAccess: canAccessAuthenticatedProxyTools,
    execute: async (args, context) => {
      const countryCode = typeof args?.country_code === "string" ? args.country_code : "";
      // Fire-and-forget usage tracking
      const userId = extractUserIdFromSession(context.session);
      if (userId !== null) {
        deps.usageTracker.recordToolCall(userId, "search_sites", countryCode || "global");
      } else {
        deps.logger.warn(
          "Could not extract user ID from session for usage tracking.",
          "registerLocalTools",
          "TRACK_LOCAL_TOOL_USAGE",
          { toolName: "search_sites" },
        );
      }

      const result = await deps.sitesSearchService.searchSites({
        query: args.query,
        top_k: args.top_k,
        source_ids: args.source_ids,
        country_code: countryCode || undefined,
      });

      deps.logger.info(
        "Executed local MCP tool search_sites.",
        "registerLocalTools",
        "REGISTER_LOCAL_TOOLS_ON_FASTMCP",
        { toolName: "search_sites", resultCount: result.results.length },
      );

      return JSON.stringify(result);
    },
  });

  fastMcpServer.addTool({
    name: "get_page_chunk",
    description:
      "Retrieve a bounded evidence excerpt from a curated site page chunk. Use chunk_id from search_sites results.",
    parameters: GetPageChunkInputSchema,
    canAccess: canAccessAuthenticatedProxyTools,
    execute: async (args, context) => {
      // Fire-and-forget usage tracking
      const userId = extractUserIdFromSession(context.session);
      if (userId !== null) {
        deps.usageTracker.recordToolCall(userId, "get_page_chunk", "global");
      } else {
        deps.logger.warn(
          "Could not extract user ID from session for usage tracking.",
          "registerLocalTools",
          "TRACK_LOCAL_TOOL_USAGE",
          { toolName: "get_page_chunk" },
        );
      }

      const result = await deps.sitesSearchService.getPageChunk({
        chunk_id: args.chunk_id,
        include_neighbors: args.include_neighbors,
      });

      deps.logger.info(
        "Executed local MCP tool get_page_chunk.",
        "registerLocalTools",
        "REGISTER_LOCAL_TOOLS_ON_FASTMCP",
        { toolName: "get_page_chunk", chunkId: args.chunk_id },
      );

      return JSON.stringify(result);
    },
  });

  deps.logger.info(
    "Registered local tools on FastMCP.",
    "registerLocalTools",
    "REGISTER_LOCAL_TOOLS_ON_FASTMCP",
    { toolNames: ["get_site_sources", "search_sites", "get_page_chunk"] },
  );
  // END_BLOCK_REGISTER_LOCAL_TOOLS_ON_FASTMCP_M_FASTMCP_RUNTIME_022
}

// START_CONTRACT: mountAdminRoutes
//   PURPOSE: Mount /admin and /admin/* route handlers on FastMCP underlying Hono app via delegated adminHandler.
//   INPUTS: { fastMcpServer: FastMCP<RuntimeSessionAuth> - Runtime instance, deps: MountAdminRoutesDependencies - Admin route dependencies }
//   OUTPUTS: { void - Admin routes are mounted on Hono app }
//   SIDE_EFFECTS: [Mutates FastMCP Hono app route table and emits structured logs]
//   LINKS: [M-FASTMCP-RUNTIME, M-ADMIN-UI, M-LOGGER]
// END_CONTRACT: mountAdminRoutes
export function mountAdminRoutes(
  fastMcpServer: FastMCP<RuntimeSessionAuth>,
  deps: MountAdminRoutesDependencies,
): void {
  // START_BLOCK_MOUNT_ADMIN_ROUTES_VIA_FASTMCP_GET_APP_M_FASTMCP_RUNTIME_019
  const app = fastMcpServer.getApp();

  const dispatchAdminRequest = async (request: Request): Promise<Response> => {
    try {
      return await deps.adminHandler(request);
    } catch (error: unknown) {
      deps.logger.error(
        "Admin handler failed at FastMCP route boundary.",
        "mountAdminRoutes",
        "DISPATCH_ADMIN_REQUEST_FAILURE",
        {
          cause: error instanceof Error ? error.message : String(error),
          method: request.method,
          pathname: new URL(request.url).pathname,
        },
      );

      return new Response(
        JSON.stringify({
          error: {
            code: "ADMIN_ROUTE_ERROR",
            message: "Admin route execution failed.",
          },
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        },
      );
    }
  };

  app.all("/admin", async (context) => {
    return dispatchAdminRequest(context.req.raw);
  });

  app.all("/admin/*", async (context) => {
    return dispatchAdminRequest(context.req.raw);
  });

  deps.logger.info(
    "Mounted admin routes on FastMCP Hono app.",
    "mountAdminRoutes",
    "MOUNT_ADMIN_ROUTES_VIA_FASTMCP_GET_APP",
    {
      routes: ["/admin", "/admin/*"],
    },
  );
  // END_BLOCK_MOUNT_ADMIN_ROUTES_VIA_FASTMCP_GET_APP_M_FASTMCP_RUNTIME_019
}

// START_CONTRACT: mountPortalRoutes
//   PURPOSE: Mount / landing and /portal/* route handlers on FastMCP underlying Hono app via delegated portal handlers.
//   INPUTS: { fastMcpServer: FastMCP<RuntimeSessionAuth> - Runtime instance, deps: MountPortalRoutesDependencies - Portal route dependencies }
//   OUTPUTS: { void - Portal routes are mounted on Hono app }
//   SIDE_EFFECTS: [Mutates FastMCP Hono app route table and emits structured logs]
//   LINKS: [M-FASTMCP-RUNTIME, M-PORTAL-UI, M-LOGGER]
// END_CONTRACT: mountPortalRoutes
export function mountPortalRoutes(
  fastMcpServer: FastMCP<RuntimeSessionAuth>,
  deps: MountPortalRoutesDependencies,
): void {
  // START_BLOCK_MOUNT_PORTAL_ROUTES_VIA_FASTMCP_GET_APP_M_FASTMCP_RUNTIME_021
  const app = fastMcpServer.getApp();

  const dispatchPortalRequest = (handler: (request: Request) => Promise<Response>) => {
    return async (request: Request): Promise<Response> => {
      try {
        return await handler(request);
      } catch (error: unknown) {
        deps.logger.error(
          "Portal handler failed at FastMCP route boundary.",
          "mountPortalRoutes",
          "DISPATCH_PORTAL_REQUEST_FAILURE",
          {
            cause: error instanceof Error ? error.message : String(error),
            method: request.method,
            pathname: new URL(request.url).pathname,
          },
        );

        return new Response(
          JSON.stringify({
            error: {
              code: "PORTAL_ROUTE_ERROR",
              message: "Portal route execution failed.",
            },
          }),
          {
            status: 500,
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          },
        );
      }
    };
  };

  const landingDispatcher = dispatchPortalRequest(deps.portalLandingHandler);
  const portalDispatcher = dispatchPortalRequest(deps.portalHandler);

  app.all("/", async (context) => {
    return landingDispatcher(context.req.raw);
  });

  app.all("/portal", async (context) => {
    return portalDispatcher(context.req.raw);
  });

  app.all("/portal/*", async (context) => {
    return portalDispatcher(context.req.raw);
  });

  deps.logger.info(
    "Mounted portal routes on FastMCP Hono app.",
    "mountPortalRoutes",
    "MOUNT_PORTAL_ROUTES_VIA_FASTMCP_GET_APP",
    {
      routes: ["/", "/portal", "/portal/*"],
    },
  );
  // END_BLOCK_MOUNT_PORTAL_ROUTES_VIA_FASTMCP_GET_APP_M_FASTMCP_RUNTIME_021
}

// START_CONTRACT: createFastMcpRuntime
//   PURPOSE: Build a fully configured FastMCP runtime with OAuthProxy auth, oauth metadata, health endpoint, proxy tools, oauth diagnostics routes, and admin routes.
//   INPUTS: { deps: FastMcpRuntimeDependencies - Runtime dependencies }
//   OUTPUTS: { FastMCP<RuntimeSessionAuth> - Configured FastMCP runtime instance }
//   SIDE_EFFECTS: [Registers tool handlers/routes on runtime and emits structured logs]
//   LINKS: [M-FASTMCP-RUNTIME, M-AUTH-PROXY, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-ADMIN-UI, M-LOGGER]
// END_CONTRACT: createFastMcpRuntime
export function createFastMcpRuntime(
  deps: FastMcpRuntimeDependencies,
): FastMCP<RuntimeSessionAuth> {
  // START_BLOCK_BUILD_CONFIGURED_FASTMCP_RUNTIME_INSTANCE_M_FASTMCP_RUNTIME_020
  assertRuntimeDependencies(deps);

  const authLogger = deps.logger.child({ component: "oauthProxyAuth" });
  const runtimeLogger = deps.logger.child({ component: "fastMcpRuntime" });

  try {
    const oauth = buildOauthConfig(deps.config, deps.oauthProxyContext);

    const fastMcpServer = new FastMCP<RuntimeSessionAuth>({
      name: FASTMCP_SERVER_NAME,
      version: FASTMCP_SERVER_VERSION,
      authenticate: async (request) => {
        return authenticateOauthProxyRequest(request, deps.oauthProxyContext, authLogger);
      },
      oauth,
      health: {
        enabled: true,
        path: FASTMCP_HEALTH_PATH,
        message: "ok",
        status: 200,
      },
    });

    mountOauthDiagnosticsNotFoundRoutes(fastMcpServer, {
      logger: runtimeLogger.child({ component: "oauthDiagnosticsRoutes" }),
    });

    registerProxyTools(fastMcpServer, {
      logger: runtimeLogger.child({ component: "proxyTools" }),
      proxyService: deps.proxyService,
      usageTracker: deps.usageTracker,
      countryCache: deps.countryCache,
    });

    registerLocalTools(fastMcpServer, {
      logger: runtimeLogger.child({ component: "localTools" }),
      usageTracker: deps.usageTracker,
      sitesSearchService: deps.sitesSearchService,
      countryCache: deps.countryCache,
      db: deps.db,
    });

    mountAdminRoutes(fastMcpServer, {
      logger: runtimeLogger.child({ component: "adminRoutes" }),
      adminHandler: deps.adminHandler,
    });

    mountPortalRoutes(fastMcpServer, {
      logger: runtimeLogger.child({ component: "portalRoutes" }),
      portalLandingHandler: deps.portalLandingHandler,
      portalHandler: deps.portalHandler,
    });

    runtimeLogger.info(
      "Created FastMCP runtime with OAuthProxy auth, oauth metadata, health endpoint, tools, oauth diagnostics routes, admin routes, and portal routes.",
      "createFastMcpRuntime",
      "BUILD_CONFIGURED_FASTMCP_RUNTIME_INSTANCE",
      {
        name: FASTMCP_SERVER_NAME,
        version: FASTMCP_SERVER_VERSION,
        healthPath: FASTMCP_HEALTH_PATH,
      },
    );

    return fastMcpServer;
  } catch (error: unknown) {
    const typedError = toFastMcpRuntimeError(
      error,
      "Failed to create FastMCP runtime.",
      "createFastMcpRuntime",
    );

    runtimeLogger.error(
      "FastMCP runtime creation failed.",
      "createFastMcpRuntime",
      "BUILD_CONFIGURED_FASTMCP_RUNTIME_INSTANCE",
      {
        code: typedError.code,
        details: typedError.details ?? null,
      },
    );

    throw typedError;
  }
  // END_BLOCK_BUILD_CONFIGURED_FASTMCP_RUNTIME_INSTANCE_M_FASTMCP_RUNTIME_020
}
