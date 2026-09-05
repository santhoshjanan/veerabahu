FROM node:20-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN mkdir -p data && VB_DISABLE_SCHEDULERS=true pnpm build && pnpm prune --prod

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json
VOLUME /app/data
EXPOSE 3000
CMD ["node", "build"]
