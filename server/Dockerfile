# Server — NestJS build + production runtime
FROM node:22-alpine AS build
RUN sed -i 's#https://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc* ./
RUN pnpm install  --ignore-scripts --registry https://registry.npmmirror.com
COPY . .
RUN pnpm build

FROM node:22-alpine
RUN sed -i 's#https://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories
RUN apk add --no-cache git openssh-client
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc* ./
# --ignore-scripts: runtime 不需要 postinstall（编译在 build 阶段完成）
RUN pnpm install  --prod --ignore-scripts --registry https://registry.npmmirror.com
COPY --from=build /app/dist ./dist
COPY configs ./configs

ENV NODE_ENV=production

# 非 root 用户 + 目录权限 + Git safe.directory
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && mkdir -p /data/liminal-field-kb && chown -R appuser:appgroup /app /data \
    && git config --global --add safe.directory /data/liminal-field-kb
USER appuser

EXPOSE 4398
CMD ["node", "dist/main.js"]
