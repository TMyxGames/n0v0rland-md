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

function editableEdge(node: Node | undefined, end: boolean): number | undefined {
  if (!node) return
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement
    if (element.dataset.sourceHidden === 'true') {
      const parent = element.parentElement
      const isOpening = parent?.firstElementChild === element && parent.lastElementChild !== element
      const isClosing = parent?.lastElementChild === element && parent.firstElementChild !== element
      const attribute = element.getAttribute(isOpening ? 'data-source-to'
        : isClosing ? 'data-source-from'
          : end ? 'data-source-from' : 'data-source-to')
      if (attribute !== null && Number.isFinite(Number(attribute))) return Number(attribute)
    }
    const children = Array.from(node.childNodes)
    if (end) children.reverse()
    let hiddenEdge: number | undefined
    for (const child of children) {
      const value = editableEdge(child, end)
      if (value === undefined) continue
      const childElement = child.nodeType === Node.ELEMENT_NODE ? child as HTMLElement : undefined
      if (childElement?.dataset.sourceHidden === 'true') hiddenEdge ??= value
      else return value
    }
    if (hiddenEdge !== undefined) return hiddenEdge
    const attribute = element.getAttribute(end ? 'data-source-to' : 'data-source-from')
    if (attribute !== null && Number.isFinite(Number(attribute))) return Number(attribute)
  }
}

function hasHiddenDelimiters(element: HTMLElement) {
  return element.firstElementChild?.getAttribute('data-source-hidden') === 'true'
    && element.lastElementChild?.getAttribute('data-source-hidden') === 'true'
}

/** Element offsets count children, text offsets count UTF-16 code units. */
export function sourceOffsetFromDOM(root: HTMLElement, node: Node, offset: number, fallback: number) {
  if (!root.contains(node)) return fallback
  if (node.nodeType === Node.TEXT_NODE) {
    const holder = node.parentElement?.closest<HTMLElement>('[data-source-from][data-source-to]')
    if (!holder) return fallback
    if (holder.dataset.sourceOffsets) {
      const offsets = holder.dataset.sourceOffsets.split(',').map(Number)
      return offsets[Math.min(offset, offsets.length - 1)] ?? fallback
    }
    return Math.min(Number(holder.dataset.sourceTo), Number(holder.dataset.sourceFrom) + offset)
  }
  const element = node as HTMLElement
  const ownFrom = element.getAttribute('data-source-from')
  const ownTo = element.getAttribute('data-source-to')
  const syntaxWrapper = hasHiddenDelimiters(element)
  if (offset === 0 && ownFrom !== null) return Number(ownFrom)
  if (offset >= node.childNodes.length && ownTo !== null) return Number(ownTo)
  // Hidden delimiters are not caret stops. Resolve a DOM boundary through a
  // wrapper's visible edge, while retaining absolute offsets across blocks.
  for (let index = offset; index < node.childNodes.length; index++) {
    const edge = syntaxWrapper
      ? editableEdge(node.childNodes[index], false)
      : mappedEdge(node.childNodes[index], false)
    if (edge !== undefined) return edge
  }
  for (let index = Math.min(offset, node.childNodes.length) - 1; index >= 0; index--) {
    const edge = syntaxWrapper
      ? editableEdge(node.childNodes[index], true)
      : mappedEdge(node.childNodes[index], true)
    if (edge !== undefined) return edge
  }
  if (node.parentNode && node !== root) {
    return sourceOffsetFromDOM(root, node.parentNode, Array.from(node.parentNode.childNodes).indexOf(node as ChildNode), fallback)
  }
  return mappedEdge(node, false) ?? fallback
}

export function domPositionFromSourceOffset(root: HTMLElement, offset: number): MarkdownDOMPosition {
  // The caption end shares its offset with the hidden image suffix.
  // Prefer real caption text, including its empty placeholder position.
  for (const caption of root.querySelectorAll<HTMLElement>('.markdown-editor-image-caption')) {
    const from = Number(caption.dataset.sourceFrom)
    const to = Number(caption.dataset.sourceTo)
    if (offset < from || offset > to) continue
    const holder = caption.querySelector<HTMLElement>('.markdown-editor-text')
    const text = holder?.firstChild
    if (text?.nodeType === Node.TEXT_NODE && text.textContent) {
      const offsets = holder?.dataset.sourceOffsets?.split(',').map(Number)
      const after = offsets?.findIndex(value => value > offset)
      return { node: text, offset: offsets
        ? after === -1 ? offsets.length - 1 : Math.max(0, (after || 0) - 1)
        : Math.min(text.textContent.length, offset - from) }
    }
    return { node: caption, offset: Math.max(0, caption.childNodes.length - 1) }
  }
  for (const marker of root.querySelectorAll<HTMLElement>('[data-source-hidden="true"]')) {
    const wrapper = marker.parentElement
    const parent = wrapper?.parentElement
    if (!wrapper || !parent) continue
    if (wrapper.classList.contains('markdown-inline-syntax')
      && (offset === Number(wrapper.dataset.sourceFrom) || offset === Number(wrapper.dataset.sourceTo))) {
      return { node: parent, offset: Array.from(parent.childNodes).indexOf(wrapper) + (offset === Number(wrapper.dataset.sourceTo) ? 1 : 0) }
    }
    if (wrapper.dataset.sourceAtomic === 'true'
      && (offset === Number(wrapper.dataset.sourceFrom) || offset === Number(wrapper.dataset.sourceTo))) {
      return { node: parent, offset: Array.from(parent.childNodes).indexOf(wrapper) + (offset === Number(wrapper.dataset.sourceTo) ? 1 : 0) }
    }
    // Inline wrappers need real positions outside their opening/closing
    // delimiters, so typing after bold text doesn't re-enter its hidden tail.
    const first = wrapper.firstElementChild as HTMLElement | null
    const last = wrapper.lastElementChild as HTMLElement | null
    if (wrapper.classList.contains('markdown-inline-syntax')
      || first === last || first?.dataset.sourceHidden !== 'true' || last?.dataset.sourceHidden !== 'true') continue
    if (offset === Number(wrapper.dataset.sourceFrom) && marker === first) {
      return { node: parent, offset: Array.from(parent.childNodes).indexOf(wrapper) }
    }
    if (offset === Number(wrapper.dataset.sourceTo) && marker === last) {
      return { node: parent, offset: Array.from(parent.childNodes).indexOf(wrapper) + 1 }
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  let previous: MarkdownDOMPosition | undefined
  let previousTo: number | undefined
  while ((node = walker.nextNode())) {
    const holder = node.parentElement?.closest<HTMLElement>('[data-source-from][data-source-to]')
    if (!holder) continue
    // Structural editing keeps delimiters in the source ledger, but they
    // must never become native caret positions (including restored selections).
    if (node.parentElement?.closest('[data-source-hidden="true"]')) continue
    const locked = node.parentElement?.closest('[contenteditable="false"]')
    if (locked && locked !== root) continue
    const from = Number(holder.dataset.sourceFrom)
    const to = Number(holder.dataset.sourceTo)
    if (offset === from && previous && previousTo === offset && !holder.closest('.markdown-editor-empty-line')
      && (holder.matches('.markdown-editor-source-gap, .markdown-editor-line-ending') || /^[\r\n]+$/.test(node.textContent || ''))) {
      // Adjacent blocks/list rows share the end offset with their source
      // newline. A newline-only text node has no visible caret rectangle.
      // Preserve the end of the preceding visible text instead.
      return previous
    }
    if (offset >= from && offset < to || from === to && offset === from) {
      if (holder.dataset.sourceOffsets) {
        const offsets = holder.dataset.sourceOffsets.split(',').map(Number)
        const after = offsets.findIndex(value => value > offset)
        return { node, offset: after < 0 ? offsets.length - 1 : Math.max(0, after - 1) }
      }
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
    if (from > offset) return previous && previousTo === offset ? previous : { node, offset: 0 }
    previous = { node, offset: node.textContent?.length || 0 }
    previousTo = to
  }
  return previous || { node: root, offset: 0 }
}
