# LinkPark

简洁现代的云端书签管理器：Go + SQLite 服务端 + Chromium (MV3) 浏览器扩展。

- 右键菜单「添加到 LinkPark」保存当前页面或链接
- 点击工具栏图标弹出书签列表，支持搜索、tag 多选筛选、排序（最近添加 / 访问频率 / 名称）、编辑、删除；自动记住上次的搜索、筛选和滚动位置
- 工具栏图标即同步状态指示器：角标数字为待同步条数，`!` 表示失败，`?` 表示未配置；悬停查看详情，右键打开设置或立即同步
- 首次使用可一次性导入浏览器现有书签（文件夹名转换为 tag）
- 本地乐观更新 + outbox 队列，按批事务提交，失败自动指数退避重试
- 本地缓存 + 基于版本号的增量拉取，多设备以服务端为准

## 服务端部署

镜像由 GitHub Actions 自动构建并推送到 Docker Hub `<user>/linkpark`（amd64 / arm64）。
需要在仓库 Settings → Secrets and variables → Actions 中配置：

- Secret `DOCKERHUB_TOKEN`：Docker Hub 的 Access Token（Read & Write 权限）
- Variable `DOCKERHUB_USERNAME`：Docker Hub 用户名（未设置时使用 GitHub 仓库所有者名）

```bash
cp .env.example .env      # 修改 LINKPARK_TOKEN（>= 16 字符）和 LINKPARK_IMAGE_OWNER
docker compose pull       # 拉取 CI 构建的镜像
docker compose up -d      # 或者本地构建：docker compose up -d --build
```

数据保存在 `./data/linkpark.db`。建议在前面加一层 HTTPS 反向代理（Caddy / Nginx）。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LINKPARK_TOKEN` | 无（必填） | API 访问令牌 |
| `LINKPARK_ADDR` | `:8080` | 监听地址 |
| `LINKPARK_DB` | `/data/linkpark.db` | SQLite 文件路径 |

### 本地开发

```bash
cd server
LINKPARK_TOKEN=dev-token-0123456789 go run ./cmd/linkpark
go test ./...
```

### API

所有 `/api/*` 请求需带 `Authorization: Bearer <token>`。

- `POST /api/v1/ops` `{ops:[{op_id, type: create|update|delete, bookmark_id, payload, client_ts}]}`：单事务原子提交，`op_id` 幂等
- `GET /api/v1/bookmarks?since=<version>`：增量拉取（含删除墓碑），`since=0` 为全量
- `POST /api/v1/import` `{bookmarks:[{url, title, tags, created_at}]}`：批量导入，按 URL 去重
- `GET /api/v1/tags`：tag 及计数
- `GET /healthz`

## 浏览器扩展

```bash
cd extension
npm install
npm run dev      # 开发模式（HMR）
npm run build    # 产物在 extension/dist
```

在 `chrome://extensions` 打开「开发者模式」→「加载已解压的扩展程序」→ 选择 `extension/dist`。
也可以直接下载 GitHub Actions 产物 `linkpark-extension.zip`（打 `v*` tag 时会附加到 Release）。

安装后会自动打开引导页：填写服务端地址和 Token，然后选择是否导入浏览器书签。
