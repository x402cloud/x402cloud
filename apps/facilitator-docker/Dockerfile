FROM node:22-slim AS base
RUN npm install -g pnpm@9

# ── Build stage ──────────────────────────────────────────────────────
FROM base AS build
WORKDIR /app

# Copy workspace root
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./

# Copy packages needed by facilitator-docker
COPY packages/protocol/ packages/protocol/
COPY packages/evm/ packages/evm/
COPY packages/facilitator/ packages/facilitator/
COPY apps/facilitator-docker/ apps/facilitator-docker/

RUN pnpm install --frozen-lockfile
RUN pnpm -r --filter @x402cloud/facilitator-docker... run build

# ── Production stage ─────────────────────────────────────────────────
FROM base AS production
WORKDIR /app

COPY --from=build /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY --from=build /app/packages/protocol/package.json /app/packages/protocol/dist/ packages/protocol/
COPY --from=build /app/packages/evm/package.json /app/packages/evm/dist/ packages/evm/
COPY --from=build /app/packages/facilitator/package.json /app/packages/facilitator/dist/ packages/facilitator/
COPY --from=build /app/apps/facilitator-docker/package.json /app/apps/facilitator-docker/dist/ apps/facilitator-docker/

RUN pnpm install --frozen-lockfile --prod

ENV PORT=3000
EXPOSE 3000

CMD ["node", "apps/facilitator-docker/dist/index.js"]
