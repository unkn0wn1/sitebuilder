# Builder image: Nuxt/Nitro and the in-process job worker (ADR 0007).
# Native modules (better-sqlite3, sharp) are compiled in the build stage and copied across.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/lib/sitebuilder \
  && chown node:node /var/lib/sitebuilder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/package.json ./
COPY --from=build /app/scripts ./scripts
# demo:golden and demo:sweep import the TypeScript sources. The product seed still runs on the host.
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
USER node
ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000
ENV SITEBUILDER_DB_PATH=/var/lib/sitebuilder/data/sitebuilder.db
ENV SITEBUILDER_MEDIA_DIR=/var/lib/sitebuilder/media
ENV SITEBUILDER_SITE_ROOT=/var/lib/sitebuilder/site
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
