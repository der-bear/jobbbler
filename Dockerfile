# syntax=docker/dockerfile:1.7

FROM node:24-bookworm AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN corepack enable && corepack install -g pnpm@11.19.0

FROM base AS build

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SUPABASE_ACTIVITY_WAKEUPS=false

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_ACTIVITY_WAKEUPS=$NEXT_PUBLIC_SUPABASE_ACTIVITY_WAKEUPS

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jobbbler/web build
RUN pnpm --filter @jobbbler/worker build
RUN pnpm --filter @jobbbler/worker deploy --legacy --prod /opt/jobbbler-worker

FROM node:24-bookworm-slim AS runtime-base

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN groupadd --system --gid 1001 jobbbler \
  && useradd --system --uid 1001 --gid jobbbler --create-home --home-dir /home/jobbbler jobbbler \
  && mkdir /app/.data \
  && chown -R jobbbler:jobbbler /app

FROM runtime-base AS web

ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build --chown=jobbbler:jobbbler /app/apps/web/.next/standalone ./
COPY --from=build --chown=jobbbler:jobbbler /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=jobbbler:jobbbler /app/apps/web/public ./apps/web/public

USER jobbbler

EXPOSE 3000

CMD ["node", "apps/web/server.js"]

FROM runtime-base AS worker

COPY --from=build --chown=jobbbler:jobbbler /opt/jobbbler-worker/node_modules ./node_modules
COPY --from=build --chown=jobbbler:jobbbler /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=jobbbler:jobbbler /app/migrations ./migrations

USER jobbbler

CMD ["node", "apps/worker/dist/main.js"]
