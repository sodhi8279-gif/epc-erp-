# Single image: API serves the built web app from the same origin.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @epc/api exec prisma generate && pnpm --filter @epc/web exec vite build

FROM node:22-bookworm-slim
RUN corepack enable && apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=4000 STORAGE_DIR=/data/storage
EXPOSE 4000
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && npx tsx src/server.ts"]
