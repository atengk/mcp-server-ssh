# ==========================================
# Stage 1: 构建阶段 (Builder)
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /build

# 启用并安装 pnpm (固定主版本为 9，与 lockfile 及 CI 环境保持一致)
RUN corepack enable && corepack prepare pnpm@9 --activate

# 优先复制依赖清单以最大化利用 Docker 缓存层
COPY package.json pnpm-lock.yaml tsconfig.json tsup.config.ts ./
RUN pnpm install --frozen-lockfile

# 复制源代码并执行 tsup 生产打包
COPY src ./src
RUN pnpm run build

# ==========================================
# Stage 2: 极简生产运行镜像 (Runner)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# 切换为内置安全的非 root 用户
USER node

# 仅从 Builder 拷贝最终编译产物与元数据
COPY --from=builder --chown=node:node /build/dist ./dist
COPY --from=builder --chown=node:node /build/package.json ./package.json

# 暴露 SSE 默认监听端口
EXPOSE 8000

# 默认生产环境与 SSE 常驻配置
ENV NODE_ENV=production \
    MCP_SSH_TRANSPORT=sse \
    MCP_SSH_SERVER_HOST=0.0.0.0 \
    MCP_SSH_SERVER_PORT=8000

# 服务入口
ENTRYPOINT ["node", "dist/index.js"]
