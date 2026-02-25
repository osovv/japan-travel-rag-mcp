// FILE: src/admin/api-key-repository.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Persist and query API key lifecycle records used for MCP Bearer authentication.
//   SCOPE: Ensure API key table exists, create one-time API keys, list key metadata, revoke keys, and resolve presented keys with expiry/revocation checks.
//   DEPENDS: M-DB, M-LOGGER
//   LINKS: M-API-KEY-REPOSITORY, M-DB, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ApiKeyStoreError - Typed repository failure with API_KEY_STORE_ERROR code.
//   ApiKeyRecord - Public API key metadata shape for admin and auth layers.
//   ApiKeyList - API key list payload for admin UI rendering.
//   CreateApiKeyResult - One-time API key creation response with raw key and stored metadata.
//   ApiKeyRepository - Repository interface for create/list/revoke/resolve lifecycle operations.
//   createApiKeyRepository - Build API key repository backed by Bun SQL and structured logs.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-API-KEY-REPOSITORY.
// END_CHANGE_SUMMARY

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DbClient } from "../db/index";
import type { Logger } from "../logger/index";

const API_KEYS_TABLE_NAME = "api_keys";
const MAX_LABEL_LENGTH = 128;
const CREATE_API_KEY_MAX_ATTEMPTS = 3;
const API_KEY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RAW_API_KEY_PATTERN = /^(?<prefix>jp_[a-f0-9]{12})_(?<secret>[a-f0-9]{64})$/;

type ApiKeyStoreErrorDetails = {
  field?: string;
  id?: string;
  keyPrefix?: string;
  cause?: string;
  code?: string;
};

type ApiKeyRow = {
  id: string;
  key_prefix: string;
  label: string;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
};

type ApiKeyResolveRow = ApiKeyRow & {
  key_hash: string;
};

type ParsedRawApiKey = {
  keyPrefix: string;
  normalizedRawApiKey: string;
};

type GeneratedApiKey = {
  id: string;
  keyPrefix: string;
  rawApiKey: string;
  keyHash: string;
};

export class ApiKeyStoreError extends Error {
  public readonly code = "API_KEY_STORE_ERROR" as const;
  public readonly details?: ApiKeyStoreErrorDetails;

  public constructor(message: string, details?: ApiKeyStoreErrorDetails) {
    super(message);
    this.name = "ApiKeyStoreError";
    this.details = details;
  }
}

export type ApiKeyRecord = {
  id: string;
  keyPrefix: string;
  label: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type ApiKeyList = ApiKeyRecord[];

export type CreateApiKeyResult = {
  record: ApiKeyRecord;
  rawApiKey: string;
};

export type ApiKeyRepository = {
  createApiKey(label: string, expiresAt: Date | null): Promise<CreateApiKeyResult>;
  listApiKeys(): Promise<ApiKeyList>;
  revokeApiKey(id: string): Promise<ApiKeyRecord | null>;
  resolveApiKey(rawApiKey: string): Promise<ApiKeyRecord | null>;
};

// START_CONTRACT: redactSensitiveDiagnostics
//   PURPOSE: Remove potentially sensitive key material and long digests from diagnostic text.
//   INPUTS: { text: string - Raw diagnostic message from runtime errors }
//   OUTPUTS: { string - Redacted diagnostic string safe for logs and typed errors }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-API-KEY-REPOSITORY]
// END_CONTRACT: redactSensitiveDiagnostics
function redactSensitiveDiagnostics(text: string): string {
  // START_BLOCK_REDACT_SENSITIVE_DIAGNOSTIC_TEXT_M_API_KEY_REPOSITORY_001
  const normalized = text.trim();
  if (!normalized) {
    return "unknown";
  }

  return normalized
    .replace(/jp_[a-f0-9]{12}_[a-f0-9]{64}/g, "<redacted-api-key>")
    .replace(/\b[a-f0-9]{64}\b/gi, "<redacted-digest>");
  // END_BLOCK_REDACT_SENSITIVE_DIAGNOSTIC_TEXT_M_API_KEY_REPOSITORY_001
}

// START_CONTRACT: toApiKeyStoreError
//   PURPOSE: Normalize unknown failures into ApiKeyStoreError with sanitized diagnostics.
//   INPUTS: { error: unknown - Caught runtime failure, message: string - Stable repository failure message, details: ApiKeyStoreErrorDetails | undefined - Optional context metadata }
//   OUTPUTS: { ApiKeyStoreError - Typed repository error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-API-KEY-REPOSITORY]
// END_CONTRACT: toApiKeyStoreError
function toApiKeyStoreError(
  error: unknown,
  message: string,
  details?: ApiKeyStoreErrorDetails,
): ApiKeyStoreError {
  // START_BLOCK_NORMALIZE_UNKNOWN_REPOSITORY_ERRORS_M_API_KEY_REPOSITORY_002
  if (error instanceof ApiKeyStoreError) {
    return error;
  }

  const diagnostic = error instanceof Error ? error.message : String(error);
  return new ApiKeyStoreError(message, {
    ...details,
    cause: redactSensitiveDiagnostics(diagnostic),
  });
  // END_BLOCK_NORMALIZE_UNKNOWN_REPOSITORY_ERRORS_M_API_KEY_REPOSITORY_002
}

// START_CONTRACT: parseDateField
//   PURPOSE: Convert database date-like values into validated Date objects.
//   INPUTS: { value: Date|string|null - Raw column value, field: string - Field name for diagnostics, nullable: boolean - Whether null is allowed }
//   OUTPUTS: { Date|null - Parsed Date or null for nullable fields }
//   SIDE_EFFECTS: [Throws ApiKeyStoreError on invalid date values]
//   LINKS: [M-API-KEY-REPOSITORY]
// END_CONTRACT: parseDateField
function parseDateField(value: Date | string | null, field: string, nullable: boolean): Date | null {
  // START_BLOCK_PARSE_DATABASE_DATE_VALUES_M_API_KEY_REPOSITORY_003
  if (value === null) {
    if (nullable) {
      return null;
    }
    throw new ApiKeyStoreError("Database row missing required date field.", { field });
  }

  const asDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(asDate.getTime())) {
    throw new ApiKeyStoreError("Database row contains invalid date field.", { field });
  }
  return asDate;
  // END_BLOCK_PARSE_DATABASE_DATE_VALUES_M_API_KEY_REPOSITORY_003
}

// START_CONTRACT: mapApiKeyRow
//   PURPOSE: Map SQL row shape to public ApiKeyRecord.
//   INPUTS: { row: ApiKeyRow - Database row with snake_case fields }
//   OUTPUTS: { ApiKeyRecord - Public API key metadata object }
//   SIDE_EFFECTS: [Throws ApiKeyStoreError on invalid persisted row shape]
//   LINKS: [M-API-KEY-REPOSITORY]
// END_CONTRACT: mapApiKeyRow
function mapApiKeyRow(row: ApiKeyRow): ApiKeyRecord {
  // START_BLOCK_MAP_DATABASE_ROW_TO_PUBLIC_RECORD_M_API_KEY_REPOSITORY_004
  if (!row.id || !row.key_prefix || !row.label) {
    throw new ApiKeyStoreError("Database row missing required API key fields.");
  }

  return {
    id: row.id,
    keyPrefix: row.key_prefix,
    label: row.label,
    expiresAt: parseDateField(row.expires_at, "expires_at", true),
    revokedAt: parseDateField(row.revoked_at, "revoked_at", true),
    createdAt: parseDateField(row.created_at, "created_at", false) as Date,
  };
  // END_BLOCK_MAP_DATABASE_ROW_TO_PUBLIC_RECORD_M_API_KEY_REPOSITORY_004
}

// START_CONTRACT: normalizeLabel
//   PURPOSE: Validate and normalize API key labels for persistence.
//   INPUTS: { label: string - User-provided label }
//   OUTPUTS: { string - Trimmed valid label string }
//   SIDE_EFFECTS: [Throws ApiKeyStoreError for empty or oversized labels]
//   LINKS: [M-API-KEY-REPOSITORY]
// END_CONTRACT: normalizeLabel
function normalizeLabel(label: string): string {
  // START_BLOCK_VALIDATE_AND_NORMALIZE_LABEL_INPUT_M_API_KEY_REPOSITORY_005
  const normalized = label.trim();
  if (!normalized) {
    throw new ApiKeyStoreError("API key label must be non-empty.", { field: "label" });
  }
  if (normalized.length > MAX_LABEL_LENGTH) {
    throw new ApiKeyStoreError("API key label exceeds max length.", { field: "label" });
  }
  return normalized;
  // END_BLOCK_VALIDATE_AND_NORMALIZE_LABEL_INPUT_M_API_KEY_REPOSITORY_005
}

// START_CONTRACT: normalizeExpiresAt
//   PURPOSE: Validate optional API key expiry date input.
//   INPUTS: { expiresAt: Date|null - Requested key expiry date }
//   OUTPUTS: { Date|null - Normalized expiry date or null }
//   SIDE_EFFECTS: [Throws ApiKeyStoreError for invalid Date inputs]
//   LINKS: [M-API-KEY-REPOSITORY]
// END_CONTRACT: normalizeExpiresAt
function normalizeExpiresAt(expiresAt: Date | null): Date | null {
  // START_BLOCK_VALIDATE_AND_NORMALIZE_EXPIRY_INPUT_M_API_KEY_REPOSITORY_006
  if (expiresAt === null) {
    return null;
  }
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw new ApiKeyStoreError("API key expiry must be a valid Date or null.", {
      field: "expiresAt",
    });
  }
  return new Date(expiresAt.getTime());
  // END_BLOCK_VALIDATE_AND_NORMALIZE_EXPIRY_INPUT_M_API_KEY_REPOSITORY_006
}

// START_CONTRACT: normalizeApiKeyId
//   PURPOSE: Validate API key id input before persistence operations.
//   INPUTS: { id: string - Requested API key id }
//   OUTPUTS: { string - Trimmed, validated id }
//   SIDE_EFFECTS: [Throws ApiKeyStoreError for malformed ids]
//   LINKS: [M-API-KEY-REPOSITORY]
// END_CONTRACT: normalizeApiKeyId
function normalizeApiKeyId(id: string): string {
  // START_BLOCK_VALIDATE_API_KEY_ID_INPUT_M_API_KEY_REPOSITORY_007
  const normalized = id.trim();
  if (!API_KEY_ID_PATTERN.test(normalized)) {
    throw new ApiKeyStoreError("API key id format is invalid.", { field: "id" });
  }
  return normalized;
  // END_BLOCK_VALIDATE_API_KEY_ID_INPUT_M_API_KEY_REPOSITORY_007
}

// START_CONTRACT: parseRawApiKey
//   PURPOSE: Validate and parse presented API key value to extract non-sensitive prefix.
//   INPUTS: { rawApiKey: string - Presented Bearer token value }
//   OUTPUTS: { ParsedRawApiKey|null - Parsed token metadata or null when format is invalid }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-API-KEY-REPOSITORY]
// END_CONTRACT: parseRawApiKey
function parseRawApiKey(rawApiKey: string): ParsedRawApiKey | null {
  // START_BLOCK_VALIDATE_AND_PARSE_RAW_API_KEY_INPUT_M_API_KEY_REPOSITORY_008
  const normalizedRawApiKey = rawApiKey.trim();
  if (!normalizedRawApiKey) {
    return null;
  }

  const match = RAW_API_KEY_PATTERN.exec(normalizedRawApiKey);
  if (!match || !match.groups?.prefix) {
    return null;
  }

  return {
    keyPrefix: match.groups.prefix,
    normalizedRawApiKey,
  };
  // END_BLOCK_VALIDATE_AND_PARSE_RAW_API_KEY_INPUT_M_API_KEY_REPOSITORY_008
}

// START_CONTRACT: hashApiKey
//   PURPOSE: Produce SHA-256 digest for API key matching without storing raw key material.
//   INPUTS: { rawApiKey: string - Raw API key token value }
//   OUTPUTS: { string - Hex digest of raw key }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-API-KEY-REPOSITORY]
// END_CONTRACT: hashApiKey
function hashApiKey(rawApiKey: string): string {
  // START_BLOCK_HASH_API_KEY_MATERIAL_M_API_KEY_REPOSITORY_009
  return createHash("sha256").update(rawApiKey).digest("hex");
  // END_BLOCK_HASH_API_KEY_MATERIAL_M_API_KEY_REPOSITORY_009
}

// START_CONTRACT: generateApiKeyMaterial
//   PURPOSE: Generate secure API key material and derived persistence fields.
//   INPUTS: {}
//   OUTPUTS: { GeneratedApiKey - Raw token, prefix, id, and digest ready for insertion }
//   SIDE_EFFECTS: [Consumes cryptographically secure random bytes]
//   LINKS: [M-API-KEY-REPOSITORY]
// END_CONTRACT: generateApiKeyMaterial
function generateApiKeyMaterial(): GeneratedApiKey {
  // START_BLOCK_GENERATE_SECURE_API_KEY_MATERIAL_M_API_KEY_REPOSITORY_010
  const keyPrefixToken = randomBytes(6).toString("hex");
  const secretToken = randomBytes(32).toString("hex");
  const keyPrefix = `jp_${keyPrefixToken}`;
  const rawApiKey = `${keyPrefix}_${secretToken}`;

  return {
    id: randomUUID(),
    keyPrefix,
    rawApiKey,
    keyHash: hashApiKey(rawApiKey),
  };
  // END_BLOCK_GENERATE_SECURE_API_KEY_MATERIAL_M_API_KEY_REPOSITORY_010
}

// START_CONTRACT: isUniqueConstraintViolation
//   PURPOSE: Detect database uniqueness collisions for retryable key creation failures.
//   INPUTS: { error: unknown - Caught database error }
//   OUTPUTS: { boolean - True when error indicates unique violation }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-API-KEY-REPOSITORY]
// END_CONTRACT: isUniqueConstraintViolation
function isUniqueConstraintViolation(error: unknown): boolean {
  // START_BLOCK_DETECT_UNIQUE_CONSTRAINT_ERRORS_M_API_KEY_REPOSITORY_011
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "23505";
  // END_BLOCK_DETECT_UNIQUE_CONSTRAINT_ERRORS_M_API_KEY_REPOSITORY_011
}

// START_CONTRACT: ensureApiKeysTable
//   PURPOSE: Create API key persistence table and supporting indexes if absent.
//   INPUTS: { db: DbClient - SQL client wrapper, logger: Logger - Repository logger }
//   OUTPUTS: { Promise<void> - Resolves when schema checks complete }
//   SIDE_EFFECTS: [Executes DDL statements in PostgreSQL and writes logs]
//   LINKS: [M-API-KEY-REPOSITORY, M-DB, M-LOGGER]
// END_CONTRACT: ensureApiKeysTable
async function ensureApiKeysTable(db: DbClient, logger: Logger): Promise<void> {
  // START_BLOCK_CREATE_API_KEYS_TABLE_IF_MISSING_M_API_KEY_REPOSITORY_012
  await db.sql`
    create table if not exists api_keys (
      id text primary key,
      key_hash text not null unique,
      key_prefix text not null,
      label text not null,
      expires_at timestamptz null,
      revoked_at timestamptz null,
      created_at timestamptz not null default now()
    )
  `;
  // END_BLOCK_CREATE_API_KEYS_TABLE_IF_MISSING_M_API_KEY_REPOSITORY_012

  // START_BLOCK_CREATE_API_KEYS_INDEXES_IF_MISSING_M_API_KEY_REPOSITORY_013
  await db.sql`create index if not exists api_keys_key_prefix_idx on api_keys (key_prefix)`;
  await db.sql`create index if not exists api_keys_created_at_idx on api_keys (created_at desc)`;
  logger.info(
    "Ensured API key repository schema exists.",
    "createApiKeyRepository",
    "CREATE_API_KEYS_INDEXES_IF_MISSING",
    { table: API_KEYS_TABLE_NAME },
  );
  // END_BLOCK_CREATE_API_KEYS_INDEXES_IF_MISSING_M_API_KEY_REPOSITORY_013
}

// START_CONTRACT: createApiKeyRepository
//   PURPOSE: Build API key repository with table bootstrap and lifecycle operations.
//   INPUTS: { db: DbClient - SQL client dependency, logger: Logger - Base logger dependency }
//   OUTPUTS: { ApiKeyRepository - API key lifecycle repository instance }
//   SIDE_EFFECTS: [Starts async table bootstrap, issues SQL DML/DDL in method calls, emits structured logs]
//   LINKS: [M-API-KEY-REPOSITORY, M-DB, M-LOGGER]
// END_CONTRACT: createApiKeyRepository
export function createApiKeyRepository(db: DbClient, logger: Logger): ApiKeyRepository {
  // START_BLOCK_BOOTSTRAP_REPOSITORY_STATE_AND_SCHEMA_M_API_KEY_REPOSITORY_014
  const repositoryLogger = logger.child({ module: "ApiKeyRepository" });
  const initializeTablePromise = ensureApiKeysTable(db, repositoryLogger);

  const awaitInitialized = async (functionName: string): Promise<void> => {
    try {
      await initializeTablePromise;
    } catch (error: unknown) {
      const storeError = toApiKeyStoreError(error, "Failed to initialize API key repository schema.", {
        field: functionName,
      });
      repositoryLogger.error(
        "API key repository initialization failed.",
        functionName,
        "BOOTSTRAP_REPOSITORY_STATE_AND_SCHEMA",
        {
          code: storeError.code,
          cause: storeError.details?.cause ?? storeError.message,
        },
      );
      throw storeError;
    }
  };
  // END_BLOCK_BOOTSTRAP_REPOSITORY_STATE_AND_SCHEMA_M_API_KEY_REPOSITORY_014

  // START_BLOCK_IMPLEMENT_CREATE_LIST_REVOKE_RESOLVE_OPERATIONS_M_API_KEY_REPOSITORY_015
  return {
    // START_CONTRACT: createApiKey
    //   PURPOSE: Generate and persist a new API key record while returning one-time raw key material.
    //   INPUTS: { label: string - Human-readable API key label, expiresAt: Date|null - Optional expiry timestamp }
    //   OUTPUTS: { Promise<CreateApiKeyResult> - Created API key metadata and one-time raw key token }
    //   SIDE_EFFECTS: [Inserts API key row and emits lifecycle logs]
    //   LINKS: [M-API-KEY-REPOSITORY, M-DB, M-LOGGER]
    // END_CONTRACT: createApiKey
    async createApiKey(label: string, expiresAt: Date | null): Promise<CreateApiKeyResult> {
      await awaitInitialized("createApiKey");

      const normalizedLabel = normalizeLabel(label);
      const normalizedExpiresAt = normalizeExpiresAt(expiresAt);

      for (let attempt = 1; attempt <= CREATE_API_KEY_MAX_ATTEMPTS; attempt += 1) {
        const generated = generateApiKeyMaterial();

        try {
          const rows = await db.sql<ApiKeyRow[]>`
            insert into api_keys (id, key_hash, key_prefix, label, expires_at, revoked_at, created_at)
            values (
              ${generated.id},
              ${generated.keyHash},
              ${generated.keyPrefix},
              ${normalizedLabel},
              ${normalizedExpiresAt},
              null,
              now()
            )
            returning id, key_prefix, label, expires_at, revoked_at, created_at
          `;

          const inserted = rows[0];
          if (!inserted) {
            throw new ApiKeyStoreError("Database did not return created API key row.");
          }

          const record = mapApiKeyRow(inserted);
          repositoryLogger.info(
            "Created API key record.",
            "createApiKey",
            "IMPLEMENT_CREATE_LIST_REVOKE_RESOLVE_OPERATIONS",
            {
              id: record.id,
              keyPrefix: record.keyPrefix,
            },
          );

          return {
            record,
            rawApiKey: generated.rawApiKey,
          };
        } catch (error: unknown) {
          if (isUniqueConstraintViolation(error) && attempt < CREATE_API_KEY_MAX_ATTEMPTS) {
            repositoryLogger.warn(
              "Retried API key creation after unique collision.",
              "createApiKey",
              "IMPLEMENT_CREATE_LIST_REVOKE_RESOLVE_OPERATIONS",
              {
                attempt,
                keyPrefix: generated.keyPrefix,
              },
            );
            continue;
          }

          const storeError = toApiKeyStoreError(error, "Failed to create API key record.", {
            field: "createApiKey",
          });
          repositoryLogger.error(
            "API key creation failed.",
            "createApiKey",
            "IMPLEMENT_CREATE_LIST_REVOKE_RESOLVE_OPERATIONS",
            {
              code: storeError.code,
              cause: storeError.details?.cause ?? storeError.message,
            },
          );
          throw storeError;
        }
      }

      throw new ApiKeyStoreError("Failed to create API key after retries.", { field: "createApiKey" });
    },

    // START_CONTRACT: listApiKeys
    //   PURPOSE: List persisted API key metadata for admin management views.
    //   INPUTS: {}
    //   OUTPUTS: { Promise<ApiKeyList> - Ordered list of API key records including revoked entries }
    //   SIDE_EFFECTS: [Executes select query]
    //   LINKS: [M-API-KEY-REPOSITORY, M-DB]
    // END_CONTRACT: listApiKeys
    async listApiKeys(): Promise<ApiKeyList> {
      await awaitInitialized("listApiKeys");

      try {
        const rows = await db.sql<ApiKeyRow[]>`
          select id, key_prefix, label, expires_at, revoked_at, created_at
          from api_keys
          order by created_at desc
        `;

        return rows.map((row) => mapApiKeyRow(row));
      } catch (error: unknown) {
        const storeError = toApiKeyStoreError(error, "Failed to list API keys.", {
          field: "listApiKeys",
        });
        repositoryLogger.error(
          "API key list query failed.",
          "listApiKeys",
          "IMPLEMENT_CREATE_LIST_REVOKE_RESOLVE_OPERATIONS",
          {
            code: storeError.code,
            cause: storeError.details?.cause ?? storeError.message,
          },
        );
        throw storeError;
      }
    },

    // START_CONTRACT: revokeApiKey
    //   PURPOSE: Mark an API key as revoked and return the updated metadata record.
    //   INPUTS: { id: string - API key identifier }
    //   OUTPUTS: { Promise<ApiKeyRecord|null> - Revoked key record or null when id does not exist }
    //   SIDE_EFFECTS: [Executes update query and writes revocation logs]
    //   LINKS: [M-API-KEY-REPOSITORY, M-DB, M-LOGGER]
    // END_CONTRACT: revokeApiKey
    async revokeApiKey(id: string): Promise<ApiKeyRecord | null> {
      await awaitInitialized("revokeApiKey");
      const normalizedId = normalizeApiKeyId(id);

      try {
        const rows = await db.sql<ApiKeyRow[]>`
          update api_keys
          set revoked_at = coalesce(revoked_at, now())
          where id = ${normalizedId}
          returning id, key_prefix, label, expires_at, revoked_at, created_at
        `;

        const revoked = rows[0];
        if (!revoked) {
          return null;
        }

        const record = mapApiKeyRow(revoked);
        repositoryLogger.info(
          "Revoked API key record.",
          "revokeApiKey",
          "IMPLEMENT_CREATE_LIST_REVOKE_RESOLVE_OPERATIONS",
          {
            id: record.id,
            keyPrefix: record.keyPrefix,
          },
        );
        return record;
      } catch (error: unknown) {
        const storeError = toApiKeyStoreError(error, "Failed to revoke API key.", {
          field: "revokeApiKey",
          id: normalizedId,
        });
        repositoryLogger.error(
          "API key revoke operation failed.",
          "revokeApiKey",
          "IMPLEMENT_CREATE_LIST_REVOKE_RESOLVE_OPERATIONS",
          {
            code: storeError.code,
            id: normalizedId,
            cause: storeError.details?.cause ?? storeError.message,
          },
        );
        throw storeError;
      }
    },

    // START_CONTRACT: resolveApiKey
    //   PURPOSE: Resolve presented raw API key token into active persisted metadata record.
    //   INPUTS: { rawApiKey: string - Presented Bearer token value }
    //   OUTPUTS: { Promise<ApiKeyRecord|null> - Active key record or null when missing/expired/revoked/invalid }
    //   SIDE_EFFECTS: [Executes hash lookup query]
    //   LINKS: [M-API-KEY-REPOSITORY, M-DB]
    // END_CONTRACT: resolveApiKey
    async resolveApiKey(rawApiKey: string): Promise<ApiKeyRecord | null> {
      const parsed = parseRawApiKey(rawApiKey);
      if (!parsed) {
        return null;
      }

      await awaitInitialized("resolveApiKey");
      const presentedHash = hashApiKey(parsed.normalizedRawApiKey);

      try {
        const rows = await db.sql<ApiKeyResolveRow[]>`
          select id, key_hash, key_prefix, label, expires_at, revoked_at, created_at
          from api_keys
          where key_hash = ${presentedHash}
          limit 1
        `;

        const matched = rows[0];
        if (!matched) {
          return null;
        }

        if (matched.key_prefix !== parsed.keyPrefix || matched.key_hash !== presentedHash) {
          return null;
        }

        const record = mapApiKeyRow(matched);
        if (record.revokedAt !== null) {
          return null;
        }

        if (record.expiresAt !== null && record.expiresAt.getTime() <= Date.now()) {
          return null;
        }

        return record;
      } catch (error: unknown) {
        const storeError = toApiKeyStoreError(error, "Failed to resolve API key.", {
          field: "resolveApiKey",
          keyPrefix: parsed.keyPrefix,
        });
        repositoryLogger.error(
          "API key resolve operation failed.",
          "resolveApiKey",
          "IMPLEMENT_CREATE_LIST_REVOKE_RESOLVE_OPERATIONS",
          {
            code: storeError.code,
            keyPrefix: parsed.keyPrefix,
            cause: storeError.details?.cause ?? storeError.message,
          },
        );
        throw storeError;
      }
    },
  };
  // END_BLOCK_IMPLEMENT_CREATE_LIST_REVOKE_RESOLVE_OPERATIONS_M_API_KEY_REPOSITORY_015
}
