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
        <MarkdownIcon name="imageUpload" />
        <span v-if="uploading" role="status">上传中…</span>
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
        :aria-expanded="tool === 'table' ? tablePickerOpen : isMenu(tool) ? openMenu === tool : undefined"
        :aria-haspopup="tool === 'table' ? 'dialog' : isMenu(tool) ? 'menu' : undefined"
        :data-menu-trigger="isMenu(tool) ? tool : undefined"
        :disabled="disabled"
        @mousedown.prevent
        @click="activateTool(tool)"
        @keydown.down="isMenu(tool) && ($event.preventDefault(), showMenu(tool))"
      >
        <slot name="tool" :tool="tool" :label="labels[tool] || tool">
          <MarkdownIcon v-if="markdownIcons[tool]" :name="tool" />
          <span v-else>{{ labels[tool] || tool }}</span>
        </slot>
      </button>
    </div>
    <Transition name="markdown-table-popover">
      <div v-if="openMenu && mode === 'visual' && !disabled" class="mde__heading-menu" :style="menuStyle" role="menu" :aria-label="openMenu === 'heading' ? '标题级别' : '提示块类型'" @keydown="navigateMenu">
        <button v-for="item in menuItems" :key="item.kind" type="button" role="menuitem" :aria-label="item.label" @mousedown.prevent @click="chooseMenuItem(item.kind)">
          <MarkdownIcon :name="item.kind" /><span>{{ item.label }}</span>
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
import { alertItems, toolLabels } from './toolbar-config'

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
type Menu = 'heading' | 'alert'
const openMenu = ref<Menu>()
const menuStyle = ref<Record<string, string>>({})
const menuItems = computed(() => openMenu.value === 'alert' ? alertItems :
  Array.from({ length: 6 }, (_, index) => ({ kind: `h${index + 1}`, label: `H${index + 1} 标题` })))
const isMenu = (tool: string): tool is Menu => tool === 'heading' || tool === 'alert'
const menuTrigger = (menu: Menu) => toolbarRoot.value?.querySelector<HTMLButtonElement>(`[data-menu-trigger="${menu}"]`)
function closeMenus(restoreFocus = false) {
  if (restoreFocus && openMenu.value) menuTrigger(openMenu.value)?.focus()
  tablePickerOpen.value = false
  openMenu.value = undefined
}
function activateTool(tool: string) {
  if (isMenu(tool)) {
    if (openMenu.value === tool) closeMenus()
    else showMenu(tool)
  } else if (tool === 'table') {
    const open = !tablePickerOpen.value
    closeMenus()
    tablePickerOpen.value = open
  } else {
    closeMenus()
    emit('insert-syntax', tool)
  }
}
function showMenu(kind: Menu) {
  if (props.disabled) return
  tablePickerOpen.value = false
  openMenu.value = kind
  void nextTick(() => {
    if (openMenu.value !== kind) return
    const host = toolbarRoot.value?.getBoundingClientRect()
    const trigger = menuTrigger(kind)?.getBoundingClientRect()
    const menu = toolbarRoot.value?.querySelector<HTMLElement>('.mde__heading-menu')
    if (host && trigger && menu) {
      const left = Math.max(8, Math.min(trigger.left, window.innerWidth - menu.offsetWidth - 8))
      menuStyle.value = { left: `${left - host.left}px` }
      menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    }
  })
}
function chooseMenuItem(kind: string) {
  closeMenus()
  emit('insert-syntax', kind)
}
function navigateMenu(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return
  if (event.key === 'Tab') { closeMenus(true); return }
  event.preventDefault()
  const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  const index = items.indexOf(event.target as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (index + items.length + (event.key === 'ArrowUp' ? -1 : 1)) % items.length
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
