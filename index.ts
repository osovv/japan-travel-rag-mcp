// FILE: index.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Root runtime entrypoint that boots MCP HTTP server.
//   SCOPE: Invoke server main function and fail fast on startup errors.
//   DEPENDS: M-SERVER
//   LINKS: M-SERVER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   bootstrap - Run server main and map fatal startup failures to process exit code 1.
// END_MODULE_MAP

// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Added startup error details logging to expose wrapped ServerStartError causes in fatal bootstrap logs.
// END_CHANGE_SUMMARY

import { main } from "./src/server/index";

// START_CONTRACT: bootstrap
//   PURPOSE: Start HTTP server and terminate process on unrecoverable startup errors.
//   INPUTS: {}
//   OUTPUTS: { Promise<void> - Resolves when startup succeeds }
//   SIDE_EFFECTS: [Starts server, may set process.exitCode=1 and log to stderr]
//   LINKS: [M-SERVER]
// END_CONTRACT: bootstrap
async function bootstrap(): Promise<void> {
  // START_BLOCK_START_SERVER_AND_HANDLE_FATAL_ERRORS_ROOT_ENTRYPOINT_001
  try {
    await main();
  } catch (error: unknown) {
    if (error instanceof Error) {
      const details = (error as { details?: unknown }).details;
      let detailsSuffix = "";

      if (details && typeof details === "object") {
        try {
          detailsSuffix = ` details=${JSON.stringify(details)}`;
        } catch {
          detailsSuffix = " details=<unserializable>";
        }
      }

      const message = error.stack ?? error.message;
      console.error(
        `[RootEntrypoint][bootstrap][START_SERVER_AND_HANDLE_FATAL_ERRORS] ${message}${detailsSuffix}`,
      );
    } else {
      console.error(
        `[RootEntrypoint][bootstrap][START_SERVER_AND_HANDLE_FATAL_ERRORS] ${String(error)}`,
      );
    }
    process.exitCode = 1;
  }
  // END_BLOCK_START_SERVER_AND_HANDLE_FATAL_ERRORS_ROOT_ENTRYPOINT_001
}

void bootstrap();
