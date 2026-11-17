# 主站接入

## 主站配置注入演示

先在独立项目启动 `pnpm dev`，选择“配置 → 主站配置”，再点击“载入配置示例”。
“主站 BDmarkdown”会同时启用主站的正文样式和明暗主题变量；可独立切换回经典/纸笺对照。
进入正式预览时，使用同一个主站 Markdown-it 实例。

示例文件位于 `examples/vue-vite/src/hosts/homepage/`：

- `markdown.ts`：主站 `src/utils/markdown.ts` 快照，只移除了全局高亮 CSS 导入。
- `homepage.css`：主站 `BDmarkdown.css`、主题变量与高亮样式，限定在 `.mde-homepage`。
- `index.ts`：将实例传给 `createMarkdownItAdapter`，包装原有自定义行内规则以补充源码范围；不改写其 HTML 输出。
- `editor-bridge.css`：补齐语法提示变量，暂停编辑时会影响光标定位的悬停位移动效。
- `snapshot.json`：源文件校验摘要。

通过 `pnpm run sync:homepage` 更新快照。主站原文件和组件库默认配置均不受影响。
宿主真正接入时直接注入自己的实例与样式即可，不需要使用演示快照。

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

需要常规 Markdown 默认语法时使用（不含大声、小声、内心独白等站点语法）：

```ts
import { createMarkdownItPreset } from '@n0v0rland-md/preset'

const markdown = createMarkdownItPreset({
  siteOrigin: window.location.origin,
})
```

自定义插件应在创建 adapter 前注册到实例，编辑器会复用该实例的 block、inline 和 renderer 配置。

如果自定义语法需要可视化编辑，还需要把它注册到 adapter 的 `syntax`：

```ts
const adapter = createMarkdownItAdapter({
  markdown: md,
  syntax: [{
    name: 'highlight-box',
    scope: 'inline',
    className: 'bd-markdown-highlight-box',
    editorClassName: 'markdown-editor-highlight-box',
    getInlineParts(raw) {
      const match = raw.match(/^(==)(.+)(==)$/)
      return match ? { open: match[1], body: match[2], close: match[3] } : undefined
    },
    toolbar: {
      label: '重点',
      before: '==',
      after: '==',
      profiles: ['article'],
    },
  }],
})
```

定义只负责编辑器协议，解析仍由 Markdown-it 插件负责。插件 token 应在
`meta` 中提供 `syntaxKind`、`sourceFrom` 和 `sourceTo`。缺少可靠范围的语法会
进入源码回退，以保证未知结构不被静默重写。

行内 `sourceFrom/sourceTo` 相对于当前 `parseInline` 输入。也可由定义的
`getSourceRange(token, context)` 返回 `{ from, to }`，两者使用相同的局部坐标；
`context.source` 是当前行内源码，`tokenFrom` 为当前消费位置，`blockFrom` 为该输入的文档起点。
优先使用 token.meta 的范围。钩子应返回包含完整开闭标记的范围；无效范围不参与可视化转换。

自定义行内语法默认 `contentMode: 'text'`，正文保持纯文本。
若插件本身会解析嵌套 Markdown，可同时设置 `contentMode: 'markdown'`，
让编辑视图对其正文使用同一实例与全文上下文解析。该配置不会替插件增加嵌套解析能力，
宿主 renderer 也应按相同语义渲染正文。

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

`maxLength` 用于校验，不截断内容。完整 `MarkdownEditor` 会在正文或上限变化时发出
`validity`；宿主应据此控制提交按钮。独立组合 `MarkdownInput` 时，在宿主按导出的
Markdown 长度校验即可。`sync()` 可以返回空字符串，清空内容后不要用 `||` 回退到旧值。

`highlightCode`、`renderMermaid` 和 `onLinkClick` 同时传给编辑视图与正式预览。
预览先使用 adapter 的 HTML，再对标准代码围栏调用注入的高亮或 Mermaid 回调；
宿主已经提供的其他 HTML 结构保持由 adapter 管理。切换内容或退出预览后，迟到的图表结果不会写入新预览。
上传失败会显示可重试错误，上传中禁用重复选择；上传期间禁用编辑器会使该次迟到结果失效。

## 表格操作接入

完整 `MarkdownEditor` 的表格工具会打开行列选择器，无需额外接线。
如果宿主将 `MarkdownToolbar` 和 `MarkdownInput` 分开组合，需连接
`@insert-table="insertTable"`，并给输入区设置 `ref="input"`：

```ts
function insertTable(rows: number, columns: number) {
  input.value?.insertTable(rows, columns)
}
```

行列工具和当前表格源码面板由输入区管理，不需要宿主维护 HTML 或第二份表格数据。
原文仍通过 `v-model` 输出 Markdown。单元格编辑、行列增删、对齐修改都经过同一份
源码历史；只在结构变更时规范化当前表格，不会重写相邻正文。

宿主需启用 Markdown-it 的 table 规则。表格属于块级工具，受限评论配置可以继续
从工具栏移除它。复杂表格仍保留为源码，不转换成会丢失信息的简化结构。
