# MarkdownSyntaxDefinition 配置协议 v1

Markdown-it 决定语法是否成立，通过同一个实例解析和正式预览。registry 为编辑器提供源码映射、工具栏和交互策略。推荐显式声明 `{ version: MARKDOWN_SYNTAX_VERSION, definitions }`。直接传定义数组仍按 v1 处理。注册时会校验版本、字段值和重复名称或别名。配置代码应由宿主应用提供。

```ts
import { MARKDOWN_SYNTAX_VERSION, type MarkdownSyntaxDefinition } from '@n0v0rland-md/core'
import { bracketSyntaxParts, createMarkdownItAdapter, inlineSyntaxPlugin } from '@n0v0rland-md/markdown-it-adapter'
import MarkdownIt from 'markdown-it'

const definitions: MarkdownSyntaxDefinition[] = [{
  name: 'aside',
  aliases: ['旁注'],
  scope: 'inline',
  className: 'demo-aside',
  getInlineParts: bracketSyntaxParts,
  contentMode: 'markdown',
  editing: { reveal: 'near', effect: 'pause-inside' },
  toolbar: { label: '旁注', before: '::aside[', after: ']' },
}]
const markdown = new MarkdownIt().use(inlineSyntaxPlugin, definitions)
const adapter = createMarkdownItAdapter({
  markdown,
  syntax: { version: MARKDOWN_SYNTAX_VERSION, definitions },
})
```

| 字段 | 契约 |
| --- | --- |
| `name` / `aliases` | 不区分大小写，可含 Unicode 字母和数字。`token.meta.syntaxKind` 可使用名称或别名。 |
| `scope` | `inline` 对应单个行内语法 token。`block` 对应具有 `map` 的顶层块起始 token。 |
| `contentMode` | `text` 是默认值。`markdown` 允许解析正文中的行内嵌套语法。 |
| `className` / `editorClassName` | `className` 供预览 renderer 和编辑态共用。`editorClassName` 额外作用于编辑态。 |
| `editorFallback` | `auto` 按映射能力决定。`source` 总是直接编辑原文。 |
| `getInlineParts(raw)` | 返回 `open`、`body`、`close`，三者连接后必须逐字符等于原文。 |
| `getBlockParts(raw)` | 返回相对块原文的 `bodyFrom`、`bodyTo` 和可选的 `tag`。可用容器为 `div`、`section`、`aside`、`blockquote`、`figure`、`pre`。正文必须在源文件中连续。 |
| `getSourceRange(token, context)` | 当 token 没有 offset 时提供范围。`context.source` 是相应的解析输入，`blockFrom` 是绝对块开始位置，`tokenFrom` 是当前行内解析位置。 |
| `editing.reveal` | `always`、`near`、`inside`、`never`。`near` 在光标靠近任一边界时成对显示。拖拽或键盘扩选时保持已有边界布局。 |
| `editing.boundary` | `visible` 固定显示，`hidden` 固定隐藏，`structure` 将边界移出可编辑光标位置。全局仅结构模式优先，其次为 `hidden` 和 `never`。 |
| `editing.effect` | `theme` 与 `none` 由宿主控制，`pause-inside` 仅在光标位于正文时暂停，`pause-hover` 仅悬停时暂停，`pause-active` 在悬停、光标进入或选区相交时暂停。可通过 `.is-effect-paused` 编写样式。 |

所有 offset 是 UTF-16 半开区间 `[from, to)`。行内范围相对于当前 Markdown-it `parseInline` 的输入，嵌套子 token 相对于父语法正文。块范围相对于完整文档，必须与块的源码范围一致，末尾分隔换行独立保留。插件可以同时写入 `meta.sourceFrom` 与 `meta.sourceTo`。显式 offset 无效时会回退为源码。解析未知 token、hook 失败或映射冲突时，保留原始源码供编辑。

正式预览使用 Markdown-it 的 `renderer.rules`。上例的 `inlineSyntaxPlugin` 提供默认 renderer，宿主可覆盖该规则，或通过 `createMarkdownItAdapter({ render })` 接入全站渲染逻辑。预览 renderer 与 `getInlineParts` 或 `getBlockParts` 各自负责展示和源码映射。

`syntax-state-change` 提供当前语法实例的快照。`id` 只在同一文档快照内用于关联，`parentId` 与 `depth` 表示嵌套。`selection` 区分折叠或分离、内部选区、完整选中和跨越边界。`hovered` 与 `caretInside` 分别报告鼠标和光标，`effectPaused` 与 `boundaryVisible` 表示实际状态。通过组件 `syntaxEditing` 可以按语法名覆盖默认策略。
