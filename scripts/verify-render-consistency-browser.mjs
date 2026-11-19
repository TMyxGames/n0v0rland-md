import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFile, unlink, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = new URL('../examples/vue-vite/__render-consistency.html', import.meta.url)
const url = 'http://127.0.0.1:5219'
let server, browser, log = ''
try {
  await writeFile(fixture, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>main { padding:2rem; max-width:100%; min-width:0; }</style></head><body><div id="app"></div>
  <script type="module">
    import { createApp, h, ref } from 'vue'
    import { MarkdownInput } from '@n0v0rland-md/vue'
    import { createMarkdownItAdapter } from '@n0v0rland-md/markdown-it-adapter'
    import { createMarkdownItPreset } from '@n0v0rland-md/preset'
    import { expressionPlugin, expressionSyntax } from '/src/expression-syntax'
    import { homepageAdapter, homepageCommentAdapter } from '/src/hosts/homepage'
    import '@n0v0rland-md/theme'
    import '@n0v0rland-md/theme/classic.css'
    import '/src/playground.css'
    import '/src/hosts/homepage/homepage.css'
    const adapters = {default:createMarkdownItAdapter({markdown:createMarkdownItPreset({configure:md=>md.use(expressionPlugin)}),syntax:expressionSyntax}),
      article:homepageAdapter, comment:homepageCommentAdapter}
    const legacyMd=createMarkdownItPreset()
    legacyMd.inline.ruler.before('text','legacy',(state,silent)=>{
      const match=state.src.slice(state.pos).match(/^::legacy\\[([^\\]\\n]+)\\]/)
      if(!match)return false
      if(!silent){const token=state.push('html_inline','',0)
        token.content='<span class="legacy">'+state.md.utils.escapeHtml(match[1])+'</span>'
        token.meta={syntaxKind:'legacy',sourceFrom:state.pos,sourceTo:state.pos+match[0].length}}
      state.pos+=match[0].length;return true
    })
    adapters.legacy=createMarkdownItAdapter({markdown:legacyMd,syntax:[{
      name:'legacy',scope:'inline',contentMode:'text',className:'legacy',
      getInlineParts:raw=>({open:'::legacy[',body:raw.slice(9,-1),close:']'})
    }]})
    const value=ref(''), config=ref('default'), mode=ref('visual'), theme=ref('classic'), dark=ref(false), effects=ref('stable')
    const input=ref()
    window.test = { source:s=>value.value=s, config:s=>config.value=s, mode:s=>mode.value=s,
      theme:s=>theme.value=s, dark:s=>dark.value=s, effects:s=>effects.value=s, sync:()=>input.value.sync(),
      expected:s=>adapters[config.value].render(s) }
    createApp({render:()=>h('main',{class:theme.value==='classic'?'mde-classic':'mde-homepage',
      'data-color-mode':dark.value?'dark':'light'},[
      h(MarkdownInput,{ref:input,modelValue:value.value,'onUpdate:modelValue':v=>value.value=v,
        mode:mode.value,adapter:adapters[config.value],editingEffects:effects.value}),
      h('button',{id:'outside'},'outside')
    ])}).mount('#app')
  </script></body></html>`)
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'examples/vue-vite/vite.config.ts',
    '--host', '127.0.0.1', '--port', '5219', '--strictPort'],
  { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', x => { log += x }); server.stderr.on('data', x => { log += x })
  for (let i = 0; i < 100; i++) {
    if (server.exitCode != null) throw new Error(log)
    try { if ((await fetch(url)).ok) break } catch {}
    if (i === 99) throw new Error(log)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ headless: true,
    channel: process.env.MDE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${url}/__render-consistency.html`)
  await page.locator('.markdown-visual-editor').waitFor()
  const source = '***粗斜体*** **粗体 *内部斜体* 粗体**\n\n::loud[**大声**] ::whisper[*小声*] ::inner[++独白++]\n\n::loud[外 ::whisper[***内***] 尾] ::raw[**保持原文**]'
  for (const config of ['default', 'article', 'comment']) {
    for (const theme of ['classic', 'homepage']) {
      for (const dark of [false, true]) {
        await page.evaluate(({ config, theme, dark, source }) => {
          test.config(config); test.theme(theme); test.dark(dark); test.source(source); test.mode('visual')
        }, { config, theme, dark, source })
        await page.waitForTimeout(80)
        const editor = page.locator('.markdown-visual-editor')
        assert.equal(await page.evaluate(() => test.sync()), source)
        assert.equal(await editor.locator('em strong').first().evaluate(el => getComputedStyle(el).fontStyle), 'italic')
        assert.notEqual(await editor.evaluate(el => getComputedStyle(el).fontSynthesis), 'none')
        const prefix = config === 'default' ? '.demo-expression-' : '.bd-markdown-'
        const inner = config === 'default' ? '.demo-expression-inner' : '.bd-markdown-inner-thought'
        assert.equal(await editor.locator(`${prefix}loud strong`).count(), 2)
        assert.equal(await editor.locator(`${prefix}whisper em`).count(), 2)
        assert.equal(await editor.locator(`${inner} u`).count(), 1)
        if (config !== 'default') assert.equal(await editor.locator('.bd-markdown-no-parse-inline strong').count(), 0)
        await page.evaluate(() => test.mode('preview'))
        const preview = page.locator('.mde__preview')
        await preview.waitFor()
        assert.equal(await preview.locator('em strong').first().evaluate(el => getComputedStyle(el).fontStyle), 'italic')
        assert.equal(await preview.locator(`${prefix}loud strong`).count(), 2)
        assert.equal(await preview.locator(`${inner} u`).count(), 1)
        assert.equal(await preview.innerHTML(), await page.evaluate(source => {
          const el = document.createElement('div'); el.innerHTML = test.expected(source); return el.innerHTML
        }, source))
      }
    }
  }
  await page.evaluate(() => { test.config('legacy'); test.mode('visual'); test.source('::legacy[**保持原文**]') })
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.markdown-visual-editor .legacy').count(), 1)
  assert.equal(await page.locator('.markdown-visual-editor .legacy strong').count(), 0)
  await page.evaluate(() => test.mode('preview'))
  assert.equal(await page.locator('.mde__preview .legacy').textContent(), '**保持原文**')
  assert.equal(await page.locator('.mde__preview .legacy strong').count(), 0)
  await page.evaluate(() => {
    test.config('article'); test.theme('homepage'); test.dark(false); test.mode('visual')
    test.source('## 标题\n\n::inner[颤抖]\n\n||模糊内容||\n\n普通段落')
  })
  await page.waitForTimeout(100)
  const heading = page.locator('.markdown-visual-editor h2 > span').first()
  await heading.hover()
  await page.waitForTimeout(350)
  assert.notEqual(await heading.evaluate(el => getComputedStyle(el).transform), 'none')
  await heading.click()
  await page.waitForTimeout(100)
  assert.equal(await heading.evaluate(el => getComputedStyle(el).transform), 'none')
  await page.locator('#outside').click()
  const inner = page.locator('.markdown-visual-editor .bd-markdown-inner-thought')
  assert.equal(await inner.evaluate(el => getComputedStyle(el).animationPlayState), 'running')
  await inner.click()
  await page.waitForTimeout(100)
  assert.equal(await inner.evaluate(el => getComputedStyle(el).animationPlayState), 'paused')
  await page.locator('#outside').click()
  assert.equal(await inner.evaluate(el => getComputedStyle(el).animationPlayState), 'running')
  const spoiler = page.locator('.markdown-visual-editor .bd-markdown-theme-spoiler')
  assert.match(await spoiler.evaluate(el => getComputedStyle(el).filter), /blur/)
  await spoiler.click()
  await page.waitForTimeout(300)
  assert.equal(await spoiler.evaluate(el => getComputedStyle(el).filter), 'none')
  await page.locator('#outside').click()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
  assert.match(await spoiler.evaluate(el => getComputedStyle(el).filter), /blur/)
  await page.evaluate(() => test.effects('none'))
  assert.equal(await inner.evaluate(el => getComputedStyle(el).animationName), 'none')
  await page.evaluate(() => test.effects('theme'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await inner.evaluate(el => getComputedStyle(el).animationName), 'none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => test.effects('stable'))
  await page.locator('.markdown-visual-editor p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('输入')
  assert.match(await page.evaluate(() => test.sync()), /普通段落输入$/)
  await page.keyboard.press('Control+z')
  assert.match(await page.evaluate(() => test.sync()), /普通段落$/)
  await mkdir(new URL('../.artifacts/', import.meta.url), { recursive: true })
  for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.locator('#outside').click()
    await page.screenshot({ path: fileURLToPath(new URL(`../.artifacts/render-consistency-${width}.png`, import.meta.url)), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  assert.deepEqual(errors, [])
  console.log('PASS: default/article/comment × classic/host × light/dark editor-preview parity, typography, nesting, motion policies, spoiler, undo and responsive layout')
} finally {
  await browser?.close()
  server?.kill()
  await unlink(fixture).catch(() => {})
}
