export * from './MarkdownSourceDocument.js'
export * from './markdown-dom-selection.js'
export * from './markdown-input.js'

export interface MarkdownEditorCoreOptions {
  profile: 'article' | 'comment'
  maxLength?: number
}
