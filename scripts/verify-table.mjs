import assert from 'node:assert/strict'
import { createMarkdownTable, completeMarkdownTableHeader, parseMarkdownTable, updateMarkdownTable } from '../packages/core/dist/index.js'
import { createMarkdownItPreset } from '../packages/preset/dist/index.js'

const markdown = createMarkdownItPreset()
const parse = source => parseMarkdownTable(source, markdown)
const text = '| **标题** | B |\r\n| :--- | ---: |\r\n| x\\|y | `代码` |\r\n| ::loud[原样] | [链接](https://example.com) |'
const original = parse(text)
assert.ok(original)
assert.deepEqual(original.alignments, ['left', 'right'])
assert.equal(original.rows[1].cells[0].text, 'x\\|y')
for (const row of original.rows) {
  for (const cell of row.cells) assert.equal(text.slice(cell.from, cell.to), cell.text)
}

let updated = parse(updateMarkdownTable(original, { type: 'insert-row', index: 2 }))
assert.equal(updated.rows.length, 4)
assert.deepEqual(updated.rows[2].cells.map(cell => cell.text), ['', ''])
assert.equal(updated.rows[3].cells[0].text, '::loud[原样]')
assert.equal(updated.newline, '\r\n')
updated = parse(updateMarkdownTable(updated, { type: 'delete-row', index: 2 }))
assert.deepEqual(updated.rows.map(row => row.cells.map(cell => cell.text)), original.rows.map(row => row.cells.map(cell => cell.text)))
assert.equal(updateMarkdownTable(original, { type: 'delete-row', index: 0 }), undefined)

updated = parse(updateMarkdownTable(original, { type: 'insert-column', index: 1 }))
assert.equal(updated.alignments.length, 3)
assert.deepEqual(updated.alignments, ['left', 'default', 'right'])
assert.equal(updated.rows[1].cells[2].text, '`代码`')
updated = parse(updateMarkdownTable(updated, { type: 'delete-column', index: 1 }))
assert.deepEqual(updated.rows.map(row => row.cells.map(cell => cell.text)), original.rows.map(row => row.cells.map(cell => cell.text)))
for (const alignment of ['default', 'left', 'center', 'right']) {
  updated = parse(updateMarkdownTable(original, { type: 'align-column', index: 0, alignment }))
  assert.equal(updated.alignments[0], alignment)
  assert.equal(updated.rows[1].cells[0].text, 'x\\|y')
}

const single = parse(createMarkdownTable(1, 1))
assert.ok(single)
assert.equal(updateMarkdownTable(single, { type: 'delete-column', index: 0 }), undefined)
assert.equal(updateMarkdownTable(original, { type: 'insert-row', index: 0 }), undefined)
assert.equal(updateMarkdownTable(original, { type: 'delete-column', index: -1 }), undefined)
assert.equal(updateMarkdownTable(original, { type: 'insert-column', index: 0.5 }), undefined)
assert.throws(() => createMarkdownTable(0, 1), RangeError)
assert.throws(() => createMarkdownTable(1, 21), RangeError)
assert.ok(parse('A | B\n--- | ---\n1 | 2'))
assert.equal(parse('| A | B |\n| --- | --- |\n| too | many | cells |'), undefined)
assert.equal(parse('| A | B |\n| --- | --- |\n| missing |'), undefined)
assert.equal(parse('# 普通标题'), undefined)
assert.equal(parse('| A |\n| --- |\n\n后面的段落'), undefined)
// Odd/even escape counts must distinguish literal pipes from delimiters.
assert.equal(parse('| A |\n| --- |\n| a\\|b |').rows[1].cells[0].text, 'a\\|b')
assert.equal(parse('| A | B |\n| --- | --- |\n| a\\\\| b |').rows[1].cells.length, 2)

const completed = completeMarkdownTableHeader('| 表头1 | **表头2** |', markdown)
assert.ok(completed)
assert.deepEqual(parse(completed).rows.map(row => row.cells.map(cell => cell.text)), [['表头1', '**表头2**'], ['', '']])
assert.equal(parse(completeMarkdownTableHeader('| a\\|b | C |', markdown)).rows[0].cells[0].text, 'a\\|b')
assert.equal(parse(completeMarkdownTableHeader('| A | B | C |', markdown)).alignments.length, 3)
assert.ok(completeMarkdownTableHeader('| A | B |', markdown, '\r\n').includes('\r\n'))
for (const header of ['| A |', '| A | B', '| A | B\\|', '\\| A | B |', '| | |', '| --- | --- |', '    | A | B |', '| A |\n| B |']) {
  assert.equal(completeMarkdownTableHeader(header, markdown), undefined, header)
}
const noTables = createMarkdownItPreset({ configure(md) { md.disable('table') } })
assert.equal(completeMarkdownTableHeader('| A | B |', noTables), undefined)

console.log('Table source model: offsets, escaped pipes, CRLF, insertion/deletion, alignment and source fallback passed')
