export interface MarkdownItLike {
  parse(source: string, env: Record<string, any>): Array<{
    type: string
    nesting: number
    map?: [number, number]
    markup?: string
    meta?: { label?: string }
  }>
  render(source: string, env?: Record<string, unknown>): string
}

export interface MarkdownBlockParser {
  parse(source: string, env: Record<string, any>): ReturnType<MarkdownItLike['parse']>
}

export interface MarkdownItAdapterOptions {
  markdown: MarkdownItLike
  profile: 'article' | 'comment'
  fallback?: 'raw' | 'throw'
}

export interface MarkdownItAdapter {
  profile: MarkdownItAdapterOptions['profile']
  markdown: MarkdownItLike
  parser: MarkdownBlockParser
  render(source: string, env?: Record<string, unknown>): string
}

export function createMarkdownItAdapter(options: MarkdownItAdapterOptions): MarkdownItAdapter {
  const { markdown, profile } = options
  return {
    profile,
    markdown,
    parser: {
      parse(source, env) {
        return markdown.parse(source, env)
      },
    },
    render(source, env = {}) {
      return markdown.render(source, env)
    },
  }
}
