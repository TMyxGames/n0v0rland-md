<template>
  <div class="mde__toolbar-shell">
    <div class="mde__modes" role="group" aria-label="编辑模式">
      <button
        v-for="item in modes"
        :key="item.value"
        type="button"
        :class="{ 'is-active': mode === item.value }"
        @click="$emit('set-mode', item.value)"
      >
        {{ item.label }}
      </button>
    </div>
    <div v-if="mode === 'visual'" class="mde__toolbar" role="toolbar" aria-label="Markdown 工具">
      <button
        v-for="tool in tools"
        :key="tool"
        type="button"
        :title="labels[tool] || tool"
        :aria-label="labels[tool] || tool"
        @mousedown.prevent
        @click="$emit('insert-syntax', tool)"
      >
        <slot name="tool" :tool="tool" :label="labels[tool] || tool">
          {{ labels[tool] || tool }}
        </slot>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MarkdownEditorMode } from './types'

defineProps<{
  mode: MarkdownEditorMode
  tools: string[]
}>()

defineEmits<{
  'set-mode': [mode: MarkdownEditorMode]
  'insert-syntax': [kind: string]
}>()

const modes = [
  { value: 'visual' as const, label: '编辑' },
  { value: 'source' as const, label: '源码' },
  { value: 'preview' as const, label: '预览' },
]

const labels: Record<string, string> = {
  heading: '标题',
  blockquote: '引用',
  alert: '提示块',
  table: '表格',
  codeBlock: '代码块',
  mermaid: '图表',
  bold: '粗体',
  italic: '斜体',
  underline: '下划线',
  strike: '删除线',
  code: '代码',
  spoiler: '隐藏',
  whisper: '小声',
  loud: '大声',
  inner: '内心',
}
</script>
