# 发布与兼容性

`core`、`markdown-it-adapter`、`preset`、`theme`、`vue` 使用同一版本。Vue 和 Markdown-it 分别由宿主满足 Vue 包和适配器的 peer 依赖。预设包提供其渲染需要的实际依赖。

1. 更新五个包的版本并将 `CHANGELOG.md` 的变更归入同一个版本。
2. 运行 `pnpm run verify`、`pnpm run verify:packages` 和 `pnpm run verify:integration-browser`。
3. 确认 npm 账号持有对应 scope，按 `core`、`markdown-it-adapter`、`preset`、`theme`、`vue` 发布同一提交的包。
4. 从该提交创建 `v<version>` 标签。Pages workflow 会构建标签中的 workspace 包，演示页消费其公开入口和 CSS 产物。

配置协议版本与 npm 版本独立。新的可选字段延续 v1，破坏配置含义或源码坐标规则时才提高协议版本。公共 API 以包 `exports`、导出类型及文档为准。兼容扩展优先新增字段，破坏性修改须在 changelog 中写明迁移方式。宿主样式推荐使用公开类与变量，编辑器内部 DOM 细节可能变化。

样式按以下顺序加载，使用整包 `@n0v0rland-md/vue/style.css` 可以一次加载所有编辑器样式。

| 样式层 | 公开入口 |
| --- | --- |
| 布局结构 | `@n0v0rland-md/vue/editor.css` |
| 工具栏 | `@n0v0rland-md/vue/toolbar.css` |
| 光标、源码边界和结构编辑 | `@n0v0rland-md/vue/visual.css`、`@n0v0rland-md/vue/table.css` |
| 默认语义规则与变量 | `@n0v0rland-md/theme`、`@n0v0rland-md/theme/classic.css` |
| 宿主覆盖 | 例如 BDmarkdown.css 和宿主传入的语法配置 |
