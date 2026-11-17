import type { MarkdownEditorProfile } from './types'

export const defaultToolbars: Record<MarkdownEditorProfile, string[]> = {
  article: ['heading', 'link', 'blockquote', 'alert', 'table', 'codeBlock', 'mermaid'],
  comment: ['bold', 'italic', 'underline', 'strike', 'code', 'link'],
}

export const syntaxPairs: Record<string, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['++', '++'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
  spoiler: ['||', '||'],
  heading: ['# ', ''],
  h1: ['# ', ''],
  h2: ['## ', ''],
  h3: ['### ', ''],
  h4: ['#### ', ''],
  h5: ['##### ', ''],
  h6: ['###### ', ''],
  link: ['[', '](https://example.com)'],
  blockquote: ['> ', ''],
  alert: ['> [!note]\n> ', ''],
  table: ['| 列 1 | 列 2 |\n| --- | --- |\n| ', ' |  |'],
  codeBlock: ['```\n', '\n```'],
  mermaid: ['```mermaid\n', '\n```'],
}

export const toolLabels: Record<string, string> = {
  heading: '标题',
  link: '链接',
  h1: 'H1 标题',
  h2: 'H2 标题',
  h3: 'H3 标题',
  h4: 'H4 标题',
  h5: 'H5 标题',
  h6: 'H6 标题',
  blockquote: '引用',
  alert: '提示块',
  table: '表格',
  codeBlock: '代码块',
  mermaid: '图表',
  bold: '粗体',
  italic: '斜体',
  underline: '下划线',
  strike: '删除线',
  code: '代码',
  spoiler: '隐藏',
  whisper: '小声',
  loud: '大声',
  inner: '内心',
}
