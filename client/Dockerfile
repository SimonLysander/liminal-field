# Client — multi-stage: build with Node, serve with Nginx
FROM docker.1ms.run/node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc* ./
RUN pnpm install --frozen-lockfile --registry https://registry.npmmirror.com
COPY . .
RUN pnpm build

FROM docker.1ms.run/nginx:alpine
# openssl 用于首次启动时生成自签名占位证书
RUN apk add --no-cache openssl
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
EXPOSE 80 443
ENTRYPOINT ["/docker-entrypoint.sh"]
