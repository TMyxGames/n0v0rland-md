import type { MarkdownEditorProfile } from './types'

export const defaultToolbars: Record<MarkdownEditorProfile, string[]> = {
  article: ['heading', 'blockquote', 'alert', 'table', 'codeBlock', 'mermaid'],
  comment: ['bold', 'italic', 'underline', 'strike', 'code', 'spoiler', 'whisper'],
}

export const syntaxPairs: Record<string, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['++', '++'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
  spoiler: ['||', '||'],
  whisper: ['::whisper[', ']'],
  loud: ['::loud[', ']'],
  inner: ['::inner[', ']'],
  heading: ['# ', ''],
  blockquote: ['> ', ''],
  alert: ['> [!note]\n> ', ''],
  table: ['| 列 1 | 列 2 |\\n| --- | --- |\\n| ', ' |  |'],
  codeBlock: ['```\\n', '\\n```'],
  mermaid: ['```mermaid\\n', '\\n```'],
}

export const toolLabels: Record<string, string> = {
  heading: '标题',
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
