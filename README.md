# n0v0rland-md

基于 Markdown-it 的可视化 Markdown 编辑器。编辑器原文以 Markdown 字符串保存，Markdown-it 实例由宿主应用注入。

当前阶段已迁移：

- Markdown 源码块账本与 source range；
- DOM 选区与 Markdown offset 映射；
- 输入、列表、引用和结构前缀辅助函数；
- Markdown-it 外部适配器。
- Vue 可视化编辑器外壳；
- `article` / `comment` profile 的工具栏默认配置；
- 可直接输入的 Vue/Vite Playground。

启动 Playground：

```powershell
pnpm install
pnpm dev
```

启动后访问 Vite 输出的本地 URL，页面会直接显示编辑器本体。当前 Playground 使用标准 Markdown-it 配置，主站接入时可传入自己的 `md`、`commentMd` 和自定义插件。

主站现有实现暂不修改，后续会继续迁移主题、正式预览、图片上传、Mermaid 和业务工具栏。
