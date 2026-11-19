import assert from 'node:assert/strict'
import { createMarkdownSyntaxRegistry, resolveMarkdownSyntaxRange, MARKDOWN_SYNTAX_VERSION } from '../packages/core/dist/index.js'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createMarkdownItPreset } from '../packages/preset/dist/index.js'
import { createMarkdownItAdapter } from '../packages/markdown-it-adapter/dist/index.js'

const registry = createMarkdownSyntaxRegistry([
  {
    name: 'highlight-box',
    aliases: ['highlight'],
    scope: 'inline',
    className: 'bd-markdown-highlight-box',
    toolbar: {
      label: '重点',
      before: '==',
      after: '==',
      profiles: ['article'],
    },
  },
])

assert.equal(registry.resolve('highlight')?.name, 'highlight-box')
assert.equal(registry.resolve('missing'), undefined)
assert.deepEqual(registry.toolbar('article').map(item => item.kind), ['highlight-box'])
assert.deepEqual(registry.toolbar('comment'), [])

const item = { name: '示例', aliases: ['demo'], scope: 'block' }
const versioned = createMarkdownSyntaxRegistry({ version: MARKDOWN_SYNTAX_VERSION, definitions: [item] })
assert.equal(versioned.version, 1)
assert.equal(versioned.resolve('DEMO')?.name, '示例')
assert.throws(() => createMarkdownSyntaxRegistry({ version: 2, definitions: [] }), /version/)
assert.throws(() => createMarkdownSyntaxRegistry([item, { name: 'Demo', scope: 'inline' }]), /already registered/)
assert.throws(() => createMarkdownSyntaxRegistry([{ ...item, editing: { reveal: 'unknown' } }]), /editing.reveal/)
assert.throws(() => createMarkdownSyntaxRegistry([{ ...item, contentMode: 'invalid' }]), /contentMode/)
assert.throws(() => createMarkdownSyntaxRegistry([{ ...item, getInlineParts: () => {} }]), /getInlineParts/)
const context = { source: '中文内容' }
const definition = { ...item, getSourceRange: () => ({ from: 1, to: 3 }) }
assert.deepEqual(resolveMarkdownSyntaxRange({}, definition, context), { from: 1, to: 3 })
assert.equal(resolveMarkdownSyntaxRange({ meta: { sourceFrom: 1 } }, definition, context), undefined)
assert.equal(resolveMarkdownSyntaxRange({ meta: { sourceFrom: 1, sourceTo: 9 } }, definition, context), undefined)
assert.equal(resolveMarkdownSyntaxRange({}, { ...definition, editorFallback: 'source' }, context), undefined)
assert.equal(resolveMarkdownSyntaxRange({}, { ...definition, getSourceRange: () => { throw Error('plugin failure') } }, context), undefined)

// Exercise the real demo configuration independently of the legacy site preset.
let source = readFileSync(new URL('../examples/vue-vite/src/expression-syntax.ts', import.meta.url), 'utf8')
source = source.replace('@n0v0rland-md/markdown-it-adapter', new URL('../packages/markdown-it-adapter/dist/index.js', import.meta.url).href)
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { expressionPlugin, expressionSyntax } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const plain = createMarkdownItPreset()
const configured = createMarkdownItPreset({ configure: md => md.use(expressionPlugin) })
const adapter = createMarkdownItAdapter({ markdown: configured, syntax: expressionSyntax })
for (const definition of expressionSyntax) {
  const raw = `::${definition.name}[内容<&]`
  assert.ok(plain.render(raw).includes(`::${definition.name}[`))
  assert.ok(!plain.render(raw).includes(definition.className))
  assert.ok(adapter.render(raw).includes(`class="${definition.className}"`))
  assert.ok(adapter.render(raw).includes('内容&lt;&amp;'))
  const token = configured.parseInline(raw, {})[0].children[0]
  assert.deepEqual(token.meta, { syntaxKind: definition.name, sourceFrom: 0, sourceTo: raw.length, contentMode: 'markdown' })
  const parts = adapter.syntax.resolve(definition.name).getInlineParts(raw)
  assert.equal(parts.open + parts.body + parts.close, raw)
  for (const incomplete of [`::${definition.name}[]`, `::${definition.name}[未闭合`, `\\::${definition.name}[转义]`]) {
    assert.ok(!adapter.render(incomplete).includes(definition.className))
  }
}

console.log('Syntax configuration smoke: passed')
