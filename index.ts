// FILE: index.ts
// VERSION: 1.0.0
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
//   LAST_CHANGE: v1.0.0 - Replaced Bun init placeholder with server bootstrap entrypoint.
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
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[RootEntrypoint][bootstrap][START_SERVER_AND_HANDLE_FATAL_ERRORS] ${message}`);
    process.exitCode = 1;
  }
  // END_BLOCK_START_SERVER_AND_HANDLE_FATAL_ERRORS_ROOT_ENTRYPOINT_001
}

void bootstrap();
