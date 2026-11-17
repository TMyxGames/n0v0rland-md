export * from './MarkdownSourceDocument.js'
export * from './markdown-dom-selection.js'
export * from './markdown-dom-navigation.js'
export * from './markdown-input.js'
export * from './syntax.js'
export * from './markdown-table.js'

export interface MarkdownEditorCoreOptions {
  profile: 'article' | 'comment'
  maxLength?: number
}
