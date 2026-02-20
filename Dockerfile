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

RUN --mount=type=cache,id=cargo-registry-${TARGETPLATFORM},target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git-${TARGETPLATFORM},target=/usr/local/cargo/git \
    --mount=type=cache,id=cargo-cache-${TARGETPLATFORM},target=/usr/local/cargo/cache \
    --mount=type=cache,id=watcher-target-${TARGETPLATFORM},target=/app/watcher-rs/target \
    cargo build --manifest-path watcher-rs/Cargo.toml --release --locked

RUN set -eux; \
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
COPY --from=node-builder /app/.next ./.next
COPY --from=node-builder /app/public ./public

COPY --from=node-builder /app/next.config.ts .
COPY --from=node-builder /app/tsconfig.json .
COPY --from=node-builder /app/src/lib/db ./src/lib/db

COPY --from=rust-builder /out ./watcher-rs

EXPOSE 3000

# db:push (schema) and db:seed (default admin) are both idempotent –
# running them every startup is safe and ensures the DB is ready.
# watcher-rs runs as a prebuilt binary; Next.js stays PID 1.
CMD ["sh", "-c", \
  "pnpm db:push && pnpm db:seed && \
   env LD_LIBRARY_PATH=/app/watcher-rs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH} /app/watcher-rs/watcher-rs & \
   exec pnpm start"]
