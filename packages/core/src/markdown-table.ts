import type { MarkdownBlockParser } from './MarkdownSourceDocument.js'

export type TableAlignment = 'default' | 'left' | 'center' | 'right'
export interface MarkdownTableCell {
  /** Offsets relative to the table source, excluding padding and delimiters. */
  from: number
  to: number
  text: string
}
export interface MarkdownTableRow {
  from: number
  to: number
  cells: MarkdownTableCell[]
}
export interface MarkdownTable {
  source: string
  rows: MarkdownTableRow[]
  alignments: TableAlignment[]
  separator: MarkdownTableRow
  newline: string
}
export type TableCommand =
  | { type: 'insert-row'; index: number }
  | { type: 'delete-row'; index: number }
  | { type: 'insert-column'; index: number }
  | { type: 'delete-column'; index: number }
  | { type: 'align-column'; index: number; alignment: TableAlignment }

function readRow(line: string, from: number): MarkdownTableRow {
  const pipes: number[] = []
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '\\') { index++; continue }
    if (line[index] === '|') pipes.push(index)
  }
  let start = 0
  let end = line.length
  if (/^\s*\|/.test(line)) start = pipes.shift()! + 1
  if (/\|\s*$/.test(line) && pipes.at(-1) === line.trimEnd().length - 1) end = pipes.pop()!
  const edges = [start - 1, ...pipes.filter(pos => pos >= start && pos < end), end]
  const cells = edges.slice(0, -1).map((edge, index) => {
    const value = line.slice(edge + 1, edges[index + 1])
    const text = value.trim()
    // Empty cells need a caret before their trailing padding. Putting it just
    // before "|" lets a typed backslash accidentally escape that delimiter.
    const leading = value.match(/^[ \t]*/)?.[0].length || 0
    const padding = text ? leading : Math.floor(leading / 2)
    return { from: from + edge + 1 + padding, to: from + edge + 1 + padding + text.length, text }
  })
  return { from, to: from + line.length, cells }
}

/** Conservative, lossless source mapping for a single regular GFM table.
 * Markdown-it is the authority for whether a block actually is a table.
 * Ragged, multiline or nested tables stay in the source fallback.
 */
export function parseMarkdownTable(source: string, parser?: MarkdownBlockParser): MarkdownTable | undefined {
  if (parser) {
    try {
      const tokens = parser.parse(source, {})
      if (tokens[0]?.type !== 'table_open' || tokens.at(-1)?.type !== 'table_close') return undefined
    } catch { return undefined }
  }
  const lines = source.replace(/\r?\n$/, '').split('\n')
  if (lines.length < 2) return undefined
  let offset = 0
  const rows = lines.map(line => {
    const row = readRow(line.replace(/\r$/, ''), offset)
    offset += line.length + 1
    return row
  })
  const separator = rows.splice(1, 1)[0]
  const columns = rows[0].cells.length
  if (!columns || separator.cells.length !== columns || rows.some(row => row.cells.length !== columns)) return undefined
  if (separator.cells.some(cell => !/^:?-+:?$/.test(cell.text))) return undefined
  const alignments: TableAlignment[] = separator.cells.map(cell =>
    cell.text.startsWith(':') && cell.text.endsWith(':') ? 'center'
      : cell.text.startsWith(':') ? 'left' : cell.text.endsWith(':') ? 'right' : 'default')
  return { source, rows, separator, alignments, newline: source.includes('\r\n') ? '\r\n' : '\n' }
}

const alignmentSource: Record<TableAlignment, string> = { default: '---', left: ':---', center: ':---:', right: '---:' }

export function serializeMarkdownTable(rows: string[][], alignments: TableAlignment[], newline = '\n') {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [line(rows[0]), line(alignments.map(value => alignmentSource[value])), ...rows.slice(1).map(line)].join(newline)
}

export function createMarkdownTable(rows = 3, columns = 3) {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows > 50 || columns > 20) {
    throw new RangeError('Table dimensions must be 1–50 rows and 1–20 columns')
  }
  return serializeMarkdownTable(
    Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => row ? '' : `列 ${column + 1}`)),
    Array.from({ length: columns }, () => 'default'),
  )
}

/** Complete an intentionally closed header line, without treating ordinary
 * pipes, escaped delimiters or empty placeholders as a table shortcut.
 */
export function completeMarkdownTableHeader(header: string, parser?: MarkdownBlockParser, newline = '\n'): string | undefined {
  if (!/^ {0,3}\|/.test(header) || !/\|[ \t]*$/.test(header) || /[\r\n]/.test(header)) return undefined
  let slashes = 0
  const end = header.trimEnd().length - 1
  for (let index = end - 1; index >= 0 && header[index] === '\\'; index--) slashes++
  if (slashes % 2) return undefined
  const row = readRow(header, 0)
  if (row.cells.length < 2 || row.cells.length > 20
    || row.cells.some(cell => !cell.text || /^:?-+:?$/.test(cell.text))) return undefined
  const separator = `| ${row.cells.map(() => '---').join(' | ')} |`
  const empty = `| ${row.cells.map(() => '').join(' | ')} |`
  const result = [header, separator, empty].join(newline)
  return parseMarkdownTable(result, parser) ? result : undefined
}

/** Only structural changes serialize the table block; normal typing uses cell offsets. */
export function updateMarkdownTable(table: MarkdownTable, command: TableCommand): string | undefined {
  const rows = table.rows.map(row => row.cells.map(cell => cell.text))
  const alignments = [...table.alignments]
  const { index } = command
  if (!Number.isInteger(index)) return undefined
  if (command.type === 'insert-row') {
    if (index < 1 || index > rows.length) return undefined // Header stays the first row.
    rows.splice(index, 0, alignments.map(() => ''))
  } else if (command.type === 'delete-row') {
    if (index < 1 || index >= rows.length) return undefined
    rows.splice(index, 1)
  } else if (command.type === 'insert-column') {
    if (index < 0 || index > alignments.length) return undefined
    rows.forEach(row => row.splice(index, 0, ''))
    alignments.splice(index, 0, 'default')
  } else if (command.type === 'delete-column') {
    if (alignments.length <= 1 || index < 0 || index >= alignments.length) return undefined
    rows.forEach(row => row.splice(index, 1))
    alignments.splice(index, 1)
  } else if (command.type === 'align-column') {
    if (index < 0 || index >= alignments.length || !Object.hasOwn(alignmentSource, command.alignment)) return undefined
    alignments[index] = command.alignment
  }
  return serializeMarkdownTable(rows, alignments, table.newline)
}
