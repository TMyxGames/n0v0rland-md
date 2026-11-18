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
# 输入状态与样式定制

## 语法、预览与编辑效果

Markdown-it 决定语法语义。编辑器复用 block/inline token 与自定义 renderer 的
语义外壳，只附加源码范围、语法边界和操作元素；不能可靠映射的行内内容保留为
原文，不再通过正则自行激活第二套语法。

`@n0v0rland-md/markdown-it-adapter` 提供可选的 `inlineSyntaxPlugin` 和
`bracketSyntaxParts`，可以由同一份定义配置识别规则、子 token、正式预览和编辑：

```ts
import { bracketSyntaxParts, inlineSyntaxPlugin, createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'

const syntax = [{
  name: 'aside',
  scope: 'inline' as const,
  className: 'my-aside',
  contentMode: 'markdown' as const,
  getInlineParts: bracketSyntaxParts,
  toolbar: { label: '旁白', before: '::aside[', after: ']' },
}]
markdown.use(inlineSyntaxPlugin, syntax)
const adapter = createMarkdownItAdapter({ markdown, syntax })
```

`::aside[**内容**]` 会同时在编辑和预览中使用加粗。
`contentMode: 'text'` 则保持内部源码为纯文本。新插件将 contentMode 写入 token
meta，编辑态优先遵守解析器声明；旧插件未提供时遵守适配定义，默认纯文本。
括号支持嵌套、反斜杠转义及代码跨度；空内容、未闭合结构和跨行结构不生效。
嵌套表达式最多解析 32 层，继续嵌套保留原文。

默认 preset 不安装 loud、whisper、inner。演示页通过配置注入；主站配置以及
legacy `createSiteMarkdown()` 中，这三个表达式已升级为支持内部行内 Markdown，
`raw` 保持纯文本。历史内容中未转义的 `*` 等符号现在可能生效；需要原样显示时，
使用 raw 或 Markdown 转义。评论继续遵守评论解析器的语法限制。

`MarkdownInput`、`MarkdownVisualEditor` 和默认 `MarkdownEditor` 支持
`editingEffects`：

| 值 | 编辑态行为 |
| --- | --- |
| `stable`（默认） | 当前选区所在块暂停动画和 hover 位移，其他块保留主题效果 |
| `theme` | 跟随主题，允许编辑区域的动态效果 |
| `none` | 禁用编辑态动画与 hover 位移 |

隐藏文本在光标进入时清晰，离开后恢复主题模糊。减弱动效偏好始终优先。
经典主题本身不包含主站的标题位移或独白颤抖；编辑策略不会凭空增加主题效果。
粗斜体由标准 em/strong 嵌套表达，不作为特殊的三星号语法实现；宿主字体需要
提供斜体字形或允许 `font-synthesis: style`，否则 computed font-style 为 italic
也可能没有可见倾斜。演示页已允许字体合成。

主站集成快照通过 `pnpm run sync:homepage` 生成，使用
`node scripts/sync-homepage-example.mjs --check` 验证是否与相邻主站源码一致。
快照不作为另一套手工维护的解析规则。

## 输入状态与样式定制

`MarkdownInput` 和默认输入槽中的 `MarkdownEditor` 支持 `focus`、`blur`、
`state-change` 事件。三个事件均传入导出的 `MarkdownInputState` 类型：

```ts
interface MarkdownInputState {
  value: string
  length: number       // 原始 Markdown 的 UTF-16 长度，与 value.length 相同
  hasContent: boolean  // 空格和换行也属于内容
  empty: boolean
  focused: boolean
  mode: 'visual' | 'source' | 'preview'
  disabled: boolean
  maxLength: number
  overLimit: boolean
}
```

`state-change` 首次挂载时发出，随后在正文、焦点、模式、禁用状态或长度上限
变化时发出；`focus`、`blur` 只在输入区域的焦点状态实际变化时发出。
编辑器内部控件之间转移焦点不会重复触发。预览链接的焦点不算输入焦点。
替换 `MarkdownEditor` 的整个 input 插槽时，需要由自定义输入组件自行提供状态事件。
状态中的内容是已经提交到 `v-model` 的 Markdown；输入法组合文本会在组合结束后更新。

```vue
<MarkdownInput
  v-model="markdown"
  mode="visual"
  :adapter="adapter"
  @state-change="state = $event"
/>
<span :class="{ 'is-floating': state.focused || state.hasContent }">评论内容</span>
```

输入面板也提供 `.is-focused`、`.has-content`、`.is-empty` 类，以及
`data-focused`、`data-empty`、`data-length` 属性，方便直接使用 CSS。
浮动标签由宿主布局提供；编辑器的原生 placeholder 仍只在空内容时显示。

语法边界字体默认继承正文，颜色默认使用淡绿色；主题可以覆盖：

```css
.my-editor {
  --mde-syntax-font-family: 'Maple Mono', inherit;
  --mde-syntax-color: #568767;
}
```
