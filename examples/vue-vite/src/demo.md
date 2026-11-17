# n0v0rland-md

一个基于 **Markdown-it** 的可视化 Markdown 编辑器：以原文为数据源，让文字直接呈现格式，同时保留手动输入语法的自由。

## 写作，保持熟悉

你可以使用 **粗体**、*斜体*、***粗斜体***、~~删除线~~、++下划线++、==高亮== 和 `行内代码`。这些格式可以嵌套，例如 **重点中的 *补充说明***。

需要展示语法本身？输入转义字符：\*这里保留星号\*。  
这一行使用两个尾随空格换行，不会另起段落。

### 三种编辑风格

1. **始终显示节点**：随时查看并修改 Markdown 标记。
2. **隐藏失焦节点**：靠近边界时显示语法，移开后专注内容。
3. **仅保留结构**：语法生效后隐藏标记，清空内容时移除空结构。

#### 按需组合

- 输入区与工具栏可以独立布局。
- 渲染配置由宿主提供，主题样式可以替换。
  - 这里是嵌套列表。
  - 同一份 Markdown 可以在编辑、源码与预览间切换。

##### 逐项完成

- [x] 试着点击正文并输入文字
- [x] 从标题按钮选择不同级别
- [ ] 插入链接或创建一张表格

###### 从这里开始探索

阅读 [Markdown-it 项目介绍](https://github.com/markdown-it/markdown-it "Markdown-it")，或访问 <https://commonmark.org/> 了解基础语法。链接也可以使用[引用形式][markdown-guide]。

> 好的编辑体验，让格式服务于表达。
>
> 引用中也可以使用 **强调** 和 `代码`。

---

## 表格与代码

在独立段落输入 `| 表头1 | 表头2 |`，编辑器会补齐一个两行两列的表格。也可以用工具栏选择尺寸，悬停表格边缘调整行、列和对齐方式。

| 能力 | 使用方式 | 数据格式 |
| :--- | :---: | ---: |
| 直接输入 | 键盘 | Markdown |
| 格式操作 | 工具栏 | Markdown |
| 主题切换 | 顶部选择框 | CSS |

```ts
import { createMarkdownItPreset } from '@n0v0rland-md/preset'
import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'

const markdown = createMarkdownItPreset()
const adapter = createMarkdownItAdapter({ markdown })
```

图片使用标准 Markdown 语法，下面的插图随演示页提供，无需外部图片服务：

![从 Markdown 原文到可视化编辑与正式预览](./editor-overview.svg "原文、编辑、预览")

## 扩展属于你的编辑器

默认预设还提供表情 :sparkles: 和脚注[^source]。复杂内容保留源码，不会因打开编辑器而静默改写。

本演示页通过配置额外注入了三个行内语法，展示解析规则、编辑映射与 CSS 如何配合：

::loud[把重要的话说清楚] · ::whisper[也留一点轻声细语] · ::inner[记录尚未说出口的想法]

随时切换顶部主题或编辑风格，然后在这里开始写作。

[markdown-guide]: https://www.markdownguide.org/basic-syntax/ "Markdown 基础语法"

[^source]: 编辑器保存 Markdown 字符串，未修改的内容尽量保持原文。
