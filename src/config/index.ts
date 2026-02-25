// FILE: src/config/index.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Load and validate runtime configuration for MCP transport and tg-chat-rag upstream connectivity.
//   SCOPE: Parse and validate runtime env values for server port and tg-chat-rag upstream settings.
//   DEPENDS: none
//   LINKS: M-CONFIG
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AppConfig - Typed runtime configuration for MCP and tg-chat-rag connectivity.
//   ConfigValidationError - Typed validation error carrying CONFIG_VALIDATION_ERROR code.
//   loadConfig - Validate process environment and return AppConfig.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Implemented M-CONFIG env parsing, validation, and typed exports.
// END_CHANGE_SUMMARY

export type AppConfig = {
  port: number;
  tgChatRag: {
    baseUrl: string;
    bearerToken: string;
    chatIds: string[];
    timeoutMs: number;
  };
};

export class ConfigValidationError extends Error {
  public readonly code = "CONFIG_VALIDATION_ERROR" as const;
  public readonly details: string[];

  public constructor(details: string[]) {
    super(`Configuration validation failed: ${details.join("; ")}`);
    this.name = "ConfigValidationError";
    this.details = details;
  }
}

// START_CONTRACT: loadConfig
//   PURPOSE: Validate runtime environment values and return typed AppConfig.
//   INPUTS: { env: NodeJS.ProcessEnv | undefined - Source env map, defaults to process.env }
//   OUTPUTS: { AppConfig - Typed config with validated MCP and tg-chat-rag settings }
//   SIDE_EFFECTS: [Throws ConfigValidationError with code CONFIG_VALIDATION_ERROR when validation fails]
//   LINKS: [M-CONFIG]
// END_CONTRACT: loadConfig
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];

  // START_BLOCK_NORMALIZE_ENV_INPUT_VALUES_M_CONFIG_001
  const baseUrlRaw = (env.TG_CHAT_RAG_BASE_URL ?? "").trim();
  const bearerToken = (env.TG_CHAT_RAG_BEARER_TOKEN ?? "").trim();
  const chatIdsRaw = (env.TG_CHAT_RAG_CHAT_IDS ?? "").trim();
  const portRaw = (env.PORT ?? "").trim();
  const timeoutRaw = (env.TG_CHAT_RAG_TIMEOUT_MS ?? "").trim();
  // END_BLOCK_NORMALIZE_ENV_INPUT_VALUES_M_CONFIG_001

  // START_BLOCK_VALIDATE_TG_CHAT_RAG_BASE_URL_M_CONFIG_002
  let normalizedBaseUrl = "";
  if (!baseUrlRaw) {
    errors.push("TG_CHAT_RAG_BASE_URL is required.");
  } else {
    try {
      normalizedBaseUrl = new URL(baseUrlRaw).toString();
    } catch {
      errors.push("TG_CHAT_RAG_BASE_URL must be a valid URL.");
    }
  }
  // END_BLOCK_VALIDATE_TG_CHAT_RAG_BASE_URL_M_CONFIG_002

  // START_BLOCK_VALIDATE_TG_CHAT_RAG_BEARER_TOKEN_M_CONFIG_003
  if (!bearerToken) {
    errors.push("TG_CHAT_RAG_BEARER_TOKEN is required.");
  }
  // END_BLOCK_VALIDATE_TG_CHAT_RAG_BEARER_TOKEN_M_CONFIG_003

  // START_BLOCK_PARSE_TG_CHAT_RAG_CHAT_IDS_M_CONFIG_004
  let chatIds: string[] = [];
  if (!chatIdsRaw) {
    errors.push("TG_CHAT_RAG_CHAT_IDS is required.");
  } else {
    const uniqueChatIds = new Set<string>();
    for (const value of chatIdsRaw.split(",")) {
      const trimmedValue = value.trim();
      if (trimmedValue) {
        uniqueChatIds.add(trimmedValue);
      }
    }
    chatIds = [...uniqueChatIds];
    if (chatIds.length === 0) {
      errors.push("TG_CHAT_RAG_CHAT_IDS must contain at least one non-empty value.");
    }
  }
  // END_BLOCK_PARSE_TG_CHAT_RAG_CHAT_IDS_M_CONFIG_004

  // START_BLOCK_PARSE_PORT_M_CONFIG_005
  let port = 3000;
  if (portRaw) {
    const parsedPort = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      errors.push("PORT must be an integer between 1 and 65535.");
    } else {
      port = parsedPort;
    }
  }
  // END_BLOCK_PARSE_PORT_M_CONFIG_005

  // START_BLOCK_PARSE_TG_CHAT_RAG_TIMEOUT_MS_M_CONFIG_006
  let timeoutMs = 15000;
  if (timeoutRaw) {
    const parsedTimeout = Number.parseInt(timeoutRaw, 10);
    if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1000 || parsedTimeout > 120000) {
      errors.push("TG_CHAT_RAG_TIMEOUT_MS must be an integer between 1000 and 120000.");
    } else {
      timeoutMs = parsedTimeout;
    }
  }
  // END_BLOCK_PARSE_TG_CHAT_RAG_TIMEOUT_MS_M_CONFIG_006

  // START_BLOCK_THROW_CONFIG_VALIDATION_ERROR_M_CONFIG_007
  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }
  // END_BLOCK_THROW_CONFIG_VALIDATION_ERROR_M_CONFIG_007

  // START_BLOCK_BUILD_APP_CONFIG_RESULT_M_CONFIG_008
  return {
    port,
    tgChatRag: {
      baseUrl: normalizedBaseUrl,
      bearerToken,
      chatIds,
      timeoutMs,
    },
  };
  // END_BLOCK_BUILD_APP_CONFIG_RESULT_M_CONFIG_008
}
