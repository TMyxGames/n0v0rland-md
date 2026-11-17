<template>
  <div class="mde__panel">
    <MarkdownVisualEditor
      v-if="mode === 'visual'"
      ref="visual"
      v-model="current"
      :profile="profile"
      :adapter="adapter"
      :highlight-code="highlightCode"
      :render-mermaid="renderMermaid"
      :on-link-click="onLinkClick"
      :editing-style="editingStyle"
      :disabled="disabled"
      :placeholder="placeholder"
    />
    <textarea
      v-else-if="mode === 'source'"
      ref="sourceInput"
      v-model="current"
      class="mde__source"
      :disabled="disabled"
      :placeholder="placeholder"
      spellcheck="false"
    />
    <MarkdownPreview
      v-else
      :model-value="current"
      :adapter="adapter"
      :highlight-code="highlightCode"
      :render-mermaid="renderMermaid"
      :on-link-click="onLinkClick"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { createMarkdownTable } from '@n0v0rland-md/core'
import MarkdownVisualEditor from './MarkdownVisualEditor.vue'
import MarkdownPreview from './MarkdownPreview.vue'
import type { MarkdownEditorAdapter, MarkdownEditorMode, MarkdownEditorProfile, MarkdownEditingStyle, MarkdownHighlightCode, MarkdownInputExpose, MarkdownLinkHandler, MarkdownRenderMermaid } from './types'

const props = withDefaults(defineProps<{
  modelValue: string
  adapter: MarkdownEditorAdapter
  mode: MarkdownEditorMode
  profile?: MarkdownEditorProfile
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  highlightCode?: MarkdownHighlightCode
  renderMermaid?: MarkdownRenderMermaid
  onLinkClick?: MarkdownLinkHandler
  editingStyle?: MarkdownEditingStyle
}>(), {
  profile: 'article',
  disabled: false,
  placeholder: '请输入 Markdown 内容…',
  maxLength: 0,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const current = ref(props.modelValue)
const visual = ref<InstanceType<typeof MarkdownVisualEditor> | null>(null)
const sourceInput = ref<HTMLTextAreaElement>()

watch(() => props.modelValue, value => {
  if (value !== current.value) current.value = value
})
watch(current, value => emit('update:modelValue', value))

defineExpose<MarkdownInputExpose>({
  focus: () => {
    if (visual.value) visual.value.focus()
    else sourceInput.value?.focus()
  },
  sync: () => visual.value?.sync() ?? current.value,
  insertSyntax: (before, after = '') => {
    if (visual.value) visual.value.insertSyntax(before, after)
    else insertSourceSyntax(before, after)
  },
  insertTable: (rows = 3, columns = 3) => {
    if (visual.value) visual.value.insertTable(rows, columns)
    else insertSourceTable(rows, columns)
  },
})

function applySourceEdit(from: number, to: number, insert: string, selectionFrom: number, selectionTo: number) {
  const textarea = sourceInput.value
  if (!textarea || props.disabled) return
  const next = current.value.slice(0, from) + insert + current.value.slice(to)
  current.value = next
  void nextTick(() => {
    if (props.disabled || sourceInput.value !== textarea || current.value !== next) return
    textarea.focus()
    textarea.setSelectionRange(selectionFrom, selectionTo)
  })
}

function insertSourceSyntax(before: string, after = '') {
  const textarea = sourceInput.value
  if (!textarea || props.disabled) return
  const value = current.value
  const rangeFrom = textarea.selectionStart
  const rangeTo = textarea.selectionEnd

  if (/^#{1,6} $/.test(before) && !after) {
    const lineStart = rangeFrom ? value.lastIndexOf('\n', rangeFrom - 1) + 1 : 0
    const prefix = value.slice(lineStart).match(/^ {0,3}#{1,6}[ \t]+/)?.[0] || ''
    applySourceEdit(lineStart, lineStart + prefix.length, before, lineStart + before.length, lineStart + before.length)
    return
  }

  if (before === '[' && after.startsWith('](') && rangeFrom === rangeTo) {
    const label = '链接文字'
    applySourceEdit(rangeFrom, rangeTo, `${before}${label}${after}`,
      rangeFrom + before.length, rangeFrom + before.length + label.length)
    return
  }

  const selected = value.slice(rangeFrom, rangeTo)
  applySourceEdit(rangeFrom, rangeTo, `${before}${selected}${after}`,
    rangeFrom + before.length, rangeFrom + before.length + selected.length)
}

function insertSourceTable(rows: number, columns: number) {
  const textarea = sourceInput.value
  if (!textarea || props.disabled) return
  let table: string
  try { table = createMarkdownTable(rows, columns) } catch { return }
  if (!props.adapter.markdown.parse(table, {}).some((token: { type: string }) => token.type === 'table_open')) return

  const value = current.value
  const from = textarea.selectionStart
  const to = textarea.selectionEnd
  const newline = value.includes('\r\n') ? '\r\n' : '\n'
  const beforeSource = value.slice(0, from)
  const afterSource = value.slice(to)
  const before = from && !beforeSource.endsWith(newline + newline)
    ? beforeSource.endsWith(newline) ? newline : newline + newline
    : ''
  const after = afterSource.startsWith(newline + newline)
    ? ''
    : afterSource.startsWith(newline) ? newline : newline + newline
  const source = table.replaceAll('\n', newline)
  applySourceEdit(from, to, `${before}${source}${after}`,
    from + before.length + 2, from + before.length + 2)
}
</script>
