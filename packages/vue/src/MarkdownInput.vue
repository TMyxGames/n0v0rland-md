<template>
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
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import MarkdownVisualEditor from './MarkdownVisualEditor.vue'
import type { MarkdownEditorAdapter, MarkdownEditorExpose, MarkdownEditorMode, MarkdownEditorProfile, MarkdownInputExpose } from './types'

const props = withDefaults(defineProps<{
  modelValue: string
  adapter: MarkdownEditorAdapter
  mode: MarkdownEditorMode
  profile?: MarkdownEditorProfile
  disabled?: boolean
  placeholder?: string
  maxLength?: number
}>(), {
  profile: 'article',
  disabled: false,
  placeholder: '请输入 Markdown 内容…',
  maxLength: 0,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const current = ref(props.modelValue)
const visual = ref<InstanceType<typeof MarkdownVisualEditor> | null>(null)

watch(() => props.modelValue, value => {
  if (value !== current.value) current.value = value
})
watch(current, value => emit('update:modelValue', value))

defineExpose<MarkdownInputExpose>({
  focus: () => visual.value?.focus(),
  sync: () => visual.value?.sync() || current.value,
  insertSyntax: (before, after = '') => visual.value?.insertSyntax(before, after),
})
</script>
