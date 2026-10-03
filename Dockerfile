# Scene on Cloud Run: Next.js standalone server + ffmpeg (Debian package: libx264, aac, flac, ebur128).
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-bookworm-slim AS run
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The data bucket is mounted with no metadata cache, so every file call on /data holds one of
# libuv's threads for a Cloud Storage round trip (40–110 ms). With the default 4, four media checks
# in flight queued every static file and page behind them (live QA, 2026-10-03: static files 3 ms
# alone, 98–133 ms with 8 in flight). 64 covers --concurrency 40 plus a listing's parallel reads.
# libuv reads it once, before any app code runs, so it is set in the image, not by the app.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 UV_THREADPOOL_SIZE=64
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
