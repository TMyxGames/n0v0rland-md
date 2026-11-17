# 主站 Markdown 配置注入

这里使用主站 `markdown.ts` 的解析与渲染规则，并注入主站 `BDmarkdown.css` 和明暗主题变量。编辑器仍然只保存 Markdown。

## 常用行内格式

支持 **粗体**、*斜体*、***粗斜体***、++下划线++、~~删除线~~、==高亮==、`行内代码` 和 :smile:。

站点语法：::whisper[小声哔哔]、::loud[大声喧哗]、::inner[内心独白]、::raw[**保持原文**]。

### 引用与提示

> 引用内可直接输入 **Markdown**，也可以继续换行。

> [!NOTE]
> 这个提示框使用主站的标题、图标、边框和颜色。

#### 列表

- 普通列表
- **格式**可以复合使用

1. 有序列表
2. 第二项

- [x] 注入主站解析配置
- [ ] 继续打磨编辑体验

##### 图片和表格

![点击图片下方可以修改这段描述](./editor-overview.svg#640x320 "演示图片")

| 功能 | 数据来源 | 展示 |
| :--- | :---: | ---: |
| 编辑 | Markdown 原文 | 语义 DOM |
| 预览 | 同一解析实例 | 主站样式 |

###### 代码与脚注

```ts
const adapter = createMarkdownItAdapter({
  markdown: homepageMarkdown,
  syntax: homepageSyntax,
})
```

这是一个脚注[^integration]。外链：[Markdown-it](https://github.com/markdown-it/markdown-it)。

[^integration]: 脚注也可以直接编辑，原文保持为 Markdown。

---

切换配置和主题不会改写正文。此示例通过页面上的“载入配置示例”按钮载入。
