<template>
  <form class="markdown-table-picker" role="dialog" aria-label="插入表格" @submit.prevent="insert">
    <strong>插入表格</strong>
    <span class="markdown-table-picker__hint">{{ rows }} 行 × {{ columns }} 列（含表头）</span>
    <div class="markdown-table-picker__grid" role="group" aria-label="快速选择表格尺寸">
      <button v-for="index in 30" :key="index" type="button"
        :aria-label="`${Math.ceil(index / 6)} 行 ${((index - 1) % 6) + 1} 列`"
        :class="{ 'is-selected': Math.ceil(index / 6) <= rows && ((index - 1) % 6) + 1 <= columns }"
        @pointerenter="preview(index)" @focus="preview(index)" @click="preview(index); insert()" />
    </div>
    <div class="markdown-table-picker__dimensions">
      <label>行数<input v-model.number="rows" type="number" min="1" max="50" required aria-label="表格行数" /></label>
      <label>列数<input v-model.number="columns" type="number" min="1" max="20" required aria-label="表格列数" /></label>
    </div>
    <p v-if="!valid" role="alert">请输入 1–50 行、1–20 列。</p>
    <div class="markdown-table-picker__actions">
      <button type="button" @click="$emit('cancel')">取消</button>
      <button type="submit" :disabled="!valid">插入表格</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
const rows = ref(3)
const columns = ref(3)
const valid = computed(() => Number.isInteger(rows.value) && rows.value >= 1 && rows.value <= 50 && Number.isInteger(columns.value) && columns.value >= 1 && columns.value <= 20)
const emit = defineEmits<{ insert: [rows: number, columns: number]; cancel: [] }>()
function preview(index: number) { rows.value = Math.ceil(index / 6); columns.value = (index - 1) % 6 + 1 }
function insert() { if (valid.value) emit('insert', rows.value, columns.value) }
</script>
