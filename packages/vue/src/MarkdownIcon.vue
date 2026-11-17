<template>
  <span class="mde-icon" aria-hidden="true" v-html="markdownIcons[name] || ''" />
</template>

<script setup lang="ts">
import { markdownIcons } from './icons'
defineProps<{ name: string }>()
</script>
