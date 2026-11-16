export type MarkdownEditorMode = 'visual' | 'source' | 'preview'
export type MarkdownEditorProfile = 'article' | 'comment'

export interface MarkdownEditorAdapter {
  profile: MarkdownEditorProfile
  markdown: any
  parser: any
  render(source: string, env?: Record<string, unknown>): string
}

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
  uploadImages?: (files: File[]) => Promise<string[]>
}

export interface MarkdownEditorExpose {
  focus(): void
  sync(): string
  insertSyntax(kind: string): void
  setMode(mode: MarkdownEditorMode): void
}

export interface MarkdownInputExpose {
  focus(): void
  sync(): string
  insertSyntax(before: string, after?: string): void
}
