<template>
  <div
    ref="root"
    class="markdown-visual-editor bd-markdown-theme"
    :class="{ 'is-disabled': disabled, 'is-comment': profile === 'comment' }"
    contenteditable="true"
    lang="zh-CN"
    translate="no"
    data-translate="no"
    data-no-translation="true"
    data-gramm="false"
    data-gramm_editor="false"
    data-lt-active="false"
    spellcheck="false"
    autocorrect="off"
    autocomplete="off"
    inputmode="text"
    role="textbox"
    aria-multiline="true"
    :aria-label="label"
    :data-placeholder="placeholder"
    @beforeinput="handleBeforeInput"
    @input="handleInputFallback"
    @compositionstart="handleCompositionStart"
    @compositionupdate="compositionText = $event.data || ''"
    @compositionend="handleCompositionEnd"
    @keydown="handleKeydown"
    @pointerdown="handlePointerDown"
    @paste="handlePaste"
    @copy="handleCopy"
    @cut="handleCut"
    @focus="focused = true"
    @blur="handleBlur"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MarkdownSourceDocument, domPositionFromSourceOffset, sourceOffsetFromDOM, adjacentSourceOffset, listLineBreak, quoteLineBreak, structuralPrefix } from '@n0v0rland-md/core'
import type { MarkdownEditorAdapter, MarkdownHighlightCode, MarkdownLinkHandler, MarkdownRenderMermaid } from './types'

type Profile = 'article' | 'comment'
const props = withDefaults(defineProps<{
  modelValue: string
  profile?: Profile
  adapter: MarkdownEditorAdapter
  highlightCode?: MarkdownHighlightCode
  renderMermaid?: MarkdownRenderMermaid
  onLinkClick?: MarkdownLinkHandler
  disabled?: boolean
  placeholder?: string
  label?: string
}>(), { profile: 'article', disabled: false, placeholder: '请输入内容…', label: 'Markdown 内容' })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement>()
const composing = ref(false)
const focused = ref(false)
let source = props.modelValue
let rendering = false
type SelectionState = { from: number; to: number; backward: boolean }
 type MarkdownTransaction = { sourceBefore: string; sourceAfter: string; from: number; to: number; insert: string; selectionBefore: SelectionState; selectionAfter: SelectionState }
let history: MarkdownTransaction[] = []
let redoHistory: MarkdownTransaction[] = []
let compositionText = ''
let compositionRange = { from: 0, to: 0 }
let pendingExternalValue: string | undefined
let activeSyntaxKey = ''
let suppressInputFallback = false
let mutationObserver: MutationObserver | undefined
let lastSelection: SelectionState = { from: source.length, to: source.length, backward: false }
let verticalColumn: number | undefined
let syntaxRevealTimer: number | undefined
let sourceDocumentCache: { source: string; profile: Profile; document: MarkdownSourceDocument } | undefined

const inlinePattern = /(?<!\\)(!\[[^\]\n]*\]\([^) \n]+(?:\s+"[^"]*")?\)|\[[^\]\n]+\]\([^) \n]+\)|\[[^\]\n]+\]\[[^\]\n]+\]|\[\^[^\]\n]+\]|\*\*[^*\n]+\*\*|__[^_\n]+__|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)|\+\+[^+\n]+\+\+|~~[^~\n]+~~|==[^=\n]+==|`[^`\n]+`|\|\|[^|\n]+\|\||::(?:whisper|loud|inner|不解析|no[ -]?parse|raw)\[[^\]\n]+\]|:[a-z][a-z0-9_+-]*:)/gi

function textNode(text: string, from: number, to: number) {
  const node = document.createTextNode(text)
  const holder = document.createElement('span')
  holder.className = 'markdown-editor-text'
  holder.dataset.sourceFrom = String(from)
  holder.dataset.sourceTo = String(to)
  holder.append(node)
  return holder
}

function boundary(text: string, from: number, to: number, active: boolean) {
  const node = document.createElement('span')
  node.className = `markdown-syntax-boundary${active ? ' is-visible' : ''}`
  node.dataset.sourceFrom = String(from)
  node.dataset.sourceTo = String(to)
  node.setAttribute('aria-hidden', active ? 'false' : 'true')
  node.textContent = text
  return node
}
function nearSyntax(selectionFrom: number, selectionTo: number, syntaxFrom: number, syntaxTo: number) {
  if (selectionFrom < 0) return false
  const distance = 0
  return selectionFrom <= syntaxTo + distance && selectionTo >= syntaxFrom - distance
}
function lineEnding(text: string, from: number) {
  const node = textNode(text, from, from + text.length)
  node.className = 'markdown-editor-line-ending'
  return node
}

type InlineToken = {
  type: string
  content?: string
  markup?: string
  children?: InlineToken[]
  meta?: { sourceFrom?: number; sourceTo?: number; syntaxKind?: string }
}

function tokenInlineNodes(text: string, start: number, activeFrom = -1, activeTo = -1) {
  let tokens: InlineToken[]
  try {
    const parsed = props.adapter.markdown.parseInline?.(text, {})?.[0]
    tokens = parsed?.children || []
  } catch {
    return null
  }
  const supported = new Set(['text', 'text_special', 'softbreak', 'hardbreak', 'strong_open', 'strong_close', 'em_open', 'em_close', 's_open', 's_close', 'ins_open', 'ins_close', 'mark_open', 'mark_close', 'code_inline', 'html_inline'])
  if (!tokens.length || tokens.some(token => !supported.has(token.type))) return null
  if (tokens.some(token => token.type === 'html_inline' && (token.meta?.sourceFrom == null || token.meta?.sourceTo == null))) return null
  if (!tokens.some(token => /^(strong|em|s|ins|mark)_open$/.test(token.type) || token.type === 'code_inline')) return null
  let cursor = 0
  let index = 0
  let lastClose: { from: number; to: number } | undefined
  const consume = (content: string, exact = false) => {
    const from = cursor
    if (exact && text.slice(cursor, cursor + content.length) !== content) return undefined
    if (!exact && text.slice(cursor, cursor + content.length) !== content) {
      const found = text.indexOf(content, cursor)
      if (found >= cursor) {
        cursor = found + content.length
        return { from: start + found, to: start + cursor }
      }
    }
    cursor += content.length
    return { from: start + from, to: start + cursor }
  }
  const tagFor = (type: string) => ({
    strong_open: 'strong',
    em_open: 'em',
    s_open: 's',
    ins_open: 'u',
    mark_open: 'mark',
  } as Record<string, string>)[type] || 'span'
  const renderUntil = (closeType?: string): DocumentFragment | null => {
    const fragment = document.createDocumentFragment()
    while (index < tokens.length) {
      const token = tokens[index++]
      if (closeType && token.type === closeType) {
        const range = consume(token.markup || '', true)
        if (!range) return null
        lastClose = range
        return fragment
      }
      if (token.type === 'softbreak' || token.type === 'hardbreak') {
        const range = consume('\n', true)
        if (!range) return null
        fragment.append(textNode('\n', range.from, range.to))
        continue
      }
      if (token.type === 'text' || token.type === 'text_special') {
        const value = token.content || ''
        if (!value) continue
        const range = consume(value)
        if (!range) return null
        fragment.append(textNode(text.slice(range.from - start, range.to - start), range.from, range.to))
        continue
      }
      if (token.type === 'code_inline') {
        const markup = token.markup || '`'
        const open = consume(markup, true)
        if (!open) return null
        const content = token.content || ''
        const body = consume(content)
        if (!body) return null
        const close = consume(markup, true)
        if (!close) return null
        const wrapper = document.createElement('code')
        wrapper.dataset.sourceFrom = String(open.from)
        wrapper.dataset.sourceTo = String(close.to)
        const active = nearSyntax(activeFrom, activeTo, open.from, open.to) || nearSyntax(activeFrom, activeTo, close.from, close.to)
        wrapper.append(boundary(markup, open.from, open.to, active), textNode(text.slice(body.from - start, body.to - start), body.from, body.to), boundary(markup, close.from, close.to, active))
        fragment.append(wrapper)
        continue
      }
      if (token.type === 'html_inline' && token.meta?.syntaxKind) {
        const rawFrom = token.meta.sourceFrom ?? cursor
        const rawTo = token.meta.sourceTo ?? rawFrom
        if (rawFrom !== cursor) return null
        const raw = text.slice(rawFrom, rawTo)
        const openLength = raw.indexOf('[') + 1
        if (openLength <= 0 || !raw.endsWith(']')) return null
        const open = consume(raw.slice(0, openLength), true)
        const body = consume(raw.slice(openLength, raw.length - 1))
        const close = consume(']', true)
        if (!open || !body || !close) return null
        const kind = token.meta.syntaxKind.toLowerCase()
        const wrapper = document.createElement('span')
        wrapper.className = /^(?:不解析|no[ -]?parse|raw)$/.test(kind)
          ? 'bd-markdown-no-parse-inline'
          : kind === 'inner' ? 'bd-markdown-inner-thought'
            : kind === 'loud' ? 'bd-markdown-loud' : 'bd-markdown-whisper'
        wrapper.dataset.sourceFrom = String(open.from)
        wrapper.dataset.sourceTo = String(close.to)
        const active = nearSyntax(activeFrom, activeTo, open.from, open.to) || nearSyntax(activeFrom, activeTo, close.from, close.to)
        const bodyContent = /^(?:不解析|no[ -]?parse|raw)$/.test(kind)
          ? textNode(text.slice(body.from - start, body.to - start), body.from, body.to)
          : inlineNodes(text.slice(body.from - start, body.to - start), body.from, activeFrom, activeTo)
        wrapper.append(boundary(raw.slice(0, openLength), open.from, open.to, active), bodyContent, boundary(']', close.from, close.to, active))
        fragment.append(wrapper)
        continue
      }
      if (/_open$/.test(token.type)) {
        const markup = token.markup || ''
        const open = consume(markup, true)
        if (!open) return null
        const inner = renderUntil(token.type.replace('_open', '_close'))
        if (!inner || index > tokens.length) return null
        const closeMarkup = token.markup || markup
        const close = lastClose || { from: start + cursor - closeMarkup.length, to: start + cursor }
        const wrapper = document.createElement(tagFor(token.type))
        wrapper.dataset.sourceFrom = String(open.from)
        wrapper.dataset.sourceTo = String(close.to)
        const active = nearSyntax(activeFrom, activeTo, open.from, open.to) || nearSyntax(activeFrom, activeTo, close.from, close.to)
        wrapper.append(boundary(markup, open.from, open.to, active), inner, boundary(closeMarkup, close.from, close.to, active))
        fragment.append(wrapper)
        continue
      }
      return null
    }
    return closeType ? null : fragment
  }
  const result = renderUntil()
  if (!result || cursor !== text.length) return null
  return result
}

function inlineNodes(text: string, start: number, activeFrom = -1, activeTo = -1) {
  const tokenResult = tokenInlineNodes(text, start, activeFrom, activeTo)
  if (tokenResult) return tokenResult
  const fragment = document.createDocumentFragment()
  let cursor = 0
  inlinePattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = inlinePattern.exec(text))) {
    const matchIndex = match.index
    const from = start + matchIndex
    const to = from + match[0].length
    if (match.index > cursor) fragment.append(textNode(text.slice(cursor, match.index), start + cursor, from))
    const raw = match[0]
    const custom = raw.startsWith('::')
    const emoji = /^:[a-z][a-z0-9_+-]*:$/i.test(raw)
    const footnote = /^\[\^[^\]\n]+\]$/.test(raw)
    if (emoji) {
      const span = document.createElement('span')
      span.className = 'markdown-editor-emoji'
      span.dataset.sourceFrom = String(from)
      span.dataset.sourceTo = String(to)
      span.textContent = raw
      fragment.append(span)
      cursor = matchIndex + raw.length
      continue
    }
    if (footnote) {
      const wrapper = document.createElement('sup')
      wrapper.className = 'markdown-editor-footnote-ref'
      wrapper.dataset.sourceFrom = String(from)
      wrapper.dataset.sourceTo = String(to)
      wrapper.dataset.label = raw.slice(2, -1)
      const sourceNode = textNode(raw, from, to)
      sourceNode.classList.add('markdown-editor-footnote-source')
      wrapper.append(sourceNode)
      fragment.append(wrapper)
      cursor = matchIndex + raw.length
      continue
    }
    const image = raw.startsWith('![')
    const link = raw.startsWith('[') && !image
    if (image || link) {
      const match = raw.match(/^!?\[([^\]]*)\]\(([^) \n]+)(?:\s+"([^"]*)")?\)$/)
      if (match) {
        const openLength = raw.indexOf('](') + 2
        const closeLength = 1
        const wrapper = document.createElement(image ? 'span' : 'a')
        wrapper.className = image ? 'markdown-editor-image' : 'markdown-editor-link'
        wrapper.dataset.sourceFrom = String(from)
        wrapper.dataset.sourceTo = String(to)
        if (image) {
          const img = document.createElement('img')
          const size = match[2].match(/#(\d+)x(\d+)$/)
          const imageSource = size ? match[2].slice(0, match[2].length - size[0].length) : match[2]
          img.src = imageSource; img.alt = match[1]; img.title = match[3] || ''
          if (size) {
            img.style.setProperty('--img-w', size[1])
            img.style.setProperty('--img-h', size[2])
            img.style.aspectRatio = `${size[1]} / ${size[2]}`
          }
          img.draggable = false; img.contentEditable = 'false'
          const sourceNode = textNode(raw, from, to)
          sourceNode.classList.add('markdown-editor-image-source')
          wrapper.append(sourceNode, img)
        } else {
          const anchor = wrapper as HTMLAnchorElement
          anchor.href = match[2]; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'
          wrapper.dataset.label = match[1]
          const sourceNode = textNode(raw, from, to)
          sourceNode.classList.add('markdown-editor-link-source')
          wrapper.append(sourceNode)
        }
        fragment.append(wrapper); cursor = matchIndex + raw.length; continue
      }
      const reference = raw.match(/^\[([^\]]+)\]\[([^\]]+)\]$/)
      if (reference) {
        const definition = source.match(new RegExp(`^\\s*\\[${reference[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]:\\s*(\\S+)`, 'im'))
        const wrapper = document.createElement(definition ? 'a' : 'span')
        wrapper.className = 'markdown-editor-link markdown-editor-reference-link'
        wrapper.dataset.sourceFrom = String(from)
        wrapper.dataset.sourceTo = String(to)
        wrapper.dataset.label = reference[1]
        if (definition) {
          const anchor = wrapper as HTMLAnchorElement
          anchor.href = definition[1]
          anchor.target = '_blank'
          anchor.rel = 'noopener noreferrer'
        }
        const sourceNode = textNode(raw, from, to)
        sourceNode.classList.add('markdown-editor-link-source')
        wrapper.append(sourceNode)
        fragment.append(wrapper)
        cursor = matchIndex + raw.length
        continue
      }
    }
    const open = custom ? raw.indexOf('[') + 1 : raw.startsWith('**') || raw.startsWith('__') || raw.startsWith('++') || raw.startsWith('~~') || raw.startsWith('==') || raw.startsWith('||') ? 2 : 1
    const close = custom ? 1 : open
    const body = raw.slice(open, raw.length - close)
    const kind = custom ? raw.slice(2, raw.indexOf('[')).toLowerCase() : raw.slice(0, open)
    const tag = kind === '**' || kind === '__' ? 'strong' : kind === '*' || kind === '_' ? 'em' : kind === '++' ? 'u' : kind === '~~' ? 's' : kind === '==' ? 'mark' : kind === '`' ? 'code' : 'span'
    const wrapper = document.createElement(tag)
    wrapper.className = custom ? `bd-markdown-${/^(?:不解析|no[ -]?parse|raw)$/.test(kind) ? 'no-parse-inline' : kind === 'inner' ? 'inner-thought' : kind}` : ''
    wrapper.dataset.sourceFrom = String(from)
    wrapper.dataset.sourceTo = String(to)
    const isActive = nearSyntax(activeFrom, activeTo, from, from + open) || nearSyntax(activeFrom, activeTo, to - close, to)
    const outerPatternIndex = inlinePattern.lastIndex
    const bodyContent = custom && /^(?:不解析|no[ -]?parse|raw)$/i.test(kind)
      ? textNode(body, from + open, to - close)
      : inlineNodes(body, from + open, activeFrom, activeTo)
    inlinePattern.lastIndex = outerPatternIndex
    wrapper.append(boundary(raw.slice(0, open), from, from + open, isActive), bodyContent, boundary(raw.slice(raw.length - close), to - close, to, isActive))
    fragment.append(wrapper)
    cursor = matchIndex + raw.length
  }
  if (cursor < text.length) fragment.append(textNode(text.slice(cursor), start + cursor, start + text.length))
  return fragment
}

function rawBlockElement(raw: string, from: number, reason = '复杂结构') {
  const element = document.createElement('pre')
  element.className = 'markdown-editor-block markdown-raw-block'
  element.dataset.fallbackReason = reason
  element.title = `源码保留：${reason}。可直接编辑原文，正式效果请切换预览。`
  element.contentEditable = 'true'
  const code = document.createElement('code')
  code.append(textNode(raw, from, from + raw.length))
  element.append(code)
  element.dataset.sourceFrom = String(from)
  element.dataset.sourceTo = String(from + raw.length)
  return element
}

function sourceDocumentFor(value: string) {
  const profile = props.profile
  if (sourceDocumentCache?.source === value && sourceDocumentCache.profile === profile) return sourceDocumentCache.document
  const document = new MarkdownSourceDocument(value, props.adapter.parser as any)
  sourceDocumentCache = { source: value, profile, document }
  return document
}

async function enhanceMermaidBlocks() {
  if (!root.value || focused.value) return
  const blocks = [...root.value.querySelectorAll<HTMLElement>('.markdown-editor-mermaid')]
  if (!blocks.length) return
  if (!props.renderMermaid) return
  try {
    for (const block of blocks) {
      if (block.querySelector('.markdown-editor-mermaid-preview')) continue
      const source = block.dataset.mermaidSource || ''
      const preview = document.createElement('div')
      preview.className = 'markdown-editor-mermaid-preview'
      preview.contentEditable = 'false'
      preview.setAttribute('aria-hidden', 'true')
      try {
        const rendered = await props.renderMermaid(source)
        const svg = typeof rendered === 'string' ? rendered : rendered.svg
        const image = document.createElement('img')
        image.alt = 'Mermaid 图表预览'
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        preview.append(image)
      } catch {
        preview.classList.add('is-error')
        preview.textContent = 'Mermaid 语法错误，切换源码模式查看。'
      }
      block.prepend(preview)
    }
  } catch { blocks.forEach(block => block.classList.add('mermaid-render-error')) }
}

function highlightedText(text: string, from: number, language: string) {
  const element = document.createElement('span')
  try { element.innerHTML = props.highlightCode?.(text, language) || '' } catch { /* plain source below */ }
  // Highlight output is accepted only if it preserves every source character.
  if (element.textContent !== text) element.textContent = text
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const leaves: Text[] = []
  while (walker.nextNode()) leaves.push(walker.currentNode as Text)
  let offset = from
  for (const leaf of leaves) {
    const value = leaf.data
    leaf.replaceWith(textNode(value, offset, offset + value.length))
    offset += value.length
  }
  return element
}

function tableElement(raw: string, from: number, activeFrom: number, activeTo: number) {
  const tokens = props.adapter.markdown.parse(raw, {})
  const headerTokens = tokens.filter((token: { type: string }) => token.type === 'th_open') as { attrGet(name: string): string | null }[]
  const alignments = headerTokens.map(token => token.attrGet('style') || '')
  const lines = raw.split('\n')
  const splitRow = (line: string) => {
    const pipes: number[] = []
    for (let index = 0; index < line.length; index++) {
      if (line[index] === '\\') { index++; continue }
      if (line[index] === '|') pipes.push(index)
    }
    const start = /^\s*\|/.test(line) ? pipes.shift()! + 1 : 0
    const end = /\|\s*$/.test(line) ? pipes.pop()! : line.length
    return { start, end, pipes: pipes.filter(index => index >= start && index < end) }
  }
  if (!headerTokens.length || lines.some((line, index) => index !== 1 && splitRow(line).pipes.length + 1 !== headerTokens.length)) {
    return rawBlockElement(raw, from, '不规则表格')
  }
  const wrapper = document.createElement('div')
  wrapper.className = 'markdown-editor-block bd-markdown-theme-table-wrapper'
  const table = document.createElement('table')
  const head = document.createElement('thead')
  const body = document.createElement('tbody')
  table.append(head, body)
  let offset = 0
  for (const [index, line] of lines.entries()) {
    const row = document.createElement('tr')
    const newline = index < lines.length - 1 ? '\n' : ''
    if (index === 1) {
      row.className = 'markdown-editor-table-syntax'
      const cell = document.createElement('td')
      cell.colSpan = headerTokens.length
      cell.append(boundary(line + newline, from + offset, from + offset + line.length + newline.length, nearSyntax(activeFrom, activeTo, from + offset, from + offset + line.length)))
      row.append(cell); body.append(row)
    } else {
      const parts = splitRow(line)
      const edges = [parts.start, ...parts.pipes.map(index => index + 1), parts.end]
      for (let column = 0; column < headerTokens.length; column++) {
        const cell = document.createElement(index === 0 ? 'th' : 'td')
        cell.style.cssText = alignments[column]
        const start = column === 0 ? 0 : edges[column]
        const end = column === headerTokens.length - 1 ? line.length : parts.pipes[column] + 1
        const contentStart = column === 0 ? parts.start : edges[column]
        const contentEnd = column === headerTokens.length - 1 ? parts.end : parts.pipes[column]
        cell.dataset.syntaxFrom = String(from + offset + start)
        cell.dataset.syntaxTo = String(from + offset + end)
        const active = nearSyntax(activeFrom, activeTo, from + offset + start, from + offset + end)
        if (contentStart > start) cell.append(boundary(line.slice(start, contentStart), from + offset + start, from + offset + contentStart, active))
        cell.append(inlineNodes(line.slice(contentStart, contentEnd), from + offset + contentStart, activeFrom, activeTo))
        if (contentEnd === contentStart) cell.append(textNode('', from + offset + contentStart, from + offset + contentStart), document.createElement('br'))
        if (end > contentEnd) cell.append(boundary(line.slice(contentEnd, end), from + offset + contentEnd, from + offset + end, active))
        if (column === headerTokens.length - 1 && newline) cell.append(lineEnding(newline, from + offset + line.length))
        row.append(cell)
      }
      ;(index === 0 ? head : body).append(row)
    }
    offset += line.length + newline.length
  }
  const tail = document.createElement('span')
  tail.className = 'markdown-editor-table-tail'
  wrapper.append(table, tail)
  wrapper.dataset.sourceFrom = String(from); wrapper.dataset.sourceTo = String(from + raw.length)
  return wrapper
}

function createBlockElement(raw: string, from: number, selectionFrom = -1, selectionTo = -1, type = '') {
  const active = nearSyntax(selectionFrom, selectionTo, from, from + raw.length)
  if (/^container_dropcap(?:_legacy)?_open$/.test(type)) {
    const element = document.createElement('div')
    element.className = 'markdown-editor-block bd-dropcap'
    const firstEnd = raw.indexOf('\n')
    const closingStart = raw.lastIndexOf('\n') + 1
    const openingMarker = raw.match(/^ {0,3}(`{3,}|↓{3,})/)?.[1]
    const closing = raw.slice(closingStart).trim()
    if (firstEnd < 0 || closingStart <= firstEnd || !openingMarker || closing.length < openingMarker.length || [...closing].some(char => char !== openingMarker[0])) {
      return rawBlockElement(raw, from, '未闭合首字下沉')
    }
    element.append(boundary(raw.slice(0, firstEnd + 1), from, from + firstEnd + 1, nearSyntax(selectionFrom, selectionTo, from, from + firstEnd + 1)))
    const body = raw.slice(firstEnd + 1, closingStart)
    const bodyDocument = new MarkdownSourceDocument(body, props.adapter.parser as any)
    const bodyFragment = document.createDocumentFragment()
    const bodyFrom = from + firstEnd + 1
    let cursor = 0
    for (const block of bodyDocument.blocks) {
      if (block.from > cursor) appendSourceGap(bodyFragment, body.slice(cursor, block.from), bodyFrom + cursor, bodyFrom + block.from)
      bodyFragment.append(block.raw ? rawBlockElement(block.text, bodyFrom + block.from, block.fallbackReason)
        : createBlockElement(block.text, bodyFrom + block.from, selectionFrom, selectionTo, block.type))
      cursor = block.to
    }
    if (cursor < body.length) appendSourceGap(bodyFragment, body.slice(cursor), bodyFrom + cursor, bodyFrom + body.length)
    element.append(bodyFragment)
    element.append(boundary(raw.slice(closingStart), from + closingStart, from + raw.length, nearSyntax(selectionFrom, selectionTo, from + closingStart, from + raw.length)))
    element.dataset.sourceFrom = String(from); element.dataset.sourceTo = String(from + raw.length)
    return element
  }
  if (type === 'table_open') return tableElement(raw, from, selectionFrom, selectionTo)
  const first = raw.split('\n')[0] || ''
  if (props.profile === 'comment' && (/^( {0,3})(#{1,6})[ \t]+/.test(first) || /^ {0,3}>/.test(first) || /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.test(first) || /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(first))) {
    const element = document.createElement('p')
    element.className = 'markdown-editor-block'
    element.append(inlineNodes(raw, from, selectionFrom, selectionTo))
    element.dataset.sourceFrom = String(from); element.dataset.sourceTo = String(from + raw.length)
    return element
  }
  const heading = first.match(/^( {0,3})(#{1,6})[ \t]+(.*)$/)
  if (heading) {
    const element = document.createElement(`h${heading[2].length}`)
    element.className = 'markdown-editor-block'
    const bodyFrom = from + heading[1].length + heading[2].length + first.slice(heading[1].length + heading[2].length).match(/^[ \t]*/)?.[0].length!
    const content = document.createElement('span')
    content.className = 'markdown-editor-heading-content'
    content.dataset.syntaxFrom = String(from)
    content.dataset.syntaxTo = String(from + raw.length)
    content.append(boundary(first.slice(0, bodyFrom - from), from, bodyFrom, nearSyntax(selectionFrom, selectionTo, from, bodyFrom)), inlineNodes(first.slice(bodyFrom - from), bodyFrom, selectionFrom, selectionTo))
    element.append(content)
    element.dataset.sourceFrom = String(from); element.dataset.sourceTo = String(from + raw.length)
    return element
  }
  const lines = raw.split('\n')
  const quote = lines.every(line => /^ {0,3}>/.test(line))
  const alert = quote && /^ {0,3}>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(lines[0])
  if (quote) {
    const element = document.createElement('blockquote')
    element.className = `markdown-editor-block${alert ? ` markdown-alert markdown-alert-${lines[0].match(/\[!([^\]]+)/i)?.[1].toLowerCase()}` : ''}`
    let bodyOffset = 0
    if (alert) {
      const title = document.createElement('div')
      title.className = 'markdown-alert-title'
      title.contentEditable = 'false'
      const label = lines[0].match(/\[!([^\]]+)/i)![1].toLowerCase()
      title.dataset.label = label[0].toUpperCase() + label.slice(1)
      const icon = document.createElement('span')
      icon.className = 'markdown-alert-icon'
      title.append(icon)
      element.append(title)
    }
    for (const [index, line] of lines.entries()) {
      const marker = (alert && index === 0 ? line.match(/^ {0,3}>[ \t]?\[![^\]]+\][ \t]*/i) : line.match(/^([ \t]{0,3}>[ \t]?)/))?.[0] || ''
      const nested = !alert && line.match(/^([ \t]{0,3}>[ \t]?)(>[ \t]?)(.*)$/)
      if (nested) {
        const nestedBlock = document.createElement('blockquote')
        nestedBlock.className = 'markdown-editor-nested-quote'
        const outerFrom = from + bodyOffset
        const innerFrom = outerFrom + nested[1].length
        const contentFrom = innerFrom + nested[2].length
        nestedBlock.append(
          boundary(nested[1], outerFrom, innerFrom, nearSyntax(selectionFrom, selectionTo, outerFrom, innerFrom)),
          boundary(nested[2], innerFrom, contentFrom, nearSyntax(selectionFrom, selectionTo, innerFrom, contentFrom)),
          inlineNodes(nested[3], contentFrom, selectionFrom, selectionTo),
        )
        if (index < lines.length - 1) nestedBlock.append(lineEnding('\n', from + bodyOffset + line.length))
        element.append(nestedBlock)
        bodyOffset += line.length + 1
        continue
      }
      const paragraph = document.createElement('p')
      if (alert && index === 0 && line.length === marker.length) paragraph.className = 'markdown-editor-alert-header'
      paragraph.dataset.syntaxFrom = String(from + bodyOffset)
      paragraph.dataset.syntaxTo = String(from + bodyOffset + line.length)
      const contentStart = from + bodyOffset + marker.length
      const markerFrom = from + bodyOffset
      paragraph.append(boundary(marker, markerFrom, contentStart, nearSyntax(selectionFrom, selectionTo, markerFrom, contentStart)))
      paragraph.append(inlineNodes(line.slice(marker.length), contentStart, selectionFrom, selectionTo))
      if (line.length === marker.length) paragraph.append(textNode('', contentStart, contentStart), document.createElement('br'))
      if (index < lines.length - 1) paragraph.append(lineEnding('\n', from + bodyOffset + line.length))
      element.append(paragraph)
      bodyOffset += line.length + 1
    }
    element.dataset.sourceFrom = String(from); element.dataset.sourceTo = String(from + raw.length)
    return element
  }
  if (/^ {0,3}>/.test(first)) return rawBlockElement(raw, from)
  if (type === 'code_block' || /^ {0,3}(`{3,}|~{3,})/.test(first)) {
    const language = type === 'code_block' ? '' : first.replace(/^ {0,3}(?:`{3,}|~{3,})/, '').trim().split(/\s+/)[0]
    const element = document.createElement('div')
    const isMermaid = language.toLowerCase() === 'mermaid'
    element.className = `markdown-editor-block markdown-editor-code bd-code-block${isMermaid ? ' markdown-editor-mermaid' : ''}`
    if (isMermaid) element.dataset.mermaidSource = lines.slice(1, -1).join('\n')
    const pre = document.createElement('pre')
    pre.className = 'hljs'
    const code = document.createElement('code')
    let offset = 0
    const fence = first.match(/^ {0,3}(`{3,}|~{3,})/)?.[1]
    for (const [index, line] of lines.entries()) {
      const row = document.createElement('span')
      row.className = 'bd-code-line'
      const isFence = !!fence && (index === 0 || index === lines.length - 1 && line.trim().length >= fence.length && [...line.trim()].every(char => char === fence[0]))
      const content = isFence ? boundary(line, from + offset, from + offset + line.length, active)
        : highlightedText(line, from + offset, language)
      content.classList.add('bd-code-line-content')
      row.append(content)
      if (!line) {
        const caret = document.createElement('br')
        caret.dataset.sourceFrom = String(from + offset); caret.dataset.sourceTo = String(from + offset)
        content.append(textNode('', from + offset, from + offset), caret)
      }
      if (index < lines.length - 1) {
        content.append(lineEnding('\n', from + offset + line.length))
        if (isFence) content.dataset.sourceTo = String(from + offset + line.length + 1)
      }
      code.append(row)
      offset += line.length + 1
    }
    pre.append(code); element.append(pre)
    element.dataset.sourceFrom = String(from); element.dataset.sourceTo = String(from + raw.length)
    return element
  }
  const list = first.match(/^([ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+)(.*)$/)
  if (list) {
    const structuralTokens = props.adapter.markdown.parse(raw, {}) as { type: string }[]
    if (structuralTokens.some(token => !/^(?:bullet_list|ordered_list|list_item|paragraph)_(?:open|close)$|^inline$/.test(token.type))) {
      return rawBlockElement(raw, from, '列表内复杂块')
    }
    const element = document.createElement(/^\s*\d/.test(list[1]) ? 'ol' : 'ul')
    element.className = 'markdown-editor-block'
    let offset = 0
    let currentItem: HTMLLIElement | undefined
    const stack: { indent: number; list: HTMLElement; item?: HTMLLIElement }[] = [{ indent: list[1].match(/^[ \t]*/)![0].length, list: element }]
    if (element.tagName === 'OL') element.setAttribute('start', String(parseInt(list[1], 10)))
    for (const line of lines) {
      const itemMatch = line.match(/^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)(.*)$/)
      if (itemMatch) {
        const indent = itemMatch[1].match(/^[ \t]*/)![0].length
        while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop()
        let level = stack[stack.length - 1]
        if (level.item) level.item.append(lineEnding('\n', from + offset - 1))
        if (indent > level.indent && level.item) {
          const nested = document.createElement(/^\s*\d/.test(itemMatch[1]) ? 'ol' : 'ul')
          if (nested.tagName === 'OL') nested.setAttribute('start', String(parseInt(itemMatch[1], 10)))
          level.item.append(nested)
          level = { indent, list: nested }; stack.push(level)
        }
        currentItem = document.createElement('li')
        level.item = currentItem
        const markerFrom = from + offset
        const task = itemMatch[2].match(/^\[([ xX])\][ \t]+/)
        const markerText = itemMatch[1] + (task?.[0] || '')
        const contentFrom = markerFrom + markerText.length
        const itemActive = nearSyntax(selectionFrom, selectionTo, markerFrom, contentFrom)
        currentItem.append(boundary(markerText, markerFrom, contentFrom, itemActive))
        if (task) {
          level.list.classList.add('contains-task-list'); currentItem.classList.add('task-list-item')
          const checkbox = document.createElement('input')
          checkbox.type = 'checkbox'; checkbox.checked = task[1] !== ' '; checkbox.disabled = true
          checkbox.contentEditable = 'false'; checkbox.setAttribute('aria-label', '任务状态')
          currentItem.append(checkbox)
        }
        currentItem.append(inlineNodes(line.slice(markerText.length), contentFrom, selectionFrom, selectionTo))
        level.list.append(currentItem)
      } else if (currentItem) {
        const contentFrom = from + offset
        currentItem.append(textNode('\n', contentFrom - 1, contentFrom))
        currentItem.append(inlineNodes(line, contentFrom, selectionFrom, selectionTo))
      }
      offset += line.length + 1
    }
    element.dataset.sourceFrom = String(from); element.dataset.sourceTo = String(from + raw.length)
    return element
  }
  if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(first)) {
    const element = document.createElement('div')
    element.className = 'markdown-editor-block markdown-editor-rule'
    const rule = document.createElement('hr')
    rule.contentEditable = 'false'
    element.append(boundary(raw, from, from + raw.length, nearSyntax(selectionFrom, selectionTo, from, from + raw.length)), rule)
    element.dataset.sourceFrom = String(from)
    element.dataset.sourceTo = String(from + raw.length)
    return element
  }
  const element = document.createElement('p')
  element.className = 'markdown-editor-block'
  element.append(inlineNodes(raw, from, selectionFrom, selectionTo))
  element.dataset.sourceFrom = String(from); element.dataset.sourceTo = String(from + raw.length)
  return element
}

function blockElement(raw: string, from: number, selectionFrom = -1, selectionTo = -1, type = '') {
  const element = createBlockElement(raw, from, selectionFrom, selectionTo, type)
  element.dataset.sourceText = raw
  return element
}

function appendSourceGap(fragment: DocumentFragment, text: string, from: number, to: number) {
  const block = fragment.lastElementChild as HTMLElement | null
  let offset = from
  const pieces: string[] = text.match(/[^\n]*\n|[^\n]+$/g) || []
  // The first terminator closes the preceding block's source line. Every
  // further terminator represents a real empty line, even when not focused.
  if (block && pieces.length && /^[ \t]*\r?\n$/.test(pieces[0])) {
    const separatorText = pieces.shift()!
    const target = block.querySelector('.markdown-editor-heading-content')
      || block.querySelector('.markdown-editor-table-tail')
      || (block.matches('.markdown-editor-code') ? block.querySelector('code') : null)
      || (block.matches('blockquote, ul, ol') ? block.lastElementChild : null)
      || (block.matches('pre') ? block.firstElementChild : null)
      || block
    const separator = textNode(separatorText, offset, offset + separatorText.length)
    separator.className = 'markdown-editor-source-gap'
    target.append(separator)
    offset += separatorText.length
    block.dataset.sourceTo = String(offset)
  }
  for (const piece of pieces) {
    const line = document.createElement('p')
    line.className = 'markdown-editor-block markdown-editor-empty-line'
    line.dataset.sourceFrom = String(offset)
    line.dataset.sourceTo = String(offset + piece.length)
    const caret = document.createElement('br')
    caret.dataset.sourceFrom = String(offset)
    caret.dataset.sourceTo = String(offset)
    line.append(textNode(piece, offset, offset + piece.length), caret)
    fragment.append(line)
    offset += piece.length
  }
  if (offset !== to) throw new Error('Markdown separator source range mismatch')
}
function selectionOffset() {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !root.value) return { from: source.length, to: source.length, backward: false }
  const range = selection.getRangeAt(0)
  const start = sourceOffsetFromDOM(root.value, range.startContainer, range.startOffset, source.length)
  const end = sourceOffsetFromDOM(root.value, range.endContainer, range.endOffset, source.length)
  const backward = selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset
  return start <= end ? { from: start, to: end, backward } : { from: end, to: start, backward: !backward }
}

function syntaxContext(from: number, to: number) {
  inlinePattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = inlinePattern.exec(source))) {
    const start = match.index; const end = start + match[0].length
    const open = match[0].startsWith('::') ? match[0].indexOf('[') + 1 : match[0].startsWith('**') || match[0].startsWith('__') || match[0].startsWith('++') || match[0].startsWith('~~') || match[0].startsWith('==') || match[0].startsWith('||') ? 2 : 1
    if (nearSyntax(from, to, start, start + open) || nearSyntax(from, to, end - (match[0].startsWith('::') ? 1 : open), end)) return `${start}:${end}`
  }
  const lines = source.split('\n')
  let offset = 0
  for (const line of lines) {
    const marker = line.match(/^( {0,3})(?:#{1,6}[ \t]+|>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+)/)
    if (marker) {
      const start = offset + marker[1].length; const end = offset + marker[0].length
      if (nearSyntax(from, to, start, end)) return `${start}:${end}`
    }
    offset += line.length + 1
  }
  return ''
}

function handleSelectionChange() {
  if (!root.value || rendering || composing.value || !focused.value) return
  const selection = window.getSelection()
  if (!selection?.anchorNode || !root.value.contains(selection.anchorNode)) return
  const range = selectionOffset()
  lastSelection = range
  // Revealing delimiters changes line widths. Keep the current presentation
  // while a range is being extended so a native pointer drag has stable targets.
  if (!selection.isCollapsed) return
  const key = syntaxContext(range.from, range.to)
  activeSyntaxKey = key
  const markers = [...root.value.querySelectorAll<HTMLElement>('.markdown-syntax-boundary')]
  window.clearTimeout(syntaxRevealTimer)
  syntaxRevealTimer = window.setTimeout(() => {
    if (!root.value || !focused.value || composing.value) return
    const current = selectionOffset()
    if (!window.getSelection()?.isCollapsed) return
    const activeParents = new Set<HTMLElement>()
    for (const marker of markers) {
      const parent = marker.closest<HTMLElement>('[data-source-from][data-source-to]') || marker.parentElement
      if (!parent) continue
      const start = Number(marker.dataset.sourceFrom)
      const end = Number(marker.dataset.sourceTo)
      if (nearSyntax(current.from, current.to, start, end)) activeParents.add(parent)
    }
    for (const marker of markers) {
      const parent = marker.closest<HTMLElement>('[data-source-from][data-source-to]') || marker.parentElement
      const visible = !!parent && activeParents.has(parent)
      marker.classList.toggle('is-visible', visible)
      marker.setAttribute('aria-hidden', String(!visible))
    }
  }, 70)
}

function handleBlur() {
  verticalColumn = undefined
  focused.value = false
  activeSyntaxKey = ''
  window.clearTimeout(syntaxRevealTimer)
  for (const marker of root.value?.querySelectorAll<HTMLElement>('.markdown-syntax-boundary') || []) {
    marker.classList.remove('is-visible')
    marker.setAttribute('aria-hidden', 'true')
  }
  void enhanceMermaidBlocks()
}

function handlePointerDown(event: PointerEvent) {
  verticalColumn = undefined
  if ((event.target as HTMLElement | null)?.closest('.markdown-editor-rule hr')) {
    event.preventDefault()
    return
  }
  const target = event.target as HTMLElement | null
  const linkNode = target?.closest<HTMLElement>('.markdown-editor-link, .markdown-editor-image')
  if (linkNode) {
    event.preventDefault()
    const from = Number(linkNode.dataset.sourceFrom)
    const to = Number(linkNode.dataset.sourceTo)
    const raw = source.slice(from, to)
    const href = raw.match(/^\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)$/)?.[1]
      || raw.match(/^!\[[^\]]*]\(([^)\s]+)/)?.[1]
    if (href) void props.onLinkClick?.(href)
    setSelection(from + Math.max(1, Math.floor((to - from) / 2)))
    return
  }
  const boundaryNode = target?.closest<HTMLElement>('.markdown-syntax-boundary')
  if (boundaryNode && !boundaryNode.classList.contains('is-visible')) {
    event.preventDefault()
    const holder = boundaryNode.parentElement?.closest<HTMLElement>('[data-source-from][data-source-to]')
    if (holder) {
      const from = Number(holder.dataset.sourceFrom)
      const to = Number(holder.dataset.sourceTo)
      const midpoint = Math.max(from, Math.min(to, from + Math.floor((to - from) / 2)))
      setSelection(midpoint)
    }
  }
}

function setSelection(from: number, to = from, backward = false) {
  if (!root.value) return
  from = Math.max(0, Math.min(source.length, from))
  to = Math.max(from, Math.min(source.length, to))
  lastSelection = { from, to, backward }
  const { node: startNode, offset: startOffset } = domPositionFromSourceOffset(root.value, from)
  const { node: endNode, offset: endOffset } = domPositionFromSourceOffset(root.value, to)
  const range = document.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset)
  root.value.focus({ preventScroll: true }); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
  if (backward && selection && !selection.isCollapsed) { selection.collapse(endNode, endOffset); selection.extend(startNode, startOffset) }
  handleSelectionChange()
}

function tableCellContext() {
  const selection = window.getSelection()
  const node = selection?.anchorNode
  if (!node || !root.value?.contains(node)) return null
  const cell = (node.parentElement?.closest<HTMLElement>('td, th') || (node as HTMLElement).closest?.<HTMLElement>('td, th'))
  const table = cell?.closest<HTMLElement>('table')
  const block = table?.closest<HTMLElement>('.markdown-editor-block')
  return cell && table && block ? { cell, table, block } : null
}

function insertTableRow() {
  const context = tableCellContext()
  if (!context) return
  const columns = context.table.querySelectorAll('thead th').length || 1
  const insertAt = Number(context.block.dataset.sourceTo ?? source.length)
  const row = `\n| ${Array.from({ length: columns }, () => '').join(' | ')} |`
  replace(insertAt, insertAt, row, selectionOffset())
  setSelection(insertAt + 3)
}

function removeTableRow() {
  const context = tableCellContext()
  if (!context || context.cell.closest('tr')?.classList.contains('markdown-editor-table-syntax')) return
  const row = context.cell.closest<HTMLTableRowElement>('tr')
  const cells = row ? [...row.querySelectorAll<HTMLElement>('th, td')] : []
  if (!row || !cells.length) return
  const firstFrom = Number(cells[0].dataset.syntaxFrom ?? context.block.dataset.sourceFrom)
  const lastTo = Number(cells[cells.length - 1].dataset.syntaxTo ?? context.block.dataset.sourceTo)
  const blockFrom = Number(context.block.dataset.sourceFrom ?? 0)
  const rowFrom = firstFrom > blockFrom ? firstFrom - 1 : firstFrom
  replace(rowFrom, lastTo, '', selectionOffset())
  setSelection(Math.min(rowFrom, source.length))
}

function tablePipes(line: string) {
  const pipes: number[] = []
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '\\') { index++; continue }
    if (line[index] === '|') pipes.push(index)
  }
  return pipes
}

function insertTableColumn() {
  const context = tableCellContext()
  if (!context) return
  const blockFrom = Number(context.block.dataset.sourceFrom ?? 0)
  const blockTo = Number(context.block.dataset.sourceTo ?? source.length)
  const raw = source.slice(blockFrom, blockTo)
  const lines = raw.split('\n')
  const next = lines.map((line, index) => {
    const pipes = tablePipes(line)
    if (pipes.length < 2) return line
    const end = pipes[pipes.length - 1]
    return `${line.slice(0, end)}| ${index === 1 ? '---' : ''} ${line.slice(end)}`
  }).join('\n')
  replace(blockFrom, blockTo, next, selectionOffset())
  setSelection(blockFrom + next.length)
}

function removeLastTableColumn() {
  const context = tableCellContext()
  if (!context) return
  const blockFrom = Number(context.block.dataset.sourceFrom ?? 0)
  const blockTo = Number(context.block.dataset.sourceTo ?? source.length)
  const raw = source.slice(blockFrom, blockTo)
  const lines = raw.split('\n')
  if (lines.some(line => tablePipes(line).length < 3)) return
  const next = lines.map(line => {
    const pipes = tablePipes(line)
    const from = pipes[pipes.length - 2]
    const to = pipes[pipes.length - 1]
    return `${line.slice(0, from)}${line.slice(to)}`
  }).join('\n')
  replace(blockFrom, blockTo, next, selectionOffset())
  setSelection(Math.min(blockFrom + next.length, source.length))
}

function render(value: string, from = -1, to = from, backward = false) {

  if (!root.value) return
  rendering = true
  const previous = new Map<string, HTMLElement>()
  const previousActive = root.value.dataset.activeSyntaxKey || ''
  const currentActive = from >= 0 ? syntaxContext(from, to) : ''
  const activeStart = (key: string) => Number(key.split(':')[0])
  for (const element of Array.from(root.value.children)) {
    if (!(element instanceof HTMLElement) || !element.dataset.sourceText) continue
    const from = Number(element.dataset.sourceFrom)
    previous.set(`${from}:${from + element.dataset.sourceText.length}:${element.dataset.sourceText}`, element)
  }
  const fragment = document.createDocumentFragment()
  let cursor = 0
  const sourceDocument = sourceDocumentFor(value)
  for (const block of sourceDocument.blocks) {
    if (block.from > cursor) appendSourceGap(fragment, value.slice(cursor, block.from), cursor, block.from)
    const end = block.to
    const intersectsSelection = from >= 0 && (from >= block.from && from <= end || to >= block.from && to <= end)
    const key = `${block.from}:${end}:${block.text}`
    const previousBlockActive = previousActive && activeStart(previousActive) >= block.from && activeStart(previousActive) <= end
    const currentBlockActive = currentActive && activeStart(currentActive) >= block.from && activeStart(currentActive) <= end
    const reusable = !intersectsSelection && !previousBlockActive && !currentBlockActive ? previous.get(key) : undefined
    if (reusable) {
      for (const gap of reusable.querySelectorAll<HTMLElement>('.markdown-editor-source-gap')) {
        if (Number(gap.dataset.sourceFrom) >= end) gap.remove()
      }
      reusable.dataset.sourceTo = String(end)
    }
    fragment.append(reusable || (block.raw ? rawBlockElement(block.text, block.from, block.fallbackReason) : blockElement(block.text, block.from, from, to, block.type)))
    cursor = end
  }
  if (cursor < value.length) {
    appendSourceGap(fragment, value.slice(cursor), cursor, value.length)
  }
  if (!value || value.endsWith('\n')) {
    const paragraph = document.createElement('p')
    paragraph.className = 'markdown-editor-block'
    paragraph.dataset.sourceFrom = String(value.length)
    paragraph.dataset.sourceTo = String(value.length)
    paragraph.append(textNode('', value.length, value.length), document.createElement('br'))
    fragment.append(paragraph)
  }
  root.value.replaceChildren(fragment)
  mutationObserver?.takeRecords()
  root.value.dataset.activeSyntaxKey = currentActive
  root.value.classList.toggle('is-empty', !value)
  rendering = false
  if (from >= 0) setSelection(from, to, backward)
  void enhanceMermaidBlocks()
}
function isPlainSingleLine(value: string) {
  if (!value || value.includes("\n")) return false
  inlinePattern.lastIndex = 0
  const hasInline = inlinePattern.test(value)
  inlinePattern.lastIndex = 0
  return !hasInline && !/^( {0,3})(?:#{1,6}[ \t]|>[ \t]?|(?:[-+*]|\d+[.)])[ \t])/.test(value)
}

function patchPlainText(previous: string, next: string) {
  if (!root.value || !isPlainSingleLine(previous) || !isPlainSingleLine(next)) return false
  if (root.value.children.length !== 1) return false
  const holder = root.value.querySelector<HTMLElement>('p.markdown-editor-block > span[data-source-from]')
  if (!holder || holder.dataset.sourceFrom !== '0' || holder.textContent !== previous) return false
  if (holder.firstChild?.nodeType !== Node.TEXT_NODE) return false
  ;(holder.firstChild as Text).replaceData(0, previous.length, next)
  holder.dataset.sourceTo = String(next.length)
  const paragraph = holder.parentElement!
  paragraph.dataset.sourceTo = String(next.length)
  paragraph.dataset.sourceText = next
  mutationObserver?.takeRecords()
  return true
}

function replace(from: number, to: number, insert: string, selectionBefore: SelectionState = { from, to, backward: false }) {
  if (props.disabled) return
  from = Math.max(0, Math.min(source.length, from))
  to = Math.max(from, Math.min(source.length, to))
  suppressInputFallback = true
  queueMicrotask(() => { suppressInputFallback = false })
  const sourceBefore = source
  const sourceAfter = sourceBefore.slice(0, from) + insert + sourceBefore.slice(to)
  const selectionAfter = { from: from + insert.length, to: from + insert.length, backward: false }
  lastSelection = selectionAfter
  history.push({ sourceBefore, sourceAfter, from, to, insert, selectionBefore, selectionAfter })
  redoHistory = []
  source = sourceAfter
  emit('update:modelValue', source)
  if (patchPlainText(sourceBefore, sourceAfter)) {
    setSelection(selectionAfter.from, selectionAfter.to)
    return
  }
  render(sourceAfter, selectionAfter.from, selectionAfter.to)
}

function undo() {
  if (props.disabled || composing.value) return
  const transaction = history.pop()
  if (!transaction) return
  redoHistory.push(transaction)
  source = transaction.sourceBefore
  emit('update:modelValue', source)
  render(source, transaction.selectionBefore.from, transaction.selectionBefore.to, transaction.selectionBefore.backward)
}

function redo() {
  if (props.disabled || composing.value) return
  const transaction = redoHistory.pop()
  if (!transaction) return
  history.push(transaction)
  source = transaction.sourceAfter
  emit('update:modelValue', source)
  render(source, transaction.selectionAfter.from, transaction.selectionAfter.to, transaction.selectionAfter.backward)
}
function handleInputFallback() {
  if (rendering || composing.value || suppressInputFallback || !focused.value) return
  const range = selectionOffset()
  lastSelection = range
  render(source, range.from, range.to, range.backward)
}

function handleBeforeInput(event: InputEvent) {
  verticalColumn = undefined
  if (props.disabled) { event.preventDefault(); return }
  if (rendering) { event.preventDefault(); return }
  if (composing.value || event.isComposing) return
  const range = selectionOffset()
  lastSelection = range
  if (event.inputType === 'historyUndo') { event.preventDefault(); undo(); return }
  if (event.inputType === 'historyRedo') { event.preventDefault(); redo(); return }
  let value = event.data || ''
  if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
    const block = sourceDocumentFor(source).blocks.find(block => range.from >= block.from && range.from <= block.to)
    if (props.profile === 'article' && block?.type === 'blockquote_open') {
      const prefix = structuralPrefix(source, range.from, 'quote')
      if (prefix && prefix.to === range.from) {
        event.preventDefault()
        replace(prefix.from, prefix.to, '\n', range)
        return
      }
      value = quoteLineBreak(source, range.from, true)
    } else if (props.profile === 'article' && (block?.type === 'bullet_list_open' || block?.type === 'ordered_list_open')) {
      const prefix = structuralPrefix(source, range.from, 'list')
      if (prefix && prefix.to === range.from) {
        event.preventDefault()
        replace(prefix.from, prefix.to, '\n', range)
        return
      }
      value = listLineBreak(source, range.from, block.type === 'ordered_list_open')
    } else {
      value = '\n'
    }
  }
  if (event.inputType === 'deleteContentBackward' && range.from === range.to) {
    event.preventDefault()
    if (!range.from) return
    const block = sourceDocumentFor(source).blocks.find(block => range.from >= block.from && range.from <= block.to)
    const prefix = props.profile === 'article' && block
      ? (block.type === 'blockquote_open' ? structuralPrefix(source, range.from, 'quote')
        : block.type === 'bullet_list_open' || block.type === 'ordered_list_open' ? structuralPrefix(source, range.from, 'list') : undefined)
      : undefined
    if (prefix && prefix.to === range.from) {
      replace(prefix.from, prefix.to, '', range)
      return
    }
    replace(adjacentSourceOffset(source, range.from, -1), range.from, '', range)
    return
  }
  if (event.inputType === 'deleteContentForward' && range.from === range.to) { event.preventDefault(); if (range.from === source.length) return; replace(range.from, adjacentSourceOffset(source, range.from, 1), '', range); return }
  if (event.inputType.startsWith('delete')) {
    event.preventDefault()
    const target = event.getTargetRanges?.()[0]
    if (range.from === range.to && target && root.value) {
      const from = sourceOffsetFromDOM(root.value, target.startContainer, target.startOffset, range.from)
      const to = sourceOffsetFromDOM(root.value, target.endContainer, target.endOffset, range.to)
      replace(Math.min(from, to), Math.max(from, to), '', range)
    } else if (range.from !== range.to) replace(range.from, range.to, '', range)
    return
  }
  if (event.inputType.startsWith('insert')) { replace(range.from, range.to, value, range); event.preventDefault() }
}
function handlePaste(event: ClipboardEvent) { if (props.disabled) return; const text = event.clipboardData?.getData('text/plain'); if (!text) return; event.preventDefault(); const range = selectionOffset(); replace(range.from, range.to, text, range) }
function handleCopy(event: ClipboardEvent) {
  if (!event.clipboardData) return
  const range = selectionOffset()
  if (range.from === range.to) return
  event.preventDefault()
  event.clipboardData.setData('text/plain', source.slice(range.from, range.to))
}
function handleCut(event: ClipboardEvent) {
  if (props.disabled || composing.value) { event.preventDefault(); return }
  const range = selectionOffset()
  if (range.from === range.to || !event.clipboardData) return
  handleCopy(event)
  replace(range.from, range.to, '', range)
}
function handleKeydown(event: KeyboardEvent) {
  if (composing.value || event.isComposing) return
  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
    const selection = window.getSelection()
    const cell = selection?.anchorNode instanceof Node
      ? (selection.anchorNode.parentElement?.closest<HTMLElement>('td, th') || (selection.anchorNode as HTMLElement).closest?.<HTMLElement>('td, th'))
      : null
    const table = cell?.closest<HTMLElement>('table')
    if (cell && table) {
      const cells = [...table.querySelectorAll<HTMLElement>('th, td')].filter(item => !item.closest('tr')?.classList.contains('markdown-editor-table-syntax'))
      const index = cells.indexOf(cell)
      const next = cells[event.shiftKey ? index - 1 : index + 1]
      if (next) {
        event.preventDefault()
        const sourceFrom = Number(next.dataset.syntaxFrom ?? next.dataset.sourceFrom ?? source.length)
        const sourceTo = Number(next.dataset.syntaxTo ?? next.dataset.sourceTo ?? sourceFrom)
        const content = next.querySelector<HTMLElement>('[data-source-from][data-source-to]')
        const contentStart = content ? Number(content.dataset.sourceFrom) : sourceFrom
        const target = Math.min(sourceTo, [...source.slice(contentStart, sourceTo)].findIndex(char => !/[\s|]/.test(char)) >= 0
          ? contentStart + [...source.slice(contentStart, sourceTo)].findIndex(char => !/[\s|]/.test(char))
          : contentStart)
        setSelection(target)
        return
      }
      if (!event.shiftKey && index === cells.length - 1) {
        const block = table.closest<HTMLElement>('.markdown-editor-block')
        const columns = table.querySelectorAll('thead th').length || 1
        if (block && columns > 0) {
          event.preventDefault()
          const insertAt = Number(block.dataset.sourceTo ?? source.length)
          const row = `\n| ${Array.from({ length: columns }, () => '').join(' | ')} |`
          replace(insertAt, insertAt, row, selectionOffset())
          setSelection(insertAt + 3)
          return
        }
      }
    }
  }
  if (event.ctrlKey || event.metaKey || event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) verticalColumn = undefined
  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
    const range = selectionOffset()
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const anchor = range.backward ? range.to : range.from
      const focus = range.backward ? range.from : range.to
      const start = focus ? source.lastIndexOf('\n', focus - 1) + 1 : 0
      const end = source.indexOf('\n', focus)
      const currentEnd = end < 0 ? source.length : end
      const targetStart = event.key === 'ArrowUp'
        ? start ? start === 1 ? 0 : source.lastIndexOf('\n', start - 2) + 1 : -1
        : end < 0 ? -1 : end + 1
      if (targetStart >= 0) {
        const targetBreak = source.indexOf('\n', targetStart)
        const targetEnd = targetBreak < 0 ? source.length : targetBreak
        // Native navigation is retained for wrapped/styled text. Chromium
        // canonicalizes consecutive whitespace-only paragraphs to one caret,
        // so empty source lines need explicit source-based vertical steps.
        if (!source.slice(start, currentEnd).trim() || !source.slice(targetStart, targetEnd).trim()) {
          event.preventDefault()
          verticalColumn ??= focus - start
          const target = Math.min(targetEnd, targetStart + verticalColumn)
          if (event.shiftKey) setSelection(Math.min(anchor, target), Math.max(anchor, target), target < anchor)
          else setSelection(target)
          return
        }
      }
      verticalColumn = undefined
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const anchor = range.backward ? range.to : range.from
      const focus = range.backward ? range.from : range.to
      let target = focus
      if (event.key === 'Home') target = focus ? source.lastIndexOf('\n', focus - 1) + 1 : 0
      else if (event.key === 'End') {
        const lineEnd = source.indexOf('\n', focus)
        target = lineEnd < 0 ? source.length : lineEnd
      } else if (!event.shiftKey && range.from !== range.to) {
        target = event.key === 'ArrowLeft' ? range.from : range.to
      } else {
        target = adjacentSourceOffset(source, focus, event.key === 'ArrowLeft' ? -1 : 1)
      }
      if (event.shiftKey) setSelection(Math.min(anchor, target), Math.max(anchor, target), target < anchor)
      else setSelection(target)
      return
    }
  }
  if (!(event.ctrlKey || event.metaKey)) return
  const key = event.key.toLowerCase()
  if (key === 'z' && !event.shiftKey) { event.preventDefault(); undo() }
  else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); redo() }
}
function handleCompositionStart() { compositionRange = selectionOffset(); composing.value = true; compositionText = '' }
function handleCompositionEnd(event: CompositionEvent) {
  composing.value = false
  if (pendingExternalValue !== undefined) {
    const value = pendingExternalValue
    pendingExternalValue = undefined
    compositionText = ''
    applyExternalValue(value)
    return
  }
  const committedText = event.data ?? compositionText
  if (committedText) replace(compositionRange.from, compositionRange.to, committedText)
  else render(source, compositionRange.from, compositionRange.to)
  compositionText = ''
}
function insertSyntax(before: string, after: string) {
  if (props.disabled || composing.value) return
  const range = selectionOffset()
  replace(range.from, range.to, `${before}${source.slice(range.from, range.to)}${after}`)
  setSelection(range.from + before.length, range.from + before.length + (range.to - range.from))
}

function applyExternalValue(value: string) {
  if (value === source) return
  if (composing.value) { pendingExternalValue = value; return }
  source = value
  history = []
  redoHistory = []
  if (focused.value) render(value, Math.min(lastSelection.from, value.length), Math.min(lastSelection.to, value.length), lastSelection.backward)
  else render(value)
}

watch(() => props.modelValue, applyExternalValue)
watch(() => props.profile, () => {
  if (composing.value) return
  if (focused.value) render(source, lastSelection.from, lastSelection.to, lastSelection.backward)
  else render(source)
})
watch(() => props.disabled, value => { if (root.value) root.value.contentEditable = value ? 'false' : 'true' })
onMounted(() => {
  if (root.value) root.value.contentEditable = props.disabled ? 'false' : 'true'
  document.addEventListener('selectionchange', handleSelectionChange)
  const editorRoot = root.value
  if (!editorRoot) return
  mutationObserver = new MutationObserver(records => {
    if (rendering || composing.value || suppressInputFallback) return
    if (records.length && records.every(record => {
      const target = record.target instanceof Element ? record.target : null
      return target?.closest('.markdown-editor-mermaid-preview') || [...record.addedNodes].every(node => node instanceof Element && node.closest('.markdown-editor-mermaid-preview'))
    })) return
    // Browser translation tools, spellcheckers, and extensions can mutate a
    // contenteditable subtree without dispatching beforeinput. The Markdown
    // source remains authoritative, so restore the semantic DOM from it.
    if (focused.value) render(source, lastSelection.from, lastSelection.to, lastSelection.backward)
    else render(source)
  })
  mutationObserver.observe(editorRoot, { subtree: true, childList: true, characterData: true })
  render(source)
})
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', handleSelectionChange)
  mutationObserver?.disconnect()
})
defineExpose({ focus: () => root.value?.focus(), sync: () => source, insertSyntax, insertTableRow, removeTableRow, insertTableColumn, removeLastTableColumn, setValue: applyExternalValue })
</script>
