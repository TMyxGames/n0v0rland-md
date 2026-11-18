export type MarkdownSyntaxScope = 'inline' | 'block'
export type MarkdownSyntaxReveal = 'always' | 'near' | 'inside' | 'never'
export type MarkdownSyntaxEffect = 'theme' | 'pause-inside' | 'pause-active' | 'none'
export type MarkdownSyntaxBoundary = 'visible' | 'hidden' | 'structure'

export interface MarkdownSyntaxToolbar {
  kind?: string
  label: string
  icon?: string
  before: string
  after?: string
  profiles?: Array<'article' | 'comment'>
}

export interface MarkdownSyntaxDefinition {
  /**
   * Stable identifier used by token.meta.syntaxKind and toolbar commands.
   */
  name: string
  aliases?: string[]
  scope: MarkdownSyntaxScope
  /**
   * Semantic class used by the preview renderer and the visual editor.
   * The editor keeps its own structural classes and adds this class to the
   * editable wrapper when the syntax is recognized.
   */
  className?: string
  editorClassName?: string
  /**
   * Split a complete inline source range into syntax prefix, editable body and
   * suffix. Returning undefined keeps the token in the source fallback.
   */
  getInlineParts?: (raw: string) => { open: string; body: string; close: string } | undefined
  /** Keep existing plain-text plugin behavior unless nesting is explicit. */
  contentMode?: 'text' | 'markdown'
  editing?: {
    reveal?: MarkdownSyntaxReveal
    effect?: MarkdownSyntaxEffect
    boundary?: MarkdownSyntaxBoundary
  }
  toolbar?: MarkdownSyntaxToolbar
  /**
   * A syntax without a reliable source range remains a source fallback.
   * This hook can validate or derive the range from a Markdown-it token.
   */
  getSourceRange?: (token: unknown, context: { source: string; blockFrom?: number; tokenFrom?: number }) =>
    { from: number; to: number } | undefined
}

export interface MarkdownSyntaxRegistry {
  definitions: readonly MarkdownSyntaxDefinition[]
  resolve(name: string | undefined): MarkdownSyntaxDefinition | undefined
  toolbar(profile: 'article' | 'comment'): MarkdownSyntaxToolbar[]
}

export function createMarkdownSyntaxRegistry(
  definitions: MarkdownSyntaxDefinition[] = [],
): MarkdownSyntaxRegistry {
  const all = [...definitions]
  const byName = new Map<string, MarkdownSyntaxDefinition>()
  for (const definition of all) {
    byName.set(definition.name.toLowerCase(), definition)
    for (const alias of definition.aliases || []) byName.set(alias.toLowerCase(), definition)
  }
  return {
    definitions: all,
    resolve(name) {
      return name ? byName.get(name.toLowerCase()) : undefined
    },
  toolbar(profile) {
      return all
        .filter(item => Boolean(item.toolbar) && (!item.toolbar?.profiles || item.toolbar.profiles.includes(profile)))
        .map(item => ({ ...item.toolbar!, kind: item.toolbar!.kind || item.name }))
        .filter(item => !item.profiles || item.profiles.includes(profile))
    },
  }
}
