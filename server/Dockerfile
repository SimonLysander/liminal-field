# Server — NestJS build + production runtime
FROM docker.1ms.run/node:22-alpine AS build
RUN sed -i 's#https://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc* ./
RUN pnpm install --frozen-lockfile --registry https://registry.npmmirror.com
COPY . .
RUN pnpm build

FROM docker.1ms.run/node:22-alpine
RUN sed -i 's#https://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories
RUN apk add --no-cache git
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc* ./
RUN pnpm install --frozen-lockfile --prod --registry https://registry.npmmirror.com
COPY --from=build /app/dist ./dist
COPY configs ./configs

ENV NODE_ENV=production
EXPOSE 4398
CMD ["node", "dist/main.js"]
