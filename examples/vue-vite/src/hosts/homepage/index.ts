import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
import type { MarkdownSyntaxDefinition } from '@n0v0rland-md/core'
import markdown from './markdown'

// Add editing metadata at the adapter boundary; the host parser and renderer
// remain unchanged. Offsets refer to the exact inline source being parsed.
export const homepageSyntax: MarkdownSyntaxDefinition[] = [
  { name: 'loud', className: 'bd-markdown-loud', label: '大声' },
  { name: 'whisper', className: 'bd-markdown-whisper', label: '小声' },
  { name: 'inner', className: 'bd-markdown-inner-thought', label: '内心独白' },
  { name: 'raw', className: 'bd-markdown-no-parse-inline', label: '不解析' },
].map(({ name, className, label }) => ({
  name, className, scope: 'inline' as const, contentMode: 'text' as const,
  getInlineParts(raw: string) {
    const open = raw.match(/^::(?:whisper|loud|inner|不解析|no[ -]?parse|raw)\[/i)?.[0]
    return open && raw.endsWith(']') && raw.length > open.length + 1
      ? { open, body: raw.slice(open.length, -1), close: ']' } : undefined
  },
  getSourceRange(_token, context) {
    const from = context.tokenFrom || 0
    const raw = context.source.slice(from).match(/^::(?:whisper|loud|inner|不解析|no[ -]?parse|raw)\[[^\]\n]+\]/i)?.[0]
    return raw ? { from, to: from + raw.length } : undefined
  },
  toolbar: { label, before: `::${name}[`, after: ']' },
}))

// Wrap the existing host rule only to annotate its emitted tokens. The host
// still decides recognition, escaping, content and final HTML.
const customRule = (markdown.inline.ruler as any).__rules__.find((rule: any) => rule.name === 'inline_custom_marks')?.fn
if (customRule) markdown.inline.ruler.at('inline_custom_marks', (state: any, silent: boolean) => {
  const from = state.pos
  const count = state.tokens.length
  const recognized = customRule(state, silent)
  if (recognized && !silent) {
    const name = state.src.slice(from, state.pos).match(/^::([^[]+)\[/)?.[1] || ''
    const kind = /^(不解析|no[ -]?parse|raw)$/i.test(name) ? 'raw' : name.toLowerCase()
    for (const token of state.tokens.slice(count)) {
      if (token.type === 'html_inline') token.meta = { ...token.meta, syntaxKind: kind, sourceFrom: from, sourceTo: state.pos }
    }
  }
  return recognized
})

export const homepageAdapter = createMarkdownItAdapter({ markdown, syntax: homepageSyntax })
