import assert from 'node:assert/strict'
import { createMarkdownSyntaxRegistry } from '../packages/core/dist/index.js'
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
