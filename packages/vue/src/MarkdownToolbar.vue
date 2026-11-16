<template>
  <div class="mde__toolbar-shell">
    <div class="mde__modes" role="group" aria-label="编辑模式">
      <button
        v-for="item in visibleModes"
        :key="item.value"
        type="button"
        :class="{ 'is-active': mode === item.value }"
        @click="$emit('set-mode', item.value)"
      >
        {{ item.label }}
      </button>
      <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="handleFiles" />
      <button
        v-if="uploadImages"
        type="button"
        title="上传图片"
        aria-label="上传图片"
        :disabled="uploading"
        @mousedown.prevent
        @click="fileInput?.click()"
      >
        {{ uploading ? '上传中…' : '图片' }}
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
import { computed, ref } from 'vue'
import type { MarkdownEditorMode, MarkdownUploadImages } from './types'
import { toolLabels } from './toolbar-config'

const props = defineProps<{
  mode: MarkdownEditorMode
  tools: string[]
  uploadImages?: MarkdownUploadImages
  showSource?: boolean
  showPreview?: boolean
}>()

const emit = defineEmits<{
  'set-mode': [mode: MarkdownEditorMode]
  'insert-syntax': [kind: string]
  'insert-image': [url: string]
}>()

const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const visibleModes = computed(() => modes.filter(item =>
  item.value === 'visual'
  || (item.value === 'source' && props.showSource !== false)
  || (item.value === 'preview' && props.showPreview !== false),
))

async function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length || !props.uploadImages) return
  uploading.value = true
  try {
    const urls = await props.uploadImages(files)
    urls.forEach(url => emit('insert-image', url))
  } finally {
    uploading.value = false
  }
}

const modes = [
  { value: 'visual' as const, label: '编辑' },
  { value: 'source' as const, label: '源码' },
  { value: 'preview' as const, label: '预览' },
]

const labels = toolLabels
</script>
