import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { MarkdownEditor, MarkdownInput } from '@n0v0rland-md/vue'
import { createMarkdownItPreset, createSiteMarkdown } from '@n0v0rland-md/preset'
import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
import { expressionPlugin, expressionSyntax } from '../../examples/vue-vite/src/expression-syntax'
import { homepageAdapter } from '../../examples/vue-vite/src/hosts/homepage'
import '@n0v0rland-md/theme'
import '@n0v0rland-md/theme/classic.css'
import notebook from '../../examples/vue-vite/src/themes/notebook.css?raw'

const value = ref('')
const mode = ref<'visual' | 'source' | 'preview'>('visual')
const style = ref<'always' | 'blur-hidden' | 'structure'>('blur-hidden')
const profile = ref<'article' | 'comment'>('article')
const theme = ref('classic')
const dark = ref(false)
const disabled = ref(false)
const maxLength = ref(0)
const full = ref(false)
const errorUpload = ref(false)
const deferMermaid = ref(false)
const deferUpload = ref(false)
const duplicateUpload = ref(false)
const pendingMermaid: ((value: string) => void)[] = []
const pendingUploads: ((value: string[]) => void)[] = []
const linkClicks: string[] = []
const input = ref<any>()
const changes: string[] = []
const syntaxStates = shallowRef<unknown[]>([])
const syntaxEditing = shallowRef<Record<string, any>>({})
const validities: boolean[] = []
const parser = createMarkdownItPreset({ configure(md) { md.use(expressionPlugin) } })
const rangedSyntax = {
  name: 'test-nested', scope: 'inline' as const, className: 'workbench-nested',
  contentMode: 'markdown' as const,
  getInlineParts(raw: string) {
    return raw.startsWith('::box[') && raw.endsWith(']') ? { open: '::box[', body: raw.slice(6, -1), close: ']' } : undefined
  },
  getSourceRange(_token: unknown, context: { source: string; tokenFrom?: number }) {
    const from = context.tokenFrom || 0
    const raw = context.source.slice(from).match(/^::box\[[^\]\n]+\]/)?.[0]
    return raw ? { from, to: from + raw.length } : undefined
  },
}
const blockSyntax = { name: 'test-panel', scope: 'block' as const, className: 'workbench-panel',
  getBlockParts: (raw: string) => ({ bodyFrom: 3, bodyTo: raw.length, tag: 'aside' as const }) }
const mappedBlocks = createMarkdownItPreset({ configure(md) {
  md.block.ruler.before('paragraph', 'workbench-panel', (state, start, _end, silent) => {
    const from = state.bMarks[start] + state.tShift[start]
    const to = state.eMarks[start]
    const raw = state.src.slice(from, to)
    if (!/^!![? ]/.test(raw)) return false
    if (silent) return true
    const token = state.push('workbench_panel', 'aside', 0)
    token.map = [start, start + 1]
    token.meta = raw.startsWith('!! ')
      ? { syntaxKind: 'test-panel', sourceFrom: from, sourceTo: to }
      : { syntaxKind: 'test-panel' }
    state.line = start + 1
    return true
  })
} })
const legacy = createSiteMarkdown()
const adapter = shallowRef(createMarkdownItAdapter({ markdown: parser, syntax: expressionSyntax }))
const styleElement = document.createElement('style')
styleElement.textContent = `${notebook}
body { margin: 0; }
.workbench { min-height: 100vh; padding: 24px; background: var(--color-page); color: var(--color-text); }
.workbench .mde__panel { padding: 16px; }
.workbench > .mde__panel, .workbench > .mde { max-width: 800px; margin: auto; background: var(--color-surface); }
.workbench__actions { display: flex; gap: 8px; max-width: 800px; margin: 0 auto 12px; }
.workbench button { font: inherit; }
`
document.head.append(styleElement)
async function settled() {
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
}
Object.assign(window, {
  editorWorkbench: {
    async set(options: Record<string, any>) {
      if ('value' in options) value.value = options.value
      if ('mode' in options) mode.value = options.mode
      if ('editingStyle' in options) style.value = options.editingStyle
      if ('profile' in options) profile.value = options.profile
      if ('theme' in options) theme.value = options.theme
      if ('dark' in options) dark.value = options.dark
      if ('disabled' in options) disabled.value = options.disabled
      if ('maxLength' in options) maxLength.value = options.maxLength
      if ('full' in options) full.value = options.full
      if ('syntaxEditing' in options) syntaxEditing.value = options.syntaxEditing
      if ('errorUpload' in options) errorUpload.value = options.errorUpload
      if ('deferMermaid' in options) deferMermaid.value = options.deferMermaid
      if ('deferUpload' in options) deferUpload.value = options.deferUpload
      if ('duplicateUpload' in options) duplicateUpload.value = options.duplicateUpload
      if ('parser' in options) {
        const md = options.parser === 'mapped-block' ? mappedBlocks : options.parser === 'legacy' ? (profile.value === 'comment' ? legacy.commentMd : legacy.md)
          : options.parser === 'no-emphasis' ? createMarkdownItPreset({ configure(md) { md.disable('emphasis') } })
            : options.parser === 'no-basics' ? createMarkdownItPreset({ configure(md) { md.disable(['emphasis', 'strikethrough', 'heading', 'lheading', 'blockquote', 'fence', 'hr']) } })
            : options.parser === 'presentation' ? createMarkdownItPreset({ configure(md) {
              md.core.ruler.after('inline', 'workbench-presentation', state => {
                for (const token of state.tokens) {
                  if (token.type === 'heading_open') { token.attrJoin('class', 'workbench-heading'); token.attrSet('style', 'text-align: center') }
                  if (token.type === 'blockquote_open') token.attrJoin('class', 'workbench-quote')
                }
              })
              md.renderer.rules.strong_open = () => '<strong class="workbench-strong"><span class="workbench-strong-body">'
              md.renderer.rules.strong_close = () => '</span></strong>'
            } })
              : options.parser === 'extension-ranges' ? createMarkdownItPreset({ configure(md) {
                md.inline.ruler.before('text', 'workbench-range', (state, silent) => {
                  const match = state.src.slice(state.pos).match(/^::box\[([^\]\n]+)\]/)
                  if (!match) return false
                  if (!silent) {
                    const token = state.push('workbench_box', 'span', 0)
                    token.content = match[1]
                    token.meta = { syntaxKind: 'test-nested' }
                    token.children = []
                    md.inline.parse(match[1], md, state.env, token.children)
                  }
                  state.pos += match[0].length
                  return true
                })
                md.renderer.rules.workbench_box = (tokens, index, options, env) =>
                  `<span class="workbench-nested">${md.renderer.renderInline(tokens[index].children || [], options, env)}</span>`
              } }) : parser
        adapter.value = options.parser === 'homepage' ? homepageAdapter
          : createMarkdownItAdapter({ markdown: md, profile: profile.value,
            syntax: options.parser === 'extension-ranges' ? [rangedSyntax] : options.parser === 'mapped-block' ? [blockSyntax] : expressionSyntax })
      }
      await settled()
    },
    state() { return { syntaxStates: syntaxStates.value, value: value.value, changes: [...changes], validities: [...validities], linkClicks: [...linkClicks], synced: input.value?.sync(), pendingMermaid: pendingMermaid.length, pendingUploads: pendingUploads.length } },
    clearEvents() { changes.length = 0; validities.length = 0 },
    async insert(before: string, after = '') { input.value?.insertSyntax(before, after); await settled() },
    async insertTable(rows = 3, columns = 3) { input.value?.insertTable(rows, columns); await settled() },
    async focus() { input.value?.focus(); await settled() },
    async setMode(next: 'visual' | 'source' | 'preview') {
      if (full.value) input.value?.setMode(next)
      else mode.value = next
      await settled()
    },
    resolveMermaid() {
      for (const resolve of pendingMermaid.splice(0)) resolve('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><text x="4" y="25">Stale diagram</text></svg>')
    },
    resolveUpload() {
      for (const resolve of pendingUploads.splice(0)) resolve(['./editor-overview.svg'])
    },
  },
})
const renderMermaid = async (source: string) => {
  if (source.includes('invalid')) throw new Error('Invalid test diagram')
  if (deferMermaid.value) return await new Promise<string>(resolve => pendingMermaid.push(resolve))
  return '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><text x="4" y="25">Diagram preview</text></svg>'
}
createApp(defineComponent({
  setup() {
    return () => h('main', { class: ['workbench mde-theme mde-classic', theme.value === 'notebook' ? 'mde-notebook' : ''], 'data-color-mode': dark.value ? 'dark' : 'light' }, [
      !full.value && h('div', { class: 'workbench__actions' }, ['visual', 'source', 'preview'].map(next =>
        h('button', { onClick() { mode.value = next as typeof mode.value } }, next))),
      h(full.value ? MarkdownEditor : MarkdownInput, {
        ref: input, modelValue: value.value, mode: mode.value, editingStyle: style.value,
        profile: profile.value, adapter: adapter.value, disabled: disabled.value, maxLength: maxLength.value,
        'onUpdate:modelValue': (next: string) => { changes.push(next); value.value = next },
        'onSyntaxStateChange': (states: unknown[]) => { syntaxStates.value = states },
        onValidity: (next: boolean) => validities.push(next),
        syntaxEditing: syntaxEditing.value,
        renderMermaid,
        highlightCode: (text: string) => `<span class="workbench-highlight">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</span>`,
        onLinkClick: (url: string) => linkClicks.push(url),
        uploadImages: async () => {
          if (errorUpload.value) throw new Error('模拟上传失败')
          if (deferUpload.value) return new Promise<string[]>(resolve => pendingUploads.push(resolve))
          return duplicateUpload.value
            ? ['./editor-overview.svg', './editor-overview.svg']
            : ['./editor-overview.svg']
        },
      }),
    ])
  },
})).mount('#app')
