# 演示页部署

演示页入口位于 `examples/vue-vite/index.html`。仓库根目录的 README
是项目文档，不是演示页的构建入口。

## 首次启用

1. 将 `.github/workflows/deploy-pages.yml` 和 Vite 配置推送到 `main`。
2. 在仓库的 **Settings → Pages → Build and deployment → Source** 中选择
   **GitHub Actions**。
3. 保留已经填写的 **Custom domain**，确认域名检查通过后启用 HTTPS。
4. 在 **Actions** 中找到 **Deploy playground to GitHub Pages**。
   若首次推送发生在切换 Source 之前，可以使用 **Run workflow** 重新部署。
5. 等待 `build` 和 `deploy` 均成功，再访问自定义域名。

工作流安装 workspace 依赖、构建演示页，并只上传
`examples/vue-vite/dist`。不需要将构建产物提交到仓库，也不需要创建
`gh-pages` 分支。

## 路径

自定义域名使用根路径 `/`，这是当前工作流的默认值。
如果以后改为仓库子路径部署，可在
**Settings → Secrets and variables → Actions → Variables** 中添加：

```text
PAGES_BASE_PATH=/n0v0rland-md/
```

同时应将演示 Markdown 中以 `/` 开头的静态资源地址改成对应的部署路径；
当前演示配置以自定义域名根路径为目标。

## 本地验证

```powershell
pnpm install --frozen-lockfile
pnpm --filter @n0v0rland-md/playground build
pnpm --filter @n0v0rland-md/playground exec vite preview --host
```

若线上仍显示 README，先检查 Pages 的 Source 是否仍是
**Deploy from a branch**，以及最新工作流是否成功。若显示空白页面，
检查页面请求的 JS/CSS 路径是否与部署路径一致。
