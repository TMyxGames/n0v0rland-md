# n0v0rland-md

一个基于 **Markdown-it + Vue 3** 的可视化 Markdown 编辑器。它保留 Markdown 字符串作为唯一数据源，编辑区域使用带源码 offset 的语义 DOM，因此可以在“所见即所得”和手动 Markdown 之间自由切换。

## 项目特点

- **Markdown-it 是唯一解析内核**：编辑器、正式预览和宿主页面都使用同一份 Markdown-it 配置。
- **保留手动输入体验**：直接输入 `**粗体**`、`***粗斜体***`、`||隐藏文本||` 等结构时，编辑器不会把源码转换成另一套富文本格式。
- **直接在渲染结果上编辑**：标题、列表、引用、表格、代码块和图片都使用语义 DOM 呈现，光标位置通过 Markdown 源码 offset 映射。
- **复杂结构安全回退**：表格、脚注、HTML 或未知插件无法可靠映射时保留源码，避免静默丢失内容。
- **编辑、源码、预览三种模式**：源码模式适合检查精确 Markdown，正式预览使用宿主传入的 renderer。
- **可注入自定义语法和主题**：语法解析、HTML class、编辑行为和 CSS 都由配置控制。
- **文章和评论共用内核**：通过 `profile` 和语法工具栏配置控制功能范围。

## 默认语法速览

项目默认 preset 提供常用 Markdown-it 扩展。可以直接编辑下面的内容观察效果。

### 行内格式

**粗体**、*斜体*、***粗斜体***、~~删除线~~、++下划线++、==高亮==、`行内代码`，以及嵌套格式：**重点中的 *补充说明***。

需要显示语法本身时可以使用反斜杠：\*这段文字不会变成斜体\*。

表情也由默认 preset 提供：:sparkles: :heart: :rocket:

### 标题、列表与任务

#### 无序列表

- 第一项
- 第二项
  - 嵌套项目
  - 可以继续编辑

#### 有序列表

1. 准备 Markdown 源文
2. 传入 Markdown-it 实例
3. 将编辑器挂载到 Vue 页面

#### 任务列表

- [x] 切换可视化模式
- [x] 检查正式预览
- [ ] 接入自己的语法配置

### 引用与分隔线

> 好的编辑器应该让格式服务于表达。
>
> 引用内部也可以使用 **强调**、*斜体* 和 `代码`。

---

### 表格

| 能力 | 说明 | 结果 |
| :--- | :---: | ---: |
| 原文保真 | 未修改块尽量保持原文 | 可回退 |
| 语义编辑 | 使用标题、列表和表格 DOM | 可视化 |
| 配置注入 | 复用宿主 Markdown-it | 可扩展 |

### 代码块

```ts
import MarkdownIt from 'markdown-it'
import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
import { MarkdownInput } from '@n0v0rland-md/vue'

const markdown = new MarkdownIt({ typographer: true })
const adapter = createMarkdownItAdapter({ markdown, profile: 'article' })
```

### 图片、链接与脚注

项目文档位于 [Markdown-it 官方仓库](https://github.com/markdown-it/markdown-it)。图片使用标准 Markdown 语法：

![编辑器示意图](./editor-overview.svg "Markdown 原文、编辑与预览")

脚注由默认 preset 提供[^default-footnote]，目录和复杂结构仍会保留原始 Markdown。

[^default-footnote]: Markdown 字符串是编辑器的唯一持久化数据。

## 安装

项目由多个可独立发布的包组成。通常只需要安装 Vue 组件、Markdown-it 适配器和一个 Markdown-it 实例：

```bash
pnpm add @n0v0rland-md/vue @n0v0rland-md/markdown-it-adapter markdown-it
```

如果希望使用项目提供的常见插件和默认 renderer，可以额外安装 preset：

```bash
pnpm add @n0v0rland-md/preset
```

Vue 项目中引入编辑器样式：

```ts
import '@n0v0rland-md/vue/style.css'
```

## 最小引用示例

```vue
<script setup lang="ts">
import { ref } from 'vue'
import MarkdownIt from 'markdown-it'
import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
import { MarkdownInput } from '@n0v0rland-md/vue'
import '@n0v0rland-md/vue/style.css'

const value = ref('# 我的文章\n\n可以直接输入 **Markdown**。')
const markdown = new MarkdownIt({ typographer: true })
const adapter = createMarkdownItAdapter({ markdown, profile: 'article' })
</script>

<template>
  <MarkdownInput v-model="value" mode="visual" :adapter="adapter" />
</template>
```

## 产物目录

构建后每个包只发布自己的 `dist` 目录：

| 目录 | 内容 |
| --- | --- |
| `packages/core/dist` | Markdown 源文档、block token、源码与 DOM 光标映射、表格操作和语法类型 |
| `packages/markdown-it-adapter/dist` | Markdown-it 适配器、语法 registry、行内自定义语法插件 |
| `packages/preset/dist` | 常用 Markdown-it 插件、默认 renderer、文章与评论 preset |
| `packages/vue/dist` | `MarkdownInput`、`MarkdownEditor`、`MarkdownVisualEditor`、工具栏、预览组件和 `style.css` |
| `packages/theme/src` | 经典主题、语义 Markdown 样式和图标样式 |
| `examples/vue-vite/dist` | 独立演示页静态产物，可直接部署到 GitHub Pages 或其他静态托管 |

## 常用 API

### `createMarkdownItAdapter`

```ts
const adapter = createMarkdownItAdapter({
  markdown,
  profile: 'article', // 'article' 或 'comment'
  syntax,
  render: source => markdown.render(source),
})
```

`markdown` 是宿主实际使用的 Markdown-it 实例。适配器不会复制一套解析器，因此宿主安装的 Markdown-it 插件会直接影响编辑和预览。

### `MarkdownInput`

```vue
<MarkdownInput
  v-model="value"
  :adapter="adapter"
  mode="visual"
  :editing-style="'blur-hidden'"
  :editing-effects="'stable'"
  @syntax-state-change="syntaxStates = $event"
/>
```

常用方法：

```ts
input.focus()
input.sync()
input.insertSyntax('**', '**')
input.insertTable(2, 2)
```

`MarkdownEditor` 在 `MarkdownInput` 之上提供完整工具栏、源码模式、正式预览、上传回调和长度校验。

### 语法状态事件

```ts
interface MarkdownSyntaxState {
  syntaxKind: string
  from: number
  to: number
  bodyFrom: number
  bodyTo: number
  focused: boolean
  caretInside: boolean
  boundaryNear: boolean
  selected: boolean
  effectPaused: boolean
  boundaryVisible: boolean
}
```

该事件只描述编辑态状态，不会修改导出的 Markdown。

## 注入自定义语法

以 `::aside[内容]` 为例。第一步是在同一个 Markdown-it 实例上注册解析插件，并声明语法定义：

```ts
import MarkdownIt from 'markdown-it'
import {
  bracketSyntaxParts,
  inlineSyntaxPlugin,
  createMarkdownItAdapter,
} from '@n0v0rland-md/markdown-it-adapter'

const markdown = new MarkdownIt({ html: false })

const asideSyntax = {
  name: 'aside',
  scope: 'inline' as const,
  className: 'my-markdown-aside',
  contentMode: 'markdown' as const,
  getInlineParts: bracketSyntaxParts,
  editing: {
    reveal: 'near' as const,
    effect: 'pause-inside' as const,
  },
  toolbar: {
    label: '旁白',
    before: '::aside[',
    after: ']',
    profiles: ['article' as const],
  },
}

markdown.use(inlineSyntaxPlugin, [asideSyntax])

const adapter = createMarkdownItAdapter({
  markdown,
  profile: 'article',
  syntax: [asideSyntax],
})
```

第二步提供与 `className` 对应的主题样式：

```css
.my-markdown-aside {
  display: inline-block;
  padding: .1em .45em;
  border-left: .2rem solid #73a884;
  color: #568767;
  background: color-mix(in srgb, #73a884 12%, transparent);
}

.my-markdown-aside.is-effect-paused {
  animation-play-state: paused;
}
```

第三步在组件中传入 adapter：

```vue
<MarkdownInput
  v-model="value"
  :adapter="adapter"
  :syntax-editing="{
    aside: { reveal: 'near', effect: 'pause-inside' }
  }"
/>
```

此时 `::aside[**重点内容**]` 会在编辑态和正式预览中使用同一套 Markdown-it 语义。`contentMode: 'markdown'` 表示内部继续解析粗体、斜体等 Markdown；如果希望内部始终保持原文，则使用 `contentMode: 'text'`。

## 自定义主题与布局

编辑器只负责语义 DOM、源码映射和输入事务，工具栏和输入区可以通过插槽拆分布局。主题可以覆盖以下变量：

```css
.my-editor {
  --mde-font-family: 'Maple Mono', monospace;
  --mde-syntax-font-family: inherit;
  --mde-syntax-color: #568767;
  --mde-toolbar-gap: .35rem;
  --mde-min-height: 20rem;
}
```

文章编辑器通常把工具栏放在输入区上方，评论框可以把紧凑工具栏放在输入区下方；两者仍然共享同一个 adapter 和 Markdown-it 配置。

## 开发与部署

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run verify:browser
```

演示页启动后会展示完整编辑器。构建后的 `examples/vue-vite/dist` 是纯静态文件，可以作为 GitHub Pages 的发布目录。

切换编辑风格和主题，尝试修改本文中的标题、列表、表格、脚注和代码块，或把上面的 `aside` 配置复制到自己的 Vue 项目中。
