import assert from 'node:assert/strict'
import { MarkdownSourceDocument } from '../packages/core/dist/index.js'
import { createMarkdownItPreset, createSiteMarkdown } from '../packages/preset/dist/index.js'

const markdown = createMarkdownItPreset()
const legacy = createSiteMarkdown().md
const samples = [
  '',
  '\n\n',
  '# Title\r\n\r\n**body**\r\n',
  'First\n\n\nSecond',
  '- First\n- Second\n\n> Quote',
  '1. Root\n   - Child\n     1. Nested',
  '> [!NOTE]\n> Body\n>\n> Next',
  'Setext title\n============\n\n[link](https://example.com "title")',
  '| A | B |\n| --- | --- |\n| a\\|b | `code` |',
  'Before\n\n```js\nconst value = 1\n```\n\nAfter',
  'Before\n\n[^note]: Footnote\n    continuation\n\nAfter [^note]',
  'Before\n\n[ref]: https://example.com\n\nAfter [label][ref]',
  'Before\n\n<div>raw HTML</div>\n\nAfter',
  '↓↓↓ dropcap\nDrop cap paragraph\n↓↓↓\n\nAfter',
  '```dropcap\nDrop cap paragraph\n```\n\nAfter',
]

for (const parser of [markdown, legacy]) for (const source of samples) {
  const document = new MarkdownSourceDocument(source, parser)
  let cursor = 0
  let restored = ''
  for (const block of document.blocks) {
    assert.ok(block.from >= cursor && block.to >= block.from && block.to <= source.length,
      `overlapping or invalid block in ${JSON.stringify(source)}`)
    assert.equal(block.text, source.slice(block.from, block.to))
    restored += source.slice(cursor, block.from) + block.text
    cursor = block.to
  }
  restored += source.slice(cursor)
  assert.equal(restored, source, `source bytes changed in ${JSON.stringify(source)}`)
}

const definitions = new MarkdownSourceDocument('Before\n\n[ref]: https://example.com\n\nAfter', markdown)
assert.equal(definitions.blocks[0].raw, false)
assert.ok(definitions.blocks.some(block => block.raw && block.text.includes('[ref]:')))
assert.equal(definitions.blocks.at(-1).raw, false)
assert.equal(definitions.env.references.REF.href, 'https://example.com')
assert.ok(definitions.tokens.length > 0)
assert.equal(definitions.blocks[0].tokens[0].type, 'paragraph_open')
assert.equal(definitions.blocks[0].tokens.at(-1).type, 'paragraph_close')
assert.equal(definitions.blockAt(1), definitions.blocks[0])
assert.equal(definitions.blockAt(definitions.source.length), definitions.blocks.at(-1))
assert.equal(definitions.blockAt(-1), undefined)
assert.equal(definitions.blockAt(definitions.source.length + 1), undefined)
const nestedTokens = new MarkdownSourceDocument('- **First**\n  - Nested\n\n> Quote', markdown)
assert.equal(nestedTokens.blocks[0].tokens[0].type, 'bullet_list_open')
assert.equal(nestedTokens.blocks[0].tokens.at(-1).type, 'bullet_list_close')
assert.ok(nestedTokens.blocks[0].tokens.some(token => token.type === 'inline' && token.children.some(child => child.type === 'strong_open')))

const unknown = new MarkdownSourceDocument('::: custom\nkeep exactly\n:::', {
  parse() { return [{ type: 'container_custom_open', nesting: 1, map: [0, 3] }, { type: 'container_custom_close', nesting: -1 }] },
})
assert.equal(unknown.blocks[0].raw, true)
assert.equal(unknown.blocks[0].text, unknown.source)

for (const parser of [
  { parse() { throw new Error('Plugin parse failure') } },
  { parse() { return [{ type: 'paragraph_open', nesting: 1, map: [0, 99] }] } },
]) {
  const source = 'Keep **source**\n\nSecond paragraph'
  const document = new MarkdownSourceDocument(source, parser)
  assert.ok(document.blocks.every(block => block.raw))
  assert.deepEqual(document.blocks.map(block => block.text), ['Keep **source**', 'Second paragraph'])
}

console.log('Source ledger: source ranges, CRLF, definitions, unknown containers and parser failures passed')
