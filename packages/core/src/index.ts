export * from './MarkdownSourceDocument'
export * from './markdown-dom-selection'
export * from './markdown-input'

export interface MarkdownEditorCoreOptions {
  profile: 'article' | 'comment'
  maxLength?: number
}
