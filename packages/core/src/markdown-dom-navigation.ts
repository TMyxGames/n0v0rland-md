import type { MarkdownDOMPosition } from './markdown-dom-selection.js'

type VisualRun = {
  node: Text
  from: number
  to: number
  rect: DOMRect
}

function isVisibleText(node: Text) {
  const parent = node.parentElement
  if (!parent?.closest('[data-source-from][data-source-to]')) return false
  if (parent.closest('[data-source-hidden="true"], [contenteditable="false"], .markdown-editor-source-gap, .markdown-editor-line-ending')) return false
  const marker = parent.closest('.markdown-syntax-boundary')
  return !marker || marker.classList.contains('is-visible')
}

function rectAt(node: Text, from: number, to = from) {
  const range = document.createRange()
  range.setStart(node, from)
  range.setEnd(node, to)
  return range.getBoundingClientRect()
}

/** Read layout from actual content runs, never whitespace separator spans.
 * Source offsets remain the model; geometry is used only to choose a caret
 * position for a vertical keyboard move, including naturally wrapped lines.
 */
export function verticalDOMPosition(
  root: HTMLElement,
  focus: MarkdownDOMPosition,
  direction: -1 | 1,
  preferredX?: number,
): { position: MarkdownDOMPosition; x: number } | undefined {
  if (!root.contains(focus.node)) return
  const selectionRange = document.createRange()
  selectionRange.setStart(focus.node, focus.offset)
  selectionRange.collapse(true)
  let current = selectionRange.getBoundingClientRect()
  if (!current.height) {
    const element = focus.node instanceof Element ? focus.node : focus.node.parentElement
    const line = element?.closest('.markdown-editor-empty-line, p, li, .bd-code-line')
    if (line) current = line.getBoundingClientRect()
  }
  if (!current.height) return
  const x = preferredX ?? current.x
  const center = (current.top + current.bottom) / 2
  const runs: VisualRun[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!isVisibleText(node)) continue
    const from = node.data.search(/[^\r\n]/)
    if (from < 0) continue
    const to = node.data.replace(/[\r\n]+$/, '').length
    const range = document.createRange()
    range.setStart(node, from)
    range.setEnd(node, to)
    for (const rect of range.getClientRects()) {
      if (rect.height && rect.width) runs.push({ node, from, to, rect })
    }
  }
  const rows = runs.filter(({ rect }) => {
    const overlap = Math.min(rect.bottom, current.bottom) - Math.max(rect.top, current.top)
    if (overlap > Math.min(rect.height, current.height) * .4) return false
    return direction * ((rect.top + rect.bottom) / 2 - center) > 2
  })
  if (!rows.length) return
  const nearest = rows.reduce((a, b) =>
    Math.abs((a.rect.top + a.rect.bottom) / 2 - center) <= Math.abs((b.rect.top + b.rect.bottom) / 2 - center) ? a : b)
  const rowY = (nearest.rect.top + nearest.rect.bottom) / 2
  const row = rows.filter(run => run.rect.top <= rowY && run.rect.bottom >= rowY)
  const distance = (rect: DOMRect) => x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
  const target = row.reduce((a, b) => distance(a.rect) <= distance(b.rect) ? a : b)

  // Geometry searches are confined to the chosen text run. Binary searches
  // find its wrapped row and horizontal position; no per-document char scan.
  const boundaries: number[] = []
  const Segmenter = (Intl as any).Segmenter
  if (Segmenter) {
    for (const part of new Segmenter(undefined, { granularity: 'grapheme' }).segment(target.node.data.slice(target.from, target.to))) {
      boundaries.push(target.from + part.index)
    }
  } else {
    let offset = target.from
    for (const char of target.node.data.slice(target.from, target.to)) { boundaries.push(offset); offset += char.length }
  }
  boundaries.push(target.to)
  const charRect = (index: number) => rectAt(target.node, boundaries[index], boundaries[index + 1])
  let low = 0
  let high = boundaries.length - 2
  while (low < high) {
    const mid = (low + high) >>> 1
    if (charRect(mid).bottom < rowY) low = mid + 1
    else high = mid
  }
  const first = low
  high = boundaries.length - 2
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (charRect(mid).top > rowY) high = mid - 1
    else low = mid
  }
  const last = low
  low = first
  high = last
  while (low < high) {
    const mid = (low + high) >>> 1
    const rect = charRect(mid)
    if (x > (rect.left + rect.right) / 2) low = mid + 1
    else high = mid
  }
  const rect = charRect(low)
  const offset = x > (rect.left + rect.right) / 2 ? boundaries[low + 1] : boundaries[low]
  return { position: { node: target.node, offset }, x }
}
