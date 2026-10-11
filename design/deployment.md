# 部署与开发

服务是单个静态二进制，听一个端口，读写一个 SQLite 文件。扩展单独构建，安装到 Chromium。

## Docker Compose

镜像由 GitHub Actions 构建并推到 Docker Hub `<user>/linkpark`，同时提供 `linux/amd64` 和 `linux/arm64`。

仓库 Settings → Secrets and variables → Actions：

| 名称 | 种类 | 作用 |
| --- | --- | --- |
| `DOCKERHUB_TOKEN` | Secret | Docker Hub Access Token，需要 Read & Write |
| `DOCKERHUB_USERNAME` | Variable | Docker Hub 用户名。未设置时用 GitHub 仓库所有者名 |

```bash
cp .env.example .env
docker compose pull
docker compose up -d
```

要在本机编译镜像而不是拉取 CI 产物：`docker compose up -d --build`。

`.env` 里两项目前会被 Compose 读到：

| 变量 | 说明 |
| --- | --- |
| `LINKPARK_TOKEN` | 必填，至少 16 个字符。生成示例：`openssl rand -hex 24` |
| `LINKPARK_IMAGE_OWNER` | 镜像仓库所有者，默认 `linkpark`，对应镜像 `linkpark/linkpark:latest` |

容器内还有：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LINKPARK_ADDR` | `:8080` | 监听地址 |
| `LINKPARK_DB` | `/data/linkpark.db` | SQLite 路径。Compose 把宿主机 `./data` 挂到 `/data` |

Token 太短时进程直接退出。数据在 `./data/linkpark.db`（WAL 模式还会有 `-wal` / `-shm`）。把整个 `data` 目录当作备份单位。

Compose 把容器的 8080 映射到宿主机 8080。对浏览器提供服务时，在前面加 HTTPS 反向代理，扩展里的服务端地址填这个 HTTPS 源。

镜像基于 `gcr.io/distroless/static-debian12`。健康检查执行 `/linkpark healthcheck`。

推送到默认分支时镜像打上 `latest` 和短 SHA；推送 `v*` tag 时额外打上版本号和 `主.次` 版本。

## 本地运行服务

```bash
cd server
LINKPARK_TOKEN=dev-token-0123456789 go run ./cmd/linkpark
```

未设置 `LINKPARK_DB` 时，数据库在 `./data/linkpark.db`（相对于启动时的工作目录）。监听地址默认 `:8080`。

```bash
cd server
go test ./...
```

CI 在 `server/**` 变更时运行 `go vet` 和 `go test -race`。

## 本地运行扩展

```bash
cd extension
npm install
npm run dev        # Vite 开发模式
npm run typecheck
npm test
npm run build      # 产物在 extension/dist
```

开发者模式加载 `extension/dist`。需要 Node.js 22（与 CI 一致）。

CI 在 `extension/**` 变更时执行 `npm ci`、类型检查、测试和构建，并把 `dist` 打成 `linkpark-extension.zip` 上传为构建产物。推送 `v*` tag 时，同一个 zip 会附到 GitHub Release。

扩展里的服务端地址要能从浏览器访问到。本地调试时通常是 `http://127.0.0.1:8080`，Token 与服务端的 `LINKPARK_TOKEN` 相同。
