# ---------------------------------------------------------------------------
# Stage 1 – Node builder: compile node_modules and build Next.js
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS node-builder

ARG TARGETPLATFORM

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++

RUN corepack enable pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml .pnpm-build-approval.yaml ./
RUN --mount=type=cache,id=pnpm-${TARGETPLATFORM},target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN --mount=type=cache,id=next-${TARGETPLATFORM},target=/app/.next/cache \
    pnpm build

# ---------------------------------------------------------------------------
# Stage 2 – Rust builder: compile watcher-rs and collect runtime libs
# ---------------------------------------------------------------------------
FROM rust:1-bookworm AS rust-builder

ARG TARGETPLATFORM

WORKDIR /app
COPY watcher-rs ./watcher-rs
# watcher-rs embeds the migration SQL at compile time (include_str!), so the
# migration files have to be present in this stage as well.
COPY src/lib/db/migrations ./src/lib/db/migrations

RUN --mount=type=cache,id=cargo-registry-${TARGETPLATFORM},target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git-${TARGETPLATFORM},target=/usr/local/cargo/git \
    --mount=type=cache,id=cargo-cache-${TARGETPLATFORM},target=/usr/local/cargo/cache \
    --mount=type=cache,id=watcher-target-${TARGETPLATFORM},target=/app/watcher-rs/target \
    set -eux; \
    cargo build --manifest-path watcher-rs/Cargo.toml --release --locked; \
    mkdir -p /out; \
    cp watcher-rs/target/release/watcher-rs /out/watcher-rs; \
    chmod +x /out/watcher-rs; \
    PDFIUM_SO="$(find /usr/local/cargo/cache/pdfium -name libpdfium.so -type f | head -n 1 || true)"; \
    if [ -n "$PDFIUM_SO" ]; then cp "$PDFIUM_SO" /out/libpdfium.so; fi

# ---------------------------------------------------------------------------
# Stage 3 – Runtime: minimal image with prebuilt app + watcher-rs binary
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim

RUN corepack enable pnpm

WORKDIR /app

COPY --from=node-builder /app/package.json .
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/scripts ./scripts
COPY --from=node-builder /app/next.config.ts .
COPY --from=node-builder /app/tsconfig.json .
COPY --from=node-builder /app/src/lib/db ./src/lib/db

# Standalone server + its bundled node_modules
COPY --from=node-builder /app/.next/standalone ./.next/standalone
# Static assets must live inside the standalone dir so server.js can serve them
COPY --from=node-builder /app/.next/static ./.next/standalone/.next/static
# Public assets likewise
COPY --from=node-builder /app/public ./.next/standalone/public

COPY --from=rust-builder /out ./watcher-rs
COPY --from=node-builder /app/docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh

# Ensure runtime writes (SQLite DB, covers, library metadata) happen as non-root.
RUN mkdir -p /app/data/library && chown -R node:node /app

# Absolute paths so runtime code is immune to cwd changes
# (the Next.js standalone server does process.chdir to .next/standalone/).
ENV DATABASE_PATH=/app/data/library.db
ENV LIBRARY_PATH=/app/data/library
ENV WATCHER_RS_BIN=/app/watcher-rs/watcher-rs
ENV LD_LIBRARY_PATH=/app/watcher-rs
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

USER node

# Readiness, not liveness: /api/health reports 503 until the schema is at the
# version this image expects, so an orchestrator will not send traffic to an
# instance whose migrations have not finished.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The entrypoint applies migrations synchronously, fails the container if they
# fail, provisions no accounts, and supervises the watcher alongside the
# server. See docker/entrypoint.sh for why the old inline CMD could not.
ENTRYPOINT ["/app/docker/entrypoint.sh"]
