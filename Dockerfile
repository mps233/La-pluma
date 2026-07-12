# ============================================
# 用于 Docker Hub 发布的 Dockerfile
# 在镜像内构建前端，不依赖本地环境
# ============================================

# ============================================
# 阶段 1: 构建前端
# ============================================
FROM node:22-alpine AS frontend-builder

ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

WORKDIR /app/client

# 复制前端依赖文件
COPY client/package*.json ./

# 安装前端依赖（使用国内镜像加速）
RUN npm config set registry https://registry.npmmirror.com && \
    npm ci

# 复制前端源代码
COPY client/ ./

# 构建前端
RUN npm run build

# ============================================
# 阶段 2: 后端运行环境 + MAA CLI
# ============================================
FROM node:22-slim

ARG VITE_BASE_PATH=/

WORKDIR /app

# 安装必要的系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    wget \
    unzip \
    ca-certificates \
    android-tools-adb \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# 创建 MAA CLI 持久化目录
RUN mkdir -p /opt/maa-cli/bin

# 使用官方安装脚本安装 MAA CLI
RUN wget -qO- https://raw.githubusercontent.com/MaaAssistantArknights/maa-cli/main/install.sh | \
    MAA_INSTALL_DIR=/opt/maa-cli/bin bash && \
    ln -s /opt/maa-cli/bin/maa /usr/local/bin/maa && \
    maa --version

# 创建 MAA 配置目录
RUN mkdir -p /root/.config/maa

# 复制后端依赖文件
COPY server/package*.json ./server/

# 安装后端依赖（使用国内镜像加速）
WORKDIR /app/server
RUN npm config set registry https://registry.npmmirror.com && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm ci --omit=dev

# 复制后端源代码
WORKDIR /app
COPY server/ ./server/

# 从构建阶段复制前端构建产物
COPY --from=frontend-builder /app/client/dist ./client/dist

# 创建数据目录
RUN mkdir -p /app/server/data/user-configs

# 复制启动脚本
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV NODE_ENV=production \
    PORT=3000 \
    LA_PLUMA_BASE_PATH=${VITE_BASE_PATH} \
    MAA_CONFIG_DIR=/root/.config/maa \
    DOCKER_ENV=true

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD scheme=http; if [ -n "$LA_PLUMA_HTTPS_CERT_PATH" ]; then scheme=https; fi; curl -fk "$scheme://localhost:${PORT:-3000}/health" || exit 1

# 启动服务器
WORKDIR /app/server
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
