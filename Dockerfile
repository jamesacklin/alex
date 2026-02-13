# ---------------------------------------------------------------------------
# Stage 1 – Builder: install native build deps, compile node_modules, build app
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS builder

# Build tools and native dependencies for canvas and better-sqlite3
# Use cache mount for apt to speed up repeated builds
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libpng-dev

RUN corepack enable pnpm

WORKDIR /app

# Install dependencies with pnpm store cache mount for faster installs
COPY package.json pnpm-lock.yaml .pnpm-build-approval.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Build native modules in parallel (better-sqlite3 and canvas)
RUN cd node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3 && npm run build-release & \
    cd node_modules/.pnpm/canvas@3.2.1/node_modules/canvas && npm run install & \
    wait

# Copy source and build Next.js
COPY . .
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 2 – Runtime: minimal image with only what's needed to run
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim

# Runtime libraries only:
#   poppler-utils       – provides pdftoppm for PDF cover extraction
#   libcairo2           – canvas fallback cover rendering
#   libpango1.0-0       – text layout for canvas
#   libjpeg62-turbo     – JPEG encoding for canvas
#   libpng16-16         – PNG support for canvas
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libcairo2 \
    libpango1.0-0 \
    libjpeg62-turbo \
    libpng16-16

RUN corepack enable pnpm

WORKDIR /app

# Copy built artifacts from the builder stage
COPY --from=builder /app/package.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Next.js config
COPY --from=builder /app/next.config.ts .
COPY --from=builder /app/tsconfig.json .
COPY --from=builder /app/drizzle.config.ts .

# Watcher service + the DB layer it imports at runtime
COPY --from=builder /app/watcher ./watcher
COPY --from=builder /app/src/lib/db ./src/lib/db

EXPOSE 3000

# db:push (schema) and db:seed (default admin) are both idempotent –
# running them every startup is safe and ensures the DB is ready.
# The watcher is backgrounded; Next.js runs in the foreground as PID 1.
CMD ["sh", "-c", \
  "pnpm db:push && pnpm db:seed && \
   pnpm watcher & \
   exec pnpm start"]
