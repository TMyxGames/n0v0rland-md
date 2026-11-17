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

演示页的“配置”可以切换到“主站配置”，同时自动选择“主站 BDmarkdown”主题。
切换配置、主题不会改写当前 Markdown；点击“载入配置示例”才替换演示内容。
主题可以独立切换，用于对照同一份正文在不同样式下的效果。

主站注入示例位于 `examples/vue-vite/src/hosts/homepage/`，不进入组件库的运行时依赖。
它包含主站 renderer 快照、隔离到 `.mde-homepage` 的正文 CSS/主题变量和内嵌图标，
以及只补充编辑范围元数据的适配层。脚注内复杂块、未知容器等仍保留源码回退。
同步主站最新配置（默认读取相邻的 `my-homepage/`，也可传入其他路径）：

```powershell
pnpm run sync:homepage
pnpm run sync:homepage -- "D:/path/to/my-homepage"
```

同步后应重新运行测试；该命令只读取主站、更新演示快照，不修改主站文件。
快照生成后，独立项目无需保留主站目录即可运行。

Playground 顶部提供格式工具、源码/预览切换和圆形主题按钮。页头使用毛玻璃背景并固定在顶部，移动端格式工具可以横向滚动。

默认 `createMarkdownItPreset` 只包含常规 Markdown 及 mark、ins、emoji、任务列表、脚注扩展，不包含站点表达语法、色板或首字下沉等专属规则。旧的 `createSiteMarkdown` 保留站点规则，供现有站点兼容接入。

演示页的大声、小声和内心独白是显式注入的可选扩展示例，见
`examples/vue-vite/src/expression-syntax.ts`。该文件同时提供 Markdown-it 插件
`expressionPlugin` 和编辑器配置 `expressionSyntax`：

```ts
const markdown = createMarkdownItPreset({
  configure(md) { md.use(expressionPlugin) },
})
const adapter = createMarkdownItAdapter({ markdown, syntax: expressionSyntax })
```

对应样式放在 `examples/vue-vite/src/playground.css` 的 `.demo-expression-*`
类中，编辑态和预览态共用。移除插件及 `syntax` 配置后，三种写法保持普通文本。

### 演示页主题注入

页头的主题选择与明暗切换相互独立，提供「经典」与「纸笺」。
`examples/vue-vite/src/theme-config.ts` 管理主题配置：

```ts
import notebookCss from './themes/notebook.css?inline'

const theme = {
  id: 'notebook',
  label: '纸笺',
  className: 'mde-notebook',
  css: notebookCss,
}
```

演示页给根元素添加所选主题的 `className`，把 `css` 注入页面拥有的
`<style data-mde-playground-theme>`；切换时替换样式，卸载时移除。选择经典主题
会清空注入样式。CSS 来自应用内可信资产，使用主题类名限定作用域，
不从 Markdown 正文加载。这里使用 Vite 的 `?inline` 导入方式。

「纸笺」基于经典主题覆盖暖纸色、衬线字体、标题、引用、代码和表格样式，
暗色通过 `[data-color-mode="dark"]` 覆盖变量。同一个 `.bd-markdown-theme`
选择器作用于编辑区和正式预览，不需要修改解析器、编辑器内核或保存内容。
新增主题时添加一份 CSS 和一条主题配置即可。

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

如果语法还需要进入可视化编辑器，应同时注册编辑器协议。Markdown-it
插件负责解析和正式预览，`syntax` 定义负责语义类名、工具栏插入和 source
range 校验：

```ts
const syntax = [{
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
    profiles: ['article', 'comment'],
  },
  getSourceRange(token, context) {
    const meta = token as { meta?: { sourceFrom?: number; sourceTo?: number } }
    const from = meta.meta?.sourceFrom
    const to = meta.meta?.sourceTo
    return Number.isInteger(from) && Number.isInteger(to) && to! > from!
      ? { from: from!, to: to! }
      : undefined
  },
}]

const adapter = createMarkdownItAdapter({ markdown, syntax })
```

自定义 inline rule 需要把范围写入 token：

```ts
token.meta = {
  sourceFrom: state.pos,
  sourceTo: state.pos + match[0].length,
  syntaxKind: 'highlight-box',
}
```

如果只有 Markdown-it renderer 而没有 `syntaxKind` 和可靠范围，正式预览仍然
可以显示，但可视化编辑器会将该内容保留为源码块，避免光标映射或回写时丢失原文。

需要自定义语法时，宿主应用创建自己的 Markdown-it 实例并按原有顺序注册插件，再传入 adapter。这样编辑器不会覆盖用户的 renderer、inline rule 或 block rule：

```ts
const markdown = new MarkdownIt({ html: false, linkify: true })
markdown.use(myBlockPlugin)
markdown.inline.ruler.before('text', 'myInlinePlugin', myInlinePlugin)

const adapter = createMarkdownItAdapter({ markdown, profile: 'article' })
```

`@n0v0rland-md/preset` 仍然导出了 `createSiteMarkdown`，它会同时返回完整文章实例、评论实例、评论专用渲染回调以及传入的 `syntax` 定义，适合主站兼容旧有规则。

主题方面，独立项目提供 `@n0v0rland-md/theme/classic.css`，不依赖主站 `BDmarkdown.css`。主站可以直接覆盖 `--color-*`、`--md-font-*` 和 `--mde-*` 变量。

编辑器外壳可以直接使用，也可以拆开布局：

```vue
<MarkdownToolbar
  :mode="mode"
  :tools="tools"
  @set-mode="mode = $event"
  @insert-syntax="insertSyntax"
  @insert-table="insertTable"
/>
<MarkdownInput
  ref="input"
  v-model="value"
  :mode="mode"
  :adapter="adapter"
  profile="comment"
/>
```

因此评论区可以把工具栏放在输入框下方，文章编辑页可以把工具栏固定在输入区上方。

### 结构化表格

在可视化模式点击「表格」，选择行列数（行数包含表头），光标会进入新表格的
第一个单元格。手动输入或粘贴的规则 Markdown 表格使用相同的交互视图。
表格仍只保存 Markdown；操作按钮不属于正文 DOM，也不参与复制和导出。

- 在独立段落输入 `| 表头1 | 表头2 |`，闭合末尾的 `|` 后自动补齐分隔行和一行空白数据，生成两行两列表格并进入首个数据单元格。列数跟随表头；未闭合、转义、空表头和代码内文本不触发。打开已有 Markdown 不自动改写。
- 悬停表头顶部边缘约 140ms，在当前列上方显示图标栏：左／中／右对齐、左／右加列、删除列。
- 悬停表格右侧边缘，在当前行右侧显示竖向图标栏：上／下加行、删除行。鼠标移入工具栏后保持显示，离开后收起。
- 触屏点选单元格显示行列工具；键盘在单元格内按 `Alt+↑`／`Alt+→` 聚焦列／行工具，`Esc` 收起。
- 支持在当前行上下添加、删除当前数据行，在当前列左右添加、删除当前列，以及列对齐。
- 表头不能单独删除，至少保留一列；可以选择整张表格删除，或在全文源码模式移除它。
- `Tab` / `Shift+Tab` 切换单元格；末尾 `Tab` 自动新增一行。
- `Enter` 进入下一行同列，末行会新增一行；`Shift+Enter` 回到普通段落。
- 单元格边界上的退格、删除和左右移动不会进入隐藏的表格分隔符。
- 全表内容（包括表头）为空时，在第一个表头开头按 `Backspace` 删除整个表格；选中整张可见表格再删除或剪切，也会一并移除隐藏的分隔符。局部选区只修改单元格内容，跨正文与表格的删除会扩大到完整表格，避免留下残缺结构。
- 在表格下方退格时先经过普通空行，再进入末尾单元格，不会因相邻而删除整表。左右方向键跨单元格移动，上下方向键可以移出表格；末尾表格后提供不改变源码的空白输入位置，实际输入后才补入换行。
- 在空单元格开头退格会移到前一个单元格末尾；整条数据行清空后，在第一个单元格继续退格会删除该行，并移到上一行末尾。整表删除、行删除和表头自动补全都支持撤销和重做。
- 单元格内支持行内格式；粘贴的换行变为空格，字面竖线自动转义为 `\\|`。
- `Alt+Enter` 编辑当前表格源码；应用前校验结构，取消不会改写正文。全文源码模式仍允许编辑任意结构。
- 行列操作、列对齐和源码应用都使用源码事务，可以撤销、重做。结构调整只规范化当前表格块，普通单元格输入只修改对应源码范围。
- 不规则表格进入源码回退，不静默删除多余单元格。暂不支持合并单元格、跨行跨列和单元格内块级内容。

拆分布局时接收 `MarkdownToolbar` 的 `insert-table` 事件：

```ts
function insertTable(rows: number, columns: number) {
  input.value?.insertTable(rows, columns)
}
```

完整 `MarkdownEditor` 已自动连接，组件 ref 也提供 `insertTable(rows?, columns?)`。
表格功能依赖宿主 Markdown-it 实例启用 table 规则。
编辑态复用宿主渲染器输出的表格、行列及包裹层的 class、style 等展示属性，
与正式预览共用主题 CSS；不额外强制固定列宽、最小单元格宽度或站点专属容器。
改变行列拓扑的渲染器会进入源码回退。工具栏图标随 Vue 包提供，格式按钮仍可通过 `tool` 插槽替换。

可视化编辑器还提供 `editingStyle` 配置：

- `always`：始终显示 Markdown 语法节点；
- `blur-hidden`：光标靠近语法两侧时显示节点，移开后隐藏（默认）；
- `structure`：语法生效后只保留渲染结构，节点始终隐藏。清空行内语法内容会同步移除空结构；标题、列表、任务列表、引用和提示块的结构前缀仍可通过光标和退格编辑。

仅结构模式中的光标不会进入隐藏分隔符；左右移动会跨过整个边界，图片和脚注视为整体。
粗体、斜体、代码等包裹型语法删空时移除两侧标记，空列表项（包含任务项）和空引用则保留，
再按一次退格才移除前缀；以上删除操作均可撤销。
编辑区对单独的连续星号保留原文，便于从 `****` 的中间继续输入粗体内容；
正式预览仍遵循宿主 Markdown-it 的分隔线规则。

例如：

```vue
<MarkdownEditor v-model="value" :adapter="adapter" editing-style="structure" />
```

工具栏的 `heading` 按钮打开 H1–H6 菜单（支持方向键、Enter、Esc），
也可在 `tools` 中单独使用 `h1` 到 `h6`。选择级别会修改当前行的标题前缀。
`link` 将选中文字包成 `[文字](https://example.com)`；没有选区时插入链接占位文字。
宿主仍可覆盖 `tool` 插槽和语法配置。演示内容位于 `examples/vue-vite/src/demo.md`。

可视化模式支持 ATX 与 Setext 标题、链接标题、自动链接，以及转义字符和 HTML 实体的显示映射。
宿主禁用的 Markdown-it 规则不会由编辑器的语法识别重新启用。格式文本内按 Enter 会在换行两侧
闭合并重新开启格式；在格式正文起止位置换行则保持空侧为普通空行，列表与引用继续补齐当前行前缀。
独立源码空行有对应的可编辑位置，保留原始 Markdown 中的间隔。

解析视图现在保存 Markdown-it 的原始块 token 和全文 `env`，引用式链接与嵌套标签
可以共用全文定义。可视化上下导航根据实际文字行选择位置，跳过源码分隔符和隐藏围栏；
自动折行仍按视觉行移动。源码、预览和导航本身均不重新序列化正文。

编辑态会尝试复用宿主 renderer 的行内语义外壳，以及块根节点上的 class、style 等展示属性。
renderer 必须保留可识别的单一语义根和正文位置；不兼容的结构继续使用标准编辑 DOM，
并以正式预览为发布效果依据。这不等于任意 renderer 都可以直接作为 contenteditable。

验证：

```powershell
pnpm run verify
pnpm run verify:browser
pnpm run verify:table-browser
```

`verify` 包含源码账本、语法配置和表格模型测试。`verify:browser` 依次运行光标映射、
换行导航、语法布局、组件集成和表格回归；也可分别运行 `verify:caret-browser`、
`verify:navigation-browser`、`verify:syntax-layout-browser` 和 `verify:integration-browser`。
集成测试覆盖模式切换保真、超长输入校验、撤销重做、外部草稿恢复、组合输入事件、
禁用状态、实际鼠标落点，以及 Mermaid 和上传的错误与异步竞态。
组合输入的自动化用例使用浏览器事件模拟；真实输入法、浏览器扩展及其他浏览器仍需宿主应用验收。

浏览器脚本默认启动自己的临时 Vite 服务并在结束时关闭。Windows 默认使用本机
Edge；其他平台使用 Playwright Chromium，可通过 `MDE_BROWSER_CHANNEL` 指定。
光标、布局和表格脚本可通过 `MDE_TEST_URL` 使用已有服务；组件集成脚本对应
`MDE_INTEGRATION_TEST_URL`，并支持 `MDE_TEST_FILTER` 正则筛选。桌面和移动截图输出到 `.artifacts/`。

高亮、Mermaid 和上传等浏览器能力由宿主注入，编辑器包不绑定具体站点服务：

```vue
<MarkdownInput
  v-model="value"
  :mode="mode"
  :adapter="adapter"
  :highlight-code="highlightCode"
  :render-mermaid="renderMermaid"
/>
```

主站现有实现暂不修改，后续会继续迁移正式预览、图片上传、Mermaid 和业务工具栏。

Vue 包已经提供独立构建产物，开发联调可以使用本地链接或打包文件：

```powershell
pnpm --filter @n0v0rland-md/vue pack
pnpm add ../n0v0rland-md-vue-0.1.0.tgz
```

宿主只需要安装 Vue peer dependency，并按需安装 `@n0v0rland-md/core`、Markdown-it adapter、preset 和 theme。
