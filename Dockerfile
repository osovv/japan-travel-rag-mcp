# FILE: Dockerfile
# VERSION: 1.0.0
# START_MODULE_CONTRACT
#   PURPOSE: Build runtime image for MCP HTTP server.
#   SCOPE: Install production dependencies, copy application sources, expose runtime port, and define default startup command.
#   DEPENDS: (none - standalone build artifact)
#   LINKS: M-DOCKER-IMAGE -> M-SERVER, M-DOCKER-IMAGE -> M-CONFIG
# END_MODULE_CONTRACT
#
# START_MODULE_MAP
#   release-stage - Bun runtime image with app sources and production dependencies.
# END_MODULE_MAP
#
# START_CHANGE_SUMMARY
#   LAST_CHANGE: [v1.0.0 - Initial Docker image definition for MCP deployment]
# END_CHANGE_SUMMARY

# START_BLOCK_RELEASE_STAGE
FROM oven/bun:1.3.8 AS release

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY index.ts ./
COPY src/ ./src/

ENV NODE_ENV=production

EXPOSE 3000/tcp

CMD ["bun", "run", "index.ts"]
# END_BLOCK_RELEASE_STAGE
