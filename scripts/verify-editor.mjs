import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createMarkdownItAdapter } from '../packages/markdown-it-adapter/dist/index.js'
import { createMarkdownItPreset } from '../packages/preset/dist/index.js'
import { MarkdownSourceDocument } from '../packages/core/dist/index.js'

const markdown = createMarkdownItPreset({ siteOrigin: 'https://example.com' })
const adapter = createMarkdownItAdapter({ markdown, profile: 'article' })
const source = '# 标题\n\n**粗体**、::loud[大声]\n\n> [!tip] 提示'
const html = adapter.render(source)

assert.match(html, /<h1/)
assert.match(html, /<strong/)
assert.match(html, /bd-markdown-loud/)
assert.match(html, /markdown-alert-tip/)

const document = new MarkdownSourceDocument(source, adapter.parser)
assert.equal(document.blocks[0].text, '# 标题')
assert.equal(source.slice(document.blocks.at(-1).from, document.blocks.at(-1).to), '> [!tip] 提示')
assert.ok(existsSync(new URL('../packages/vue/dist/index.js', import.meta.url)))
assert.ok(existsSync(new URL('../packages/vue/dist/types/index.d.ts', import.meta.url)))

console.log('Markdown editor smoke: passed')
