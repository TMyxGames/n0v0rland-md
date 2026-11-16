<template>
  <main class="playground mde-theme mde-classic" :data-color-mode="dark ? 'dark' : 'light'">
    <header class="playground__header">
      <strong>n0v0rland-md Playground</strong>
      <div class="playground__actions">
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
      :adapter="adapter"
      :highlight-code="highlightCode"
      :render-mermaid="renderMermaid"
    />
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import hljs from 'highlight.js'
import mermaid from 'mermaid'
import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
import { createSiteMarkdown } from '@n0v0rland-md/preset'
import { MarkdownInput, MarkdownToolbar } from '@n0v0rland-md/vue'
import type { MarkdownEditorMode, MarkdownInputExpose } from '@n0v0rland-md/vue'
import '@n0v0rland-md/theme'
import '@n0v0rland-md/theme/classic.css'
import '@n0v0rland-md/theme/icons.css'

const markdown = ref('# n0v0rland-md\n\n输入 **粗体**、||隐藏||、::loud[大声] 或 `代码` 查看可视化效果。\n\n> [!tip] 提示块\n> 这是使用站点 Markdown-it preset 的预览。')
const mode = ref<MarkdownEditorMode>('visual')
const dark = ref(false)
const input = ref<MarkdownInputExpose | null>(null)
const siteMarkdown = createSiteMarkdown({ siteOrigin: 'https://n0v0rland.xyz' })
const adapter = createMarkdownItAdapter({
  markdown: siteMarkdown.md,
  profile: 'article',
})
const highlightCode = (source: string, language: string) => {
  if (!language || !hljs.getLanguage(language)) return undefined
  return hljs.highlight(source, { language, ignoreIllegals: true }).value
}
const renderMermaid = async (source: string) => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark.value ? 'dark' : 'default' })
  return (await mermaid.render(`playground-mermaid-${Date.now()}`, source)).svg
}
const tools = [
  'heading', 'bold', 'italic', 'underline', 'strike', 'code',
  'spoiler', 'whisper', 'loud', 'inner', 'blockquote', 'alert',
  'table', 'codeBlock', 'mermaid',
]

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
  padding: 0;
  background: var(--color-page);
}

.playground__header {
  position: fixed;
  z-index: 5;
  top: 0;
  left: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 1rem;
  width: 100%;
  min-height: 6rem;
  padding: .75rem 1.25rem;
  border: 0;
  border-bottom: 1px solid var(--color-surface-border);
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-surface) 92%, transparent);
  backdrop-filter: blur(10px);
}

.playground__header > strong {
  font-size: 1.25rem;
  letter-spacing: .02em;
}

.playground__header > .mde__toolbar-shell {
  flex: 1 1 100%;
  padding: .35rem 0 0;
  border: 0;
}

.playground__header > .mde__toolbar-shell .mde__toolbar {
  padding-left: .75rem;
  border-left: 1px solid var(--color-surface-border);
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
  transition: color .2s ease, border-color .2s ease, background-color .2s ease;
}

.playground__actions button:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.playground > .mde__panel {
  width: 100%;
  min-height: calc(100vh - 6rem);
  margin-top: 6rem;
  padding: 1.25rem 2rem;
  border: 0;
  border-radius: 0;
  background: var(--color-surface);
}

@media (max-width: 768px) {
  .playground {
    padding: 0;
  }

  .playground > .mde__panel {
    width: 100%;
    min-height: 100vh;
    margin-top: 7rem;
    padding: 1rem;
    border: 0;
    border-radius: 0;
  }

  .playground__header {
    min-height: 7rem;
    padding: .65rem .75rem;
  }

  .playground__header > .mde__toolbar-shell .mde__toolbar {
    padding-left: 0;
    border-left: 0;
  }
}
</style>
