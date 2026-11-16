<template>
  <main class="playground mde-theme mde-classic" :data-color-mode="dark ? 'dark' : 'light'">
    <header class="playground__header">
      <strong>n0v0rland-md Playground</strong>
      <div class="playground__actions">
        <button type="button" @click="profile = profile === 'article' ? 'comment' : 'article'">
          {{ profile === 'article' ? '切换评论模式' : '切换文章模式' }}
        </button>
        <button type="button" @click="dark = !dark">{{ dark ? '亮色主题' : '暗色主题' }}</button>
      </div>
      <MarkdownToolbar
        class="playground__toolbar"
        :mode="mode"
        :tools="tools"
        @set-mode="mode = $event"
        @insert-syntax="insertSyntax"
      />
    </header>
    <MarkdownInput
      ref="input"
      v-model="markdown"
      :mode="mode"
      :profile="profile"
      :adapter="adapter"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
import { createSiteMarkdown } from '@n0v0rland-md/preset'
import { MarkdownInput, MarkdownToolbar } from '@n0v0rland-md/vue'
import type { MarkdownEditorMode, MarkdownInputExpose } from '@n0v0rland-md/vue'
import '@n0v0rland-md/theme'
import '@n0v0rland-md/theme/classic.css'
import '@n0v0rland-md/theme/icons.css'

const markdown = ref('# n0v0rland-md\n\n输入 **粗体**、||隐藏||、::loud[大声] 或 `代码` 查看可视化效果。\n\n> [!tip] 提示块\n> 这是使用站点 Markdown-it preset 的预览。')
const profile = ref<'article' | 'comment'>('article')
const mode = ref<MarkdownEditorMode>('visual')
const dark = ref(false)
const input = ref<MarkdownInputExpose | null>(null)
const siteMarkdown = createSiteMarkdown({ siteOrigin: 'https://n0v0rland.xyz' })
const adapter = createMarkdownItAdapter({
  markdown: siteMarkdown.md,
  profile: 'article',
})
const tools = computed(() => profile.value === 'article'
  ? ['heading', 'blockquote', 'alert', 'table', 'codeBlock', 'mermaid']
  : ['bold', 'italic', 'underline', 'strike', 'code', 'spoiler', 'whisper'])

function insertSyntax(kind: string) {
  const syntax: Record<string, [string, string]> = {
    bold: ['**', '**'], italic: ['*', '*'], underline: ['++', '++'], strike: ['~~', '~~'],
    code: ['`', '`'], spoiler: ['||', '||'], whisper: ['::whisper[', ']'],
    heading: ['# ', ''], blockquote: ['> ', ''], alert: ['> [!note]\n> ', ''],
    table: ['| 列 1 | 列 2 |\\n| --- | --- |\\n| ', ' |  |'],
    codeBlock: ['```\\n', '\\n```'], mermaid: ['```mermaid\\n', '\\n```'],
  }
  const [before, after] = syntax[kind] || [kind, '']
  input.value?.insertSyntax(before, after)
}
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

.playground[data-color-mode="dark"] {
  --color-text: #dcdcdc;
  --color-text-secondary: #b7b7b7;
  --color-text-muted: #929292;
  --color-surface: #1c2020;
  --color-surface-border: #39433f;
  --color-page: #111514;
  --color-accent: #a1caaa;
  --color-accent-soft: #2a4034;
  --color-accent-muted: #2e4a3b;
  color: var(--color-text);
  background: var(--color-page);
}

.playground:not([data-color-mode="dark"]) {
  --color-text: #222831;
  --color-text-secondary: #59635c;
  --color-text-muted: #778078;
  --color-surface: #fff;
  --color-surface-border: #cbd9d0;
  --color-page: #f4f7f4;
  --color-accent: #65966f;
  --color-accent-soft: #e0eee3;
  --color-accent-muted: #d9e9dd;
  color: var(--color-text);
  background: var(--color-page);
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
  background: var(--color-page);
}

.playground__header {
  position: fixed;
  z-index: 5;
  top: 1rem;
  left: 50%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: min(calc(100% - 2rem), 1100px);
  padding: .5rem .75rem;
  border: 1px solid var(--color-surface-border);
  border-radius: .5rem;
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-surface) 92%, transparent);
  transform: translateX(-50%);
  backdrop-filter: blur(10px);
}

.playground__header > .mde__toolbar-shell {
  flex: 1 1 100%;
  padding: .35rem 0 0;
  border: 0;
}

.playground__actions {
  display: flex;
  gap: .35rem;
}

.playground__actions button {
  border: 1px solid var(--color-surface-border);
  border-radius: .35rem;
  padding: .3rem .55rem;
  color: var(--color-text);
  background: transparent;
  cursor: pointer;
}

.playground > .mde {
  width: min(100%, 1100px);
  align-self: stretch;
  --mde-min-height: calc(100vh - 2rem);
  --mde-panel-padding: 1.25rem;
  --mde-surface: #fff;
  --mde-border: #cbd9d0;
  --mde-color-text: var(--color-text);
  --color-markdown-syntax: #65966f;
  margin-top: 4rem;
}

.playground > .mde__panel {
  width: min(100%, 1100px);
  min-height: calc(100vh - 2rem);
  margin-top: 4rem;
  padding: 1.25rem;
  border: 1px solid var(--color-surface-border);
  border-radius: .5rem;
  background: var(--color-surface);
}

@media (max-width: 768px) {
  .playground {
    padding: 0;
  }

  .playground > .mde {
    border: 0;
    border-radius: 0;
    --mde-min-height: 100vh;
    margin-top: 3.5rem;
  }

  .playground > .mde__panel {
    width: 100%;
    min-height: 100vh;
    margin-top: 3.5rem;
    border: 0;
    border-radius: 0;
  }

  .playground__header {
    top: .5rem;
    width: calc(100% - 1rem);
  }
}
</style>
