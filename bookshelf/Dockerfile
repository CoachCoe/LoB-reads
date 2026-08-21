# Build in one stage, run in a much smaller one.
#
# The build needs roughly 2GB of memory — more than an Azure B1s or an AWS
# t3.micro has — which is why CI builds the image and the host only runs it.
# Doing it here rather than on the server is the whole point of the split.

FROM node:24-slim AS deps
WORKDIR /app
# prisma generate downloads engines over TLS and needs libssl to run them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Prisma's postinstall needs the schema present to generate a client.
COPY prisma ./prisma
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app
# Needed here too: Prisma decides which engine to load by probing for libssl,
# and with none present it falls back to a 1.1.x engine that will not load.
# next build runs prerender queries, so the build itself hits this.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Both are baked into the build: next.config reads CDN_URL for the image
# allowlist and the CSP, and Prisma needs a URL present to generate.
ARG CDN_URL
ARG DATABASE_URL="postgresql://placeholder/placeholder"
ARG DIRECT_URL="postgresql://placeholder/placeholder"
ENV CDN_URL=$CDN_URL DATABASE_URL=$DATABASE_URL DIRECT_URL=$DIRECT_URL
RUN npx prisma generate && npx next build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Prisma's query engine links against libssl, which the slim image does not
# ship. Without it the app starts and then fails on the first query.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Runs unprivileged. The image ships a `node` user for exactly this.
USER node

# Standalone output carries its own minimal node_modules.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
