import type { MarkdownSyntaxDefinition } from '@n0v0rland-md/core'

/** Balanced, single-line expression. Escapes and code spans do not close it. */
export function bracketExpression(source: string, from = 0, max = source.length) {
  const opening = source.slice(from, max).match(/^::(no[ -]?parse|[^\s[\]]+)\[/i)
  if (!opening) return
  const bodyFrom = from + opening[0].length
  let depth = 1
  for (let cursor = bodyFrom; cursor < max; cursor++) {
    const char = source[cursor]
    if (char === '\n' || char === '\r') return
    if (char === '\\') { cursor++; continue }
    if (char === '`') {
      const run = source.slice(cursor).match(/^`+/)![0]
      let end = cursor + run.length
      while ((end = source.indexOf(run, end)) >= 0 && end < max) {
        if (source[end - 1] !== '`' && source[end + run.length] !== '`') break
        end += run.length
      }
      if (end >= 0 && end < max && !/[\r\n]/.test(source.slice(cursor, end))) {
        cursor = end + run.length - 1
        continue
      }
    }
    if (char === '[') depth++
    if (char === ']') depth--
    if (char === ']' && depth === 0) {
      if (cursor === bodyFrom) return
      return { name: opening[1].toLowerCase(), from, to: cursor + 1,
        open: opening[0], body: source.slice(bodyFrom, cursor), close: ']' }
    }
  }
}

export function bracketSyntaxParts(raw: string) {
  const expression = bracketExpression(raw)
  if (!expression || expression.to !== raw.length) return
  const { open, body, close } = expression
  return { open, body, close }
}

/** Host-owned definitions drive both editable content and preview semantics. */
export function inlineSyntaxPlugin(markdown: any, definitions: readonly MarkdownSyntaxDefinition[]) {
  const byName = new Map<string, MarkdownSyntaxDefinition>()
  for (const definition of definitions) {
    byName.set(definition.name.toLowerCase(), definition)
    for (const alias of definition.aliases || []) byName.set(alias.toLowerCase(), definition)
  }
  markdown.inline.ruler.before('text', 'mapped_inline_syntax', (state: any, silent: boolean) => {
    const expression = bracketExpression(state.src, state.pos, state.posMax)
    const definition = expression && byName.get(expression.name)
    if (!expression || !definition) return false
    if (!silent) {
      const depth = state.env.__mappedInlineDepth || 0
      if (depth >= 32) return false
      const token = state.push('mapped_inline_syntax', 'span', 0)
      token.content = expression.body
      token.meta = { syntaxKind: definition.name, sourceFrom: expression.from,
        sourceTo: expression.to, contentMode: definition.contentMode || 'text' }
      token.attrSet('class', definition.className || '')
      if (definition.contentMode === 'markdown') {
        const previousDepth = state.env.__mappedInlineDepth
        state.env.__mappedInlineDepth = depth + 1
        try { token.children = state.md.parseInline(expression.body, state.env)[0].children }
        finally {
          if (previousDepth === undefined) delete state.env.__mappedInlineDepth
          else state.env.__mappedInlineDepth = previousDepth
        }
      }
    }
    state.pos = expression.to
    return true
  })
  markdown.renderer.rules.mapped_inline_syntax = (tokens: any[], index: number, options: any, env: any, renderer: any) => {
    const token = tokens[index]
    const body = token.children
      ? renderer.renderInline(token.children, options, env)
      : markdown.utils.escapeHtml(token.content)
    return `<span class="${markdown.utils.escapeHtml(token.attrGet('class') || '')}">${body}</span>`
  }
}
