# LinkPark

简洁现代的云端书签管理器：Go + SQLite 服务端 + Chromium (MV3) 浏览器扩展。

- 右键菜单「添加到 LinkPark」保存当前页面或链接
- 点击工具栏图标弹出书签列表，支持搜索、tag 多选筛选、排序（默认 / 最近添加 / 访问频率 / 名称）、编辑、删除；自动记住上次的搜索、筛选和滚动位置
- 工具栏图标即同步状态指示器：角标数字为待同步条数，`!` 表示失败，`?` 表示未配置；悬停查看详情，右键打开设置或立即同步
- 全局「默认」顺序：所有书签共享一条手动顺序，任意 tag 筛选下都保持原来的相对位置；默认排序下可拖拽调整。新书签插到其最具体 tag（书签最少的那个）的末尾，无 tag 则放到最后；从「未分类」首次打上 tag 时同样归位
- tag 栏：未选择时只显示固定的 tag，其余收在「更多」；选中后只显示与当前结果有交集的关联 tag（计数为结果内数量）。没有任何 tag 的书签自动归入虚拟的「未分类」
- 标签管理（设置页）：拖拽排序、固定 / 取消固定、重命名（改为已有名称即合并）、删除（仅从书签上移除 tag）
- 暂存区：右键网页或工具栏图标「暂存当前窗口的所有标签页」，可整组打开、逐条收藏为书签或移除（首次使用需授权读取标签页）；每组默认以创建时间命名，可手动重命名，按组折叠/展开
- 一次性导入浏览器书签或导出的 HTML 书签文件：路径上每一级文件夹都成为一个 tag，默认顺序按原文件夹深度优先排列；书签栏上的文件夹自动固定，根目录下的散链接归入「未分类」。浏览器缓存或文件中的网站图标会一并保存（站点失效后仍能显示；本机之后访问过新图标则仍显示新的）。导入时可勾选任意文件夹直接放入暂存区（以文件夹名为组名，含子文件夹，超过 1000 条自动分组），这些链接不会导入为书签
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

- `POST /api/v1/ops` `{ops:[{op_id, entity: bookmark|tag|stash, type: create|update|delete, id, payload, client_ts}]}`：单事务原子提交，`op_id` 幂等
  - `bookmark` 的 payload：create `{url, title, favicon, tags, rank, created_at}`，update 各字段可选；`rank` 为客户端生成的分数索引（`[0-9A-Za-z]`，按字节序排序）
  - `tag` 以 tag 名作为 `id`（空字符串表示虚拟的「未分类」）：update `{name?, rank?, pinned?}`，`name` 为重命名，目标已存在则合并且保留目标的顺序与固定状态；delete 从所有书签上移除该 tag。受影响的书签会获得新版本号
  - `stash` 的 payload：create `{name, items:[{url, title}], created_at}`，update `{name?, items?}`
- `GET /api/v1/bookmarks?since=<version>`：增量拉取 `{version, full, bookmarks, stashes, tags}`（含删除墓碑），`since=0` 为全量；`tags` 总是完整的 tag 元数据 `[{name, rank, pinned}]`
- `POST /api/v1/import` `{bookmarks:[{url, title, tags, rank, created_at, favicon?}], tags:[{name, rank, pinned}]}`：批量导入，按 URL 去重；`favicon` 只接受图片 data URL，过长或非图片则丢弃；tag 元数据只在该 tag 尚无元数据时写入，不会覆盖用户的排序
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
