export const MARKDOWN_SYNTAX_VERSION = 1 as const

export interface MarkdownSyntaxSourceRange { from: number; to: number }
export interface MarkdownSyntaxRangeContext {
  /** Inline parser input for inline tokens, full Markdown document for block tokens. */
  source: string
  blockFrom?: number
  tokenFrom?: number
}
export interface MarkdownSyntaxBlockParts {
  /** Editable body range relative to the complete block source. */
  bodyFrom: number
  bodyTo: number
  tag?: 'div' | 'section' | 'aside' | 'blockquote' | 'figure' | 'pre'
}
export interface MarkdownSyntaxConfig {
  version: typeof MARKDOWN_SYNTAX_VERSION
  definitions: readonly MarkdownSyntaxDefinition[]
}

export type MarkdownSyntaxScope = 'inline' | 'block'
export type MarkdownSyntaxReveal = 'always' | 'near' | 'inside' | 'never'
export type MarkdownSyntaxEffect = 'theme' | 'pause-inside' | 'pause-active' | 'pause-hover' | 'none'
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
  /** The visual editor preserves this syntax as raw source when requested. */
  editorFallback?: 'auto' | 'source'
  /** Map a supported block shell to its contiguous editable source body. */
  getBlockParts?: (raw: string) => MarkdownSyntaxBlockParts | undefined
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
  getSourceRange?: (token: unknown, context: MarkdownSyntaxRangeContext) =>
    MarkdownSyntaxSourceRange | undefined
}

export interface MarkdownSyntaxRegistry {
  version: typeof MARKDOWN_SYNTAX_VERSION
  definitions: readonly MarkdownSyntaxDefinition[]
  resolve(name: string | undefined): MarkdownSyntaxDefinition | undefined
  toolbar(profile: 'article' | 'comment'): MarkdownSyntaxToolbar[]
}

const identifier = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u

export function validateMarkdownSyntaxConfig(config: unknown): asserts config is MarkdownSyntaxConfig {
  if (!config || typeof config !== 'object') throw new TypeError('Expected a Markdown syntax config object')
  const { version, definitions } = config as Partial<MarkdownSyntaxConfig>
  if (version !== MARKDOWN_SYNTAX_VERSION) throw new TypeError(`Unsupported Markdown syntax config version: ${String(version)}`)
  if (!Array.isArray(definitions)) throw new TypeError('Markdown syntax definitions must be an array')
  const owners = new Map<string, number>()
  definitions.forEach((value: MarkdownSyntaxDefinition, index) => {
    const invalid = (key: string) => { throw new TypeError(`Invalid Markdown syntax definitions[${index}].${key}`) }
    const check = (key: string, field: unknown, allowed: readonly string[]) => {
      if (field !== undefined && (typeof field !== 'string' || !allowed.includes(field))) invalid(key)
    }
    if (!value || typeof value.name !== 'string' || !identifier.test(value.name)) invalid('name')
    if (value.scope !== 'inline' && value.scope !== 'block') invalid('scope')
    if (value.aliases !== undefined && (!Array.isArray(value.aliases) ||
      value.aliases.some(alias => typeof alias !== 'string' || !identifier.test(alias)))) invalid('aliases')
    for (const name of [value.name, ...value.aliases || []]) {
      const key = name.toLowerCase()
      if (owners.has(key) && owners.get(key) !== index) invalid(`name/alias (${name} is already registered)`)
      owners.set(key, index)
    }
    for (const field of ['className', 'editorClassName'] as const) {
      if (value[field] !== undefined && typeof value[field] !== 'string') invalid(field)
    }
    for (const field of ['getInlineParts', 'getBlockParts', 'getSourceRange'] as const) {
      if (value[field] !== undefined && typeof value[field] !== 'function') invalid(field)
    }
    if (value.scope === 'block' && value.getInlineParts) invalid('getInlineParts')
    if (value.scope === 'inline' && value.getBlockParts) invalid('getBlockParts')
    check('contentMode', value.contentMode, ['text', 'markdown'])
    check('editorFallback', value.editorFallback, ['auto', 'source'])
    if (value.editing !== undefined) {
      if (!value.editing || typeof value.editing !== 'object' || Array.isArray(value.editing)) invalid('editing')
      check('editing.reveal', value.editing.reveal, ['always', 'near', 'inside', 'never'])
      check('editing.effect', value.editing.effect, ['theme', 'pause-inside', 'pause-active', 'pause-hover', 'none'])
      check('editing.boundary', value.editing.boundary, ['visible', 'hidden', 'structure'])
    }
    if (value.toolbar !== undefined) {
      const toolbar = value.toolbar
      if (!toolbar || typeof toolbar.label !== 'string' || typeof toolbar.before !== 'string' ||
        [toolbar.kind, toolbar.icon, toolbar.after].some(field => field !== undefined && typeof field !== 'string') ||
        (toolbar.profiles !== undefined && (!Array.isArray(toolbar.profiles) ||
          toolbar.profiles.some(profile => profile !== 'article' && profile !== 'comment')))) invalid('toolbar')
    }
  })
}

export function resolveMarkdownSyntaxRange(
  token: { meta?: { sourceFrom?: number; sourceTo?: number } },
  definition: MarkdownSyntaxDefinition,
  context: MarkdownSyntaxRangeContext,
): MarkdownSyntaxSourceRange | undefined {
  if (definition.editorFallback === 'source') return
  try {
    const meta = token.meta
    const hasOffsets = meta?.sourceFrom !== undefined || meta?.sourceTo !== undefined
    const range = hasOffsets ? { from: meta.sourceFrom, to: meta.sourceTo }
      : definition.getSourceRange?.(token, context)
    if (typeof range?.from !== 'number' || typeof range.to !== 'number') return
    if (!Number.isInteger(range.from) || !Number.isInteger(range.to) ||
      range.from < 0 || range.to <= range.from || range.to > context.source.length) return
    return { from: range.from, to: range.to }
  } catch {
    return undefined
  }
}

export function createMarkdownSyntaxRegistry(
  input: readonly MarkdownSyntaxDefinition[] | MarkdownSyntaxConfig = [],
): MarkdownSyntaxRegistry {
  const config = Array.isArray(input) ? { version: MARKDOWN_SYNTAX_VERSION, definitions: input } : input
  validateMarkdownSyntaxConfig(config)
  const all = config.definitions.map(definition => Object.freeze({
    ...definition,
    aliases: definition.aliases?.slice(),
    editing: definition.editing && Object.freeze({ ...definition.editing }),
    toolbar: definition.toolbar && Object.freeze({ ...definition.toolbar, profiles: definition.toolbar.profiles?.slice() }),
  }))
  const byName = new Map<string, MarkdownSyntaxDefinition>()
  for (const definition of all) {
    byName.set(definition.name.toLowerCase(), definition)
    for (const alias of definition.aliases || []) byName.set(alias.toLowerCase(), definition)
  }
  return {
    version: MARKDOWN_SYNTAX_VERSION,
    definitions: Object.freeze(all),
    resolve(name) {
      return typeof name === 'string' ? byName.get(name.toLowerCase()) : undefined
    },
    toolbar(profile) {
      return all.flatMap(({ toolbar, name }) => toolbar && (!toolbar.profiles || toolbar.profiles.includes(profile))
        ? [{ ...toolbar, profiles: toolbar.profiles?.slice(), kind: toolbar.kind || name }] : [])
    },
  }
}
