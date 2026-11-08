# La Pluma Go backend image.
# Build from the repository root: docker build -f go/Dockerfile -t la-pluma-go .

FROM node:22-alpine AS frontend
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
WORKDIR /app/client
COPY client/package*.json ./
RUN npm config set registry https://registry.npmmirror.com && npm ci
COPY client/ ./
RUN npm run build

FROM golang:1.27-bookworm AS backend
WORKDIR /src/go
COPY go/go.mod go/go.sum ./
RUN go mod download
COPY go/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/la-pluma ./cmd/server

FROM debian:bookworm-slim
ARG VITE_BASE_PATH=/
ENV NODE_ENV=production \
    PORT=3000 \
    LA_PLUMA_BASE_PATH=${VITE_BASE_PATH} \
    LA_PLUMA_CLIENT_DIST=/app/client/dist \
    LA_PLUMA_DATA_DIR=/app/server/data \
    MAA_CLI_PATH=/usr/local/bin/maa \
    ADB_PATH=/usr/bin/adb \
    LA_PLUMA_SCRCPY_SERVER_PATH=/app/resources/scrcpy-server

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl wget unzip android-tools-adb libatomic1 && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/maa-cli/bin && \
    wget -qO- https://raw.githubusercontent.com/MaaAssistantArknights/maa-cli/main/install.sh | \
    MAA_INSTALL_DIR=/opt/maa-cli/bin bash && \
    ln -s /opt/maa-cli/bin/maa /usr/local/bin/maa && \
    maa --version && \
    mkdir -p /root/.config/maa /app/server/data /app/client

COPY --from=backend /out/la-pluma /app/la-pluma
COPY --from=frontend /app/client/dist /app/client/dist
COPY go/resources /app/resources
COPY go/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
EXPOSE 3478/udp
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD scheme=http; if [ -n "$LA_PLUMA_HTTPS_CERT_PATH" ]; then scheme=https; fi; curl -fk "$scheme://localhost:${PORT:-3000}/health" || exit 1

WORKDIR /app
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/app/la-pluma"]
