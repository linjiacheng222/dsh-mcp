# 发布到 DSH 插件市场

DSH 插件市场（`dshmarket`）**没有直接 publish API**。收录流程是：

1. 把插件包发布到公开 npm；
2. 公开 GitHub 仓库；
3. 向 [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
   提交一个 `data/plugins/<owner>__<repo>.yml` 文件（PR）；
4. 目录构建通过后，市场与 `plugin_market` / Discover 索引会自动收录。

## 当前状态

- npm 包名：`dsh-mcp-gateway`（registry 查询为 404，名字可用）。
- 包版本：`0.3.2`；已移除 `private`，许可证为 MIT，`publishConfig.access=public`。
- 仓库：`https://github.com/linjiacheng222/dsh-mcp`；`package.json` 已写入 `repository` / `homepage` / `bugs`。
- 市场条目草稿：[market/linjiacheng222__dsh-mcp.yml](../market/linjiacheng222__dsh-mcp.yml)。
- 初始提交已推送到 GitHub：`ac4e560`（`main`）。
- **待完成**：
  - npm 发布账号登录（当前 `pnpm whoami` 仍返回 unauthorized）；
  - npm publish；
  - awesome-dsh-plugin PR。

## 发布步骤

### 1. 安装依赖并跑测试

```sh
pnpm install
node --test test/*.test.js
```

### 2. 公开 npm 包

先在本机登录 npm（不要把 token 写进聊天或仓库）：

```sh
pnpm login
pnpm publish --access public --tag latest
```

发布前确认 tarball 内容：

```sh
pnpm pack
```

### 3. 公开 GitHub 仓库

在 GitHub 创建空仓库 `linjiacheng222/dsh-mcp`，然后：

```sh
git init
git add .
git commit -m "release: dsh-mcp-gateway 0.3.2"
git branch -M main
git remote add origin https://github.com/linjiacheng222/dsh-mcp.git
git push -u origin main
```

仓库公开后，在 `package.json` 补上（已提前写入）：

```json
"repository": { "type": "git", "url": "git+https://github.com/linjiacheng222/dsh-mcp.git" },
"homepage": "https://github.com/linjiacheng222/dsh-mcp#readme"
```

### 4. 提交市场条目

Fork `awesome-dsh-plugin`，把本仓库的
`market/linjiacheng222__dsh-mcp.yml` 复制为
`data/plugins/linjiacheng222__dsh-mcp.yml`：

```yaml
url: https://github.com/linjiacheng222/dsh-mcp
name: linjiacheng222/dsh-mcp
category: tools
description:
  en: Streamable HTTP MCP gateway for DeepSeek Harness that lets external agents read, message and wait on DSH sessions.
  zh: 将本机 DeepSeek Harness 暴露为 Streamable HTTP MCP 网关，让外部 Agent 读取、发送并等待 DSH 会话。
```

提交 PR。合并后目录 CI 会自动生成市场条目（通常一天内）。不要直接改 README。

### 5. 验证

- `https://www.npmjs.com/package/dsh-mcp-gateway` 可访问；
- 市场 Discover 能搜索到；
- 新 profile 中 `dsh plugin --profile <profile> add dsh-mcp-gateway` 可安装并加载。

## 安全提醒

- npm token、GitHub token 只在本机登录，不要提交到仓库或日志。
- 市场安装受 curated registry 限制，未收录的 npm 包不会出现在市场 UI。
- 发布前确认 `README.md`、`docs/`、`scripts/` 不含真实 Token、用户路径或本机凭据。
