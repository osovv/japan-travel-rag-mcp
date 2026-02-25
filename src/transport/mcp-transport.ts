// FILE: src/transport/mcp-transport.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Register MCP tools and route tool calls into ToolProxyService.
//   SCOPE: Build MCP SDK server instances per request, register proxied tools with zod schemas, and handle streamable HTTP transport lifecycle.
//   DEPENDS: M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-LOGGER
//   LINKS: M-TRANSPORT, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   McpToolDescriptor - MCP tool descriptor with name, description, and input schema metadata.
//   McpTransportDependencies - Runtime dependencies for transport request handling.
//   TransportError - Typed transport error with TRANSPORT_ERROR code.
//   registerTools - Return the fixed MCP proxy tool registry.
//   createMcpServerForRequest - Build and configure per-request MCP SDK server with registered tools.
//   handleMcpRequest - Handle POST /mcp requests through MCP SDK streamable HTTP transport.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Replaced custom JSON-RPC handling with MCP SDK server and streamable HTTP transport.
// END_CHANGE_SUMMARY

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Logger } from "../logger/index";
import {
  GetMessageContextInputSchema,
  GetRelatedMessagesInputSchema,
  ListSourcesInputSchema,
  PROXIED_TOOL_NAMES,
  SearchMessagesInputPublicSchema,
  TOOL_INPUT_JSON_SCHEMAS,
} from "../tools/contracts";
import type { ProxiedToolName } from "../tools/contracts";
import { ProxyExecutionError } from "../tools/proxy-service";
import type { ToolProxyService } from "../tools/proxy-service";

type ZodToolInputSchema =
  | typeof SearchMessagesInputPublicSchema
  | typeof GetMessageContextInputSchema
  | typeof GetRelatedMessagesInputSchema
  | typeof ListSourcesInputSchema;

const TOOL_INPUT_ZOD_SCHEMAS: Record<ProxiedToolName, ZodToolInputSchema> = {
  search_messages: SearchMessagesInputPublicSchema,
  get_message_context: GetMessageContextInputSchema,
  get_related_messages: GetRelatedMessagesInputSchema,
  list_sources: ListSourcesInputSchema,
};

export type McpToolDescriptor = {
  name: ProxiedToolName;
  description: string;
  inputSchema: ZodToolInputSchema;
};

export type McpTransportDependencies = {
  logger: Logger;
  proxyService: ToolProxyService;
};

export class TransportError extends Error {
  public readonly code = "TRANSPORT_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "TransportError";
    this.details = details;
  }
}

// START_CONTRACT: createRequestId
//   PURPOSE: Create a request-scoped identifier for transport logging and tracing.
//   INPUTS: { request: Request - Incoming HTTP request }
//   OUTPUTS: { string - Request-scoped identifier }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TRANSPORT]
// END_CONTRACT: createRequestId
function createRequestId(request: Request): string {
  // START_BLOCK_CREATE_REQUEST_SCOPED_IDENTIFIER_M_TRANSPORT_001
  const incoming = (request.headers.get("x-request-id") ?? "").trim();
  if (incoming.length > 0) {
    return incoming;
  }

  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `mcp-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  // END_BLOCK_CREATE_REQUEST_SCOPED_IDENTIFIER_M_TRANSPORT_001
}

// START_CONTRACT: buildErrorText
//   PURPOSE: Build safe text messages for tool error results returned to MCP clients.
//   INPUTS: { toolName: ProxiedToolName - Tool context, error: unknown - Tool execution error }
//   OUTPUTS: { string - Error text for MCP tool content }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TRANSPORT, M-TOOL-PROXY]
// END_CONTRACT: buildErrorText
function buildErrorText(toolName: ProxiedToolName, error: unknown): string {
  // START_BLOCK_FORMAT_TOOL_ERROR_TEXT_M_TRANSPORT_002
  if (error instanceof ProxyExecutionError) {
    return `${toolName} failed: ${error.code} - ${error.message}`;
  }
  return `${toolName} failed due to unexpected transport error.`;
  // END_BLOCK_FORMAT_TOOL_ERROR_TEXT_M_TRANSPORT_002
}

// START_CONTRACT: registerTools
//   PURPOSE: Register fixed proxy surface MCP tools using metadata and zod schemas from contracts.
//   INPUTS: {}
//   OUTPUTS: { McpToolDescriptor[] - Tool descriptors for the transport registry }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TRANSPORT, M-TOOLS-CONTRACTS]
// END_CONTRACT: registerTools
export function registerTools(): McpToolDescriptor[] {
  // START_BLOCK_BUILD_FIXED_PROXY_TOOL_DESCRIPTORS_M_TRANSPORT_003
  return PROXIED_TOOL_NAMES.map((toolName) => ({
    name: toolName,
    description: TOOL_INPUT_JSON_SCHEMAS[toolName].description,
    inputSchema: TOOL_INPUT_ZOD_SCHEMAS[toolName],
  }));
  // END_BLOCK_BUILD_FIXED_PROXY_TOOL_DESCRIPTORS_M_TRANSPORT_003
}

// START_CONTRACT: createMcpServerForRequest
//   PURPOSE: Create and configure a per-request MCP SDK server with the four proxied tools.
//   INPUTS: { deps: McpTransportDependencies - Runtime transport dependencies, requestId: string - Request-scoped identifier for logs }
//   OUTPUTS: { McpServer - Configured MCP server instance for one request lifecycle }
//   SIDE_EFFECTS: [Registers tool handlers and binds proxy execution callbacks]
//   LINKS: [M-TRANSPORT, M-TOOL-PROXY, M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: createMcpServerForRequest
function createMcpServerForRequest(deps: McpTransportDependencies, requestId: string): McpServer {
  // START_BLOCK_CREATE_SERVER_AND_REGISTER_PROXY_TOOLS_M_TRANSPORT_004
  const server = new McpServer({
    name: "japan-travel-rag-mcp",
    version: "0.4.0",
  });

  for (const descriptor of registerTools()) {
    const toolName = descriptor.name;
    server.registerTool(
      toolName,
      {
        description: descriptor.description,
        inputSchema: descriptor.inputSchema,
      },
      async (args: unknown) => {
        deps.logger.info(
          "Dispatching MCP tool callback to proxy service.",
          "createMcpServerForRequest",
          "CREATE_SERVER_AND_REGISTER_PROXY_TOOLS",
          { requestId, toolName },
        );

        try {
          return await deps.proxyService.executeTool(toolName, args ?? {});
        } catch (error: unknown) {
          if (error instanceof ProxyExecutionError) {
            deps.logger.warn(
              "Proxy execution returned handled tool error.",
              "createMcpServerForRequest",
              "HANDLE_PROXY_TOOL_FAILURE",
              { requestId, toolName, code: error.code },
            );
          } else {
            deps.logger.error(
              "Proxy execution returned unexpected tool error.",
              "createMcpServerForRequest",
              "HANDLE_PROXY_TOOL_FAILURE",
              {
                requestId,
                toolName,
                cause: error instanceof Error ? error.message : String(error),
              },
            );
          }

          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: buildErrorText(toolName, error),
              },
            ],
          };
        }
      },
    );
  }

  return server;
  // END_BLOCK_CREATE_SERVER_AND_REGISTER_PROXY_TOOLS_M_TRANSPORT_004
}

// START_CONTRACT: handleMcpRequest
//   PURPOSE: Handle MCP HTTP requests by routing through MCP SDK streamable transport.
//   INPUTS: { request: Request - Incoming MCP HTTP request, deps: McpTransportDependencies - Transport runtime dependencies }
//   OUTPUTS: { Promise<Response> - MCP SDK transport response }
//   SIDE_EFFECTS: [Creates per-request server/transport instances, logs lifecycle events, and executes proxy tools]
//   LINKS: [M-TRANSPORT, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-LOGGER]
// END_CONTRACT: handleMcpRequest
export async function handleMcpRequest(
  request: Request,
  deps: McpTransportDependencies,
): Promise<Response> {
  // START_BLOCK_VALIDATE_REQUEST_METHOD_AND_INIT_LIFECYCLE_M_TRANSPORT_005
  if (request.method !== "POST") {
    throw new TransportError("MCP endpoint accepts only POST requests.", {
      method: request.method,
    });
  }

  const requestId = createRequestId(request);
  const startedAt = Date.now();

  deps.logger.info(
    "Starting MCP transport request lifecycle.",
    "handleMcpRequest",
    "VALIDATE_REQUEST_METHOD_AND_INIT_LIFECYCLE",
    { requestId, method: request.method },
  );
  // END_BLOCK_VALIDATE_REQUEST_METHOD_AND_INIT_LIFECYCLE_M_TRANSPORT_005

  // START_BLOCK_CREATE_PER_REQUEST_SERVER_AND_TRANSPORT_M_TRANSPORT_006
  const server = createMcpServerForRequest(deps, requestId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  // END_BLOCK_CREATE_PER_REQUEST_SERVER_AND_TRANSPORT_M_TRANSPORT_006

  // START_BLOCK_CONNECT_AND_HANDLE_MCP_REQUEST_M_TRANSPORT_007
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const durationMs = Date.now() - startedAt;

    deps.logger.info(
      "Completed MCP transport request lifecycle.",
      "handleMcpRequest",
      "CONNECT_AND_HANDLE_MCP_REQUEST",
      { requestId, status: response.status, durationMs },
    );

    return response;
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;
    deps.logger.error(
      "Failed MCP transport request lifecycle.",
      "handleMcpRequest",
      "CONNECT_AND_HANDLE_MCP_REQUEST",
      {
        requestId,
        durationMs,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
    throw new TransportError("Failed to handle MCP request.", {
      requestId,
      cause: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await server.close();
  }
  // END_BLOCK_CONNECT_AND_HANDLE_MCP_REQUEST_M_TRANSPORT_007
}
