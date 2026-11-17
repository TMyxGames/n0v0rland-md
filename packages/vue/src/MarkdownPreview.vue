<template>
  <div ref="preview" class="mde__preview bd-markdown-theme" :class="contentClass" v-html="html" @click="handleClick" />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { MarkdownEditorAdapter, MarkdownHighlightCode, MarkdownLinkHandler, MarkdownRenderMermaid } from './types'

const props = withDefaults(defineProps<{
  modelValue: string
  adapter: MarkdownEditorAdapter
  contentClass?: string
  highlightCode?: MarkdownHighlightCode
  renderMermaid?: MarkdownRenderMermaid
  onLinkClick?: MarkdownLinkHandler
}>(), {
  contentClass: '',
})

const html = computed(() => props.adapter.render(props.modelValue))
const preview = ref<HTMLElement>()
let renderVersion = 0

watch([html, () => props.highlightCode, () => props.renderMermaid], async ([markup, highlightCode, renderMermaid]) => {
  const version = ++renderVersion
  await nextTick()
  const root = preview.value
  if (!root || version !== renderVersion) return

  for (const code of root.querySelectorAll<HTMLElement>('pre > code, .bd-mermaid > pre.mermaid')) {
    const hostMermaid = code.matches('pre.mermaid')
    const language = hostMermaid ? 'mermaid' : code.className.match(/(?:^|\s)language-([^\s]+)/)?.[1]
    if (!language) continue

    if (language === 'mermaid' && renderMermaid) {
      const source = code.textContent || ''
      const block = hostMermaid ? code.closest<HTMLElement>('.bd-mermaid') : code.parentElement
      if (!block) continue
      try {
        const result = await renderMermaid(source)
        if (version !== renderVersion || !root.contains(block)) return
        const wrapper = document.createElement('div')
        wrapper.className = 'bd-mermaid mde__mermaid'
        wrapper.innerHTML = typeof result === 'string' ? result : result.svg
        block.replaceWith(wrapper)
      } catch {
        if (version !== renderVersion || !root.contains(block)) return
        const error = document.createElement('div')
        error.className = 'mde__preview-error'
        error.setAttribute('role', 'alert')
        error.textContent = 'Mermaid 语法错误，无法生成图表预览。'
        block.replaceWith(error)
      }
      continue
    }

    // A host renderer may already supply numbered/highlighted line wrappers.
    // Replacing those with one highlighted string destroys its presentation.
    if (!highlightCode || code.querySelector('.bd-code-line')) continue
    try {
      const source = code.textContent || ''
      const highlighted = highlightCode(source, language)
      if (highlighted === undefined) continue
      const template = document.createElement('template')
      template.innerHTML = highlighted
      if (template.content.textContent !== source) continue
      code.replaceChildren(template.content)
    } catch {
      // Keep the renderer's original code markup when highlighting fails.
    }
  }
}, { immediate: true, flush: 'post' })

onBeforeUnmount(() => { renderVersion++ })

function handleClick(event: MouseEvent) {
  if (!props.onLinkClick || !(event.target instanceof Element)) return
  const link = event.target.closest<HTMLAnchorElement>('a[href]')
  if (!link || !preview.value?.contains(link)) return
  event.preventDefault()
  void Promise.resolve(props.onLinkClick(link.getAttribute('href') || link.href)).catch(() => {})
}
</script>
