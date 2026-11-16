<template>
  <main class="playground">
    <MarkdownEditor v-model="markdown" profile="article" :adapter="adapter" />
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import MarkdownIt from 'markdown-it'
import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
import { MarkdownEditor } from '@n0v0rland-md/vue'

const markdown = ref('# n0v0rland-md\n\n在这里直接输入 Markdown，观察可视化编辑效果。')
const markdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})
const adapter = createMarkdownItAdapter({
  markdown: markdownIt,
  profile: 'article',
})
</script>

<style>
:root {
  color: #2f3a35;
  background: #f4f7f4;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

#app {
  min-height: 100vh;
}

.playground {
  display: flex;
  align-items: stretch;
  justify-content: center;
  min-height: 100vh;
  padding: 1rem;
}

.playground > .mde {
  width: min(100%, 1100px);
  align-self: stretch;
  --mde-min-height: calc(100vh - 2rem);
  --mde-panel-padding: 1.25rem;
  --mde-surface: #fff;
  --mde-border: #cbd9d0;
}

@media (max-width: 768px) {
  .playground {
    padding: 0;
  }

  .playground > .mde {
    border: 0;
    border-radius: 0;
    --mde-min-height: 100vh;
  }
}
</style>
