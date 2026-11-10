# Stage 1: Install dependencies
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Stage 2: Build the application
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# About page build facts (#1256). .git is not in the build context, so the commit
# comes from Railway's build variable; SOURCE_URL and HEIRLOOM_HOSTED are optional.
ARG RAILWAY_GIT_COMMIT_SHA
ARG SOURCE_COMMIT
ARG SOURCE_URL
ARG HEIRLOOM_HOSTED

# Build Next.js (standalone output)
RUN npm run build

# Stage 3: Production image
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user and install su-exec for privilege dropping
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    apk add --no-cache su-exec

# Copy standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Maintenance scripts run inside the container (plain Node, no tsx). #860
COPY --from=builder /app/scripts/sweep-orphan-media.mjs ./scripts/sweep-orphan-media.mjs

# Create data directory for media uploads (mounted as persistent volume)
RUN mkdir -p /data && chown nextjs:nodejs /data

ENV DATA_DIR=/data
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

# Run as root initially so we can fix volume permissions, then drop to nextjs
CMD ["sh", "-c", "chown -R nextjs:nodejs /data && exec su-exec nextjs node server.js"]
