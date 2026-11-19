<template>
  <div ref="toolbarRoot" class="mde__toolbar-shell" @keydown.esc.stop.prevent="closeMenus(true)">
    <div class="mde__modes" role="group" aria-label="编辑模式">
      <button
        v-for="item in visibleModes"
        :key="item.value"
        type="button"
        :class="{ 'is-active': mode === item.value }"
        :disabled="disabled"
        @click="$emit('set-mode', item.value)"
      >
        {{ item.label }}
      </button>
      <input ref="fileInput" type="file" accept="image/*" multiple hidden :disabled="uploading || disabled" @change="handleFiles" />
      <button
        v-if="uploadImages"
        type="button"
        title="上传图片"
        aria-label="上传图片"
        :disabled="uploading || disabled"
        @mousedown.prevent
        @click="fileInput?.click()"
      >
        {{ uploading ? '上传中…' : '图片' }}
      </button>
    </div>
    <p v-if="uploadError" class="mde__upload-error" role="alert">{{ uploadError }}</p>
    <div v-if="mode === 'visual'" class="mde__toolbar" role="toolbar" aria-label="Markdown 工具">
      <button
        v-for="tool in tools"
        :key="tool"
        type="button"
        :title="labels[tool] || tool"
        :aria-label="labels[tool] || tool"
        :aria-expanded="tool === 'table' ? tablePickerOpen : tool === 'heading' ? headingMenuOpen : undefined"
        :aria-haspopup="tool === 'table' ? 'dialog' : tool === 'heading' ? 'menu' : undefined"
        :disabled="disabled"
        @mousedown.prevent
        @click="activateTool(tool)"
        @keydown.down.prevent="tool === 'heading' && openHeadings()"
      >
        <slot name="tool" :tool="tool" :label="labels[tool] || tool">
          <MarkdownIcon v-if="markdownIcons[tool]" :name="tool" />
          <span v-else>{{ labels[tool] || tool }}</span>
        </slot>
      </button>
    </div>
    <Transition name="markdown-table-popover">
      <div v-if="headingMenuOpen && mode === 'visual' && !disabled" class="mde__heading-menu" :style="headingMenuStyle" role="menu" aria-label="标题级别" @keydown="navigateHeadings">
        <button v-for="level in 6" :key="level" type="button" role="menuitem" :aria-label="`H${level} 标题`" @mousedown.prevent @click="chooseHeading(level)">
          <MarkdownIcon :name="`h${level}`" /><span>{{ level }} 级标题</span>
        </button>
      </div>
    </Transition>
    <Transition name="markdown-table-popover">
      <MarkdownTablePicker v-if="tablePickerOpen && mode === 'visual' && !disabled" @insert="insertTable" @cancel="tablePickerOpen = false" />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MarkdownTablePicker from './MarkdownTablePicker.vue'
import MarkdownIcon from './MarkdownIcon.vue'
import { markdownIcons } from './icons'
import type { MarkdownEditorMode, MarkdownUploadImages } from './types'
import { toolLabels } from './toolbar-config'

const props = withDefaults(defineProps<{
  mode: MarkdownEditorMode
  tools: string[]
  uploadImages?: MarkdownUploadImages
  showSource?: boolean
  showPreview?: boolean
  labels?: Record<string, string>
  disabled?: boolean
}>(), { labels: () => ({}), showSource: true, showPreview: true })

const emit = defineEmits<{
  'set-mode': [mode: MarkdownEditorMode]
  'insert-syntax': [kind: string]
  'insert-image': [url: string]
  'insert-images': [urls: string[]]
  'insert-table': [rows: number, columns: number]
}>()

const toolbarRoot = ref<HTMLElement>()
const tablePickerOpen = ref(false)
const headingMenuOpen = ref(false)
const headingMenuStyle = ref<Record<string, string>>({})
function closeMenus(restoreFocus = false) {
  if (restoreFocus && headingMenuOpen.value) toolbarRoot.value?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus()
  tablePickerOpen.value = false
  headingMenuOpen.value = false
}
function activateTool(tool: string) {
  if (tool === 'heading') {
    const open = !headingMenuOpen.value
    closeMenus()
    if (open) openHeadings()
  } else if (tool === 'table') {
    const open = !tablePickerOpen.value
    closeMenus()
    tablePickerOpen.value = open
  } else {
    closeMenus()
    emit('insert-syntax', tool)
  }
}
function openHeadings() {
  if (props.disabled) return
  tablePickerOpen.value = false
  headingMenuOpen.value = true
  void nextTick(() => {
    const host = toolbarRoot.value?.getBoundingClientRect()
    const trigger = toolbarRoot.value?.querySelector('[aria-haspopup="menu"]')?.getBoundingClientRect()
    const menu = toolbarRoot.value?.querySelector<HTMLElement>('.mde__heading-menu')
    if (host && trigger && menu) {
      const left = Math.max(8, Math.min(trigger.left, window.innerWidth - menu.offsetWidth - 8))
      headingMenuStyle.value = { left: `${left - host.left}px` }
    }
    toolbarRoot.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  })
}
function chooseHeading(level: number) {
  closeMenus()
  emit('insert-syntax', `h${level}`)
}
function navigateHeadings(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return
  if (event.key === 'Tab') { closeMenus(); return }
  event.preventDefault()
  const items = [...toolbarRoot.value!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  const index = items.indexOf(event.target as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? 5 : (index + (event.key === 'ArrowUp' ? 5 : 1)) % 6
  items[next]?.focus()
}
function insertTable(rows: number, columns: number) {
  tablePickerOpen.value = false
  emit('insert-table', rows, columns)
}
function closePicker(event: PointerEvent) {
  if (!toolbarRoot.value?.contains(event.target as Node)) closeMenus()
}
watch(() => props.mode, () => closeMenus())
watch(() => props.disabled, () => closeMenus())
function handleResize() { closeMenus() }
onMounted(() => {
  document.addEventListener('pointerdown', closePicker)
  window.addEventListener('resize', handleResize)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closePicker)
  window.removeEventListener('resize', handleResize)
})
const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const uploadError = ref('')
let uploadVersion = 0
const visibleModes = computed(() => modes.filter(item =>
  item.value === 'visual'
  || (item.value === 'source' && props.showSource !== false)
  || (item.value === 'preview' && props.showPreview !== false),
))

async function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length || !props.uploadImages || props.disabled || uploading.value) return
  const version = ++uploadVersion
  uploading.value = true
  uploadError.value = ''
  try {
    const urls = await props.uploadImages(files)
    if (version !== uploadVersion || props.disabled) return
    const unique = [...new Set(urls.map(url => url.trim()).filter(Boolean))]
    if (!unique.length) throw new Error('No uploaded images')
    emit('insert-images', unique)
    for (const url of unique) emit('insert-image', url)
  } catch {
    if (version === uploadVersion && !props.disabled) uploadError.value = '图片上传失败，请重试。'
  } finally {
    if (version === uploadVersion) uploading.value = false
  }
}
watch(() => props.disabled, disabled => {
  if (!disabled) return
  uploadVersion++
  uploading.value = false
  uploadError.value = ''
}, { flush: 'sync' })

const modes = [
  { value: 'visual' as const, label: '编辑' },
  { value: 'source' as const, label: '源码' },
  { value: 'preview' as const, label: '预览' },
]

const labels = computed(() => ({ ...toolLabels, ...props.labels }))
</script>
