<template>
  <div class="mde__preview bd-markdown-theme" :class="contentClass" v-html="html" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MarkdownEditorAdapter } from './types'

const props = withDefaults(defineProps<{
  modelValue: string
  adapter: MarkdownEditorAdapter
  contentClass?: string
}>(), {
  contentClass: '',
})

const html = computed(() => props.adapter.render(props.modelValue))
</script>
