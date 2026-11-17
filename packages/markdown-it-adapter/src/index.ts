import { createMarkdownSyntaxRegistry, type MarkdownSyntaxDefinition, type MarkdownSyntaxRegistry } from '@n0v0rland-md/core'

export interface MarkdownItLike {
  parse(source: string, env: Record<string, any>): Array<{
    type: string
    nesting: number
    map?: [number, number]
    markup?: string
    meta?: { label?: string }
  }>
  render(source: string, env?: Record<string, unknown>): string
  parseInline?(source: string, env?: Record<string, unknown>): unknown[]
}

export interface MarkdownBlockParser {
  parse(source: string, env: Record<string, any>): ReturnType<MarkdownItLike['parse']>
}

export interface MarkdownItAdapterOptions {
  markdown: MarkdownItLike
  profile?: 'article' | 'comment'
  fallback?: 'raw' | 'throw'
  render?: (source: string, env?: Record<string, unknown>) => string
  syntax?: MarkdownSyntaxRegistry | MarkdownSyntaxDefinition[]
}

export interface MarkdownItAdapter {
  profile: 'article' | 'comment'
  markdown: MarkdownItLike
  parser: MarkdownBlockParser
  syntax: MarkdownSyntaxRegistry
  render(source: string, env?: Record<string, unknown>): string
}

export function createMarkdownItAdapter(options: MarkdownItAdapterOptions): MarkdownItAdapter {
  const { markdown, profile = 'article' } = options
  const syntax = Array.isArray(options.syntax)
    ? createMarkdownSyntaxRegistry(options.syntax)
    : options.syntax || createMarkdownSyntaxRegistry()
  return {
    profile,
    markdown,
    syntax,
    parser: {
      parse(source, env) {
        return markdown.parse(source, env)
      },
    },
    render(source, env = {}) {
      return options.render ? options.render(source, env) : markdown.render(source, env)
    },
  }
}
