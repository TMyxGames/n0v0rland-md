# n0v0rland-md

基于 Markdown-it 的可视化 Markdown 编辑器。编辑器原文以 Markdown 字符串保存，Markdown-it 实例由宿主应用注入。

当前阶段已迁移：

- Markdown 源码块账本与 source range；
- DOM 选区与 Markdown offset 映射；
- 输入、列表、引用和结构前缀辅助函数；
- Markdown-it 外部适配器。
- Vue 可视化编辑器外壳；
- `article` / `comment` profile 的工具栏默认配置；
- 可选的站点 Markdown-it preset 和语义主题包；
- 可直接输入的 Vue/Vite Playground。

启动 Playground：

```powershell
pnpm install
pnpm dev
```

启动后访问 Vite 输出的本地 URL，页面会直接显示编辑器本体。当前 Playground 使用标准 Markdown-it 配置，主站接入时可传入自己的 `md`、`commentMd` 和自定义插件。

Playground 顶部可以切换文章/评论 profile 和明暗主题。两种 profile 只影响默认工具栏和布局语义，Playground 使用同一个包含全部语法的 Markdown-it 实例。

默认 preset：

```ts
import { createMarkdownItPreset } from '@n0v0rland-md/preset'
import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'

const markdown = createMarkdownItPreset({
  siteOrigin: 'https://example.com',
  configure: (markdown) => {
    markdown.use(myBlockPlugin)
    markdown.inline.ruler.before('text', 'myInlinePlugin', myInlinePlugin)
  },
})
const adapter = createMarkdownItAdapter({
  markdown,
  profile: 'article',
})
```

需要自定义语法时，宿主应用创建自己的 Markdown-it 实例并按原有顺序注册插件，再传入 adapter。这样编辑器不会覆盖用户的 renderer、inline rule 或 block rule：

```ts
const markdown = new MarkdownIt({ html: false, linkify: true })
markdown.use(myBlockPlugin)
markdown.inline.ruler.before('text', 'myInlinePlugin', myInlinePlugin)

const adapter = createMarkdownItAdapter({ markdown, profile: 'article' })
```

`@n0v0rland-md/preset` 仍然导出了 `createSiteMarkdown`，它会同时返回完整文章实例、评论实例和评论专用渲染回调，适合主站兼容旧有规则。

主题方面，独立项目提供 `@n0v0rland-md/theme/classic.css`，不依赖主站 `BDmarkdown.css`。主站可以直接覆盖 `--color-*`、`--md-font-*` 和 `--mde-*` 变量。

编辑器外壳可以直接使用，也可以拆开布局：

```vue
<MarkdownToolbar
  :mode="mode"
  :tools="tools"
  @set-mode="mode = $event"
  @insert-syntax="insertSyntax"
/>
<MarkdownInput
  v-model="value"
  :mode="mode"
  :adapter="adapter"
  profile="comment"
/>
```

因此评论区可以把工具栏放在输入框下方，文章编辑页可以把工具栏固定在输入区上方。

主站现有实现暂不修改，后续会继续迁移正式预览、图片上传、Mermaid 和业务工具栏。
