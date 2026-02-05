# GitHub Actions 配置说明

## Docker 自动构建和发布

### 功能

- ✅ 自动构建 Docker 镜像
- ✅ 支持多架构（amd64 + arm64）
- ✅ 自动推送到 Docker Hub
- ✅ 自动生成版本标签
- ✅ 使用 GitHub Actions 缓存加速构建

### 触发条件

1. **推送到 main 分支** → 构建并推送 `latest` 标签
2. **推送 tag（如 v1.0.0）** → 构建并推送版本标签
3. **Pull Request** → 仅构建，不推送
4. **手动触发** → 在 Actions 页面手动运行

### 配置步骤

#### 1. 在 Docker Hub 创建仓库

1. 登录 [Docker Hub](https://hub.docker.com/)
2. 点击 "Create Repository"
3. 仓库名：`la-pluma`
4. 可见性：Public 或 Private

#### 2. 获取 Docker Hub 凭证

1. 登录 Docker Hub
2. 点击右上角头像 → Account Settings
3. 点击 Security → New Access Token
4. 输入描述（如 "GitHub Actions"）
5. 权限选择：Read, Write, Delete
6. 复制生成的 token（只显示一次！）

#### 3. 在 GitHub 添加 Secrets

1. 打开你的 GitHub 仓库
2. 点击 Settings → Secrets and variables → Actions
3. 点击 "New repository secret"
4. 添加两个 secrets：

   **DOCKER_USERNAME**
   - Name: `DOCKER_USERNAME`
   - Value: 你的 Docker Hub 用户名（如 `mps233`）

   **DOCKER_PASSWORD**
   - Name: `DOCKER_PASSWORD`
   - Value: 刚才复制的 Access Token

### 使用方法

#### 自动构建（推送到 main）

```bash
git add .
git commit -m "更新功能"
git push
```

GitHub Actions 会自动：
1. 构建 Docker 镜像
2. 推送到 Docker Hub
3. 标签：`mps233/la-pluma:latest`

#### 发布版本（推送 tag）

```bash
# 创建版本标签
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions 会自动推送多个标签：
- `mps233/la-pluma:v1.0.0`
- `mps233/la-pluma:1.0`
- `mps233/la-pluma:1`
- `mps233/la-pluma:latest`

#### 手动触发

1. 打开 GitHub 仓库
2. 点击 Actions 标签
3. 选择 "Docker Build and Push"
4. 点击 "Run workflow"
5. 选择分支，点击 "Run workflow"

### 查看构建状态

1. 打开 GitHub 仓库
2. 点击 Actions 标签
3. 查看最新的工作流运行

### 使用发布的镜像

```bash
# 拉取最新版本
docker pull mps233/la-pluma:latest

# 拉取指定版本
docker pull mps233/la-pluma:v1.0.0

# 运行容器
docker run -d \
  --name la-pluma \
  -p 3000:3000 \
  -v /path/to/data:/app/server/data \
  -v /path/to/config:/root/.config/maa \
  -v /path/to/maacore:/root/.local/share/maa \
  -e ADB_ADDRESS=127.0.0.1:5555 \
  mps233/la-pluma:latest
```

### 多架构支持

镜像支持以下架构：
- `linux/amd64` - x86_64 服务器、PC
- `linux/arm64` - ARM64 服务器、Apple Silicon

Docker 会自动选择适合你系统的架构。

### 构建时间

- 首次构建：约 10-15 分钟
- 后续构建：约 5-8 分钟（使用缓存）

### 故障排查

#### 构建失败

1. 检查 Actions 日志
2. 确认 Dockerfile 语法正确
3. 确认依赖可以正常安装

#### 推送失败

1. 检查 Docker Hub 凭证是否正确
2. 确认 Access Token 有写入权限
3. 确认仓库名称正确

#### 镜像拉取失败

1. 确认镜像已成功推送到 Docker Hub
2. 检查镜像名称和标签是否正确
3. 如果是私有仓库，需要先 `docker login`

### 高级配置

#### 修改镜像名称

编辑 `.github/workflows/docker-publish.yml`：

```yaml
env:
  IMAGE_NAME: YOUR_USERNAME/YOUR_REPO_NAME
```

#### 仅构建 amd64

如果不需要 arm64 支持，可以修改：

```yaml
platforms: linux/amd64
```

#### 添加构建参数

```yaml
build-args: |
  NODE_VERSION=20
  BUILD_DATE=${{ github.event.head_commit.timestamp }}
```

### 相关资源

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [Docker Hub](https://hub.docker.com/)
- [Docker Buildx](https://docs.docker.com/buildx/working-with-buildx/)
