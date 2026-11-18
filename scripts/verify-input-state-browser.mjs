import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = new URL('../examples/vue-vite/__input-state-check.html', import.meta.url)
const url = 'http://127.0.0.1:5218'
let server, browser, output = ''

try {
  await writeFile(fixture, `<!doctype html><html><body><div id="app"></div>
    <script type="module">
      import { createApp, h, ref } from 'vue'
      import { MarkdownInput, MarkdownEditor } from '/packages-vue-placeholder'
      import { createMarkdownItAdapter } from '/packages-adapter-placeholder'
      import MarkdownIt from 'markdown-it'
      const value = ref(''), mode = ref('visual'), disabled = ref(false)
      const adapter = createMarkdownItAdapter({markdown: new MarkdownIt()})
      window.events = []; window.states = []; window.wrapperEvents = []
      window.setValue = v => value.value = v
      window.setMode = v => mode.value = v
      window.setDisabled = v => disabled.value = v
      const record = name => state => window.events.push({name, state})
      createApp({render: () => h('main', [
        h(MarkdownInput, {modelValue:value.value, 'onUpdate:modelValue':v=>value.value=v,
          mode:mode.value, adapter, disabled:disabled.value, maxLength:4,
          onFocus:record('focus'), onBlur:record('blur'), onStateChange:s=>window.states.push(s)}),
        h('button',{id:'outside'},'outside'),
        h(MarkdownEditor, {modelValue:'', adapter, onFocus:s=>window.wrapperEvents.push(s),
          onStateChange:s=>window.wrapperEvents.push(s)})
      ])}).mount('#app')
    </script></body></html>`
    .replace('/packages-vue-placeholder', '@n0v0rland-md/vue')
    .replace('/packages-adapter-placeholder', '@n0v0rland-md/markdown-it-adapter'))
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config',
    'examples/vue-vite/vite.config.ts', '--host', '127.0.0.1', '--port', '5218', '--strictPort'],
  { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', value => { output += value })
  server.stderr.on('data', value => { output += value })
  for (let i = 0; i < 100; i++) {
    if (server.exitCode != null) throw new Error(output)
    try { if ((await fetch(url)).ok) break } catch {}
    if (i === 99) throw new Error(output)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ headless: true,
    channel: process.env.MDE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${url}/__input-state-check.html`)
  const visual = page.locator('.markdown-visual-editor').first()
  await visual.waitFor()
  const latest = () => page.evaluate(() => window.states.at(-1))
  assert.equal((await latest()).empty, true)
  await visual.click()
  await page.waitForFunction(() => window.states.at(-1).focused)
  await page.keyboard.insertText('中文abc')
  await page.waitForFunction(() => window.states.at(-1).length === 5)
  assert.equal((await latest()).overLimit, true)
  assert.equal((await latest()).value, '中文abc')
  assert.equal((await latest()).hasContent, true)
  assert.equal(await page.locator('.mde__panel').first().getAttribute('data-length'), '5')
  await page.locator('#outside').click()
  await page.waitForFunction(() => !window.states.at(-1).focused)
  assert.deepEqual(await page.evaluate(() => window.events.map(e => e.name)), ['focus', 'blur'])
  await page.evaluate(() => window.setMode('source'))
  const source = page.locator('textarea.mde__source')
  await source.fill('abc')
  await page.waitForFunction(() => window.states.at(-1).value === 'abc')
  assert.equal((await latest()).mode, 'source')
  assert.equal((await latest()).overLimit, false)
  // Internal control focus remains within the input panel.
  await page.evaluate(() => {
    const control = document.createElement('button')
    control.textContent = 'internal'
    document.querySelector('.mde__panel').append(control)
    control.focus()
  })
  assert.deepEqual(await page.evaluate(() => window.events.map(e => e.name)), ['focus', 'blur', 'focus'])
  await page.evaluate(() => window.setValue(''))
  await page.waitForFunction(() => window.states.at(-1).empty)
  await page.evaluate(() => window.setDisabled(true))
  await page.waitForFunction(() => window.states.at(-1).disabled)
  await page.evaluate(() => window.setMode('preview'))
  await page.waitForFunction(() => window.states.at(-1).mode === 'preview' && !window.states.at(-1).focused)
  await page.locator('.mde .markdown-visual-editor').click()
  await page.waitForFunction(() => window.wrapperEvents.some(s => s.focused))
  assert.deepEqual(errors, [])
  console.log('PASS: input state payload, focus/blur, internal focus, source mode, external/reset/disabled/limit changes, MarkdownEditor forwarding')
} finally {
  await browser?.close()
  server?.kill()
  await unlink(fixture).catch(() => {})
}
