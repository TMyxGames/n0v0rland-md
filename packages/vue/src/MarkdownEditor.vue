<template>
  <section class="mde" :class="[`mde--${profile}`, `mde--${mode}`]">
    <slot name="toolbar" :mode="mode" :tools="visibleToolbar" :set-mode="setMode" :insert-syntax="insertSyntax">
      <MarkdownToolbar :mode="mode" :tools="visibleToolbar" @set-mode="setMode" @insert-syntax="insertSyntax" />
    </slot>

    <slot name="input" :mode="mode">
      <MarkdownInput
        ref="input"
        v-model="current"
        :mode="mode"
        :profile="profile"
        :adapter="adapter"
        :disabled="disabled"
        :placeholder="placeholder"
        :max-length="maxLength"
        :highlight-code="highlightCode"
        :render-mermaid="renderMermaid"
      />
    </slot>

    <footer class="mde__status">
      <span>{{ current.length }}{{ maxLength ? ` / ${maxLength}` : '' }}</span>
      <span v-if="maxLength && current.length > maxLength" class="mde__error">内容超过长度限制</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MarkdownInput from './MarkdownInput.vue'
import MarkdownToolbar from './MarkdownToolbar.vue'
import type { MarkdownEditorExpose, MarkdownEditorMode, MarkdownEditorProfile, MarkdownEditorAdapter, MarkdownHighlightCode, MarkdownRenderMermaid } from './types'

const props = withDefaults(defineProps<{
  modelValue: string
  adapter: MarkdownEditorAdapter
  profile?: MarkdownEditorProfile
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  toolbar?: string[]
  highlightCode?: MarkdownHighlightCode
  renderMermaid?: MarkdownRenderMermaid
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
const input = ref<InstanceType<typeof MarkdownInput> | null>(null)
const defaultArticleToolbar = ['heading', 'blockquote', 'alert', 'table', 'codeBlock', 'mermaid']
const defaultCommentToolbar = ['bold', 'italic', 'underline', 'strike', 'code', 'spoiler', 'whisper']
const visibleToolbar = computed(() => props.toolbar || (props.profile === 'comment' ? defaultCommentToolbar : defaultArticleToolbar))

watch(() => props.modelValue, value => {
  if (value !== current.value) current.value = value
})
watch(current, value => {
  emit('update:modelValue', value)
  emit('validity', !props.maxLength || value.length <= props.maxLength)
}, { immediate: true })

function setMode(value: MarkdownEditorMode) {
  mode.value = value
}

function insertSyntax(kind: string) {
  const syntax: Record<string, [string, string]> = {
    bold: ['**', '**'],
    italic: ['*', '*'],
    underline: ['++', '++'],
    strike: ['~~', '~~'],
    code: ['`', '`'],
    spoiler: ['||', '||'],
    whisper: ['::whisper[', ']'],
    loud: ['::loud[', ']'],
    inner: ['::inner[', ']'],
    heading: ['# ', ''],
    blockquote: ['> ', ''],
    alert: ['> [!note]\n> ', ''],
    table: ['| 列 1 | 列 2 |\\n| --- | --- |\\n| ', ' |  |'],
    codeBlock: ['```\\n', '\\n```'],
    mermaid: ['```mermaid\\n', '\\n```'],
  }
  const [before, after] = syntax[kind] || [kind, '']
  input.value?.insertSyntax(before, after)
}

defineExpose<MarkdownEditorExpose>({
  focus: () => input.value?.focus(),
  sync: () => input.value?.sync() || current.value,
  insertSyntax,
  setMode,
})
</script>

<style>
.mde {
  overflow: hidden;
  border: 1px solid var(--mde-border, var(--color-surface-border, #d8d8d8));
  border-radius: .5rem;
  background: var(--mde-surface, var(--color-surface, #fff));
}

.mde__toolbar-shell {
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
  align-items: center;
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
