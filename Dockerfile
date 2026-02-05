# ---------------------------------------------------------------------------
# Stage 1 – Builder: install native build deps, compile node_modules, build app
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS builder

# canvas requires cairo/pango/png/jpeg headers to compile its native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libpng-dev \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm

WORKDIR /app

# Install dependencies (layer-cached: only re-runs when lock file changes)
COPY package.json pnpm-lock.yaml .pnpm-build-approval.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build Next.js
COPY . .
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 2 – Runtime: minimal image with only what's needed to run
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim

# Runtime libraries only:
#   poppler-utils   – provides pdftoppm for PDF cover extraction
#   libcairo2       – canvas fallback cover rendering
#   libpango1.0-0   – text layout for canvas
#   libjpeg8        – JPEG encoding for canvas
#   libpng16-2      – PNG support for canvas
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libcairo2 \
    libpango1.0-0 \
    libjpeg8 \
    libpng16-2 \
    && rm -rf /var/lib/apt/lists/*

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
