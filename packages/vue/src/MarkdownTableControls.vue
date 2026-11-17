<template>
  <div class="markdown-table-ui" @pointerenter="$emit('keep-open')" @pointerleave="$emit('leave', $event)" @focusin="$emit('keep-open')" @focusout="$emit('leave')" @keydown="moveToolFocus" @keydown.esc.stop.prevent="editingSource ? $emit('cancel-source') : $emit('close')">
    <Transition name="markdown-table-popover">
      <div v-if="!editingSource && (tools === 'column' || tools === 'both')" class="markdown-table-controls markdown-table-controls--column" :data-column="target.column" :style="columnStyle" role="toolbar" aria-label="表格列操作">
        <button v-for="item in alignments" :key="item.value" type="button" :aria-label="item.label" :title="item.label" :aria-pressed="target.alignment === item.value" :disabled="disabled" @mousedown.prevent @click="command({ type: 'align-column', index: target.column, alignment: item.value })"><MarkdownIcon :name="item.icon" /></button>
        <span class="markdown-table-controls__divider" role="separator" aria-orientation="vertical" />
        <button type="button" aria-label="左侧加列" title="左侧加列" :disabled="disabled" @mousedown.prevent @click="command({ type: 'insert-column', index: target.column })"><MarkdownIcon name="columnBefore" /></button>
        <button type="button" aria-label="右侧加列" title="右侧加列" :disabled="disabled" @mousedown.prevent @click="command({ type: 'insert-column', index: target.column + 1 })"><MarkdownIcon name="columnAfter" /></button>
        <button class="is-danger" type="button" aria-label="删除列" :title="target.columns === 1 ? '至少保留一列' : '删除列'" :disabled="disabled || target.columns === 1" @mousedown.prevent @click="command({ type: 'delete-column', index: target.column })"><MarkdownIcon name="columnRemove" /></button>
      </div>
    </Transition>
    <Transition name="markdown-table-popover">
      <div v-if="!editingSource && (tools === 'row' || tools === 'both')" class="markdown-table-controls markdown-table-controls--row" :data-row="target.row" :style="rowStyle" role="toolbar" aria-label="表格行操作" aria-orientation="vertical">
        <button type="button" aria-label="上方加行" :title="target.row === 0 ? '表头上方不能添加行' : '上方加行'" :disabled="disabled || target.row === 0" @mousedown.prevent @click="command({ type: 'insert-row', index: target.row })"><MarkdownIcon name="rowBefore" /></button>
        <button type="button" aria-label="下方加行" title="下方加行" :disabled="disabled" @mousedown.prevent @click="command({ type: 'insert-row', index: target.row + 1 })"><MarkdownIcon name="rowAfter" /></button>
        <button class="is-danger" type="button" aria-label="删除行" :title="target.row === 0 ? '表头不能单独删除' : '删除行'" :disabled="disabled || target.row === 0" @mousedown.prevent @click="command({ type: 'delete-row', index: target.row })"><MarkdownIcon name="rowRemove" /></button>
      </div>
    </Transition>
    <section v-if="editingSource" class="markdown-table-source" :style="toolbarStyle" aria-label="表格源码编辑">
      <div class="markdown-table-controls__source">
        <label>编辑当前表格源码
          <textarea :value="sourceDraft" :disabled="disabled" aria-label="当前表格源码" spellcheck="false" @input="$emit('update:sourceDraft', ($event.target as HTMLTextAreaElement).value)" />
        </label>
        <p v-if="error" role="alert">{{ error }}</p>
        <button type="button" :disabled="disabled" @click="$emit('apply-source')">应用修改</button>
        <button type="button" @click="$emit('cancel-source')">取消</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TableCommand, TableAlignment } from '@n0v0rland-md/core'
import MarkdownIcon from './MarkdownIcon.vue'

const props = defineProps<{
  target: { row: number; column: number; columns: number; alignment: TableAlignment }
  tools?: 'row' | 'column' | 'both'
  toolbarStyle: Record<string, string>
  rowStyle: Record<string, string>
  columnStyle: Record<string, string>
  sourceDraft?: string
  error?: string
  disabled?: boolean
}>()
const editingSource = computed(() => props.sourceDraft !== undefined)
const alignments = [
  { value: 'left' as const, label: '左对齐', icon: 'alignLeft' },
  { value: 'center' as const, label: '居中对齐', icon: 'alignCenter' },
  { value: 'right' as const, label: '右对齐', icon: 'alignRight' },
]
const emit = defineEmits<{
  command: [command: TableCommand]
  'update:sourceDraft': [value: string]
  'apply-source': []
  'cancel-source': []
  'keep-open': []
  leave: [event?: PointerEvent]
  close: []
}>()
const command = (value: TableCommand) => emit('command', value)
function moveToolFocus(event: KeyboardEvent) {
  const bar = (event.target as Element).closest('[role="toolbar"]')
  if (!bar) return
  const keys = bar.getAttribute('aria-orientation') === 'vertical'
    ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
  if (!keys.includes(event.key) && !['Home', 'End'].includes(event.key)) return
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const index = buttons.indexOf(event.target as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === keys[0] ? -1 : 1) + buttons.length) % buttons.length
  event.preventDefault()
  buttons[next]?.focus()
}
</script>
