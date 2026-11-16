<template>
  <section class="mde" :class="[`mde--${profile}`, `mde--${mode}`]">
    <header class="mde__header">
      <div class="mde__modes" role="group" aria-label="编辑模式">
        <button v-for="item in modes" :key="item.value" type="button" :class="{ 'is-active': mode === item.value }" @click="mode = item.value">
          {{ item.label }}
        </button>
      </div>
      <div v-if="mode === 'visual'" class="mde__toolbar" role="toolbar" aria-label="Markdown 工具">
        <button v-for="tool in visibleToolbar" :key="tool" type="button" @mousedown.prevent @click="insertSyntax(tool)">
          {{ toolLabels[tool] || tool }}
        </button>
      </div>
    </header>

    <div class="mde__panel">
      <MarkdownVisualEditor
        v-if="mode === 'visual'"
        ref="visual"
        v-model="current"
        :profile="profile"
        :adapter="adapter"
        :disabled="disabled"
        :placeholder="placeholder"
      />
      <textarea
        v-else-if="mode === 'source'"
        v-model="current"
        class="mde__source"
        :disabled="disabled"
        :placeholder="placeholder"
        :maxlength="maxLength || undefined"
        spellcheck="false"
      />
      <div v-else class="mde__preview bd-markdown-theme" v-html="adapter.render(current)" />
    </div>

    <footer class="mde__status">
      <span>{{ current.length }}{{ maxLength ? ` / ${maxLength}` : '' }}</span>
      <span v-if="maxLength && current.length > maxLength" class="mde__error">内容超过长度限制</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MarkdownVisualEditor from './MarkdownVisualEditor.vue'
import type { MarkdownEditorExpose, MarkdownEditorMode, MarkdownEditorProfile, MarkdownEditorAdapter } from './types'

const props = withDefaults(defineProps<{
  modelValue: string
  adapter: MarkdownEditorAdapter
  profile?: MarkdownEditorProfile
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  toolbar?: string[]
}>(), {
  profile: 'article',
  disabled: false,
  placeholder: '请输入 Markdown 内容…',
  maxLength: 0,
})
const emit = defineEmits<{
  'update:modelValue': [value: string]
  validity: [value: boolean]
}>()

const current = ref(props.modelValue)
const mode = ref<MarkdownEditorMode>('visual')
const visual = ref<InstanceType<typeof MarkdownVisualEditor> | null>(null)
const modes = [
  { value: 'visual' as const, label: '编辑' },
  { value: 'source' as const, label: '源码' },
  { value: 'preview' as const, label: '预览' },
]
const defaultArticleToolbar = ['heading', 'blockquote', 'alert', 'table', 'codeBlock', 'mermaid']
const defaultCommentToolbar = ['bold', 'italic', 'underline', 'strike', 'code', 'spoiler', 'whisper']
const toolLabels: Record<string, string> = {
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
}
const visibleToolbar = computed(() => props.toolbar || (props.profile === 'comment' ? defaultCommentToolbar : defaultArticleToolbar))

watch(() => props.modelValue, value => {
  if (value !== current.value) current.value = value
})
watch(current, value => {
  emit('update:modelValue', value)
  emit('validity', !props.maxLength || value.length <= props.maxLength)
}, { immediate: true })

function insertSyntax(kind: string) {
  const syntax: Record<string, [string, string]> = {
    bold: ['**', '**'],
    italic: ['*', '*'],
    underline: ['++', '++'],
    strike: ['~~', '~~'],
    code: ['`', '`'],
    spoiler: ['||', '||'],
    whisper: ['::whisper[', ']'],
    heading: ['# ', ''],
    blockquote: ['> ', ''],
    alert: ['> [!note]\n> ', ''],
    table: ['| 列 1 | 列 2 |\\n| --- | --- |\\n| ', ' |  |'],
    codeBlock: ['```\\n', '\\n```'],
    mermaid: ['```mermaid\\n', '\\n```'],
  }
  const [before, after] = syntax[kind] || [kind, '']
  visual.value?.insertSyntax(before, after)
}

defineExpose<MarkdownEditorExpose>({
  focus: () => visual.value?.focus(),
  sync: () => visual.value?.sync() || current.value,
  insertSyntax,
  setMode: value => { mode.value = value },
})
</script>

<style>
.mde {
  overflow: hidden;
  border: 1px solid var(--mde-border, var(--color-surface-border, #d8d8d8));
  border-radius: .5rem;
  background: var(--mde-surface, var(--color-surface, #fff));
}

.mde__header {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem;
  padding: .5rem;
  border-bottom: 1px solid var(--mde-border, var(--color-surface-border, #d8d8d8));
}

.mde__modes,
.mde__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mde-toolbar-gap, .25rem);
}

.mde button {
  border: 1px solid transparent;
  border-radius: .35rem;
  padding: .3rem .55rem;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.mde button:hover,
.mde button.is-active {
  border-color: var(--color-accent, #4f8f70);
  color: var(--color-accent, #4f8f70);
}

.mde__panel {
  min-height: var(--mde-min-height, 18rem);
  padding: var(--mde-panel-padding, 1rem);
}

.mde__source {
  display: block;
  width: 100%;
  min-height: var(--mde-min-height, 18rem);
  resize: vertical;
  border: 0;
  outline: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  line-height: 1.7;
}

.mde__preview {
  min-height: var(--mde-min-height, 18rem);
}

.mde__status {
  display: flex;
  justify-content: flex-end;
  gap: .75rem;
  padding: .35rem .75rem;
  color: var(--color-text-muted, #888);
  font-size: .8rem;
}

.mde__error {
  color: var(--color-danger, #c55);
}

.mde--comment {
  --mde-min-height: 8rem;
  --mde-panel-padding: .5rem;
}
</style>
