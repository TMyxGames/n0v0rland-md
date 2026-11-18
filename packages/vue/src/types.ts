import type { MarkdownSyntaxRegistry } from '@n0v0rland-md/core'
import type { MarkdownSyntaxEffect, MarkdownSyntaxReveal } from '@n0v0rland-md/core'

export type MarkdownEditorMode = 'visual' | 'source' | 'preview'
export type MarkdownEditorProfile = 'article' | 'comment'
export type MarkdownEditingStyle = 'always' | 'blur-hidden' | 'structure'
export type MarkdownEditingEffects = 'theme' | 'stable' | 'none'

export interface MarkdownInputState {
  value: string
  length: number
  hasContent: boolean
  empty: boolean
  focused: boolean
  mode: MarkdownEditorMode
  disabled: boolean
  maxLength: number
  overLimit: boolean
}
export interface MarkdownSyntaxState {
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
  reveal?: MarkdownSyntaxReveal
  effect?: MarkdownSyntaxEffect
}

export interface MarkdownEditorAdapter {
  profile: MarkdownEditorProfile
  markdown: any
  parser: any
  syntax?: MarkdownSyntaxRegistry
  render(source: string, env?: Record<string, unknown>): string
}

export type MarkdownHighlightCode = (source: string, language: string) => string | undefined
export type MarkdownRenderMermaid = (source: string) => Promise<string | { svg: string }>
export type MarkdownUploadImages = (files: File[]) => Promise<string[]>
export type MarkdownLinkHandler = (url: string) => void | Promise<void>

export interface MarkdownEditorProps {
  modelValue: string
  profile?: MarkdownEditorProfile
  adapter: MarkdownEditorAdapter
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  showSource?: boolean
  showPreview?: boolean
  toolbar?: string[]
  uploadImages?: MarkdownUploadImages
  onLinkClick?: MarkdownLinkHandler
  editingStyle?: MarkdownEditingStyle
  editingEffects?: MarkdownEditingEffects
  syntaxEditing?: Record<string, { reveal?: MarkdownSyntaxReveal; effect?: MarkdownSyntaxEffect }>
  highlightCode?: MarkdownHighlightCode
  renderMermaid?: MarkdownRenderMermaid
}

export interface MarkdownEditorExpose {
  focus(): void
  sync(): string
  insertSyntax(kind: string): void
  setMode(mode: MarkdownEditorMode): void
  insertTable(rows?: number, columns?: number): void
}

export interface MarkdownInputExpose {
  focus(): void
  sync(): string
  insertSyntax(before: string, after?: string): void
  insertTable(rows?: number, columns?: number): void
}
