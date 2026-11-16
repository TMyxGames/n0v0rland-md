export interface MarkdownSourceBlock {
  text: string
  from: number
  to: number
  raw: boolean
  type?: string
  fallbackReason?: string
}

type BlockToken = {
  type: string
  nesting: number
  map?: [number, number]
  markup?: string
  meta?: { label?: string }
}
export interface MarkdownBlockParser {
  parse(source: string, env: Record<string, any>): BlockToken[]
}

const rawTokenTypes = /^(html_block|footnote_block_open|no_parse_block)$/
const standaloneTokenTypes = /^(fence|code_block|hr|html_block|table_open)$/
const fallbackLabels: Record<string, string> = {
  footnote_definition: '脚注定义',
  table_open: '表格',
  html_block: 'HTML',
  no_parse_block: '不解析块',
  container_dropcap_open: '首字下沉容器',
  container_dropcap_legacy_open: '历史首字下沉容器',
}

export class MarkdownSourceDocument {
  readonly source: string
  readonly blocks: MarkdownSourceBlock[]

  constructor(source: string, private readonly parser: MarkdownBlockParser) {
    this.source = source
    this.blocks = this.parseBlocks(source)
  }

  private parseBlocks(source: string): MarkdownSourceBlock[] {
    if (!source) return []
    const offsets = [0]
    for (const match of source.matchAll(/\n/g)) offsets.push(match.index! + 1)
    offsets.push(source.length)
    try {
      const env: Record<string, any> = {}
      const tokens = this.parser.parse(source, env)
      const result: MarkdownSourceBlock[] = []
      const addBlock = (map: [number, number], type: string, forceRaw = false, markup?: string) => {
        if (!map.every(Number.isInteger) || map[0] < 0 || map[1] < map[0] || map[1] >= offsets.length) {
          throw new Error('Unreliable Markdown block source range')
        }
        const from = offsets[map[0]]
        let endLine = map[1]
        // markdown-it-container's opening map stops before its closing marker.
        // Preserve the closing line in the same fallback block.
        if (type.startsWith('container_') && markup) {
          const closing = source.slice(offsets[endLine], offsets[endLine + 1] ?? source.length).trim()
          if (closing.length >= markup.length && [...closing].every(char => char === markup[0])) endLine++
        }
        const mappedEnd = offsets[endLine] ?? source.length
        const text = source.slice(from, mappedEnd).replace(/\r?\n$/, '')
        const raw = forceRaw || rawTokenTypes.test(type) ||
          !/^(paragraph_open|heading_open|blockquote_open|bullet_list_open|ordered_list_open|fence|code_block|hr|table_open|container_dropcap(?:_legacy)?_open)$/.test(type)
        result.push({
          text, from, to: from + text.length, raw, type,
          ...(raw ? { fallbackReason: fallbackLabels[type] || '复杂结构' } : {}),
        })
      }
      let depth = 0
      let footnoteMap: [number, number] | undefined
      let footnoteLabel: string | undefined
      let inFootnotes = false
      for (const token of tokens) {
        // The footnote plugin moves definitions into a generated tail. It is
        // not a source container; collect each original definition separately,
        // then sort by source order rather than treating the whole document raw.
        if (token.type === 'footnote_block_open') { inFootnotes = true; continue }
        if (inFootnotes) {
          if (token.type === 'footnote_block_close') { inFootnotes = false; continue }
          if (token.type === 'footnote_open') { footnoteMap = undefined; footnoteLabel = token.meta?.label }
          else if (token.type === 'footnote_close' && footnoteMap) {
            if (footnoteLabel) {
              for (let line = footnoteMap[0]; line >= 0; line--) {
                const definition = source.slice(offsets[line], offsets[line + 1]).match(/^ {0,3}\[\^([^\]\s]+)\]:/)
                if (definition?.[1] === footnoteLabel) { footnoteMap[0] = line; break }
              }
            }
            addBlock(footnoteMap, 'footnote_definition', true)
          }
          else if (token.map) footnoteMap = footnoteMap
            ? [Math.min(footnoteMap[0], token.map[0]), Math.max(footnoteMap[1], token.map[1])]
            : [...token.map]
          continue
        }
        const standalone = token.nesting === 0 && standaloneTokenTypes.test(token.type)
        if (token.map && depth === 0 && (token.nesting === 1 || standalone || token.nesting === 0)) {
          addBlock(token.map, token.type, false, token.markup)
        }
        if (token.nesting === 1) depth += 1
        else if (token.nesting === -1) depth = Math.max(0, depth - 1)
      }
      result.sort((a, b) => a.from - b.from)
      const blocks: MarkdownSourceBlock[] = []
      let cursor = 0
      // Reference definitions (including unused footnotes) can disappear from
      // rendered tokens. Keep uncovered non-whitespace source as local raw
      // blocks; blank-line gaps retain their own caret positions in the view.
      const preserveGap = (from: number, to: number) => {
        const gap = source.slice(from, to)
        const first = gap.search(/\S/)
        if (first < 0) return
        const start = from + gap.lastIndexOf('\n', first) + 1
        const end = from + gap.trimEnd().length
        blocks.push({
          from: start, to: end, text: source.slice(start, end), raw: true,
          type: 'source_definition', fallbackReason: '定义或未映射语法',
        })
      }
      for (const block of result) {
        if (block.from < cursor) {
          // A moved definition can retain a map inside its original quote or
          // list. Expand only that enclosing block rather than degrading every
          // unrelated block in the document.
          const previous = blocks[blocks.length - 1]
          previous.to = Math.max(previous.to, block.to)
          previous.text = source.slice(previous.from, previous.to)
          previous.raw = true
          previous.fallbackReason = '嵌套或跨块定义'
          cursor = previous.to
          continue
        }
        preserveGap(cursor, block.from)
        blocks.push(block)
        cursor = block.to
      }
      preserveGap(cursor, source.length)
      return blocks
    } catch {
      // Malformed Markdown is handled by the line fallback below.
    }
    return this.fallbackBlocks(source)
  }

  private fallbackBlocks(source: string): MarkdownSourceBlock[] {
    const result: MarkdownSourceBlock[] = []
    const lines = source.split('\n')
    let cursor = 0
    let text = ''
    let from = 0
    const flush = () => {
      if (text) result.push({ text, from, to: from + text.length, raw: true })
      text = ''
    }
    for (const line of lines) {
      if (!line.trim() && text) {
        flush()
        cursor += line.length + 1
        from = cursor
        continue
      }
      if (!text) from = cursor
      text += `${text ? '\n' : ''}${line}`
      cursor += line.length + 1
    }
    flush()
    return result
  }
}
