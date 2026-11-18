<template>
  <main class="playground mde-theme" :class="[activeTheme.className, { 'mde-classic': themeId !== 'homepage' }]" :data-color-mode="dark ? 'dark' : 'light'" :style="{ '--header-height': `${headerHeight}px` }">
    <header ref="header" class="playground__header">
      <div class="playground__topbar">
        <a class="playground__brand" href="./" aria-label="n0v0rland-md 首页"><span class="playground__monogram">md</span><strong>n0v0rland-md</strong><span class="playground__badge">Playground</span></a>
        <div class="playground__actions">
          <span class="playground__count">{{ markdown.length }} 字符</span>
          <label class="playground__theme-picker">
            <span>配置</span>
            <select v-model="configId" aria-label="选择 Markdown 配置">
              <option value="default">项目默认</option>
              <option value="homepage">主站配置</option>
            </select>
          </label>
          <button type="button" class="playground__load-example" @click="loadExample">载入配置示例</button>
          <label class="playground__theme-picker">
            <span>主题</span>
            <select v-model="themeId" aria-label="选择编辑器主题">
              <option v-for="theme in playgroundThemes" :key="theme.id" :value="theme.id">{{ theme.label }}</option>
            </select>
          </label>
          <label class="playground__editing-style">语法显示
            <select v-model="editingStyle" aria-label="选择语法显示风格">
              <option value="always">始终显示节点</option>
              <option value="blur-hidden">隐藏失焦节点</option>
              <option value="structure">仅保留结构</option>
            </select>
          </label>
          <label class="playground__editing-style">编辑效果
            <select v-model="editingEffects" aria-label="选择编辑动效">
              <option value="stable">编辑时稳定</option>
              <option value="theme">跟随主题</option>
              <option value="none">关闭动效</option>
            </select>
          </label>
          <button class="playground__theme" type="button" :title="dark ? '切换亮色主题' : '切换暗色主题'" :aria-label="dark ? '切换亮色主题' : '切换暗色主题'" @click="dark = !dark">
            <span class="playground__icon" :style="iconStyle(dark ? lightIcon : darkIcon)" aria-hidden="true" />
          </button>
        </div>
      </div>
      <MarkdownToolbar class="playground__toolbar" :mode="mode" :tools="tools" :labels="labels" :show-source="true" :show-preview="true" @set-mode="mode = $event" @insert-syntax="insertSyntax" @insert-table="insertTable" />
    </header>
    <MarkdownInput ref="input" v-model="markdown" :mode="mode" :adapter="adapter" :editing-style="editingStyle" :editing-effects="editingEffects" :highlight-code="highlightCode" :render-mermaid="renderMermaid" />
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import hljs from 'highlight.js'
import mermaid from 'mermaid'
import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
import { createMarkdownItPreset } from '@n0v0rland-md/preset'
import { MarkdownInput, MarkdownToolbar, syntaxPairs } from '@n0v0rland-md/vue'
import type { MarkdownEditingStyle, MarkdownEditingEffects } from '@n0v0rland-md/vue'
import type { MarkdownEditorMode, MarkdownInputExpose } from '@n0v0rland-md/vue'
import { expressionPlugin, expressionSyntax } from './expression-syntax'
import { playgroundThemes } from './theme-config'
import { homepageAdapter, homepageSyntax } from './hosts/homepage'
import homepageDemo from './hosts/homepage/demo.md?raw'
import lightIcon from './assets/icons/material-symbols--light-mode-rounded.svg'
import darkIcon from './assets/icons/material-symbols--dark-mode-rounded.svg'
import '@n0v0rland-md/theme'
import '@n0v0rland-md/theme/classic.css'
import '@n0v0rland-md/theme/icons.css'
import './playground.css'
import demoMarkdown from './demo.md?raw'

const query = new URLSearchParams(window.location.search)
const initialConfig = query.get('config') === 'homepage' ? 'homepage' : 'default'
const markdown = ref(query.get('sample') === 'homepage' ? homepageDemo : demoMarkdown)
const mode = ref<MarkdownEditorMode>('visual')
const editingStyle = ref<MarkdownEditingStyle>('blur-hidden')
const editingEffects = ref<MarkdownEditingEffects>('stable')
const dark = ref(false)
const themeId = ref(initialConfig === 'homepage' ? 'homepage' : 'classic')
const configId = ref(initialConfig)
watch(configId, value => { themeId.value = value === 'homepage' ? 'homepage' : 'classic' })
const activeTheme = computed(() => playgroundThemes.find(theme => theme.id === themeId.value) || playgroundThemes[0])
const input = ref<MarkdownInputExpose | null>(null)
const header = ref<HTMLElement>()
const headerHeight = ref(130)
let resizeObserver: ResizeObserver | undefined
let themeStyle: HTMLStyleElement | undefined
watch(activeTheme, theme => {
  if (themeStyle) themeStyle.textContent = theme.css
})
onMounted(() => {
  themeStyle = document.createElement('style')
  themeStyle.dataset.mdePlaygroundTheme = 'true'
  themeStyle.textContent = activeTheme.value.css
  document.head.append(themeStyle)
  resizeObserver = new ResizeObserver(entries => { headerHeight.value = entries[0].target.getBoundingClientRect().height })
  if (header.value) resizeObserver.observe(header.value)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  themeStyle?.remove()
})

const parser = createMarkdownItPreset({ configure(md) { md.use(expressionPlugin) } })
const defaultAdapter = createMarkdownItAdapter({ markdown: parser, syntax: expressionSyntax })
const adapter = computed(() => configId.value === 'homepage' ? homepageAdapter : defaultAdapter)
const highlightCode = (source: string, language: string) => {
  if (!language || !hljs.getLanguage(language)) return undefined
  return hljs.highlight(source, { language, ignoreIllegals: true }).value
}
const renderMermaid = async (source: string) => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark.value ? 'dark' : 'default' })
  return (await mermaid.render(`playground-mermaid-${Date.now()}`, source)).svg
}
const activeSyntax = computed(() => configId.value === 'homepage' ? homepageSyntax : expressionSyntax)
const tools = computed(() => ['heading', 'bold', 'italic', 'underline', 'strike', 'code', 'link', 'blockquote', 'table', 'codeBlock', ...activeSyntax.value.map(item => item.name)])
const labels = computed(() => Object.fromEntries(activeSyntax.value.map(item => [item.name, item.toolbar?.label || item.name])))
const iconStyle = (url: string) => ({ maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` })
function insertSyntax(kind: string) {
  if (kind === 'table') { input.value?.insertTable(); return }
  const custom = adapter.value.syntax.resolve(kind)?.toolbar
  const [before, after] = custom ? [custom.before, custom.after || ''] : syntaxPairs[kind] || [kind, '']
  input.value?.insertSyntax(before, after)
}
function insertTable(rows: number, columns: number) {
  input.value?.insertTable(rows, columns)
}
function loadExample() {
  markdown.value = configId.value === 'homepage' ? homepageDemo : demoMarkdown
}
</script>
