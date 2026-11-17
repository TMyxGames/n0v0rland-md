// Optional application configuration. Nothing here is installed by the default preset.
// The same definition supplies the parser, preview class, editable source and toolbar.
export const expressionSyntax = [
  { name: 'loud', label: '大声', className: 'demo-expression-loud' },
  { name: 'whisper', label: '小声', className: 'demo-expression-whisper' },
  { name: 'inner', label: '内心独白', className: 'demo-expression-inner' },
].map(({ name, label, className }) => ({
  name,
  scope: 'inline' as const,
  className,
  getInlineParts(raw: string) {
    const open = `::${name}[`
    if (!raw.startsWith(open) || !raw.endsWith(']')) return undefined
    const body = raw.slice(open.length, -1)
    return body ? { open, body, close: ']' } : undefined
  },
  toolbar: { label, before: `::${name}[`, after: ']' },
}))

// Markdown-it rule API is supplied by the consuming application.
export function expressionPlugin(md: any) {
  md.inline.ruler.before('text', 'demo_expressions', (state: any, silent: boolean) => {
    const match = state.src.slice(state.pos, state.posMax).match(/^::(loud|whisper|inner)\[([^\]\n]+)\]/)
    if (!match) return false
    const definition = expressionSyntax.find(item => item.name === match[1])!
    if (!silent) {
      const token = state.push('demo_expression', 'span', 0)
      token.content = match[2]
      token.meta = {
        syntaxKind: definition.name,
        sourceFrom: state.pos,
        sourceTo: state.pos + match[0].length,
      }
    }
    state.pos += match[0].length
    return true
  })
  md.renderer.rules.demo_expression = (tokens: any[], index: number) => {
    const token = tokens[index]
    const definition = expressionSyntax.find(item => item.name === token.meta.syntaxKind)!
    return `<span class="${definition.className}">${md.utils.escapeHtml(token.content)}</span>`
  }
}
