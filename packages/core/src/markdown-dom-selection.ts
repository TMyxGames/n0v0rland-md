export interface MarkdownDOMPosition {
  node: Node
  offset: number
}

function mappedEdge(node: Node | undefined, end: boolean): number | undefined {
  if (!node) return
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement
    const attribute = element.getAttribute(end ? 'data-source-to' : 'data-source-from')
    if (attribute !== null && Number.isFinite(Number(attribute))) return Number(attribute)
  }
  const children = Array.from(node.childNodes)
  if (end) children.reverse()
  for (const child of children) {
    const value = mappedEdge(child, end)
    if (value !== undefined) return value
  }
}

/** Element offsets count children, text offsets count UTF-16 code units. */
export function sourceOffsetFromDOM(root: HTMLElement, node: Node, offset: number, fallback: number) {
  if (!root.contains(node)) return fallback
  if (node.nodeType === Node.TEXT_NODE) {
    const holder = node.parentElement?.closest<HTMLElement>('[data-source-from][data-source-to]')
    if (!holder) return fallback
    return Math.min(Number(holder.dataset.sourceTo), Number(holder.dataset.sourceFrom) + offset)
  }
  const element = node as HTMLElement
  const ownFrom = element.getAttribute('data-source-from')
  const ownTo = element.getAttribute('data-source-to')
  if (offset === 0 && ownFrom !== null) return Number(ownFrom)
  if (offset >= node.childNodes.length && ownTo !== null) return Number(ownTo)
  // Prefer the next child's absolute range. Summing rendered text lengths is
  // incorrect when containers omit source separators (quote/list newlines).
  for (let index = offset; index < node.childNodes.length; index++) {
    const edge = mappedEdge(node.childNodes[index], false)
    if (edge !== undefined) return edge
  }
  for (let index = Math.min(offset, node.childNodes.length) - 1; index >= 0; index--) {
    const edge = mappedEdge(node.childNodes[index], true)
    if (edge !== undefined) return edge
  }
  if (node.parentNode && node !== root) {
    return sourceOffsetFromDOM(root, node.parentNode, Array.from(node.parentNode.childNodes).indexOf(node as ChildNode), fallback)
  }
  return mappedEdge(node, false) ?? fallback
}

export function domPositionFromSourceOffset(root: HTMLElement, offset: number): MarkdownDOMPosition {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  let previous: MarkdownDOMPosition | undefined
  while ((node = walker.nextNode())) {
    const holder = node.parentElement?.closest<HTMLElement>('[data-source-from][data-source-to]')
    if (!holder) continue
    const from = Number(holder.dataset.sourceFrom)
    const to = Number(holder.dataset.sourceTo)
    if (offset >= from && offset < to || from === to && offset === from) {
      if (offset === from && holder.parentElement?.classList.contains('markdown-editor-empty-line')) {
        const paragraph = holder.parentElement
        return { node: paragraph, offset: paragraph.childNodes.length - 1 }
      }
      // Empty text nodes have no native caret geometry. Anchor before the
      // placeholder BR so vertical navigation starts on the actual empty line.
      if (!node.textContent && holder.parentElement && (holder.parentElement.tagName === 'P' || holder.nextSibling?.nodeName === 'BR')) {
        const paragraph = holder.parentElement
        return { node: paragraph, offset: Array.from(paragraph.childNodes).indexOf(holder) + 1 }
      }
      return { node, offset: Math.min(node.textContent?.length || 0, offset - from) }
    }
    if (from > offset) return { node, offset: 0 }
    previous = { node, offset: node.textContent?.length || 0 }
  }
  return previous || { node: root, offset: 0 }
}
