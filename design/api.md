# API

基路径 `/api/v1`。除 `/healthz` 外，每个请求带：

```http
Authorization: Bearer <token>
```

请求和响应都是 JSON。错误体为 `{"error":"..."}`。

| 状态码 | 何时 |
| --- | --- |
| 401 | Token 缺失或不匹配 |
| 400 | JSON 无法解析，或查询参数不合法 |
| 413 | 请求体超过 16MB，或一批操作 / 导入条数超过上限 |
| 422 | 操作能解析，但某条违反字段约束。整批回滚 |
| 500 | 存储失败。响应不包含内部错误文本 |

只放行来源为 `chrome-extension://` 的跨域请求。

## `GET /healthz`

无需认证。

```json
{"status": "ok"}
```

## `POST /api/v1/ops`

单事务提交一批操作。`op_id` 幂等。一批最多 500 条，空数组返回 400。

```json
{
  "ops": [
    {
      "op_id": "uuid",
      "entity": "bookmark",
      "type": "create",
      "id": "uuid",
      "payload": {},
      "client_ts": 0
    }
  ]
}
```

`entity` 为 `bookmark`、`tag` 或 `stash`。`type` 为 `create`、`update` 或 `delete`。标签的 `id` 可以是空字符串，表示「未分类」；其他实体的 `id` 必填。

响应：

```json
{
  "version": 42,
  "results": [{ "op_id": "uuid", "status": "applied" }]
}
```

`status` 为 `applied`、`duplicate`、`ignored` 或 `replayed`，含义见 [同步](sync.md)。

### `bookmark`

创建 payload：

```json
{
  "url": "https://example.com",
  "title": "Example",
  "favicon": "",
  "tags": ["阅读"],
  "rank": "V",
  "created_at": 1710000000000
}
```

`url` 必填，最长 8192。`title` 最长 1024。`rank` 匹配 `^[0-9A-Za-z]{0,128}$`。`favicon` 按字节截断到 8192。标签规则见 [数据模型](model.md)。未删除书签中 URL 已存在时，本条为 `duplicate`。

更新 payload 的每个字段都可选，缺省表示不改：`url`、`title`、`favicon`、`tags`、`rank`。

删除不需要 payload。目标已删除或不存在时仍写下墓碑，结果为 `ignored`。

### `tag`

`id` 是标签名。没有 create。更新 payload：

```json
{"name": "新名字", "rank": "V", "pinned": true}
```

三个字段都可选。`name` 表示重命名；目标已存在则合并，并保留目标的 `rank` 与 `pinned`。「未分类」（空 `id`）不能改名。`delete` 从所有书签上移除该标签。

### `stash`

创建 payload：

```json
{
  "name": "10月12日 01:10",
  "items": [{ "url": "https://example.com", "title": "Example" }],
  "created_at": 1710000000000
}
```

`items` 最多 1000 条。`name` 最长 200 字符。更新 payload 为可选的 `name` 和 `items`。

## `GET /api/v1/bookmarks?since=<version>`

增量拉取。省略 `since` 或 `since=0` 为全量。

```json
{
  "version": 42,
  "full": false,
  "bookmarks": [],
  "stashes": [],
  "tags": [{ "name": "阅读", "rank": "V", "pinned": true }]
}
```

`bookmarks` 和 `stashes` 是版本号大于 `since` 的行。全量时不含墓碑；增量时包含 `deleted_at`。`tags` 始终是完整的标签元数据，不随 `since` 裁剪。

书签上的 `tags` 是名字数组。暂存的 `items` 在响应里是数组，不暴露数据库里的 JSON 文本。

## `POST /api/v1/import`

按 URL 去重的批量导入。书签和标签元数据各自最多 5000 条。

```json
{
  "bookmarks": [
    {
      "url": "https://example.com",
      "title": "Example",
      "tags": ["技术", "Go"],
      "rank": "V",
      "created_at": 1710000000000,
      "favicon": "data:image/png;base64,..."
    }
  ],
  "tags": [{ "name": "技术", "rank": "G", "pinned": true }]
}
```

`favicon` 只接受图片 data URL（png、jpeg、gif、webp、x-icon），最长 64KB；过长或不是图片则丢弃该字段，书签仍会导入。标签元数据仅在该名字还没有元数据时写入。

```json
{"imported": 10, "skipped": 2, "version": 43}
```

`skipped` 包含非法 URL、批内重复和库内已存在的地址。

## `GET /api/v1/tags`

返回仍被至少一条未删除书签使用的标签及计数，按数量降序、名字升序。不含「未分类」，也不含 `tag_meta` 里的顺序和固定状态。扩展的标签栏用拉取结果里的 `tags` 元数据，不用这个端点。

```json
{"tags": [{"name": "阅读", "count": 12}]}
```
