import { createApp, defineComponent, h, ref } from 'vue'
import { MarkdownInput } from '@n0v0rland-md/vue'
import { createMarkdownItPreset } from '@n0v0rland-md/preset'
import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
import '@n0v0rland-md/theme'
import '@n0v0rland-md/theme/classic.css'

const value = ref('| H1 | H2 |\n| :--- | ---: |\n| A | B |\n| | |')
const mode = ref<'visual' | 'preview'>('visual')
const markdown = createMarkdownItPreset({ configure(md) {
  md.renderer.rules.table_open = () => '<section class="fixture-shell"><table class="fixture-table">'
  md.renderer.rules.table_close = () => '</table></section>'
  md.renderer.rules.th_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrJoin('class', 'fixture-head')
    return renderer.renderToken(tokens, index, options)
  }
} })
const adapter = createMarkdownItAdapter({ markdown })
const style = document.createElement('style')
style.textContent = `body { margin: 0; }
.fixture { max-width: 700px; margin: 80px auto; padding: 16px; }
.fixture-shell { border: 3px solid purple; padding: 10px; border-radius: 12px; }
.fixture .fixture-shell > table.fixture-table { width: 100%; table-layout: auto; }
.fixture .fixture-table .fixture-head { color: purple; font-size: 20px; background: lavender; padding: 12px; }
.fixture .fixture-table td { padding: 8px; font-size: 16px; }`
document.head.append(style)
createApp(defineComponent({ setup() {
  return () => h('main', { class: 'fixture mde-theme mde-classic' }, [
    h('button', { onClick: () => { mode.value = mode.value === 'visual' ? 'preview' : 'visual' } }, '切换模式'),
    h(MarkdownInput, { modelValue: value.value, 'onUpdate:modelValue': (next: string) => { value.value = next }, mode: mode.value, adapter }),
  ])
} })).mount('#app')
