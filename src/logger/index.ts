// FILE: src/logger/index.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Provide structured logs for MCP requests, validation decisions, upstream calls, and failures.
//   SCOPE: Create module-scoped logger instances with level filtering, structured JSON output, and child context inheritance.
//   DEPENDS: M-CONFIG
//   LINKS: M-LOGGER, M-CONFIG
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   LogLevel - Supported severity levels for structured logging.
//   Logger - Logger interface with level methods and child context derivation.
//   LoggerInitError - Typed initialization error with LOGGER_INIT_ERROR code.
//   createLogger - Build and return a configured module-scoped logger.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-LOGGER.
// END_CHANGE_SUMMARY

import type { AppConfig } from "../config/index";

export type LogLevel = "debug" | "info" | "warn" | "error";

type LogMethod = (
  message: string,
  functionName: string,
  blockName: string,
  extra?: Record<string, unknown>,
) => void;

export type Logger = {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  child(extraContext: Record<string, unknown>): Logger;
};

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LOG_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>(["debug", "info", "warn", "error"]);

const CONSOLE_BY_LEVEL: Record<LogLevel, (line: string) => void> = {
  debug: (line: string) => {
    console.debug(line);
  },
  info: (line: string) => {
    console.info(line);
  },
  warn: (line: string) => {
    console.warn(line);
  },
  error: (line: string) => {
    console.error(line);
  },
};

export class LoggerInitError extends Error {
  public readonly code = "LOGGER_INIT_ERROR" as const;

  public constructor(message: string) {
    super(message);
    this.name = "LoggerInitError";
  }
}

// START_CONTRACT: isRecord
//   PURPOSE: Narrow unknown values to string-keyed object records.
//   INPUTS: { value: unknown - Candidate value to inspect }
//   OUTPUTS: { boolean - True when value is a non-null object }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: isRecord
function isRecord(value: unknown): value is Record<string, unknown> {
  // START_BLOCK_CHECK_RECORD_SHAPE_M_LOGGER_001
  return typeof value === "object" && value !== null;
  // END_BLOCK_CHECK_RECORD_SHAPE_M_LOGGER_001
}

// START_CONTRACT: normalizeText
//   PURPOSE: Normalize string-like values for logging identifiers and messages.
//   INPUTS: { value: unknown - Value to normalize, fallback: string - Value used when normalized input is empty }
//   OUTPUTS: { string - Trimmed non-empty text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: normalizeText
function normalizeText(value: unknown, fallback: string): string {
  // START_BLOCK_NORMALIZE_TEXT_VALUE_M_LOGGER_002
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
  // END_BLOCK_NORMALIZE_TEXT_VALUE_M_LOGGER_002
}

// START_CONTRACT: hasConfigEssentials
//   PURPOSE: Validate that AppConfig includes required runtime essentials for safe logger initialization.
//   INPUTS: { config: AppConfig - Runtime configuration object from M-CONFIG }
//   OUTPUTS: { boolean - True when required config fields are present and valid }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER, M-CONFIG]
// END_CONTRACT: hasConfigEssentials
function hasConfigEssentials(config: AppConfig): boolean {
  // START_BLOCK_VALIDATE_CONFIG_CORE_FIELDS_M_LOGGER_003
  if (!isRecord(config)) {
    return false;
  }

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    return false;
  }

  if (!isRecord(config.tgChatRag)) {
    return false;
  }

  const baseUrl = normalizeText(config.tgChatRag.baseUrl, "");
  const bearerToken = normalizeText(config.tgChatRag.bearerToken, "");
  const chatIds = config.tgChatRag.chatIds;
  const timeoutMs = config.tgChatRag.timeoutMs;

  if (!baseUrl || !bearerToken) {
    return false;
  }

  if (!Array.isArray(chatIds) || chatIds.length === 0) {
    return false;
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    return false;
  }

  try {
    new URL(baseUrl);
  } catch {
    return false;
  }

  return true;
  // END_BLOCK_VALIDATE_CONFIG_CORE_FIELDS_M_LOGGER_003
}

// START_CONTRACT: resolveLogLevelFromConfig
//   PURPOSE: Resolve logger threshold from config-provided env values with fallback to info.
//   INPUTS: { config: AppConfig - Runtime configuration object }
//   OUTPUTS: { LogLevel - Resolved logger threshold }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER, M-CONFIG]
// END_CONTRACT: resolveLogLevelFromConfig
function resolveLogLevelFromConfig(config: AppConfig): LogLevel {
  // START_BLOCK_EXTRACT_LOG_LEVEL_CANDIDATES_M_LOGGER_004
  const configRecord = config as unknown as Record<string, unknown>;
  const envCandidate = isRecord(configRecord["env"]) ? configRecord["env"] : undefined;
  const rawLogLevel = envCandidate?.LOG_LEVEL ?? configRecord["logLevel"];

  if (typeof rawLogLevel !== "string") {
    return "info";
  }
  // END_BLOCK_EXTRACT_LOG_LEVEL_CANDIDATES_M_LOGGER_004

  // START_BLOCK_VALIDATE_LOG_LEVEL_CANDIDATE_M_LOGGER_005
  const normalizedLevel = rawLogLevel.trim().toLowerCase();
  if (LOG_LEVELS.has(normalizedLevel as LogLevel)) {
    return normalizedLevel as LogLevel;
  }
  return "info";
  // END_BLOCK_VALIDATE_LOG_LEVEL_CANDIDATE_M_LOGGER_005
}

// START_CONTRACT: mergeContexts
//   PURPOSE: Merge inherited and per-call logger contexts into one serializable record.
//   INPUTS: { baseContext: Record<string, unknown>, extraContext: Record<string, unknown> | undefined }
//   OUTPUTS: { Record<string, unknown> - Combined context object }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: mergeContexts
function mergeContexts(
  baseContext: Record<string, unknown>,
  extraContext?: Record<string, unknown>,
): Record<string, unknown> {
  // START_BLOCK_COMBINE_CONTEXT_OBJECTS_M_LOGGER_006
  if (!extraContext || !isRecord(extraContext)) {
    return { ...baseContext };
  }
  return { ...baseContext, ...extraContext };
  // END_BLOCK_COMBINE_CONTEXT_OBJECTS_M_LOGGER_006
}

// START_CONTRACT: createScopedLogger
//   PURPOSE: Create a logger instance bound to module name, level threshold, and inherited context.
//   INPUTS: { moduleName: string, minLevel: LogLevel, baseContext: Record<string, unknown> }
//   OUTPUTS: { Logger - Logger implementation with level methods and child context derivation }
//   SIDE_EFFECTS: [Writes JSON lines to console methods]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createScopedLogger
function createScopedLogger(
  moduleName: string,
  minLevel: LogLevel,
  baseContext: Record<string, unknown>,
): Logger {
  // START_BLOCK_BUILD_LOGGER_METHOD_FACTORY_M_LOGGER_007
  const write = (
    level: LogLevel,
    message: string,
    functionName: string,
    blockName: string,
    extra?: Record<string, unknown>,
  ): void => {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) {
      return;
    }

    const resolvedFunctionName = normalizeText(functionName, "unknown_function");
    const resolvedBlockName = normalizeText(blockName, "UNKNOWN_BLOCK");
    const resolvedMessageBody = normalizeText(message, "(empty message)");
    const formattedMessage = `[${moduleName}][${resolvedFunctionName}][${resolvedBlockName}] ${resolvedMessageBody}`;
    const resolvedContext = mergeContexts(baseContext, extra);

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      module: moduleName,
      function: resolvedFunctionName,
      block: resolvedBlockName,
      message: formattedMessage,
      context: resolvedContext,
    };

    CONSOLE_BY_LEVEL[level](JSON.stringify(payload));
  };
  // END_BLOCK_BUILD_LOGGER_METHOD_FACTORY_M_LOGGER_007

  // START_BLOCK_RETURN_SCOPED_LOGGER_OBJECT_M_LOGGER_008
  return {
    debug: (message, functionName, blockName, extra) => {
      write("debug", message, functionName, blockName, extra);
    },
    info: (message, functionName, blockName, extra) => {
      write("info", message, functionName, blockName, extra);
    },
    warn: (message, functionName, blockName, extra) => {
      write("warn", message, functionName, blockName, extra);
    },
    error: (message, functionName, blockName, extra) => {
      write("error", message, functionName, blockName, extra);
    },
    child: (extraContext) => {
      const mergedChildContext = mergeContexts(baseContext, extraContext);
      return createScopedLogger(moduleName, minLevel, mergedChildContext);
    },
  };
  // END_BLOCK_RETURN_SCOPED_LOGGER_OBJECT_M_LOGGER_008
}

// START_CONTRACT: createLogger
//   PURPOSE: Validate logger initialization inputs and create a module-scoped structured logger.
//   INPUTS: { config: AppConfig - Runtime app configuration, moduleName: string - Logical module identifier, context: Record<string, unknown> | undefined - Optional base context }
//   OUTPUTS: { Logger - Structured logger with level methods and child logger support }
//   SIDE_EFFECTS: [Throws LoggerInitError on invalid initialization state]
//   LINKS: [M-LOGGER, M-CONFIG]
// END_CONTRACT: createLogger
export function createLogger(
  config: AppConfig,
  moduleName: string,
  context?: Record<string, unknown>,
): Logger {
  // START_BLOCK_VALIDATE_LOGGER_INIT_ARGUMENTS_M_LOGGER_009
  const normalizedModuleName = normalizeText(moduleName, "");
  if (!normalizedModuleName) {
    throw new LoggerInitError("LOGGER_INIT_ERROR: moduleName must be a non-empty string.");
  }

  if (!hasConfigEssentials(config)) {
    throw new LoggerInitError("LOGGER_INIT_ERROR: config is missing required runtime essentials.");
  }
  // END_BLOCK_VALIDATE_LOGGER_INIT_ARGUMENTS_M_LOGGER_009

  // START_BLOCK_RESOLVE_LOGGER_CONFIGURATION_M_LOGGER_010
  const minLevel = resolveLogLevelFromConfig(config);
  const baseContext = isRecord(context) ? { ...context } : {};
  // END_BLOCK_RESOLVE_LOGGER_CONFIGURATION_M_LOGGER_010

  // START_BLOCK_CREATE_AND_RETURN_LOGGER_M_LOGGER_011
  return createScopedLogger(normalizedModuleName, minLevel, baseContext);
  // END_BLOCK_CREATE_AND_RETURN_LOGGER_M_LOGGER_011
}
