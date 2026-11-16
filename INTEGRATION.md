# 主站接入

## 本地联调

在编辑器仓库构建并打包：

```powershell
pnpm run build
pnpm --filter @n0v0rland-md/core pack
pnpm --filter @n0v0rland-md/vue pack
```

在主站安装生成的 `core` 和 `vue` `.tgz` 文件。`vue` 包需要 Vue 3 peer dependency。

```powershell
pnpm add .\n0v0rland-md-core-0.1.0.tgz .\n0v0rland-md-vue-0.1.0.tgz
```

正式发布后直接安装：

```powershell
pnpm add @n0v0rland-md/core @n0v0rland-md/vue @n0v0rland-md/markdown-it-adapter
```

## Markdown-it 配置

主站已有 Markdown-it 实例可以直接注入：

```ts
import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
import { md } from './markdown'

const adapter = createMarkdownItAdapter({
  markdown: md,
})
```

需要完整默认语法时使用：

```ts
import { createMarkdownItPreset } from '@n0v0rland-md/preset'

const markdown = createMarkdownItPreset({
  siteOrigin: window.location.origin,
})
```

自定义插件应在创建 adapter 前注册到实例，编辑器会复用该实例的 block、inline 和 renderer 配置。

## 文章布局

```vue
<MarkdownEditor
  v-model="article"
  :adapter="articleAdapter"
  profile="article"
  :upload-images="uploadImages"
  :render-mermaid="renderMermaid"
  :highlight-code="highlightCode"
  @validity="articleValid = $event"
/>
```

通过 `class` 和 CSS 变量调整尺寸：

```css
.article-editor {
  --mde-min-height: 32rem;
  --mde-panel-padding: 1rem;
}
```

## 评论布局

评论可以直接组合输入区和工具栏，把工具栏放在输入框下方：

```vue
<MarkdownInput
  v-model="comment"
  :mode="mode"
  :adapter="adapter"
  profile="comment"
/>
<MarkdownToolbar
  :mode="mode"
  :tools="commentTools"
  @set-mode="mode = $event"
  @insert-syntax="insertSyntax"
/>
```

评论提交前使用 `sync()` 或 `v-model` 的 Markdown 字符串进行长度校验。上传、外链确认、Mermaid 和代码高亮都由主站通过回调注入。
