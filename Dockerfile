FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig*.json ./
COPY src ./src
COPY tool ./tool
ENV DATABASE_URL=mysql://ci:ci-password@127.0.0.1:3306/appglv_unified_test
RUN npm run prisma:generate && npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000

COPY package*.json ./
RUN npm ci --include=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/src ./src
COPY --from=build /app/tool ./tool
COPY deploy/healthcheck.mjs ./deploy/healthcheck.mjs

EXPOSE 5000
CMD ["node", "dist/server.js"]
