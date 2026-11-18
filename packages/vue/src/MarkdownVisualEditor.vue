<template>
  <div ref="surface" class="markdown-visual-surface">
  <div
    ref="root"
    class="markdown-visual-editor bd-markdown-theme"
    :class="{ 'is-disabled': disabled, 'is-comment': profile === 'comment', 'is-structure-mode': editingStyle === 'structure', 'is-always-syntax': editingStyle === 'always' }"
    :data-editing-effects="editingEffects"
    :contenteditable="!disabled && tableSourceDraft === undefined"
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
    @pointermove="handleTableHover"
    @pointerleave="scheduleTableClose"
    @paste="handlePaste"
    @copy="handleCopy"
    @cut="handleCut"
    @focus="focused = true"
    @blur="handleBlur"
  />
  <Transition name="markdown-table-popover">
    <MarkdownTableControls
      v-if="tableTarget && !disabled"
      :target="tableTarget"
      :tools="tableTools"
      :toolbar-style="tableControlsStyle"
      :row-style="tableRowStyle"
      :column-style="tableColumnStyle"
      :source-draft="tableSourceDraft"
      :error="tableSourceError"
      :disabled="disabled"
      @command="runTableCommand"
      @update:source-draft="tableSourceDraft = $event"
      @apply-source="closeTableSource(true)"
      @cancel-source="closeTableSource()"
      @keep-open="enterTableTools"
      @leave="scheduleTableClose"
      @close="closeTableControls"
    />
  </Transition>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createMarkdownTable, completeMarkdownTableHeader, parseMarkdownTable, updateMarkdownTable, MarkdownSourceDocument, domPositionFromSourceOffset, sourceOffsetFromDOM, verticalDOMPosition, adjacentSourceOffset, listLineBreak, quoteLineBreak, structuralPrefix } from '@n0v0rland-md/core'
import type { TableAlignment, TableCommand } from '@n0v0rland-md/core'
import MarkdownTableControls from './MarkdownTableControls.vue'
import { copyPresentation, inlinePresentation } from './markdown-presentation'
import type { MarkdownEditorAdapter, MarkdownEditingStyle, MarkdownEditingEffects, MarkdownHighlightCode, MarkdownLinkHandler, MarkdownRenderMermaid, MarkdownSyntaxState } from './types'

type Profile = 'article' | 'comment'
const props = withDefaults(defineProps<{
  modelValue: string
  profile?: Profile
  adapter: MarkdownEditorAdapter
  highlightCode?: MarkdownHighlightCode
  renderMermaid?: MarkdownRenderMermaid
  onLinkClick?: MarkdownLinkHandler
  editingStyle?: MarkdownEditingStyle
  editingEffects?: MarkdownEditingEffects
  syntaxEditing?: Record<string, { reveal?: 'always' | 'near' | 'inside' | 'never'; effect?: 'theme' | 'pause-inside' | 'pause-active' | 'none' }>
  disabled?: boolean
  placeholder?: string
  label?: string
}>(), { profile: 'article', editingStyle: 'blur-hidden', editingEffects: 'stable', disabled: false, placeholder: '请输入内容…', label: 'Markdown 内容' })
const emit = defineEmits<{ 'update:modelValue': [value: string]; 'syntax-state-change': [states: MarkdownSyntaxState[]] }>()
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
let compositionRange: SelectionState = { from: 0, to: 0, backward: false }
let pendingExternalValue: string | undefined
let activeSyntaxKey = ''
let suppressInputFallback = false
let mutationObserver: MutationObserver | undefined
let lastSelection: SelectionState = { from: source.length, to: source.length, backward: false }
let verticalColumn: number | undefined
let verticalX: number | undefined
let syntaxRevealTimer: number | undefined
let sourceDocumentCache: { source: string; profile: Profile; adapter: MarkdownEditorAdapter; document: MarkdownSourceDocument } | undefined
let renderedDefinitionContext = ''
let selectedImageRange: { from: number; to: number } | undefined

const inlinePattern = /(?<!\\)(!\[[^\]\n]*\]\([^) \n]+(?:\s+"[^"]*")?\)|\[[^\]\n]+\]\([^) \n]+(?:\s+"[^"]*")?\)|\[[^\]\n]+\]\[[^\]\n]+\]|\[\^[^\]\n]+\]|\*\*[^*\n]+\*\*|__[^_\n]+__|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)|\+\+[^+\n]+\+\+|~~[^~\n]+~~|==[^=\n]+==|`[^`\n]+`|\|\|[^|\n]+\|\||::(?:whisper|loud|inner|不解析|no[ -]?parse|raw)\[[^\]\n]+\]|:[a-z][a-z0-9_+-]*:)/gi

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
  const visible = props.editingStyle === 'always' ? true : props.editingStyle === 'structure' ? false : active
  node.className = `markdown-syntax-boundary${visible ? ' is-visible' : ''}`
  node.dataset.sourceFrom = String(from)
  node.dataset.sourceTo = String(to)
  if (props.editingStyle === 'structure') {
    node.dataset.sourceHidden = 'true'
    node.contentEditable = 'false'
  }
  node.setAttribute('aria-hidden', visible ? 'false' : 'true')
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

type ImageSourceParts = { from: number; bodyFrom: number; bodyTo: number; to: number }

function imageElement(raw: string, parts: ImageSourceParts, attrs: [string, string][], activeFrom: number, activeTo: number) {
  const wrapper = document.createElement('span')
  wrapper.className = 'markdown-editor-image'
  wrapper.dataset.sourceFrom = String(parts.from)
  wrapper.dataset.sourceTo = String(parts.to)
  const figure = document.createElement('span')
  figure.className = 'bd-md-figure markdown-editor-image-figure'
  figure.setAttribute('role', 'figure')
  const image = document.createElement('img')
  for (const [name, value] of attrs) if (name === 'src' || name === 'title') image.setAttribute(name, value)
  const size = image.getAttribute('src')?.match(/#(\d+)x(\d+)$/)
  if (size) {
    image.setAttribute('src', image.getAttribute('src')!.slice(0, -size[0].length))
    image.style.setProperty('--img-w', size[1])
    image.style.setProperty('--img-h', size[2])
    image.style.aspectRatio = `${size[1]} / ${size[2]}`
  }
  image.alt = props.adapter.markdown.utils?.unescapeAll?.(raw.slice(parts.bodyFrom - parts.from, parts.bodyTo - parts.from)) || ''
  image.draggable = false
  image.contentEditable = 'false'
  image.addEventListener('error', () => {
    figure.classList.add('is-image-error')
    image.classList.add('img-load-failed')
  })
  const caption = document.createElement('span')
  caption.className = 'bd-md-caption markdown-editor-image-caption'
  caption.dataset.sourceFrom = String(parts.bodyFrom)
  caption.dataset.sourceTo = String(parts.bodyTo)
  caption.dataset.placeholder = '点击输入图片描述'
  caption.setAttribute('aria-label', '图片描述')
  const body = raw.slice(parts.bodyFrom - parts.from, parts.bodyTo - parts.from)
  const captionText = textNode('', parts.bodyFrom, parts.bodyTo)
  const offsets = [parts.bodyFrom]
  let cursor = 0
  let display = ''
  while (cursor < body.length) {
    const chunk = body.slice(cursor).match(/^(?:\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]|&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);)/)?.[0]
      || String.fromCodePoint(body.codePointAt(cursor)!)
    const decoded = props.adapter.markdown.utils?.unescapeAll?.(chunk) ?? chunk
    cursor += chunk.length
    display += decoded
    for (let index = 0; index < decoded.length; index++) offsets.push(parts.bodyFrom + cursor)
  }
  captionText.textContent = display
  captionText.dataset.sourceOffsets = offsets.join(',')
  caption.append(captionText)
  if (!body) {
    caption.classList.add('is-empty')
    caption.append(document.createElement('br'))
  }
  const active = nearSyntax(activeFrom, activeTo, parts.from, parts.bodyFrom)
    || nearSyntax(activeFrom, activeTo, parts.bodyTo, parts.to)
  figure.append(image, caption)
  wrapper.append(boundary(raw.slice(0, parts.bodyFrom - parts.from), parts.from, parts.bodyFrom, active),
    figure, boundary(raw.slice(parts.bodyTo - parts.from), parts.bodyTo, parts.to, active))
  return wrapper
}

function footnoteReference(spelling: string, from: number, to: number, activeFrom: number, activeTo: number, token?: InlineToken) {
  const wrapper = document.createElement('span')
  wrapper.className = 'markdown-editor-footnote-ref'
  wrapper.dataset.sourceFrom = String(from)
  wrapper.dataset.sourceTo = String(to)
  const label = spelling.slice(2, -1)
  wrapper.dataset.footnoteLabel = label
  const id = token?.meta?.id ?? sourceDocumentFor(source).env.footnotes?.refs?.[`:${label}`]
  const number = document.createElement('sup')
  number.className = 'footnote-ref markdown-editor-footnote-number'
  number.contentEditable = 'false'
  number.textContent = `[${typeof id === 'number' && id >= 0 ? id + 1 : label}]`
  number.title = `脚注 ${label}，点击查看正文`
  number.setAttribute('role', 'button')
  number.setAttribute('aria-label', `查看脚注 ${label}`)
  const marker = boundary(spelling, from, to, nearSyntax(activeFrom, activeTo, from, to))
  wrapper.append(marker, number)
  return wrapper
}

// Delimiters belong to the source group, not to the styled content. Keeping
// them as siblings also prevents code/mark backgrounds and link hit areas
// from painting the syntax itself.
function separateInlineSyntax(root: ParentNode) {
  for (const element of [...root.querySelectorAll<HTMLElement>('[data-source-from][data-source-to]')].reverse()) {
    if (element.matches('.markdown-inline-syntax, .markdown-editor-image, .markdown-editor-block, .markdown-editor-code, .markdown-editor-heading-content')) continue
    const markers = [...element.children].filter(child => child.classList.contains('markdown-syntax-boundary'))
    if (markers.length !== 2 || element.firstElementChild !== markers[0] || element.lastElementChild !== markers[1]) continue
    const group = document.createElement('span')
    group.className = 'markdown-inline-syntax'
    group.dataset.sourceFrom = element.dataset.sourceFrom
    group.dataset.sourceTo = element.dataset.sourceTo
    group.dataset.syntaxTag = element.tagName
    element.replaceWith(group)
    group.append(markers[0], element, markers[1])
  }
}

type InlineToken = {
  type: string
  content?: string
  markup?: string
  children?: InlineToken[]
  attrs?: [string, string][]
  meta?: { sourceFrom?: number; sourceTo?: number; syntaxKind?: string; contentMode?: 'text' | 'markdown'; id?: number; label?: string }
}

function tokenInlineNodes(text: string, start: number, activeFrom = -1, activeTo = -1, originalTokens?: InlineToken[]) {
  let tokens: InlineToken[]
  try {
    const document = sourceDocumentFor(source)
    const block = document.blockAt(start)
    const inline = block?.tokens.filter(token => token.type === 'inline' && token.content === text)
    // Reuse original parser tokens when this is the block's complete inline
    // content. Partial/nested bodies still share the full document's env.
    const parsed = inline?.length === 1 ? inline[0] : props.adapter.markdown.parseInline?.(text, document.env)?.[0]
    tokens = originalTokens || parsed?.children as InlineToken[] || []
  } catch {
    return null
  }
  const supported = new Set(['text', 'text_special', 'softbreak', 'hardbreak', 'strong_open', 'strong_close', 'em_open', 'em_close', 's_open', 's_close', 'ins_open', 'ins_close', 'mark_open', 'mark_close', 'spoiler_open', 'spoiler_close', 'code_inline', 'html_inline', 'link_open', 'link_close', 'image', 'emoji', 'footnote_ref'])
  if (!tokens.length || tokens.some(token => {
    if (supported.has(token.type)) return false
    return !Boolean(token.meta?.syntaxKind && props.adapter.syntax?.resolve(token.meta.syntaxKind)?.getInlineParts)
  })) return null
  if (tokens.some(token => token.type === 'html_inline' && (token.meta?.sourceFrom == null || token.meta?.sourceTo == null)
    && !props.adapter.syntax?.resolve(token.meta?.syntaxKind)?.getSourceRange)) return null
  let cursor = 0
  let index = 0
  let lastClose: { from: number; to: number } | undefined
  let lastCloseToken: InlineToken | undefined
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
  const consumeDecoded = (content: string) => {
    const from = cursor
    if (text.slice(cursor, cursor + content.length) === content) {
      cursor += content.length
      return { from: start + from, to: start + cursor }
    }
    const decode = (value: string) => {
      const utils = (props.adapter.markdown as any).utils
      if (utils?.unescapeAll) return utils.unescapeAll(value)
      const holder = document.createElement('textarea')
      holder.innerHTML = value
      return holder.value.replace(/\\([\\`*_[\]{}()#+.!<>-])/g, '$1')
    }
    for (let end = cursor + 1; end <= text.length; end++) {
      if (decode(text.slice(cursor, end)) === content) {
        cursor = end
        return { from: start + from, to: start + cursor }
      }
    }
    return undefined
  }
  const decodedNode = (content: string, from: number, to: number) => {
    const holder = textNode(content, from, to)
    const raw = text.slice(from - start, to - start)
    if (raw === content) return holder
    const offsets = [from]
    const unescape = (value: string) => props.adapter.markdown.utils?.unescapeAll?.(value) ?? value
    let sourceCursor = 0
    let visibleCursor = 0
    while (sourceCursor < raw.length) {
      const chunk = raw.slice(sourceCursor).match(/^(?:\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]|&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);)/)?.[0]
        || String.fromCodePoint(raw.codePointAt(sourceCursor)!)
      const visible = unescape(chunk)
      sourceCursor += chunk.length
      for (let i = 0; i < visible.length; i++) offsets.push(from + sourceCursor)
      visibleCursor += visible.length
    }
    if (visibleCursor === content.length) holder.dataset.sourceOffsets = offsets.join(',')
    return holder
  }
  const tagFor = (type: string) => ({
    strong_open: 'strong',
    em_open: 'em',
    s_open: 's',
    ins_open: 'u',
    mark_open: 'mark',
  } as Record<string, string>)[type] || 'span'
  const customRange = (token: InlineToken) => {
    try {
      const configured = props.adapter.syntax?.resolve(token.meta?.syntaxKind)?.getSourceRange?.(token, {
        source: text, blockFrom: start, tokenFrom: cursor,
      })
      const from = token.meta?.sourceFrom ?? configured?.from
      const to = token.meta?.sourceTo ?? configured?.to
      return from !== undefined && to !== undefined && Number.isInteger(from) && Number.isInteger(to)
        && from === cursor && to >= from && to <= text.length ? { from, to } : undefined
    } catch {
      return
    }
  }
  const linkSourceParts = (image: boolean) => {
    const beginning = cursor
    const labelStart = beginning + (image ? 2 : 1)
    if (text.slice(beginning, labelStart) !== (image ? '![' : '[')) return
    const md = props.adapter.markdown
    if (md.helpers?.parseLinkLabel && md.helpers?.parseLinkDestination && md.helpers?.parseLinkTitle && md.inline?.State) {
      const state = new md.inline.State(text, md, {}, [])
      const labelEnd = md.helpers.parseLinkLabel(state, labelStart - 1, !image)
      if (labelEnd < 0) return
      if (text[labelEnd + 1] !== '(') {
        let end = labelEnd + 1
        if (text[end] === '[') {
          const referenceEnd = md.helpers.parseLinkLabel(state, end, false)
          if (referenceEnd < 0) return
          end = referenceEnd + 1
        }
        return { from: start + beginning, bodyFrom: start + labelStart, bodyTo: start + labelEnd, to: start + end }
      }
      let position = labelEnd + 2
      while (/[ \t\r\n]/.test(text[position] || '\0')) position++
      const destination = md.helpers.parseLinkDestination(text, position, text.length)
      if (!destination.ok) return
      position = destination.pos
      const destinationEnd = position
      while (/[ \t\r\n]/.test(text[position] || '\0')) position++
      if (position > destinationEnd) {
        const title = md.helpers.parseLinkTitle(text, position, text.length)
        if (title.ok) {
          position = title.pos
          while (/[ \t\r\n]/.test(text[position] || '\0')) position++
        }
      }
      if (text[position] !== ')') return
      return { from: start + beginning, bodyFrom: start + labelStart, bodyTo: start + labelEnd, to: start + position + 1 }
    }
    let depth = 1
    let labelEnd = labelStart
    for (; labelEnd < text.length; labelEnd++) {
      if (text[labelEnd] === '\\') { labelEnd++; continue }
      if (text[labelEnd] === '[') depth++
      if (text[labelEnd] === ']') { depth--; if (!depth) break }
    }
    if (depth || text[labelEnd + 1] !== '(') return
    // The parser already recognized the link. Find its complete source
    // suffix, respecting quoted titles, escaped characters and nested URLs.
    let parentheses = 1
    let quote = ''
    let end = labelEnd + 2
    for (; end < text.length; end++) {
      const char = text[end]
      if (char === '\\') { end++; continue }
      if (quote) { if (char === quote) quote = ''; continue }
      if ((char === '"' || char === "'") && /\s/.test(text[end - 1])) { quote = char; continue }
      if (char === '(') parentheses++
      if (char === ')') { parentheses--; if (!parentheses) break }
    }
    if (parentheses) return
    return { from: start + beginning, bodyFrom: start + labelStart, bodyTo: start + labelEnd, to: start + end + 1 }
  }
  const renderUntil = (closeType?: string): DocumentFragment | null => {
    const fragment = document.createDocumentFragment()
    while (index < tokens.length) {
      const token = tokens[index++]
      if (closeType && token.type === closeType) {
        const range = consume(token.markup || '', true)
        if (!range) return null
        lastClose = range
        lastCloseToken = token
        return fragment
      }
      if (token.type === 'softbreak' || token.type === 'hardbreak') {
        const separator = text.slice(cursor).match(/^(?: {2,}|\\)?\r?\n/)?.[0]
        if (!separator) return null
        const range = consume(separator, true)
        if (!range) return null
        const newlineFrom = range.to - (separator.endsWith('\r\n') ? 2 : 1)
        if (newlineFrom > range.from) fragment.append(boundary(separator.slice(0, newlineFrom - range.from), range.from, newlineFrom,
          nearSyntax(activeFrom, activeTo, range.from, newlineFrom)))
        fragment.append(textNode('\n', newlineFrom, range.to))
        continue
      }
      if (token.type === 'emoji') {
        const spelling = `:${token.markup}:`
        const range = consume(spelling, true)
        if (!range) return null
        const holder = textNode(spelling, range.from, range.to)
        holder.classList.add('markdown-editor-emoji')
        fragment.append(holder)
        continue
      }
      if (token.type === 'footnote_ref') {
        const spelling = text.slice(cursor).match(/^\[\^[^\]\n]+\]/)?.[0]
        if (!spelling) return null
        const range = consume(spelling, true)!
        fragment.append(footnoteReference(spelling, range.from, range.to, activeFrom, activeTo, token))
        continue
      }
      if (token.type === 'text' || token.type === 'text_special') {
        const value = token.content || ''
        if (!value) continue
        const range = consumeDecoded(value)
        if (!range) return null
        fragment.append(decodedNode(value, range.from, range.to))
        continue
      }
      if (token.type === 'link_open') {
        // Markdown-it identifies these spellings; source scanning only maps
        // their delimiters and never decides whether a URL is a valid link.
        if (token.markup !== 'autolink' && token.markup !== 'linkify') {
          const parts = linkSourceParts(false)
          if (!parts) return null
          let depth = 1
          let closeIndex = index
          for (; closeIndex < tokens.length; closeIndex++) {
            if (tokens[closeIndex].type === 'link_open') depth++
            if (tokens[closeIndex].type === 'link_close') { depth--; if (!depth) break }
          }
          if (depth) return null
          const anchor = document.createElement('a')
          anchor.className = 'markdown-editor-inline-link'
          for (const [name, value] of token.attrs || []) if (name === 'href' || name === 'title') anchor.setAttribute(name, value)
          anchor.rel = 'noopener noreferrer'
          anchor.dataset.sourceFrom = String(parts.from)
          anchor.dataset.sourceTo = String(parts.to)
          const active = nearSyntax(activeFrom, activeTo, parts.from, parts.bodyFrom) || nearSyntax(activeFrom, activeTo, parts.bodyTo, parts.to)
          anchor.append(boundary('[', parts.from, parts.bodyFrom, active),
            inlineNodes(text.slice(parts.bodyFrom - start, parts.bodyTo - start), parts.bodyFrom, activeFrom, activeTo),
            boundary(text.slice(parts.bodyTo - start, parts.to - start), parts.bodyTo, parts.to, active))
          fragment.append(anchor)
          cursor = parts.to - start
          index = closeIndex + 1
          continue
        }
        const body = tokens[index]
        const closeToken = tokens[index + 1]
        if (body?.type !== 'text' || closeToken?.type !== 'link_close') return null
        const bracketed = token.markup === 'autolink'
        const from = start + cursor
        const open = bracketed ? consume('<', true) : { from, to: from }
        const bodyRange = open && consumeDecoded(body.content || '')
        const close = bodyRange && (bracketed ? consume('>', true) : { from: bodyRange.to, to: bodyRange.to })
        if (!open || !bodyRange || !close) return null
        index += 2
        const anchor = document.createElement('a')
        anchor.className = 'markdown-editor-autolink'
        for (const [name, value] of token.attrs || []) if (name === 'href' || name === 'title') anchor.setAttribute(name, value)
        anchor.rel = 'noopener noreferrer'
        anchor.dataset.sourceFrom = String(from)
        anchor.dataset.sourceTo = String(close.to)
        const active = nearSyntax(activeFrom, activeTo, open.from, open.to) || nearSyntax(activeFrom, activeTo, close.from, close.to)
        if (bracketed) anchor.append(boundary('<', open.from, open.to, active))
        anchor.append(decodedNode(body.content || '', bodyRange.from, bodyRange.to))
        if (bracketed) anchor.append(boundary('>', close.from, close.to, active))
        fragment.append(anchor)
        continue
      }
      if (token.type === 'image') {
        const parts = linkSourceParts(true)
        if (!parts) return null
        fragment.append(imageElement(text.slice(parts.from - start, parts.to - start), parts, token.attrs || [], activeFrom, activeTo))
        cursor = parts.to - start
        continue
      }
      if (token.type === 'code_inline') {
        const markup = token.markup || '`'
        const open = consume(markup, true)
        if (!open) return null
        const content = token.content || ''
        const bodyStart = cursor
        const closingPattern = /`+/g
        closingPattern.lastIndex = cursor
        let closing: RegExpExecArray | null
        do { closing = closingPattern.exec(text) } while (closing && closing[0].length !== markup.length)
        if (!closing) return null
        const rawBody = text.slice(bodyStart, closing.index)
        const normalized = rawBody.replace(/\r?\n/g, ' ')
        const trimPadding = normalized.startsWith(' ') && normalized.endsWith(' ') && /[^ ]/.test(normalized)
        if ((trimPadding ? normalized.slice(1, -1) : normalized) !== content) return null
        const padding = trimPadding ? 1 : 0
        cursor = closing.index
        const close = consume(markup, true)
        if (!close) return null
        const wrapper = document.createElement('code')
        wrapper.dataset.sourceFrom = String(open.from)
        wrapper.dataset.sourceTo = String(close.to)
        const active = nearSyntax(activeFrom, activeTo, open.from, open.to) || nearSyntax(activeFrom, activeTo, close.from, close.to)
        wrapper.append(boundary(markup + rawBody.slice(0, padding), open.from, start + bodyStart + padding, active),
          textNode(content, start + bodyStart + padding, close.from - padding),
          boundary(rawBody.slice(rawBody.length - padding) + markup, close.from - padding, close.to, active))
        fragment.append(wrapper)
        continue
      }
      if (token.meta?.syntaxKind) {
        const definition = props.adapter.syntax?.resolve(token.meta.syntaxKind)
        const range = customRange(token)
        if (!range || !definition) return null
        const raw = text.slice(range.from, range.to)
        const parts = definition.getInlineParts?.(raw)
        if (!parts || range.from !== cursor || !parts.body || parts.open + parts.body + parts.close !== raw) return null
        const open = consume(parts.open, true)
        const body = consume(parts.body, true)
        const close = consume(parts.close, true)
        if (!open || !body || !close) return null
        const wrapper = document.createElement('span')
        wrapper.className = definition.editorClassName || definition.className || ''
        wrapper.dataset.syntaxKind = definition.name
        if (definition.className && definition.editorClassName && definition.className !== definition.editorClassName) {
          wrapper.classList.add(definition.className)
        }
        const active = nearSyntax(activeFrom, activeTo, open.from, open.to) || nearSyntax(activeFrom, activeTo, close.from, close.to)
        wrapper.dataset.sourceFrom = String(open.from)
        wrapper.dataset.sourceTo = String(close.to)
        const content = (token.meta.contentMode || definition.contentMode) === 'markdown'
          ? tokenInlineNodes(parts.body, body.from, activeFrom, activeTo, token.children) || textNode(parts.body, body.from, body.to)
          : textNode(parts.body, body.from, body.to)
        wrapper.append(boundary(parts.open, open.from, open.to, active), content, boundary(parts.close, close.from, close.to, active))
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
        const mappedContent = document.createDocumentFragment()
        const active = nearSyntax(activeFrom, activeTo, open.from, open.to) || nearSyntax(activeFrom, activeTo, close.from, close.to)
        mappedContent.append(inner)
        const wrapper = inlinePresentation(props.adapter.markdown, token, lastCloseToken, mappedContent,
          sourceDocumentFor(source).env, tagFor(token.type)) || document.createElement(tagFor(token.type))
        wrapper.dataset.sourceFrom = String(open.from)
        wrapper.dataset.sourceTo = String(close.to)
        if (mappedContent.childNodes.length) wrapper.append(mappedContent)
        wrapper.prepend(boundary(markup, open.from, open.to, active))
        wrapper.append(boundary(closeMarkup, close.from, close.to, active))
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
  const parsed = tokenInlineNodes(text, start, activeFrom, activeTo)
  if (parsed) return parsed
  // Never infer another syntax from regex when the injected parser cannot be mapped.
  const fragment = document.createDocumentFragment()
  fragment.append(textNode(text, start, start + text.length))
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

function footnoteDefinitionElement(raw: string, from: number, activeFrom: number, activeTo: number) {
  const first = raw.match(/^( {0,3}\[\^([^\]\s]+)\]:[ \t]*)([^\r\n]*)/)
  const refs = sourceDocumentFor(source).env.footnotes?.refs
  if (!first || !refs || !Object.prototype.hasOwnProperty.call(refs, `:${first[2]}`)) return
  const lines = raw.split('\n')
  // Complex definitions keep the source fallback. Only expose paragraphs
  // whose exact line indentation can be mapped without flattening blocks.
  if (lines.slice(1).some(line => line.trim() && !/^(?: {4}|\t)/.test(line))) return
  const body = lines.map((line, index) => index === 0 ? line.slice(first[1].length) : line.replace(/^(?: {4}|\t)/, '')).join('\n')
  const parsed = new MarkdownSourceDocument(body, props.adapter.parser)
  if (parsed.blocks.some(block => block.raw || block.type !== 'paragraph_open')) return
  const element = document.createElement('section')
  element.className = 'markdown-editor-block markdown-editor-footnote-definition footnote-item'
  element.dataset.footnoteLabel = first[2]
  element.dataset.sourceFrom = String(from)
  element.dataset.sourceTo = String(from + raw.length)
  const id = refs[`:${first[2]}`]
  const number = document.createElement('span')
  number.className = 'markdown-editor-footnote-definition-number'
  number.contentEditable = 'false'
  number.textContent = `${id >= 0 ? id + 1 : first[2]}.`
  number.title = `脚注 ${first[2]}`
  element.append(number)
  let offset = from
  for (const [index, line] of lines.entries()) {
    const prefix = index === 0 ? first[1] : line.match(/^(?: {4}|\t)/)?.[0] || ''
    const paragraph = document.createElement('p')
    paragraph.className = 'markdown-editor-footnote-body'
    paragraph.dataset.sourceFrom = String(offset)
    paragraph.dataset.sourceTo = String(offset + line.length)
    const contentFrom = offset + prefix.length
    if (prefix) paragraph.append(boundary(prefix, offset, contentFrom, nearSyntax(activeFrom, activeTo, offset, contentFrom)))
    paragraph.append(inlineNodes(line.slice(prefix.length), contentFrom, activeFrom, activeTo))
    if (!line.slice(prefix.length)) paragraph.append(textNode('', contentFrom, contentFrom), document.createElement('br'))
    if (index < lines.length - 1) paragraph.append(lineEnding('\n', offset + line.length))
    element.append(paragraph)
    offset += line.length + 1
  }
  return element
}

function sourceDocumentFor(value: string) {
  const profile = props.profile
  if (sourceDocumentCache?.source === value && sourceDocumentCache.profile === profile && sourceDocumentCache.adapter === props.adapter) return sourceDocumentCache.document
  const document = new MarkdownSourceDocument(value, props.adapter.parser as any)
  sourceDocumentCache = { source: value, profile, adapter: props.adapter, document }
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
  const model = parseMarkdownTable(raw, props.adapter.parser)
  if (!model) return rawBlockElement(raw, from, '不规则表格')
  const wrapper = document.createElement('div')
  wrapper.className = 'markdown-editor-block markdown-editor-table'
  // Reuse presentation from the host renderer, including optional wrappers.
  // Only mapped cell contents are replaced; Markdown remains the sole state.
  const template = document.createElement('template')
  template.innerHTML = props.adapter.render(raw)
  const rendered = template.content.querySelector('table')
  if (!rendered || rendered.rows.length !== model.rows.length
    || [...rendered.rows].some(row => row.cells.length !== model.alignments.length
      || [...row.cells].some(cell => cell.colSpan !== 1 || cell.rowSpan !== 1))) {
    return rawBlockElement(raw, from, '自定义表格结构')
  }
  const copyPresentation = (target: HTMLElement, original?: Element | null) => {
    for (const attr of original?.attributes || []) {
      if (['class', 'style', 'align', 'valign', 'width', 'height', 'border', 'cellpadding', 'cellspacing', 'scope'].includes(attr.name)) {
        target.setAttribute(attr.name, attr.value)
      }
    }
  }
  const table = document.createElement('table')
  copyPresentation(table, rendered)
  table.setAttribute('aria-keyshortcuts', 'Alt+Enter Alt+ArrowUp Alt+ArrowRight Shift+Enter')
  const head = document.createElement('thead')
  const body = document.createElement('tbody')
  copyPresentation(head, rendered.tHead)
  copyPresentation(body, rendered.tBodies[0])
  table.append(head, body)
  for (const [rowIndex, row] of model.rows.entries()) {
    const tr = document.createElement('tr')
    copyPresentation(tr, rendered.rows[rowIndex])
    for (const [column, cell] of row.cells.entries()) {
      const element = document.createElement(rowIndex === 0 ? 'th' : 'td')
      copyPresentation(element, rendered.rows[rowIndex]?.cells[column])
      element.dataset.tableRow = String(rowIndex)
      element.dataset.tableColumn = String(column)
      element.dataset.sourceFrom = String(from + cell.from)
      element.dataset.sourceTo = String(from + cell.to)
      element.append(inlineNodes(cell.text, from + cell.from, activeFrom, activeTo))
      if (!cell.text) element.append(textNode('', from + cell.from, from + cell.from), document.createElement('br'))
      // GFM escapes a literal pipe even inside code spans. Keep its source
      // range but expose one visual character and accurate caret positions.
      for (const holder of element.querySelectorAll<HTMLElement>('.markdown-editor-text')) {
        const rawText = holder.textContent || ''
        if (!rawText.includes('\\|')) continue
        const start = Number(holder.dataset.sourceFrom)
        const offsets = [start]
        let display = ''
        for (let index = 0; index < rawText.length; index++) {
          if (rawText[index] === '\\' && rawText[index + 1] === '|') index++
          display += rawText[index]
          offsets.push(start + index + 1)
        }
        holder.textContent = display
        holder.dataset.sourceOffsets = offsets.join(',')
      }
      tr.append(element)
    }
    ;(rowIndex === 0 ? head : body).append(tr)
  }
  const tail = document.createElement('span')
  tail.className = 'markdown-editor-table-tail'
  let presentation: HTMLElement = table
  let ancestor = rendered.parentElement
  while (ancestor) {
    const shell = document.createElement(ancestor.tagName)
    copyPresentation(shell, ancestor)
    shell.append(presentation)
    presentation = shell
    ancestor = ancestor.parentElement
  }
  wrapper.append(presentation, tail)
  wrapper.dataset.sourceFrom = String(from)
  wrapper.dataset.sourceTo = String(from + raw.length)
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
  // A run of stars is also Markdown's thematic-break spelling. Keep it
  // editable as literal source here so typing an empty **...** pair never
  // traps the caret in a hidden rule halfway through the keystrokes.
  if (/^ {0,3}\*{3,}[ \t]*$/.test(raw)) {
    const paragraph = document.createElement('p')
    paragraph.className = 'markdown-editor-block'
    paragraph.dataset.sourceFrom = String(from)
    paragraph.dataset.sourceTo = String(from + raw.length)
    paragraph.append(textNode(raw, from, from + raw.length))
    return paragraph
  }
  if (props.profile === 'comment' && type === 'paragraph_open' && (/^( {0,3})(#{1,6})[ \t]+/.test(first) || /^ {0,3}>/.test(first) || /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.test(first) || /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(first))) {
    const element = document.createElement('p')
    element.className = 'markdown-editor-block'
    element.append(inlineNodes(raw, from, selectionFrom, selectionTo))
    element.dataset.sourceFrom = String(from); element.dataset.sourceTo = String(from + raw.length)
    return element
  }
  const heading = type === 'heading_open' && first.match(/^( {0,3})(#{1,6})(?:[ \t]+|$)(.*)$/)
  if (heading) {
    const element = document.createElement(`h${heading[2].length}`)
    element.className = 'markdown-editor-block'
    const bodyFrom = from + heading[1].length + heading[2].length + first.slice(heading[1].length + heading[2].length).match(/^[ \t]*/)?.[0].length!
    const content = document.createElement('span')
    content.className = 'markdown-editor-heading-content'
    content.dataset.syntaxFrom = String(from)
    content.dataset.syntaxTo = String(from + raw.length)
    const rawBody = first.slice(bodyFrom - from)
    const parsedBody = sourceDocumentFor(source).blockAt(from)?.tokens.find(token => token.type === 'inline')?.content
    const suffix = rawBody.match(/[ \t]+#+[ \t]*$/)?.[0] || ''
    const closing = suffix && parsedBody === rawBody.slice(0, -suffix.length) ? suffix : ''
    const body = closing ? rawBody.slice(0, -closing.length) : rawBody
    content.append(boundary(first.slice(0, bodyFrom - from), from, bodyFrom, nearSyntax(selectionFrom, selectionTo, from, bodyFrom)),
      inlineNodes(body, bodyFrom, selectionFrom, selectionTo))
    if (!body) content.append(textNode('', bodyFrom, bodyFrom), document.createElement('br'))
    if (closing) {
      const closingFrom = bodyFrom + body.length
      content.append(boundary(closing, closingFrom, from + first.length, nearSyntax(selectionFrom, selectionTo, closingFrom, from + first.length)))
    }
    element.append(content)
    element.dataset.sourceFrom = String(from); element.dataset.sourceTo = String(from + raw.length)
    return element
  }
  const lines = raw.split('\n')
  const setext = type === 'heading_open' && lines.length >= 2 && /^( {0,3})(=+|-+)[ \t]*$/.exec(lines.at(-1)!)
  if (setext) {
    const level = setext[2][0] === '=' ? 1 : 2
    const element = document.createElement(`h${level}`)
    element.className = 'markdown-editor-block'
    const body = raw.slice(0, raw.lastIndexOf('\n'))
    const bodyEnd = from + body.length
    const content = document.createElement('span')
    content.className = 'markdown-editor-heading-content'
    content.append(inlineNodes(body, from, selectionFrom, selectionTo),
      boundary(raw.slice(body.length), bodyEnd, from + raw.length, nearSyntax(selectionFrom, selectionTo, bodyEnd, from + raw.length)))
    element.append(content)
    element.dataset.sourceFrom = String(from); element.dataset.sourceTo = String(from + raw.length)
    return element
  }
  const quote = type === 'blockquote_open' && lines.every(line => /^ {0,3}>/.test(line))
  const quoteToken = sourceDocumentFor(source).blockAt(from)?.tokens[0]
  const alert = quote && quoteToken?.attrs?.some(([name, value]) => name === 'class' && /(?:^|\s)markdown-alert(?:\s|$)/.test(value))
    && /^ {0,3}>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(lines[0])
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
      try {
        const rendered = document.createElement('template')
        rendered.innerHTML = props.adapter.render(raw, sourceDocumentFor(source).env)
        const hostTitle = rendered.content.querySelector<HTMLElement>('.markdown-alert-title')
        if (hostTitle) {
          delete title.dataset.label
          copyPresentation(hostTitle, title)
          title.replaceChildren(...Array.from(hostTitle.childNodes))
        }
      } catch { /* Keep the standard title if the host renderer fails. */ }
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
  if (type === 'blockquote_open' && /^ {0,3}>/.test(first)) return rawBlockElement(raw, from)
  if (type === 'code_block' || type === 'fence') {
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
      const isFence = !!fence && (index === 0 || index === lines.length - 1 && line.trim().length >= fence.length && [...line.trim()].every(char => char === fence[0]))
      const row = document.createElement('span')
      row.className = isFence ? 'markdown-editor-code-fence' : 'bd-code-line'
      const content = isFence ? boundary(line, from + offset, from + offset + line.length, active)
        : highlightedText(line, from + offset, language)
      if (!isFence) content.classList.add('bd-code-line-content')
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
      if (isFence) {
        if (index === 0) element.append(row)
        else {
          if (!pre.parentElement) { pre.append(code); element.append(pre) }
          element.append(row)
        }
      } else code.append(row)
      offset += line.length + 1
    }
    if (!pre.parentElement) { pre.append(code); element.append(pre) }
    element.dataset.sourceFrom = String(from); element.dataset.sourceTo = String(from + raw.length)
    return element
  }
  const list = /^(bullet_list_open|ordered_list_open)$/.test(type) && first.match(/^([ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+)(.*)$/)
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
        currentItem.dataset.sourceFrom = String(from + offset)
        currentItem.dataset.sourceTo = String(from + offset + line.length)
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
        if (line.length === markerText.length) currentItem.append(textNode('', contentFrom, contentFrom), document.createElement('br'))
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
  if (type === 'hr' && /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(first)) {
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
  const document = sourceDocumentFor(source)
  const block = document.blockAt(from)
  if (block?.from === from && block.tokens.length > 1 && block.tokens[0].tag?.toLowerCase() === element.tagName.toLowerCase()) {
    const shell = inlinePresentation(props.adapter.markdown, block.tokens[0], block.tokens.at(-1),
      window.document.createDocumentFragment(), document.env, element.tagName.toLowerCase())
    if (shell) copyPresentation(shell, element)
  }
  if (type === 'fence' || type === 'code_block') {
    try {
      const rendered = window.document.createElement('template')
      rendered.innerHTML = props.adapter.render(raw, document.env)
      const hostPre = rendered.content.querySelector('pre')
      const hostCode = hostPre?.querySelector('code')
      const editablePre = element.querySelector('pre')
      const editableCode = editablePre?.querySelector('code')
      if (hostPre && editablePre) copyPresentation(hostPre, editablePre)
      if (hostCode && editableCode) copyPresentation(hostCode, editableCode)
      element.classList.toggle('has-line-numbers', !!rendered.content.querySelector('.bd-code-line-number'))
    } catch { /* Source content remains editable with the standard shell. */ }
  }
  element.dataset.sourceText = raw
  return element
}

function appendSourceGap(fragment: DocumentFragment, text: string, from: number, to: number) {
  const block = fragment.lastElementChild as HTMLElement | null
  let offset = from
  const pieces: string[] = text.match(/[^\n]*\n|[^\n]+$/g) || []
  // The first terminator closes the preceding block's source line. Every
  // further terminator represents a real empty line, even when not focused.
  if (block && !block.dataset.sourceText?.endsWith('\n')
    && pieces.length && /^[ \t]*\r?\n$/.test(pieces[0])) {
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

function imageCaptionContext() {
  const node = window.getSelection()?.anchorNode
  if (!node || !root.value?.contains(node)) return null
  return (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.markdown-editor-image-caption') || null
}

function inlineSyntaxAtCaret(range: SelectionState) {
  if (range.from !== range.to || !root.value) return { open: '', close: '', moveBefore: 0, moveAfter: 0 }
  const selection = window.getSelection()
  let element = selection?.anchorNode instanceof Element
    ? selection.anchorNode
    : selection?.anchorNode?.parentElement
  const nestedFirst: Array<{ open: string; close: string; openTo: number; closeFrom: number }> = []
  while (element && element !== root.value) {
    const markers = [...element.children].filter((child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains('markdown-syntax-boundary'))
    if (markers.length === 2 && ['STRONG', 'EM', 'U', 'S', 'DEL', 'MARK', 'CODE'].includes((element as HTMLElement).dataset.syntaxTag || element.tagName)) {
      const openFrom = Number(markers[0].dataset.sourceFrom)
      const openTo = Number(markers[0].dataset.sourceTo)
      const closeFrom = Number(markers[1].dataset.sourceFrom)
      const closeTo = Number(markers[1].dataset.sourceTo)
      if (range.from >= openTo && range.from <= closeFrom) {
        nestedFirst.push({
          open: source.slice(openFrom, openTo),
          close: source.slice(closeFrom, closeTo),
          openTo,
          closeFrom,
        })
      }
    }
    element = element.parentElement
  }
  const active = nestedFirst.filter(pair => range.from > pair.openTo && range.from < pair.closeFrom)
  const moveBefore = nestedFirst
    .filter(pair => pair.openTo === range.from)
    .reduce((length, pair) => length + pair.open.length, 0)
  const moveAfter = nestedFirst
    .filter(pair => pair.closeFrom === range.from)
    .reduce((length, pair) => length + pair.close.length, 0)
  return {
    open: [...active].reverse().map(pair => pair.open).join(''),
    close: active.map(pair => pair.close).join(''),
    moveBefore,
    moveAfter,
  }
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
  if (!selection?.anchorNode || !root.value.contains(selection.anchorNode)) {
    selectedImageRange = undefined
    root.value.querySelectorAll('.markdown-editor-image.is-selected').forEach(image => image.classList.remove('is-selected'))
    return
  }
  const range = selectionOffset()
  updateEditingEffects(range)
  if (selectedImageRange && (range.from !== selectedImageRange.from || range.to !== selectedImageRange.to)) selectedImageRange = undefined
  for (const image of root.value.querySelectorAll<HTMLElement>('.markdown-editor-image')) {
    image.classList.toggle('is-selected', range.from === Number(image.dataset.sourceFrom) && range.to === Number(image.dataset.sourceTo))
  }
  if (props.editingStyle === 'structure' && selection.isCollapsed) {
    const node = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode.parentElement
    const hidden = node?.closest<HTMLElement>('[data-source-hidden="true"]')
    if (hidden) {
      setSelection(Number(hidden.dataset.sourceTo))
      return
    }
  }
  lastSelection = range
  const cellContext = tableCellContext()
  if (cellContext) trackTableCell(cellContext.cell)
  else if (tableSourceDraft.value === undefined) tableTarget.value = undefined
  // Revealing delimiters changes line widths. Keep the current presentation
  // while a range is being extended so a native pointer drag has stable targets.
  if (!selection.isCollapsed) return
  if (props.editingStyle === 'always' || props.editingStyle === 'structure') return
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
      const parent = marker.parentElement?.closest<HTMLElement>('[data-source-from][data-source-to]') || marker.parentElement
      if (!parent) continue
      const start = Number(marker.dataset.sourceFrom)
      const end = Number(marker.dataset.sourceTo)
      if (nearSyntax(current.from, current.to, start, end)) activeParents.add(parent)
    }
    for (const marker of markers) {
      const parent = marker.parentElement?.closest<HTMLElement>('[data-source-from][data-source-to]') || marker.parentElement
      const visible = !!parent && activeParents.has(parent)
      marker.classList.toggle('is-visible', visible)
      marker.setAttribute('aria-hidden', String(!visible))
    }
  }, 70)
}

function handleBlur() {
  selectedImageRange = undefined
  root.value?.querySelectorAll('.markdown-editor-image.is-selected').forEach(image => image.classList.remove('is-selected'))
  verticalColumn = undefined
  verticalX = undefined
  focused.value = false
  updateEditingEffects()
  activeSyntaxKey = ''
  window.clearTimeout(syntaxRevealTimer)
  if (props.editingStyle !== 'always') for (const marker of root.value?.querySelectorAll<HTMLElement>('.markdown-syntax-boundary') || []) {
    marker.classList.remove('is-visible')
    marker.setAttribute('aria-hidden', 'true')
  }
  void enhanceMermaidBlocks()
}

function updateEditingEffects(range?: SelectionState) {
  if (!root.value) return
  for (const block of root.value.children) {
    const from = Number((block as HTMLElement).dataset.sourceFrom)
    const to = Number((block as HTMLElement).dataset.sourceTo)
    block.classList.toggle('markdown-editing-active', !!range && range.to >= from && range.from <= to)
  }
  for (const spoiler of root.value.querySelectorAll<HTMLElement>('.bd-markdown-theme-spoiler')) {
    const from = Number(spoiler.dataset.sourceFrom)
    const to = Number(spoiler.dataset.sourceTo)
    spoiler.classList.toggle('markdown-editing-revealed', !!range && range.to >= from && range.from <= to)
  }
    const states: MarkdownSyntaxState[] = []
    for (const node of root.value.querySelectorAll<HTMLElement>('[data-syntax-kind][data-source-from][data-source-to]')) {
      const syntaxKind = node.dataset.syntaxKind
      if (!syntaxKind) continue
      const from = Number(node.dataset.sourceFrom), to = Number(node.dataset.sourceTo)
      const parts = props.adapter.syntax?.resolve(syntaxKind)
      const raw = source.slice(from, to)
      const parsed = parts?.getInlineParts?.(raw)
      const bodyFrom = parsed ? from + parsed.open.length : from
      const bodyTo = parsed ? to - parsed.close.length : to
      const focused = !!range && range.from >= from && range.to <= to
      const caretInside = !!range && range.from === range.to && range.from >= bodyFrom && range.from <= bodyTo
      const boundaryNear = !!range && (Math.abs(range.from - from) <= 1 || Math.abs(range.to - to) <= 1)
      const selected = !!range && range.from < to && range.to > from
      const configured = props.syntaxEditing?.[syntaxKind]
      const definition = parts?.editing
      const effect = configured?.effect || definition?.effect || 'theme'
      const reveal = configured?.reveal || definition?.reveal || 'near'
      const effectPaused = effect === 'pause-inside' ? caretInside : effect === 'pause-active' ? focused : false
      const boundaryVisible = reveal === 'always' || (reveal === 'inside' && caretInside) || (reveal === 'near' && (focused || boundaryNear))
      node.classList.toggle('is-caret-inside', caretInside)
      node.classList.toggle('is-syntax-active', focused)
      node.classList.toggle('is-effect-paused', effectPaused)
      node.classList.toggle('is-boundary-visible', boundaryVisible)
      states.push({ syntaxKind, from, to, bodyFrom, bodyTo, focused, caretInside, boundaryNear, selected, effectPaused, boundaryVisible, reveal, effect })
    }
    emit('syntax-state-change', states)
}

function handlePointerDown(event: PointerEvent) {
  verticalColumn = undefined
  verticalX = undefined
  const touchCell = (event.target as Element).closest<HTMLElement>('[data-table-row]')
  if (touchCell && event.pointerType === 'touch') {
    enterTableTools()
    trackTableCell(touchCell)
    tableTools.value = 'both'
  }
  if ((event.target as HTMLElement | null)?.closest('.markdown-editor-rule hr')) {
    event.preventDefault()
    return
  }
  const target = event.target as HTMLElement | null
  selectedImageRange = undefined
  const captionTarget = target?.closest<HTMLElement>('.markdown-editor-image-caption')
  if (captionTarget) {
    event.preventDefault()
    const from = Number(captionTarget.dataset.sourceFrom)
    const to = Number(captionTarget.dataset.sourceTo)
    const caretDocument = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null }
    const position = caretDocument.caretPositionFromPoint?.(event.clientX, event.clientY)
    const range = position ? undefined : caretDocument.caretRangeFromPoint?.(event.clientX, event.clientY)
    const node = position?.offsetNode || range?.startContainer
    const offset = position?.offset ?? range?.startOffset ?? 0
    const mapped = node && captionTarget.contains(node) && root.value
      ? sourceOffsetFromDOM(root.value, node, offset, to) : to
    setSelection(Math.max(from, Math.min(to, mapped)))
    return
  }
  const footnote = target?.closest<HTMLElement>('.markdown-editor-footnote-number')
  if (footnote) {
    event.preventDefault()
    const label = footnote.parentElement?.dataset.footnoteLabel
    const definition = [...root.value?.querySelectorAll<HTMLElement>('.markdown-editor-footnote-definition') || []]
      .find(element => element.dataset.footnoteLabel === label)
    const body = definition?.querySelector<HTMLElement>('.markdown-editor-footnote-body')
    if (body) {
      const marker = body.querySelector<HTMLElement>('.markdown-syntax-boundary')
      setSelection(Number(marker?.dataset.sourceTo || body.dataset.sourceFrom))
      definition?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    }
    return
  }
  const image = target?.closest<HTMLElement>('.markdown-editor-image')
  if (image && target?.matches('img')) {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      const href = target.getAttribute('src')
      if (href) void props.onLinkClick?.(href)
    } else {
      root.value?.focus({ preventScroll: true })
      const range = document.createRange()
      range.selectNode(image)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      selectedImageRange = { from: Number(image.dataset.sourceFrom), to: Number(image.dataset.sourceTo) }
      image.classList.add('is-selected')
    }
    return
  }
  const linkNode = target?.closest<HTMLElement>('.markdown-editor-link')
  if (linkNode) {
    if (props.editingStyle === 'structure' && linkNode.classList.contains('markdown-editor-link')
      && !event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const from = Number(linkNode.dataset.sourceFrom)
    const to = Number(linkNode.dataset.sourceTo)
    const raw = source.slice(from, to)
    const href = raw.match(/^\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)$/)?.[1]
      || raw.match(/^!\[[^\]]*]\(([^)\s]+)/)?.[1]
    if (href) void props.onLinkClick?.(href)
    setSelection(props.editingStyle === 'structure' ? to : from + Math.max(1, Math.floor((to - from) / 2)))
    return
  }
  const boundaryNode = target?.closest<HTMLElement>('.markdown-syntax-boundary')
  if (boundaryNode && !boundaryNode.classList.contains('is-visible')) {
    event.preventDefault()
    const holder = boundaryNode.parentElement?.closest<HTMLElement>('[data-source-from][data-source-to]')
    if (holder) {
      const from = Number(holder.dataset.sourceFrom)
      const to = Number(holder.dataset.sourceTo)
      // A hidden boundary is still a real source range. Put the caret after
      // the clicked marker so Backspace can edit/remove that prefix naturally.
      setSelection(to)
    }
  }
}

function setSelection(from: number, to = from, backward = false) {
  if (!root.value) return
  selectedImageRange = undefined
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

function hiddenSyntaxRanges() {
  if (props.editingStyle !== 'structure' || !root.value) return []
  const ranges = [...root.value.querySelectorAll<HTMLElement>('[data-source-hidden="true"]')].map(node =>
    ({ from: Number(node.dataset.sourceFrom), to: Number(node.dataset.sourceTo), atomic: node.parentElement?.dataset.sourceAtomic === 'true' }))
    .sort((a, b) => a.from - b.from || a.to - b.to)
  return ranges.reduce<typeof ranges>((merged, range) => {
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to)
      previous.atomic ||= range.atomic
    } else merged.push({ ...range })
    return merged
  }, [])
}
function skipHiddenSyntax(offset: number, direction: -1 | 1) {
  const ranges = hiddenSyntaxRanges()
  let previous: number
  do {
    previous = offset
    for (const range of ranges) {
      if (offset > range.from && offset < range.to) offset = direction > 0 ? range.to : range.from
    }
  } while (previous !== offset)
  for (const holder of root.value?.querySelectorAll<HTMLElement>('[data-source-offsets]') || []) {
    const offsets = holder.dataset.sourceOffsets!.split(',').map(Number)
    if (offset > offsets[0] && offset < offsets[offsets.length - 1] && !offsets.includes(offset)) {
      offset = direction > 0 ? offsets.find(value => value > offset)! : offsets.filter(value => value < offset).pop()!
    }
  }
  return offset
}
function structuralDeletionRange(offset: number, direction: -1 | 1) {
  const ranges = hiddenSyntaxRanges()
  const atom = ranges.find(range => range.atomic && (direction < 0 ? range.to === offset : range.from === offset))
  if (atom) return { from: atom.from, to: atom.to }
  let previous: number
  do {
    previous = offset
    for (const range of ranges) {
      if (direction < 0 && offset > range.from && offset <= range.to) offset = range.from
      if (direction > 0 && offset >= range.from && offset < range.to) offset = range.to
    }
  } while (previous !== offset)
  const next = skipHiddenSyntax(adjacentSourceOffset(source, offset, direction), direction)
  return { from: Math.min(offset, next), to: Math.max(offset, next) }
}

type TableTarget = { from: number; to: number; row: number; column: number; rows: number; columns: number; alignment: TableAlignment }
const tableTarget = ref<TableTarget>()
const tableTools = ref<'row' | 'column' | 'both'>()
let tableCloseTimer: ReturnType<typeof setTimeout> | undefined
let tableRevealTimer: ReturnType<typeof setTimeout> | undefined
let pendingTableHover: { cell: HTMLElement; kind: 'row' | 'column' } | undefined
const tableControlsStyle = ref<Record<string, string>>({})
const tableRowStyle = ref<Record<string, string>>({})
const tableColumnStyle = ref<Record<string, string>>({})
const tableSourceDraft = ref<string | undefined>()
const tableSourceError = ref('')
const surface = ref<HTMLElement>()

function tableCellContext() {
  const node = window.getSelection()?.anchorNode
  if (!node || !root.value?.contains(node)) return null
  const cell = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('td[data-table-row], th[data-table-row]')
  const table = cell?.closest<HTMLElement>('table')
  const block = table?.closest<HTMLElement>('.markdown-editor-block')
  return cell && table && block ? { cell, table, block } : null
}

function trackTableCell(cell: HTMLElement) {
  if (composing.value || tableSourceDraft.value !== undefined) return
  const block = cell.closest<HTMLElement>('.markdown-editor-table')
  if (!block || !surface.value) return
  const from = Number(block.dataset.sourceFrom)
  const to = from + (block.dataset.sourceText?.length ?? Number(block.dataset.sourceTo) - from)
  const model = parseMarkdownTable(source.slice(from, to), props.adapter.parser)
  if (!model) return
  const column = Number(cell.dataset.tableColumn)
  tableTarget.value = { from, to, row: Number(cell.dataset.tableRow), column, rows: model.rows.length, columns: model.alignments.length, alignment: model.alignments[column] }
  const table = cell.closest('table')!
  const rect = table.getBoundingClientRect()
  const host = surface.value.getBoundingClientRect()
  const cellRect = cell.getBoundingClientRect()
  const header = table.rows[0]?.cells[column]?.getBoundingClientRect() || cellRect
  const size = window.matchMedia('(max-width: 768px)').matches ? 36 : 32
  const columnWidth = size * 6 + 31
  const rowHeight = size * 3 + 16
  // Clamp against the viewport, including horizontally scrolled tables.
  const clampX = (x: number, width: number) => Math.max(4, Math.min(window.innerWidth - width - 4, x)) - host.left
  tableControlsStyle.value = { left: '0px', top: `${rect.bottom - host.top + 4}px`, maxWidth: '100%' }
  const visibleRight = Math.min(rect.right, block.getBoundingClientRect().right)
  tableRowStyle.value = { left: `${clampX(visibleRight + 4, size + 12)}px`, top: `${Math.max(4, cellRect.top + cellRect.height / 2 - rowHeight / 2) - host.top}px` }
  tableColumnStyle.value = { left: `${clampX(header.left + header.width / 2 - columnWidth / 2, columnWidth)}px`, top: `${Math.max(4, rect.top - size - 16) - host.top}px` }
}

function keepTableOpen() {
  clearTimeout(tableCloseTimer)
}
function cancelTableReveal() {
  clearTimeout(tableRevealTimer)
  pendingTableHover = undefined
}
function enterTableTools() {
  cancelTableReveal()
  keepTableOpen()
}
function scheduleTableClose(event?: PointerEvent) {
  // Touch pointerleave fires as soon as the finger is lifted. Keep its tools
  // available until another tap, Escape, or a mode change instead.
  if (event?.pointerType === 'touch') return
  cancelTableReveal()
  keepTableOpen()
  tableCloseTimer = setTimeout(() => {
    if (!surface.value?.querySelector('.markdown-table-ui :focus-visible')) tableTools.value = undefined
  }, 180)
}
function handleTableHover(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  const cell = (event.target as Element).closest<HTMLElement>('td[data-table-row], th[data-table-row]')
  if (!cell) { scheduleTableClose(); return }
  const rect = cell.getBoundingClientRect()
  const tableRect = cell.closest('table')!.getBoundingClientRect()
  const visibleRight = Math.min(tableRect.right, cell.closest('.markdown-editor-table')!.getBoundingClientRect().right)
  const kind = cell.dataset.tableRow === '0' && event.clientY <= rect.top + 12 ? 'column'
    : event.clientX >= visibleRight - 12 ? 'row' : undefined
  if (kind) {
    keepTableOpen()
    const current = tableTarget.value
    if (tableTools.value === kind && current
      && current.from === Number(cell.closest('.markdown-editor-table')?.getAttribute('data-source-from'))
      && current.row === Number(cell.dataset.tableRow) && current.column === Number(cell.dataset.tableColumn)) {
      cancelTableReveal()
      return
    }
    if (pendingTableHover?.cell === cell && pendingTableHover.kind === kind) return
    cancelTableReveal()
    pendingTableHover = { cell, kind }
    tableRevealTimer = setTimeout(() => {
      pendingTableHover = undefined
      if (props.disabled || !root.value?.contains(cell)) return
      trackTableCell(cell)
      tableTools.value = kind
    }, 140)
  } else scheduleTableClose()
}

function dismissTable(event: PointerEvent) {
  if (!surface.value?.contains(event.target as Node)) {
    cancelTableReveal()
    keepTableOpen()
    tableTools.value = undefined
    if (tableSourceDraft.value === undefined) tableTarget.value = undefined
  }
}

function runTableCommand(command: TableCommand) {
  const target = tableTarget.value
  if (!target || props.disabled || composing.value || tableSourceDraft.value !== undefined) return
  const model = parseMarkdownTable(source.slice(target.from, target.to), props.adapter.parser)
  if (!model) return
  const next = updateMarkdownTable(model, command)
  if (next === undefined) return
  let row = target.row
  let column = target.column
  if (command.type === 'insert-row') row = command.index
  if (command.type === 'insert-column') column = command.index
  const mapped = parseMarkdownTable(next, props.adapter.parser)!
  row = Math.min(row, mapped.rows.length - 1)
  column = Math.min(column, mapped.alignments.length - 1)
  const offset = target.from + mapped.rows[row].cells[column].from
  replace(target.from, target.to, next, lastSelection, { from: offset, to: offset, backward: false })
}

function insertTable(rows = 3, columns = 3) {
  if (props.disabled || composing.value) return
  let raw: string
  try { raw = createMarkdownTable(rows, columns) } catch { return }
  if (!props.adapter.markdown.parse(raw, {}).some((token: { type: string }) => token.type === 'table_open')) return
  const range = root.value?.contains(window.getSelection()?.anchorNode || null) ? selectionOffset() : lastSelection
  const before = range.from && !source.slice(0, range.from).endsWith('\n\n') ? (source[range.from - 1] === '\n' ? '\n' : '\n\n') : ''
  const after = source.slice(range.to).startsWith('\n\n') ? '' : (source[range.to] === '\n' ? '\n' : '\n\n')
  const offset = range.from + before.length + parseMarkdownTable(raw)!.rows[0].cells[0].from
  replace(range.from, range.to, before + raw + after, range, { from: offset, to: offset, backward: false })
}

function openTableSource() {
  cancelTableReveal()
  const target = tableTarget.value
  if (!target || composing.value) return
  tableSourceDraft.value = source.slice(target.from, target.to)
  tableSourceError.value = ''
  void nextTick(() => surface.value?.querySelector<HTMLTextAreaElement>('.markdown-table-controls__source textarea')?.focus())
}
function closeTableControls() {
  cancelTableReveal()
  if (tableSourceDraft.value !== undefined) closeTableSource()
  if (root.value && !props.disabled) setSelection(lastSelection.from, lastSelection.to, lastSelection.backward)
  tableTarget.value = undefined
  tableTools.value = undefined
}
function exitTable() {
  cancelTableReveal()
  const target = tableTarget.value
  if (!target || props.disabled || composing.value) return
  const end = target.to
  if (source.slice(end, end + 2) === '\n\n') setSelection(end + 2)
  else replace(end, end, '\n\n', lastSelection, { from: end + 2, to: end + 2, backward: false })
  tableTarget.value = undefined
}

function goToTableCell(row: number, column: number, extend = false, edge: 'from' | 'to' = 'from') {
  const context = tableCellContext()
  if (!context) return
  const from = Number(context.block.dataset.sourceFrom)
  const to = from + (context.block.dataset.sourceText?.length ?? Number(context.block.dataset.sourceTo) - from)
  const model = parseMarkdownTable(source.slice(from, to), props.adapter.parser)
  if (!model) return
  if (row >= model.rows.length) {
    if (props.disabled) return
    const next = updateMarkdownTable(model, { type: 'insert-row', index: model.rows.length })!
    const target = parseMarkdownTable(next)!.rows[row].cells[column]
    const offset = from + target.from
    replace(from, to, next, lastSelection, { from: offset, to: offset, backward: false })
  } else if (row >= 0) {
    const offset = from + model.rows[row].cells[column][edge]
    if (extend) {
      const anchor = lastSelection.backward ? lastSelection.to : lastSelection.from
      setSelection(Math.min(anchor, offset), Math.max(anchor, offset), offset < anchor)
    } else setSelection(offset)
  }
}

function moveOutsideTable(direction: -1 | 1, extend = false) {
  const context = tableCellContext()
  if (!context) return
  const sibling = direction < 0 ? context.block.previousElementSibling : context.block.nextElementSibling
  if (!(sibling instanceof HTMLElement)) return
  const offset = Number(direction < 0 && !sibling.classList.contains('markdown-editor-empty-line')
    ? sibling.dataset.sourceTo : sibling.dataset.sourceFrom)
  const anchor = lastSelection.backward ? lastSelection.to : lastSelection.from
  if (extend) setSelection(Math.min(anchor, offset), Math.max(anchor, offset), offset < anchor)
  else setSelection(offset)
}
function closeTableSource(apply = false) {
  const target = tableTarget.value
  if (!target) return
  const draft = tableSourceDraft.value
  if (apply && draft !== undefined && draft !== source.slice(target.from, target.to)) {
    const blocks = new MarkdownSourceDocument(draft, props.adapter.parser).blocks
    if (blocks.length !== 1 || blocks[0].type !== 'table_open' || !parseMarkdownTable(draft, props.adapter.parser)) {
      tableSourceError.value = '请输入完整、规则的 Markdown 表格；也可以取消后切换全文源码模式。'
      return
    }
    tableSourceDraft.value = undefined
    const offset = target.from + parseMarkdownTable(draft)!.rows[0].cells[0].from
    replace(target.from, target.to, draft, lastSelection, { from: offset, to: offset, backward: false })
  } else {
    tableSourceDraft.value = undefined
    setSelection(Math.min(lastSelection.from, source.length))
  }
}

function updateTablePosition() {
  const target = tableTarget.value
  if (!target) return
  const block = root.value?.querySelector<HTMLElement>(`.markdown-editor-table[data-source-from="${target.from}"]`)
  const cell = block?.querySelector<HTMLElement>(`[data-table-row="${target.row}"][data-table-column="${target.column}"]`)
  if (cell) trackTableCell(cell)
  else if (tableSourceDraft.value === undefined) tableTarget.value = undefined
}

function render(value: string, from = -1, to = from, backward = false) {

  if (!root.value) return
  selectedImageRange = undefined
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
  const definitionContext = JSON.stringify([sourceDocument.env.footnotes?.refs, sourceDocument.env.references])
  const definitionsChanged = definitionContext !== renderedDefinitionContext
  renderedDefinitionContext = definitionContext
  for (const block of sourceDocument.blocks) {
    if (block.from > cursor) appendSourceGap(fragment, value.slice(cursor, block.from), cursor, block.from)
    const hasListMap = block.type === 'bullet_list_open' || block.type === 'ordered_list_open'
    const trailingListBreak = hasListMap ? block.text.match(/(?:\r?\n)+$/)?.[0] || '' : ''
    const blockText = trailingListBreak ? block.text.slice(0, -trailingListBreak.length) : block.text
    const end = block.to - trailingListBreak.length
    const intersectsSelection = from >= 0 && (from >= block.from && from <= end || to >= block.from && to <= end)
    const key = `${block.from}:${end}:${blockText}`
    const previousBlockActive = previousActive && activeStart(previousActive) >= block.from && activeStart(previousActive) <= end
    const currentBlockActive = currentActive && activeStart(currentActive) >= block.from && activeStart(currentActive) <= end
    const reusable = !definitionsChanged && !intersectsSelection && !previousBlockActive && !currentBlockActive ? previous.get(key) : undefined
    if (reusable) {
      for (const gap of reusable.querySelectorAll<HTMLElement>('.markdown-editor-source-gap')) {
        if (Number(gap.dataset.sourceFrom) >= end) gap.remove()
      }
      reusable.dataset.sourceTo = String(end)
    }
    fragment.append(reusable || (block.raw
      ? footnoteDefinitionElement(blockText, block.from, from, to) || rawBlockElement(blockText, block.from, block.fallbackReason)
      : blockElement(blockText, block.from, from, to, block.type)))
    cursor = end
  }
  if (cursor < value.length) {
    appendSourceGap(fragment, value.slice(cursor), cursor, value.length)
  }
  const lastImage = [...fragment.querySelectorAll<HTMLElement>('.markdown-editor-image')].at(-1)
  if (!value || value.endsWith('\n') || sourceDocument.blocks.at(-1)?.type === 'table_open'
    || lastImage?.dataset.sourceTo === String(value.length)) {
    const paragraph = document.createElement('p')
    paragraph.className = 'markdown-editor-block'
    paragraph.dataset.sourceFrom = String(value.length)
    paragraph.dataset.sourceTo = String(value.length)
    if (value && !value.endsWith('\n')) paragraph.dataset.virtualSourceTail = 'true'
    paragraph.append(textNode('', value.length, value.length), document.createElement('br'))
    fragment.append(paragraph)
  }
  separateInlineSyntax(fragment)
  root.value.replaceChildren(fragment)
  mutationObserver?.takeRecords()
  root.value.dataset.activeSyntaxKey = currentActive
  root.value.classList.toggle('is-empty', !value)
  rendering = false
  if (from >= 0) setSelection(from, to, backward)
  updateEditingEffects(focused.value && from >= 0 ? { from, to, backward } : undefined)
  updateTablePosition()
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

function replace(from: number, to: number, insert: string, selectionBefore: SelectionState = { from, to, backward: false }, desiredSelection?: SelectionState) {
  if (props.disabled) return
  from = Math.max(0, Math.min(source.length, from))
  to = Math.max(from, Math.min(source.length, to))
  const tableContext = tableCellContext()
  if (tableContext && insert.endsWith('\\') && source[to] === '|'
    && to === Number(tableContext.cell.dataset.sourceTo) && from >= Number(tableContext.cell.dataset.sourceFrom)) {
    desiredSelection ??= { from: from + insert.length, to: from + insert.length, backward: false }
    insert += ' ' // Keep an unpadded table delimiter outside the escape.
  }
  if (props.editingStyle === 'structure' && !insert && from < to) {
    const expanded = expandEmptyStructureDeletion(from, to)
    from = expanded.from
    to = expanded.to
  }
  suppressInputFallback = true
  queueMicrotask(() => { suppressInputFallback = false })
  const sourceBefore = source
  const sourceAfter = sourceBefore.slice(0, from) + insert + sourceBefore.slice(to)
  const selectionAfter = desiredSelection || { from: from + insert.length, to: from + insert.length, backward: false }
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

function expandEmptyStructureDeletion(from: number, to: number) {
  // Only clear syntax that was active in the pre-edit mapped DOM. Never scan
  // unrelated text with regex: literal ****, code and unknown plugins survive.
  const pairs: Array<{ from: number; to: number; bodyFrom: number; bodyTo: number }> = []
  for (const node of root.value?.querySelectorAll<HTMLElement>('[data-source-from][data-source-to]') || []) {
    if (node.matches('.markdown-editor-block, .markdown-editor-code, .markdown-raw-block, .markdown-editor-image')) continue
    const markers = [...node.children].filter((child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains('markdown-syntax-boundary'))
    if (markers.length !== 2) continue
    pairs.push({ from: Number(markers[0].dataset.sourceFrom), bodyFrom: Number(markers[0].dataset.sourceTo),
      bodyTo: Number(markers[1].dataset.sourceFrom), to: Number(markers[1].dataset.sourceTo) })
  }
  pairs.sort((a, b) => a.to - a.from - (b.to - b.from))
  for (const pair of pairs) {
    if (from >= pair.from && to <= pair.to && from <= pair.bodyFrom && to >= pair.bodyTo) {
      from = pair.from
      to = pair.to
    }
  }
  // Headings can disappear with their last character. Lists and quotes keep
  // an empty item/body until a subsequent explicit Backspace removes it.
  const lineStart = from ? source.lastIndexOf('\n', from - 1) + 1 : 0
  const newline = source.indexOf('\n', to)
  const lineEnd = newline < 0 ? source.length : newline
  const prefix = source.slice(lineStart, lineEnd).match(/^ {0,3}(?:#{1,6}[ \t]+|(?:>[ \t]?)+|(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/)?.[0]
  const block = sourceDocumentFor(source).blocks.find(block => from >= block.from && to <= block.to)
  if (prefix && block && block.type === 'heading_open'
    && from <= lineStart + prefix.length && to >= lineEnd) from = lineStart
  return { from, to }
}

/** Native selections omit hidden table delimiters. A complete visual table
 * selection, or a selection crossing its boundary, owns the entire structure.
 */
function expandTableSelection(range: SelectionState): SelectionState {
  if (range.from === range.to) return range
  let { from, to } = range
  for (const block of sourceDocumentFor(source).blocks) {
    if (block.type !== 'table_open' || to <= block.from || from >= block.to) continue
    const model = parseMarkdownTable(block.text, props.adapter.parser)
    if (!model) continue
    const first = block.from + model.rows[0].cells[0].from
    const last = block.from + model.rows.at(-1)!.cells.at(-1)!.to
    if (from < block.from || to > block.to || from <= first && to >= last) {
      from = Math.min(from, block.from)
      to = Math.max(to, block.to)
    }
  }
  return { ...range, from, to }
}

/** Partial multi-cell selections edit contents, never hidden delimiters. */
function replaceTableSelection(range: SelectionState, insert: string): boolean {
  if (range.from === range.to) return false
  const expanded = expandTableSelection(range)
  if (expanded.from !== range.from || expanded.to !== range.to) {
    replace(expanded.from, expanded.to, insert, range)
    return true
  }
  const block = sourceDocumentFor(source).blocks.find(block =>
    block.type === 'table_open' && range.from >= block.from && range.to <= block.to)
  if (!block || range.from === block.from && range.to === block.to) return false
  const model = parseMarkdownTable(block.text, props.adapter.parser)
  if (!model) return false
  const from = range.from - block.from
  const to = range.to - block.from
  if (model.rows.some(row => row.cells.some(cell => from >= cell.from && to <= cell.to))) return false
  const edits = model.rows.flatMap(row => row.cells)
    .filter(cell => cell.to >= from && cell.from <= to)
    .map(cell => ({ from: Math.max(cell.from, from), to: Math.min(cell.to, to) }))
  if (!edits.length) return false
  let next = block.text
  for (let index = edits.length - 1; index >= 0; index--) {
    const edit = edits[index]
    next = next.slice(0, edit.from) + (index === 0 ? insert : '') + next.slice(edit.to)
  }
  const offset = block.from + edits[0].from + insert.length
  replace(block.from, block.to, next, range, { from: offset, to: offset, backward: false })
  return true
}

function replaceInput(range: SelectionState, insert: string) {
  const caption = imageCaptionContext()
  if (caption && range.from >= Number(caption.dataset.sourceFrom) && range.to <= Number(caption.dataset.sourceTo)) {
    insert = insert.replace(/\r?\n/g, ' ').replace(/[\\[\]]/g, '\\$&')
  }
  if (insert && range.from === source.length && range.to === source.length && !tableCellContext()
    && root.value?.querySelector('[data-virtual-source-tail="true"]')) {
    replace(range.from, range.to, `\n\n${insert}`, range)
    return
  }
  if (replaceTableSelection(range, insert)) return
  // Only live input on a standalone paragraph invokes the shortcut. Opening,
  // deleting, undoing, or restoring existing Markdown never rewrites it.
  if (insert && !insert.includes('\n') && !tableCellContext()) {
    const candidate = source.slice(0, range.from) + insert + source.slice(range.to)
    const caret = range.from + insert.length
    const from = candidate.lastIndexOf('\n', caret - 1) + 1
    const end = candidate.indexOf('\n', caret)
    const lineEnd = end < 0 ? candidate.length : end
    const to = candidate[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd
    const header = candidate.slice(from, to)
    const paragraph = sourceDocumentFor(candidate).blocks.find(block =>
      block.type === 'paragraph_open' && block.from === from && block.text === header)
    const table = paragraph && completeMarkdownTableHeader(header, props.adapter.parser, source.includes('\r\n') ? '\r\n' : '\n')
    if (table) {
      // Combine the user's final character and generated structure into one
      // transaction, so a single undo returns to the original header text.
      const originalTo = to - insert.length + range.to - range.from
      const body = parseMarkdownTable(table)!.rows[1].cells[0]
      const offset = from + body.from
      replace(from, originalTo, table, range, { from: offset, to: offset, backward: false })
      return
    }
  }
  replace(range.from, range.to, insert, range)
}

function navigateAdjacentTable(range: SelectionState, backward: boolean) {
  if (range.from !== range.to || tableCellContext()) return false
  const lineStart = range.from ? source.lastIndexOf('\n', range.from - 1) + 1 : 0
  if (backward && range.from !== lineStart
    && !(range.from === source.length && root.value?.querySelector('[data-virtual-source-tail="true"]'))) return false
  const block = sourceDocumentFor(source).blocks.find(block => {
    if (block.type !== 'table_open' || !parseMarkdownTable(block.text, props.adapter.parser)) return false
    const gap = backward ? source.slice(block.to, range.from) : source.slice(range.to, block.from)
    return (backward ? block.to <= range.from : block.from >= range.to)
      && /^[ \t\r\n]*$/.test(gap)
  })
  if (!block) return false
  const gap = backward ? source.slice(block.to, range.from) : source.slice(range.to, block.from)
  const count = gap.match(/\n/g)?.length || 0
  if (count > 2) {
    const length = source.includes('\r\n') ? 2 : 1
    if (backward) replace(range.from - length, range.from, '', range)
    else replace(range.from, range.from + length, '', range)
    return true
  }
  if (count > 1) {
    setSelection(backward ? block.to + (gap.startsWith('\r\n') ? 2 : 1)
      : block.from - (gap.endsWith('\r\n') ? 2 : 1))
    return true
  }
  const model = parseMarkdownTable(block.text, props.adapter.parser)!
  const cell = backward ? model.rows.at(-1)!.cells.at(-1)! : model.rows[0].cells[0]
  setSelection(block.from + (backward ? cell.to : cell.from))
  return true
}

function tableBoundaryOffset(offset: number, direction: -1 | 1) {
  const block = sourceDocumentFor(source).blocks.find(block =>
    block.type === 'table_open' && offset >= block.from && offset <= block.to)
  const model = block && parseMarkdownTable(block.text, props.adapter.parser)
  if (!block || !model) return offset
  const cells = model.rows.flatMap(row => row.cells)
  const local = offset - block.from
  const within = cells.find(cell => local >= cell.from && local <= cell.to)
  if (within) return offset
  const cell = direction > 0 ? cells.find(cell => cell.from > local) : [...cells].reverse().find(cell => cell.to < local)
  return block.from + (cell ? direction > 0 ? cell.from : cell.to
    : direction > 0 ? cells.at(-1)!.to : cells[0].from)
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
  verticalX = undefined
  if (props.disabled) { event.preventDefault(); return }
  if (rendering || tableSourceDraft.value !== undefined) { event.preventDefault(); return }
  if (composing.value || event.isComposing) return
  const range = selectionOffset()
  lastSelection = range
  if (event.inputType === 'historyUndo') { event.preventDefault(); undo(); return }
  if (event.inputType === 'historyRedo') { event.preventDefault(); redo(); return }
  const selectedImage = selectedImageRange && [...root.value?.querySelectorAll<HTMLElement>('.markdown-editor-image') || []]
    .find(image => Number(image.dataset.sourceFrom) === selectedImageRange!.from)
  if (selectedImage && event.inputType.startsWith('delete')) {
    event.preventDefault()
    replace(selectedImageRange!.from, selectedImageRange!.to, '', range)
    selectedImageRange = undefined
    return
  }
  const caption = imageCaptionContext()
  if (caption) {
    const from = Number(caption.dataset.sourceFrom)
    const to = Number(caption.dataset.sourceTo)
    const image = caption.closest<HTMLElement>('.markdown-editor-image')!
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
      event.preventDefault()
      const end = Number(image.dataset.sourceTo)
      const separator = source[end] === '\n' ? '' : '\n'
      replace(end, end, separator, range, { from: end + 1, to: end + 1, backward: false })
      return
    }
    if (event.inputType.startsWith('delete') && range.from === range.to) {
      const backward = /Backward$/.test(event.inputType)
      if (backward && range.from === from || !backward && range.to === to) {
        event.preventDefault()
        if (from === to && backward) replace(Number(image.dataset.sourceFrom), Number(image.dataset.sourceTo), '', range)
        else setSelection(backward ? Number(image.dataset.sourceFrom) : Number(image.dataset.sourceTo))
        return
      }
      event.preventDefault()
      const mapped = caption.querySelector<HTMLElement>('[data-source-offsets]')?.dataset.sourceOffsets?.split(',').map(Number) || []
      const fromOffset = backward ? [...mapped].reverse().find(offset => offset < range.from) : range.from
      const toOffset = backward ? range.to : mapped.find(offset => offset > range.to)
      if (fromOffset !== undefined && toOffset !== undefined) replace(fromOffset, toOffset, '', range)
      return
    }
  }
  if (!caption && event.inputType.startsWith('delete') && range.from === range.to) {
    const backward = /Backward$/.test(event.inputType)
    const image = [...root.value?.querySelectorAll<HTMLElement>('.markdown-editor-image') || []].find(element =>
      range.from === Number(backward ? element.dataset.sourceTo : element.dataset.sourceFrom))
    const body = image?.querySelector<HTMLElement>('.markdown-editor-image-caption')
    if (body) {
      event.preventDefault()
      setSelection(Number(backward ? body.dataset.sourceTo : body.dataset.sourceFrom))
      return
    }
  }
  let value = event.data || ''
  if (event.inputType.startsWith('delete') && replaceTableSelection(range, '')) {
    event.preventDefault()
    return
  }
  const tableContext = tableCellContext()
  if (tableContext) {
    const cellFrom = Number(tableContext.cell.dataset.sourceFrom)
    const cellTo = Number(tableContext.cell.dataset.sourceTo)
    if ((event.inputType.startsWith('insert') || event.inputType.startsWith('delete'))
      && replaceTableSelection(range, event.inputType.startsWith('insert') ? tableCellInput(value, range.from) : '')) {
      event.preventDefault()
      return
    }
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
      event.preventDefault()
      goToTableCell(Number(tableContext.cell.dataset.tableRow) + 1, Number(tableContext.cell.dataset.tableColumn))
      return
    }
    if (event.inputType.startsWith('insert') && range.from >= cellFrom && range.to <= cellTo) value = tableCellInput(value, range.from)
    if (event.inputType.startsWith('delete') && range.from === range.to) {
      event.preventDefault()
      const backward = /Backward$/.test(event.inputType)
      const blockFrom = Number(tableContext.block.dataset.sourceFrom)
      const blockTo = blockFrom + (tableContext.block.dataset.sourceText?.length || 0)
      const model = parseMarkdownTable(source.slice(blockFrom, blockTo), props.adapter.parser)
      if (event.inputType === 'deleteContentBackward' && range.from === cellFrom
        && tableContext.cell.dataset.tableRow === '0' && tableContext.cell.dataset.tableColumn === '0'
        && model?.rows.every(row => row.cells.every(cell => !cell.text.trim()))) {
        replace(blockFrom, blockTo, '', range)
        return
      }
      if (backward && range.from === cellFrom && model) {
        const row = Number(tableContext.cell.dataset.tableRow)
        const column = Number(tableContext.cell.dataset.tableColumn)
        if (column > 0) goToTableCell(row, column - 1, false, 'to')
        else if (row > 0 && model.rows[row].cells.every(cell => !cell.text.trim())
          && event.inputType === 'deleteContentBackward') {
          const next = updateMarkdownTable(model, { type: 'delete-row', index: row })!
          const previous = parseMarkdownTable(next, props.adapter.parser)!.rows[row - 1].cells.at(-1)!
          const offset = blockFrom + previous.to
          replace(blockFrom, blockTo, next, range, { from: offset, to: offset, backward: false })
        } else if (row > 0) goToTableCell(row - 1, model.alignments.length - 1, false, 'to')
        else moveOutsideTable(-1)
        return
      }
      if (!backward && range.from === cellTo && model) {
        const row = Number(tableContext.cell.dataset.tableRow)
        const column = Number(tableContext.cell.dataset.tableColumn)
        if (column + 1 < model.alignments.length) goToTableCell(row, column + 1)
        else if (row + 1 < model.rows.length) goToTableCell(row + 1, 0)
        else moveOutsideTable(1)
        return
      }
      const native = event.getTargetRanges?.()[0]
      let from = backward ? adjacentSourceOffset(source, range.from, -1) : range.from
      let to = backward ? range.to : adjacentSourceOffset(source, range.to, 1)
      if (native && root.value) {
        const start = sourceOffsetFromDOM(root.value, native.startContainer, native.startOffset, range.from)
        const end = sourceOffsetFromDOM(root.value, native.endContainer, native.endOffset, range.to)
        if (start !== end) { from = Math.min(start, end); to = Math.max(start, end) }
      }
      from = Math.max(cellFrom, from)
      to = Math.min(cellTo, to)
      if (from < to) replace(from, to, '', range)
      return
    }
  }
  if (event.inputType.startsWith('delete') && range.from === range.to
    && navigateAdjacentTable(range, /Backward$/.test(event.inputType))) {
    event.preventDefault()
    return
  }
  if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
    const selectionNode = window.getSelection()?.anchorNode
    const definition = (selectionNode instanceof Element ? selectionNode : selectionNode?.parentElement)?.closest('.markdown-editor-footnote-definition')
    if (definition) {
      event.preventDefault()
      const start = range.from ? source.lastIndexOf('\n', range.from - 1) + 1 : 0
      const lineEnd = source.indexOf('\n', range.from)
      const line = source.slice(start, lineEnd < 0 ? source.length : lineEnd)
      if (/^(?: {4}|\t)[ \t]*$/.test(line)) replace(start, start + line.length, '', range)
      else replaceInput(range, '\n    ')
      return
    }
    const block = sourceDocumentFor(source).blocks.find(block => range.from >= block.from && range.from <= block.to)
    if (props.profile === 'article' && block?.type === 'blockquote_open') {
      const prefix = structuralPrefix(source, range.from, 'quote')
      if (prefix && prefix.to === range.from) {
        event.preventDefault()
        replace(prefix.from, prefix.to, '', range)
        return
      }
      value = quoteLineBreak(source, range.from, true)
    } else if (props.profile === 'article' && (block?.type === 'bullet_list_open' || block?.type === 'ordered_list_open')) {
      const prefix = structuralPrefix(source, range.from, 'list')
      if (prefix && prefix.to === range.from) {
        event.preventDefault()
        replace(prefix.from, prefix.to, '', range)
        return
      }
      value = listLineBreak(source, range.from)
    } else {
      value = '\n'
    }
    const inlineSyntax = inlineSyntaxAtCaret(range)
    const lineStart = source.lastIndexOf('\n', range.from - 1) + 1
    const lineEnd = source.indexOf('\n', range.from)
    const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd)
    const triple = line.match(/^(\*{3}|_{3})([^\n]*)(\*{3}|_{3})$/)
    if (triple && triple[1] === triple[3]) {
      const bodyStart = lineStart + triple[1].length
      const bodyEnd = bodyStart + triple[2].length
      if (range.from === bodyStart) {
        replaceInput({ ...range, from: lineStart, to: lineStart }, value)
        event.preventDefault()
        return
      }
      if (range.from === bodyEnd) {
        replaceInput({ ...range, from: lineStart + line.length, to: lineStart + line.length }, value)
        event.preventDefault()
        return
      }
    }
    if (inlineSyntax.close) value = `${inlineSyntax.close}${value}${inlineSyntax.open}`
    const insertionRange = inlineSyntax.moveBefore
      ? { ...range, from: range.from - inlineSyntax.moveBefore, to: range.to - inlineSyntax.moveBefore }
      : inlineSyntax.moveAfter
        ? { ...range, from: range.from + inlineSyntax.moveAfter, to: range.to + inlineSyntax.moveAfter }
        : range
    if (insertionRange !== range) {
      replaceInput(insertionRange, value)
      event.preventDefault()
      return
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
    if (props.editingStyle === 'structure') {
      const lineStart = source.lastIndexOf('\n', range.from - 1) + 1
      const marker = source.slice(lineStart, range.from).match(/^[ \t]*(?:(?:>[ \t]?)+|(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?)$/)
      if (marker && block && /^(blockquote_open|bullet_list_open|ordered_list_open)$/.test(block.type || '')) {
        replace(lineStart, range.from, '', range)
        return
      }
      const deletion = structuralDeletionRange(range.from, -1)
      if (deletion.from < deletion.to) replace(deletion.from, deletion.to, '', range)
      return
    }
    replace(adjacentSourceOffset(source, range.from, -1), range.from, '', range)
    return
  }
  if (event.inputType === 'deleteContentForward' && range.from === range.to) {
    event.preventDefault()
    const deletion = props.editingStyle === 'structure' ? structuralDeletionRange(range.from, 1)
      : { from: range.from, to: adjacentSourceOffset(source, range.from, 1) }
    if (deletion.from < deletion.to) replace(deletion.from, deletion.to, '', range)
    return
  }
  if (event.inputType.startsWith('delete')) {
    event.preventDefault()
    const target = event.getTargetRanges?.()[0]
    if (range.from === range.to && target && root.value) {
      const from = sourceOffsetFromDOM(root.value, target.startContainer, target.startOffset, range.from)
      const to = sourceOffsetFromDOM(root.value, target.endContainer, target.endOffset, range.to)
      const targetRange = { ...range, from: Math.min(from, to), to: Math.max(from, to) }
      if (!replaceTableSelection(targetRange, '')) replace(targetRange.from, targetRange.to, '', range)
    } else if (range.from !== range.to) replace(range.from, range.to, '', range)
    return
  }
  if (event.inputType.startsWith('insert')) { replaceInput(range, value); event.preventDefault() }
  selectedImageRange = undefined
}
function tableCellInput(text: string, from: number) {
  let result = ''
  let slashes = source.slice(0, from).match(/\\+$/)?.[0].length || 0
  for (const char of text.replace(/\r?\n/g, ' ')) {
    if (char === '|' && slashes % 2 === 0) result += '\\'
    result += char
    slashes = char === '\\' ? slashes + 1 : 0
  }
  return result
}
function handlePaste(event: ClipboardEvent) {
  if (props.disabled || composing.value) return
  const text = event.clipboardData?.getData('text/plain')
  if (!text) return
  event.preventDefault()
  const range = selectionOffset()
  const insert = tableCellContext() ? tableCellInput(text, range.from) : text
  replaceInput(range, insert)
}
function handleCopy(event: ClipboardEvent) {
  if (!event.clipboardData) return
  const range = expandTableSelection(selectionOffset())
  if (range.from === range.to) return
  event.preventDefault()
  event.clipboardData.setData('text/plain', source.slice(range.from, range.to))
}
function handleCut(event: ClipboardEvent) {
  if (props.disabled || composing.value) { event.preventDefault(); return }
  const range = selectionOffset()
  if (range.from === range.to || !event.clipboardData) return
  handleCopy(event)
  if (!replaceTableSelection(range, '')) replace(range.from, range.to, '', range)
}
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && tableTarget.value) { event.preventDefault(); closeTableControls(); return }
  if (composing.value || event.isComposing) return
  if (selectedImageRange && (event.key === 'Backspace' || event.key === 'Delete')) {
    event.preventDefault()
    const selected = selectedImageRange
    selectedImageRange = undefined
    replace(selected.from, selected.to, '', selectionOffset())
    return
  }
  if (selectedImageRange && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(event.key)) {
    selectedImageRange = undefined
    root.value?.querySelectorAll('.markdown-editor-image.is-selected').forEach(image => image.classList.remove('is-selected'))
  }
  const caption = imageCaptionContext()
  if (caption && (event.key === 'Home' || event.key === 'End')) {
    event.preventDefault()
    const range = selectionOffset()
    const target = Number(event.key === 'Home' ? caption.dataset.sourceFrom : caption.dataset.sourceTo)
    const anchor = range.backward ? range.to : range.from
    if (event.shiftKey) setSelection(Math.min(anchor, target), Math.max(anchor, target), target < anchor)
    else setSelection(target)
    return
  }
  const tableContext = tableCellContext()
  if (tableContext && event.altKey && ['Enter', 'ArrowUp', 'ArrowRight'].includes(event.key)) {
    event.preventDefault()
    enterTableTools()
    trackTableCell(tableContext.cell)
    if (event.key === 'Enter') openTableSource()
    else {
      tableTools.value = event.key === 'ArrowUp' ? 'column' : 'row'
      void nextTick(() => surface.value?.querySelector<HTMLButtonElement>(`.markdown-table-controls--${tableTools.value} button`)?.focus())
    }
    return
  }
  if (tableContext && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const row = Number(tableContext.cell.dataset.tableRow)
    const column = Number(tableContext.cell.dataset.tableColumn)
    const columns = tableContext.table.querySelectorAll('thead th').length
    const range = selectionOffset()
    if (event.key === 'Tab') {
      const index = row * columns + column + (event.shiftKey ? -1 : 1)
      if (index >= 0) {
        event.preventDefault()
        goToTableCell(Math.floor(index / columns), index % columns)
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) exitTable()
      else goToTableCell(row + 1, column)
      return
    }
    if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault()
      const nextRow = row + (event.key === 'ArrowUp' ? -1 : 1)
      if (nextRow >= 0 && nextRow < tableContext.table.querySelectorAll('tr').length) goToTableCell(nextRow, column, event.shiftKey)
      else moveOutsideTable(event.key === 'ArrowUp' ? -1 : 1, event.shiftKey)
      return
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const from = Number(tableContext.cell.dataset.sourceFrom)
      const to = Number(tableContext.cell.dataset.sourceTo)
      const anchor = range.backward ? range.to : range.from
      const focus = range.backward ? range.from : range.to
      if (range.from === range.to && event.key === 'ArrowLeft' && focus === from) {
        if (column > 0) goToTableCell(row, column - 1, event.shiftKey, 'to')
        else if (row > 0) goToTableCell(row - 1, columns - 1, event.shiftKey, 'to')
        else moveOutsideTable(-1, event.shiftKey)
        return
      }
      if (range.from === range.to && event.key === 'ArrowRight' && focus === to) {
        if (column + 1 < columns) goToTableCell(row, column + 1, event.shiftKey)
        else if (row + 1 < tableContext.table.querySelectorAll('tr').length) goToTableCell(row + 1, 0, event.shiftKey)
        else moveOutsideTable(1, event.shiftKey)
        return
      }
      let target = event.key === 'Home' ? from : event.key === 'End' ? to
        : adjacentSourceOffset(source, focus, event.key === 'ArrowLeft' ? -1 : 1)
      if (event.key === 'ArrowRight' && source.slice(focus, focus + 2) === '\\|') target = focus + 2
      if (event.key === 'ArrowLeft' && source.slice(focus - 2, focus) === '\\|') target = focus - 2
      if (!event.shiftKey && range.from !== range.to) target = event.key === 'ArrowLeft' ? range.from : range.to
      target = Math.min(to, Math.max(from, target))
      target = skipHiddenSyntax(target, event.key === 'ArrowLeft' || event.key === 'End' ? -1 : 1)
      target = tableBoundaryOffset(target, event.key === 'ArrowLeft' || event.key === 'End' ? -1 : 1)
      if (event.shiftKey) setSelection(Math.min(anchor, target), Math.max(anchor, target), target < anchor)
      else setSelection(target)
      return
    }
  }
  if (event.ctrlKey || event.metaKey || event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) {
    verticalColumn = undefined
    verticalX = undefined
  }
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
          // A source blank line is represented by its newline range. Keep
          // the caret at that line's start instead of stepping across the
          // terminator into the following paragraph.
          const target = !source.slice(targetStart, targetEnd).trim()
            ? targetStart
            : Math.min(targetEnd, targetStart + verticalColumn)
          if (event.shiftKey) setSelection(Math.min(anchor, target), Math.max(anchor, target), target < anchor)
          else setSelection(target)
          return
        }
      }
      verticalColumn = undefined
      const selection = window.getSelection()
      if (root.value && selection?.focusNode) {
        const next = verticalDOMPosition(root.value,
          { node: selection.focusNode, offset: selection.focusOffset },
          event.key === 'ArrowUp' ? -1 : 1, verticalX)
        if (next) {
          event.preventDefault()
          verticalX = next.x
          const target = sourceOffsetFromDOM(root.value, next.position.node, next.position.offset, focus)
          if (event.shiftKey) setSelection(Math.min(anchor, target), Math.max(anchor, target), target < anchor)
          else setSelection(target)
          return
        }
      }
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
      target = skipHiddenSyntax(target, event.key === 'ArrowLeft' || event.key === 'End' ? -1 : 1)
      target = tableBoundaryOffset(target, event.key === 'ArrowLeft' || event.key === 'End' ? -1 : 1)
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
  if (committedText) {
    const insert = tableCellContext() ? tableCellInput(committedText, compositionRange.from) : committedText
    replaceInput(compositionRange, insert)
  }
  else render(source, compositionRange.from, compositionRange.to)
  compositionText = ''
}
function insertSyntax(before: string, after: string) {
  if (props.disabled || composing.value) return
  const range = selectionOffset()
  if (/^#{1,6} $/.test(before) && !after) {
    const start = range.from ? source.lastIndexOf('\n', range.from - 1) + 1 : 0
    const prefix = source.slice(start).match(/^ {0,3}#{1,6}[ \t]+/)?.[0] || ''
    replace(start, start + prefix.length, before, range)
    return
  }
  if (before === '[' && after.startsWith('](') && range.from === range.to) {
    const label = '链接文字'
    replace(range.from, range.to, before + label + after, range,
      { from: range.from + 1, to: range.from + 1 + label.length, backward: false })
    return
  }
  replace(range.from, range.to, `${before}${source.slice(range.from, range.to)}${after}`)
  setSelection(range.from + before.length, range.from + before.length + (range.to - range.from))
}

function applyExternalValue(value: string) {
  if (value === source) return
  if (composing.value) { pendingExternalValue = value; return }
  cancelTableReveal()
  keepTableOpen()
  tableTools.value = undefined
  tableSourceDraft.value = undefined
  tableTarget.value = undefined
  source = value
  verticalColumn = undefined
  verticalX = undefined
  history = []
  redoHistory = []
  if (focused.value) render(value, Math.min(lastSelection.from, value.length), Math.min(lastSelection.to, value.length), lastSelection.backward)
  else render(value)
}

watch(() => props.modelValue, applyExternalValue)
watch([() => props.profile, () => props.adapter], () => {
  if (composing.value) return
  sourceDocumentCache = undefined
  root.value?.replaceChildren()
  if (focused.value) render(source, lastSelection.from, lastSelection.to, lastSelection.backward)
  else render(source)
})
watch(() => props.editingStyle, () => {
  if (composing.value) return
  root.value?.replaceChildren()
  if (focused.value) render(source, lastSelection.from, lastSelection.to, lastSelection.backward)
  else render(source)
})
watch([() => props.disabled, tableSourceDraft], () => {
  if (root.value) root.value.contentEditable = props.disabled || tableSourceDraft.value !== undefined ? 'false' : 'true'
  if (props.disabled) {
    selectedImageRange = undefined
    root.value?.querySelectorAll('.markdown-editor-image.is-selected').forEach(image => image.classList.remove('is-selected'))
  }
}, { flush: 'sync' })
onMounted(() => {
  if (root.value) root.value.contentEditable = props.disabled ? 'false' : 'true'
  document.addEventListener('selectionchange', handleSelectionChange)
  document.addEventListener('pointerdown', dismissTable)
  window.addEventListener('resize', updateTablePosition)
  window.addEventListener('scroll', updateTablePosition, true)
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
  document.removeEventListener('pointerdown', dismissTable)
  window.removeEventListener('resize', updateTablePosition)
  window.removeEventListener('scroll', updateTablePosition, true)
  keepTableOpen()
  cancelTableReveal()
  mutationObserver?.disconnect()
})
defineExpose({ focus: () => root.value?.focus(), sync: () => source, insertSyntax, insertTable, setValue: applyExternalValue })
</script>
