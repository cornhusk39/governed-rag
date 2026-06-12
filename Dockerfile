# syntax=docker/dockerfile:1

# One image, two roles (web server and CLI), selected by the compose service.
# The build stage installs the workspace and builds every package; the runtime
# stage carries the built artifacts and dependencies. better-sqlite3 is a native
# addon, so the build stage has a toolchain in case no prebuilt binary is found.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Install dependencies first for better layer caching: only the manifests are
# needed to resolve the lockfile.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

# Build the whole workspace.
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
COPY --from=build /app ./

EXPOSE 3000

# Default role: serve the read-only web UI over the committed snapshot. The CLI
# role overrides the entrypoint (see docker-compose.yml).
ENV GOVERNED_RAG_DEMO_DATA=/app/packages/web/data/sample-snapshot.json
CMD ["pnpm", "--filter", "@governed-rag/web", "start"]
