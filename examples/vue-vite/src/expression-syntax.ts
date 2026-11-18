// Optional application expressions; the default preset never installs them.
import { bracketSyntaxParts, inlineSyntaxPlugin } from '@n0v0rland-md/markdown-it-adapter'

export const expressionSyntax = [
  { name: 'loud', label: '大声', className: 'demo-expression-loud' },
  { name: 'whisper', label: '小声', className: 'demo-expression-whisper' },
  { name: 'inner', label: '内心独白', className: 'demo-expression-inner' },
].map(({ name, label, className }) => ({
  name,
  scope: 'inline' as const,
  contentMode: 'markdown' as const,
  className,
  getInlineParts: bracketSyntaxParts,
  toolbar: { label, before: `::${name}[`, after: ']' },
}))

export function expressionPlugin(md: any) {
  inlineSyntaxPlugin(md, expressionSyntax)
}
