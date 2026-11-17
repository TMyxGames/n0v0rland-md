/**
 * Reuse a host Markdown-it renderer's semantic shell without adopting its
 * text as editable state. Source-mapped children replace a unique text slot.
 * A renderer that removes/duplicates the slot keeps the standard editor DOM.
 */
export function inlinePresentation(
  markdown: any,
  open: any,
  close: any,
  content: DocumentFragment,
  env: Record<string, unknown>,
  expectedTag: string,
): HTMLElement | undefined {
  if (!markdown.renderer?.renderInline || typeof open.constructor !== 'function' || open.constructor === Object) return
  try {
    const slot = new open.constructor('text', '', 0)
    slot.content = 'N0V0RLAND_EDITABLE_CONTENT_SLOT'
    const html = markdown.renderer.renderInline([open, slot, close], markdown.options, env)
    const template = document.createElement('template')
    template.innerHTML = html
    if (template.content.childElementCount !== 1) return
    const element = template.content.firstElementChild as HTMLElement
    if (element.tagName.toLowerCase() !== expectedTag) return
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let target: Text | undefined
    while (walker.nextNode()) {
      const text = walker.currentNode as Text
      if (!text.data.includes(slot.content)) continue
      if (target || text.data.trim() !== slot.content) return
      target = text
    }
    if (!target) return
    target.replaceWith(content)
    return element
  } catch {
    return
  }
}

/** Presentation attributes belong to the renderer; source and editing
 * attributes belong to the editor. Never copy event/editability attributes.
 */
export function copyPresentation(from: Element, to: HTMLElement) {
  for (const attribute of from.attributes) {
    const name = attribute.name
    if (name === 'class') {
      for (const item of from.classList) to.classList.add(item)
    } else if (name === 'style' || name === 'title' || name === 'lang' || name === 'dir'
      || name === 'start' || name === 'reversed' || name === 'type'
      || name.startsWith('data-') && !name.startsWith('data-source-')) {
      to.setAttribute(name, attribute.value)
    }
  }
}
