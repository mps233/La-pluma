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
ENV PORT=3000 \
    LA_PLUMA_BASE_PATH=${VITE_BASE_PATH} \
    LA_PLUMA_CLIENT_DIST=/app/client/dist \
    LA_PLUMA_DATA_DIR=/app/data \
    MAA_CLI_PATH=/usr/local/bin/maa \
    ADB_PATH=/usr/bin/adb \
    LA_PLUMA_SCRCPY_SERVER_PATH=/app/resources/scrcpy-server

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl wget unzip android-tools-adb libatomic1 && \
    rm -rf /var/lib/apt/lists/*

ARG MAA_CLI_VERSION=0.7.8
ARG TARGETARCH=amd64
RUN mkdir -p /opt/maa-cli/bin && \
    arch="x86_64"; checksum="8ac10686a36bd227cd7b2f2625652cb8bbcf2b9ea001fc88d788030fedb05fbf"; \
    if [ "$TARGETARCH" = "arm64" ]; then arch="aarch64"; checksum="7aadb2ee402694c5c9f7ff0d391d546f2e71e02e32f0d545ad4a18df3e4510b4"; fi; \
    wget -q --tries=5 --retry-connrefused --timeout=60 -O /tmp/maa-cli.tar.gz \
      "https://github.com/MaaAssistantArknights/maa-cli/releases/download/v${MAA_CLI_VERSION}/maa_cli-v${MAA_CLI_VERSION}-${arch}-unknown-linux-gnu.tar.gz" && \
    echo "${checksum}  /tmp/maa-cli.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/maa-cli.tar.gz -C /opt/maa-cli/bin maa && \
    rm /tmp/maa-cli.tar.gz && \
    ln -s /opt/maa-cli/bin/maa /usr/local/bin/maa && \
    maa --version && \
    mkdir -p /root/.config/maa /app/data /app/client

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
