type Segmenter = {
  segment(value: string): Iterable<{ index: number; segment: string }>
}

/** Only continue source prefixes inside a parsed quote, never inside a fence. */
export function quoteLineBreak(source: string, offset: number, inQuote: boolean) {
  if (!inQuote) return '\n'
  const start = offset > 0 ? source.lastIndexOf('\n', offset - 1) + 1 : 0
  const line = source.slice(start, offset)
  const prefix = line.match(/^ {0,3}(?:>[ \t]?)+/)?.[0]
  return `\n${prefix || ''}`
}

export function listLineBreak(source: string, offset: number, ordered?: boolean) {
  const start = offset > 0 ? source.lastIndexOf('\n', offset - 1) + 1 : 0
  const line = source.slice(start, offset)
  const match = line.match(/^([ \t]*)([-+*]|\d+[.)])([ \t]+)(?:\[([ xX])\][ \t]+)?(.*)$/)
  if (!match) return '\n'
  if (!match[5].trim()) return '\n'
  const indent = match[1]
  const marker = (ordered ?? /^\d/.test(match[2]))
    ? `${Math.max(1, Number.parseInt(match[2], 10) + 1)}${match[2].slice(-1)} `
    : `${match[2]} `
  const task = match[4] === undefined ? '' : '[ ] '
  return `\n${indent}${marker}${task}`
}

export function structuralPrefix(source: string, offset: number, kind: 'quote' | 'list') {
  const start = offset > 0 ? source.lastIndexOf('\n', offset - 1) + 1 : 0
  const line = source.slice(start, offset)
  const pattern = kind === 'quote'
    ? /^([ \t]{0,3}(?:>[ \t]?)+)$/
    : /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)$/
  const match = line.match(pattern)
  if (!match) return undefined
  return { from: start, to: start + match[1].length, text: match[1] }
}

const SegmenterConstructor = (Intl as unknown as {
  Segmenter?: new (locale?: string, options?: { granularity: string }) => Segmenter
}).Segmenter
const segmenter = SegmenterConstructor ? new SegmenterConstructor(undefined, { granularity: 'grapheme' }) : undefined

/** Offsets remain UTF-16; a keyboard step/deletion consumes a whole grapheme. */
export function adjacentSourceOffset(source: string, offset: number, direction: -1 | 1) {
  const start = offset ? source.lastIndexOf('\n', offset - 1) + 1 : 0
  const lineEnd = source.indexOf('\n', offset)
  const end = lineEnd < 0 ? source.length : lineEnd + 1
  const from = offset <= start ? Math.max(0, start - 2) : start
  const text = source.slice(from, end)
  const positions: number[] = []
  if (segmenter) {
    for (const item of segmenter.segment(text)) positions.push(from + item.index)
  } else {
    let position = from
    for (const char of text) { positions.push(position); position += char.length }
  }
  positions.push(end)
  if (direction < 0) return positions.filter(value => value < offset).pop() ?? 0
  return positions.find(value => value > offset) ?? source.length
}
