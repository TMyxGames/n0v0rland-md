# n0v0rland-md

基于 Markdown-it 的可视化 Markdown 编辑器。编辑器原文以 Markdown 字符串保存，Markdown-it 实例由宿主应用注入。

当前阶段已迁移：

- Markdown 源码块账本与 source range；
- DOM 选区与 Markdown offset 映射；
- 输入、列表、引用和结构前缀辅助函数；
- Markdown-it 外部适配器。

Vue 编辑器外壳和主站主题仍在后续阶段迁移，主站现有实现暂不修改。
