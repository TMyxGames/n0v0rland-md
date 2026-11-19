import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const artifacts = fileURLToPath(new URL('../.artifacts/', import.meta.url))
const port = process.env.MDE_INTEGRATION_TEST_PORT || '5201'
const origin = process.env.MDE_INTEGRATION_TEST_URL || 'http://127.0.0.1:' + port
const server = process.env.MDE_INTEGRATION_TEST_URL ? undefined : spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--config', 'examples/vue-vite/vite.config.ts', '--host', '127.0.0.1', '--port', port, '--strictPort',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
let serverOutput = ''
server?.stdout.on('data', data => { serverOutput += data })
server?.stderr.on('data', data => { serverOutput += data })
const results = []
let browser
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server?.exitCode != null) throw new Error(serverOutput)
    try { if ((await fetch(origin)).ok) break } catch {}
    if (attempt === 99) throw new Error(`Vite startup: ${serverOutput}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  await mkdir(artifacts, { recursive: true })
  browser = await chromium.launch({ headless: true, channel: process.env.MDE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) })
  const fixture = `${origin}/@fs/${root.replaceAll('\\', '/')}scripts/fixtures/editor-workbench.html`
  async function check(name, fn, options = {}) {
    if (process.env.MDE_TEST_FILTER && !new RegExp(process.env.MDE_TEST_FILTER, 'i').test(name)) return
    const page = await browser.newPage({ viewport: { width: 1000, height: 850 }, ...options })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(fixture)
      await page.waitForFunction(() => !!window.editorWorkbench)
      const set = options => page.evaluate(options => window.editorWorkbench.set(options), options)
      const state = () => page.evaluate(() => window.editorWorkbench.state())
      await fn({ page, set, state })
      assert.deepEqual(errors, [], 'Browser runtime errors')
      results.push({ name, status: 'passed' })
      console.log(`PASS ${name}`)
    } catch (error) {
      results.push({ name, status: 'failed', error: error.message })
      console.error(`FAIL ${name}: ${error.stack || error.message}`)
    } finally { await page.close() }
  }
  const selectionModule = `/@fs/${root.replaceAll('\\', '/')}packages/core/src/markdown-dom-selection.ts`
  async function selectSource(page, from, to = from) {
    await page.evaluate(async ({ module, from, to }) => {
      const { domPositionFromSourceOffset } = await import(module)
      const editor = document.querySelector('.markdown-visual-editor')
      editor.focus()
      const anchor = domPositionFromSourceOffset(editor, from)
      const focus = domPositionFromSourceOffset(editor, to)
      const selection = window.getSelection()
      selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
    }, { module: selectionModule, from, to })
  }
  await check('Twelve nested syntax states expose parentage and distinguish crossing selection', async ({ page, set, state }) => {
    const value = '外部 ' + '::inner['.repeat(12) + '中心' + ']'.repeat(12) + ' 尾部'
    await set({ value })
    await selectSource(page, value.indexOf('中心') + 1)
    await page.waitForFunction(() => window.editorWorkbench.state().syntaxStates.filter(node => node.caretInside).length === 12)
    const nodes = (await state()).syntaxStates
    assert.equal(nodes[11].depth, 11)
    assert.equal(nodes[11].parentId, nodes[10].id)
    await selectSource(page, 0, value.indexOf('中心') + 1)
    await page.waitForFunction(() => window.editorWorkbench.state().syntaxStates.every(node => node.selection === 'crosses'))
    assert.equal((await state()).value, value)
  })
  await check('Per-syntax focus, hover and delayed delimiters follow the configured policy', async ({ page, set, state }) => {
    const value = '前缀 ::inner[需停下] ::loud[不暂停] 后缀'
    await set({ value, syntaxEditing: { inner: { effect: 'pause-hover' }, loud: { effect: 'none', boundary: 'hidden' } } })
    const inner = page.locator('[data-syntax-kind="inner"]')
    await inner.hover()
    await page.waitForFunction(() => window.editorWorkbench.state().syntaxStates.find(node => node.syntaxKind === 'inner').effectPaused)
    const innerFrom = value.indexOf('::inner')
    await selectSource(page, innerFrom + '::inner['.length)
    await page.waitForFunction(() => window.editorWorkbench.state().syntaxStates.find(node => node.syntaxKind === 'inner').boundaryVisible)
    assert.equal(await inner.locator('..').locator('.markdown-syntax-boundary.is-visible').count(), 2)
    await page.locator('[data-syntax-kind="loud"]').hover()
    await page.waitForFunction(() => !window.editorWorkbench.state().syntaxStates.find(node => node.syntaxKind === 'inner').effectPaused)
    assert.equal((await state()).syntaxStates.find(node => node.syntaxKind === 'loud').boundaryVisible, false)
    await selectSource(page, value.length)
    await page.waitForFunction(() => !window.editorWorkbench.state().syntaxStates.find(node => node.syntaxKind === 'inner').boundaryVisible)
  })
  await check('A mapped block is editable and a neighboring unmapped plugin block keeps its source', async ({ page, set, state }) => {
    const value = '普通段落\n\n!! 映射正文\n\n!!?无范围'
    await set({ value, parser: 'mapped-block' })
    const visual = page.locator('.markdown-visual-editor')
    assert.equal(await visual.locator('aside.workbench-panel').count(), 1)
    assert.equal(await visual.locator('.markdown-raw-block').innerText(), '!!?无范围')
    await selectSource(page, value.indexOf('映射正文') + 2)
    await page.keyboard.insertText('新')
    assert.equal((await state()).value, value.replace('映射正文', '映射新正文'))
  })
  await check('Mermaid blocks toggle their source and preview independently', async ({ page, set, state }) => {
    const value = '```mermaid\ngraph TD; A-->B\n```\n\n```mermaid\ngraph TD; C-->D\n```'
    await set({ value })
    const diagrams = page.locator('.markdown-editor-mermaid')
    await diagrams.first().getByRole('button', { name: '预览图表' }).click()
    await diagrams.first().getByRole('img', { name: 'Mermaid 图表预览' }).waitFor()
    assert.equal(await diagrams.first().locator('pre').isVisible(), false)
    assert.equal(await diagrams.last().locator('pre').isVisible(), true)
    await diagrams.first().getByRole('button', { name: '编辑源码' }).click()
    assert.equal(await diagrams.first().locator('pre').isVisible(), true)
    assert.equal((await state()).value, value)
  })
  for (const dark of [false, true]) await check(`Mobile touch selects the intended formatted text (dark: ${dark})`, async ({ page, set, state }) => {
    const value = '前一行\n\n**触屏文字**\n\n后一行'
      await set({ value, dark, editingStyle: 'structure' })
      const text = page.locator('.markdown-visual-editor strong .markdown-editor-text')
      const point = await text.evaluate(element => {
        const range = document.createRange()
        range.setStart(element.firstChild, 1)
        range.setEnd(element.firstChild, 1)
        const rect = range.getBoundingClientRect()
        return { x: rect.x, y: rect.y + rect.height / 2 }
      })
      await page.touchscreen.tap(point.x, point.y)
      await page.keyboard.insertText('新')
      assert.equal((await state()).value, value.replace('触屏', '触新屏'))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: `${artifacts}mobile-touch-${dark ? 'dark' : 'light'}.png` })
  }, { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true })
  await check('Quote, alert and nested task Enter retain their source prefixes', async ({ page, set, state }) => {
    for (const [value, continuation] of [
      ['> > 嵌套引用', '> > '],
      ['> [!NOTE]\n> 提示正文', '> '],
      ['1. 上级\n   1) 子项', '   2) '],
      ['- 上级\n  - [x] 已完成', '  - [ ] '],
    ]) {
      await set({ value })
      await selectSource(page, value.length)
      await page.keyboard.press('Enter')
      await page.keyboard.insertText('第二行')
      assert.equal((await state()).value, `${value}\n${continuation}第二行`)
      await page.keyboard.press('Enter')
      assert.equal((await state()).value, `${value}\n${continuation}第二行\n${continuation.replace('2)', '3)')}`)
    }
  })
  await check('Large document input preserves all untouched Markdown', async ({ page, set, state }) => {
    const value = Array.from({ length: 600 }, (_, index) => `${index} 段落与 **格式**`).join('\n\n')
    await set({ value })
    const offset = value.indexOf('300 段落') + 4
    await selectSource(page, offset)
    const start = Date.now()
    await page.keyboard.insertText('新')
    assert.equal((await state()).value, value.slice(0, offset) + '新' + value.slice(offset))
    const duration = Date.now() - start
    console.log(`600 段 Markdown 输入至模型同步 ${duration} ms`)
    assert.ok(duration < 2500, `Large document input took ${duration} ms`)
  })
  await check('Opening and mode switching preserve Markdown without editor changes', async ({ page, set, state }) => {
    const cases = ['# 标题\n\n正文 ++下划线++\n\n- 第一项\n\n- 第二项', '**bold** *italic* ~~strike~~ ==mark== `code`', '> 引用\n>\n> 第二段', '| A | B |\n| --- | --- |\n| x | y |', '原文\r\n\r\n**完整**\r\n', '<div>unknown HTML</div>\n\n[^ref]: footnote']
    for (const value of cases) for (const editingStyle of ['always', 'blur-hidden', 'structure']) {
      await set({ value, editingStyle })
      await page.evaluate(() => window.editorWorkbench.clearEvents())
      for (const mode of ['source', 'preview', 'visual']) await set({ mode })
      assert.equal((await state()).value, value)
      assert.deepEqual((await state()).changes, [])
    }
  })
  await check('Nested emphasis matches Markdown-it even beside custom syntax and footnotes', async ({ page, set, state }) => {
    const cases = [
      '***粗斜体***', '**粗体*斜体*粗体**', '**粗体 *斜体* 粗体**',
      '***粗斜体***普通**粗体**', '**外层*内层***', '***内层*外层**',
      '***第一段*** 和 ***第二段***', '**甲*乙*丙** 与 ***丁***',
      '***粗斜体*** ::loud[自定义]', '**粗体*斜体*粗体** :smile:',
      '***粗斜体***[^note]\n\n[^note]: 脚注',
      '**粗体*斜体*粗体**[^note]\n\n[^note]: 脚注',
      '***粗斜体*** `` `代码` ``', '**粗体*斜体*粗体** 与 [链接][ref]\n\n[ref]: https://example.com',
    ]
    for (const value of cases) for (const editingStyle of ['structure', 'blur-hidden', 'always']) {
      await set({ value, editingStyle, parser: 'plain', mode: 'preview' })
      const expected = await page.locator('.mde__preview').evaluate(root =>
        [...root.querySelectorAll('strong, em')].map(element => `${element.tagName}:${element.textContent}`))
      await set({ mode: 'visual' })
      const actual = await page.locator('.markdown-visual-editor').evaluate(root =>
        [...root.querySelectorAll('strong, em')].map(element => {
          const copy = element.cloneNode(true)
          copy.querySelectorAll('.markdown-syntax-boundary').forEach(marker => marker.remove())
          return `${element.tagName}:${copy.textContent}`
        }))
      assert.deepEqual(actual, expected, `${editingStyle}: ${value}`)
      assert.equal((await state()).value, value)
    }
  })
  await check('Leaving an empty final list item stays on its current line', async ({ page, set, state }) => {
    for (const prefix of ['- ', '1. ', '- [ ] ']) {
      const value = `${prefix}项目`
      await set({ value, editingStyle: 'structure' })
      await selectSource(page, value.length)
      await page.keyboard.press('Enter')
      const nextPrefix = prefix === '1. ' ? '2. ' : prefix
      assert.equal((await state()).value, `${value}\n${nextPrefix}`)
      await page.keyboard.press('Enter')
      assert.equal((await state()).value, `${value}\n`)
      await page.keyboard.insertText('后文')
      assert.equal((await state()).value, `${value}\n后文`)
      await page.keyboard.press('Control+z')
      await page.keyboard.press('Control+z')
      assert.equal((await state()).value, `${value}\n${nextPrefix}`)
    }
  })
  await check('Typing and editing nested emphasis keeps both Markdown-it marks', async ({ page, set, state }) => {
    for (const editingStyle of ['structure']) {
      for (const value of ['***粗斜体***', '**粗体*斜体*粗体**']) {
        await set({ value: '', editingStyle, parser: 'plain', mode: 'visual' })
        await page.locator('.markdown-visual-editor').click()
        for (const character of value) await page.keyboard.insertText(character)
        assert.equal((await state()).value, value)
        const italic = page.locator('.markdown-visual-editor strong em, .markdown-visual-editor em strong')
        assert.equal(await italic.count(), 1, `${editingStyle}: ${value}`)
        const offset = value.indexOf('斜')
        await selectSource(page, offset)
        await page.keyboard.insertText('新')
        assert.equal((await state()).value, `${value.slice(0, offset)}新${value.slice(offset)}`)
        assert.equal(await italic.count(), 1)
        await page.keyboard.press('Control+z')
        assert.equal((await state()).value, value)
        assert.equal(await italic.count(), 1)
      }
    }
  })
  await check('Images expose editable captions and preserve source metadata and history', async ({ page, set, state }) => {
    await page.route('https://images.test/**', route => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#67a77e"/></svg>',
    }))
    for (const editingStyle of ['structure', 'blur-hidden', 'always']) {
      const value = '![描述](https://images.test/sample.svg#320x160 "标题")'
      await set({ value, parser: 'plain', editingStyle, mode: 'visual' })
      const caption = page.locator('.markdown-editor-image-caption')
      const image = page.locator('.markdown-editor-image img')
      await image.evaluate(image => image.decode())
      assert.equal(await image.getAttribute('src'), 'https://images.test/sample.svg')
      assert.equal(await image.getAttribute('title'), '标题')
      assert.equal(await image.evaluate(image => image.style.getPropertyValue('--img-w')), '320')
      await caption.click()
      await page.keyboard.press('End')
      await page.keyboard.insertText('新增')
      assert.equal((await state()).value, value.replace('描述', '描述新增'))
      await page.keyboard.press('Control+z')
      assert.equal((await state()).value, value)
      await set({ mode: 'preview' })
      assert.equal(await page.locator('.mde__preview img').getAttribute('alt'), '描述')
      await set({ mode: 'visual' })
      await image.click()
      await page.keyboard.press('Backspace')
      assert.equal((await state()).value, '')
      await page.keyboard.press('Control+z')
      assert.equal((await state()).value, value)
    }
    const empty = '![](https://images.test/sample.svg "保持标题")'
    await set({ value: empty, editingStyle: 'structure' })
    await page.locator('.markdown-editor-image-caption').click()
    await page.keyboard.insertText('中文描述')
    assert.equal((await state()).value, empty.replace('![]', '![中文描述]'))
    for (let index = 0; index < 4; index++) await page.keyboard.press('Backspace')
    assert.equal((await state()).value, empty)
    await page.locator('.markdown-editor-image img').click()
    await page.keyboard.press('Backspace')
    assert.equal((await state()).value, '')
    await set({ value: '![](https://missing.test/broken.png)' })
    await page.route('https://missing.test/**', route => route.abort())
    await page.waitForFunction(() => document.querySelector('.markdown-editor-image-figure.is-image-error'))
    await page.locator('.markdown-editor-image-caption').click()
    await page.keyboard.insertText('失败后仍可编辑')
    assert.ok((await state()).value.includes('![失败后仍可编辑]'))
  })
  await check('Image focus follows the actual caret and never leaks into subsequent editing', async ({ page, set, state }) => {
    await page.route('https://images.test/**', route => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"/>',
    }))
    for (const editingStyle of ['structure', 'blur-hidden', 'always']) {
      const value = '前文\n\n![描述](https://images.test/a.svg "标题")\n\n后文'
      await set({ value, editingStyle, mode: 'visual' })
      const caption = page.locator('.markdown-editor-image-caption')
      await caption.click()
      await page.keyboard.press('Home')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.insertText('新')
      assert.equal((await state()).value, value.replace('描述', '描新述'))
      await page.keyboard.press('End')
      await page.keyboard.insertText(']')
      assert.equal((await state()).value, value.replace('描述', '描新述\\]'))
      assert.equal(await caption.textContent(), '描新述]')
      await page.keyboard.press('Backspace')
      assert.equal((await state()).value, value.replace('描述', '描新述'))
      await page.keyboard.press('Enter')
      await page.keyboard.insertText('图片后文')
      assert.equal((await state()).value, value.replace('描述', '描新述').replace('\n\n后文', '\n图片后文\n后文'))
      await selectSource(page, (await state()).value.length)
      await page.keyboard.press('Backspace')
      assert.ok((await state()).value.endsWith('后'), 'backspace in normal text must not delete the image')
      const beforeImageSelection = (await state()).value
      await page.locator('.markdown-editor-image img').click()
      await selectSource(page, 1)
      await page.keyboard.insertText('普通')
      assert.equal((await state()).value, beforeImageSelection.slice(0, 1) + '普通' + beforeImageSelection.slice(1))
      await page.locator('.markdown-editor-image img').click()
      await page.keyboard.press('ArrowRight')
      const beforeMoveDelete = (await state()).value
      await page.keyboard.press('Backspace')
      assert.equal(await page.locator('.markdown-editor-image').count(), 1)
      assert.equal((await state()).value, beforeMoveDelete)
      for (const mode of ['preview', 'source', 'visual']) await set({ mode })
      await selectSource(page, (await state()).value.length)
      await page.keyboard.insertText('继续')
      assert.ok((await state()).value.endsWith('继续'))
      await set({ value: '恢复的草稿' })
      await selectSource(page, 6)
      await page.keyboard.insertText('正文')
      assert.equal((await state()).value, '恢复的草稿正文')
    }
    const empty = '![](https://images.test/a.svg "保留")'
    await set({ value: empty, editingStyle: 'structure' })
    await page.locator('.markdown-editor-image-caption').click()
    await page.keyboard.insertText('说明')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    assert.equal((await state()).value, empty)
    await page.keyboard.press('Backspace')
    assert.equal((await state()).value, '')
    await page.keyboard.press('Control+z')
    assert.equal((await state()).value, empty)
    await set({ disabled: true })
    await page.locator('.markdown-editor-image img').click()
    await page.keyboard.press('Delete')
    await page.keyboard.insertText('禁止')
    assert.equal((await state()).value, empty)
  })
  await check('Footnotes display numbered references and editable definitions with exact source preservation', async ({ page, set, state }) => {
    const value = '正文[^note]，再次引用[^note]。\n\n[^note]: **脚注**正文\n\n    第二段正文'
    for (const editingStyle of ['structure', 'blur-hidden', 'always']) {
      await set({ value, parser: 'plain', editingStyle, mode: 'visual' })
      const refs = page.locator('.markdown-editor-footnote-number')
      assert.deepEqual(await refs.allTextContents(), ['[1]', '[1]'])
      assert.equal(await page.locator('.markdown-editor-footnote-definition strong').textContent(), '脚注')
      assert.equal(await page.locator('.markdown-raw-block').count(), 0)
      assert.equal((await state()).value, value)
      if (editingStyle !== 'always') await refs.first().click()
      await selectSource(page, value.indexOf('正文\n\n    第二段'))
      await page.keyboard.insertText('新增')
      assert.equal((await state()).value, value.replace('**脚注**正文', '**脚注**新增正文'))
      await page.keyboard.press('Control+z')
      assert.equal((await state()).value, value)
      await selectSource(page, value.length)
      await page.keyboard.press('Enter')
      await page.keyboard.insertText('后续行')
      assert.equal((await state()).value, `${value}\n    后续行`)
      for (const mode of ['source', 'preview', 'visual']) await set({ mode })
      assert.equal((await state()).value, `${value}\n    后续行`)
    }
    await set({ value: '未引用\n\n[^unused]: 未使用的脚注', editingStyle: 'structure' })
    assert.equal(await page.locator('.markdown-editor-footnote-definition').count(), 1)
    await set({ value: '正文[^note]\n\n[^note]: 第一行\n\n    - 复杂列表', editingStyle: 'structure' })
    assert.equal(await page.locator('.markdown-raw-block').count(), 1, 'complex definitions retain exact source fallback')
  })
  await check('Homepage configuration injects the real renderer and source metadata without changing its HTML', async ({ page, set, state }) => {
    const value = '# 主站标题\n\n**粗体**、***粗斜体***和::loud[大声] ::raw[**原文**]\n\n> [!NOTE]\n> 主站提示\n\n| A | B |\n| --- | --- |\n| 甲 | 乙 |\n\n正文[^a]\n\n[^a]: 注释正文'
    await set({ value, parser: 'homepage', editingStyle: 'structure', mode: 'preview' })
    const actual = await page.locator('.mde__preview').innerHTML()
    const expected = await page.evaluate(async ({ url, value }) => {
      const { default: md } = await import(url)
      const element = document.createElement('div')
      element.innerHTML = md.render(value)
      return element.innerHTML
    }, { url: `/@fs/${root.replaceAll('\\', '/')}examples/vue-vite/src/hosts/homepage/markdown.ts?baseline`, value })
    assert.equal(actual, expected)
    await set({ mode: 'visual' })
    assert.equal(await page.locator('.markdown-visual-editor .bd-markdown-loud').textContent(), '大声')
    assert.equal(await page.locator('.markdown-visual-editor .bd-markdown-no-parse-inline').textContent(), '**原文**')
    assert.equal(await page.locator('.markdown-visual-editor .markdown-alert-note').count(), 1)
    await selectSource(page, value.indexOf('大声') + 1)
    await page.keyboard.insertText('新')
    assert.equal((await state()).value, value.replace('大声', '大新声'))
    await set({ value: '```mermaid\ngraph TD; A-->B\n```', mode: 'preview' })
    assert.equal(await page.locator('.mde__preview svg').count(), 1, 'host pre.mermaid is enhanced through the same callback')
  })
  await check('Playground switches to injected homepage styles without changing source or leaking themes', async ({ page }) => {
    await page.route('https://res.n0v0rland.xyz/**', route => route.abort())
    await page.goto(origin)
    const config = page.getByRole('combobox', { name: '选择 Markdown 配置' })
    const theme = page.getByRole('combobox', { name: '选择编辑器主题' })
    const style = page.getByRole('combobox', { name: '选择语法显示风格' })
    const sourceButton = page.getByRole('button', { name: '源码', exact: true })
    const editButton = page.getByRole('button', { name: '编辑', exact: true })
    const previewButton = page.getByRole('button', { name: '预览', exact: true })
    await sourceButton.click()
    const original = await page.locator('.mde__source').inputValue()
    await config.selectOption('homepage')
    assert.equal(await theme.inputValue(), 'homepage')
    assert.equal(await page.locator('.mde__source').inputValue(), original)
    await page.getByRole('button', { name: '载入配置示例', exact: true }).click()
    const value = await page.locator('.mde__source').inputValue()
    assert.ok(value.includes('主站 Markdown 配置注入'))
    await editButton.click()
    assert.equal(await page.locator('.markdown-visual-editor .bd-markdown-loud').count(), 1)
    assert.equal(await page.locator('.markdown-visual-editor .markdown-alert-note').count(), 1)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      if (width < 768) await page.getByRole('button', { name: '切换暗色主题', exact: true }).click()
      await style.selectOption('always')
      await page.screenshot({ path: `${artifacts}homepage-injected-${width}-editor.png`, fullPage: true, animations: 'disabled' })
      const heading = await page.locator('.markdown-visual-editor h1').evaluate(element => ({
        align: getComputedStyle(element).textAlign, font: getComputedStyle(element).fontSize,
      }))
      assert.equal(heading.align, 'center')
      await previewButton.click()
      const previewHeading = await page.locator('.mde__preview h1').evaluate(element => ({
        align: getComputedStyle(element).textAlign, font: getComputedStyle(element).fontSize,
      }))
      assert.deepEqual(previewHeading, heading)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `homepage overflow at ${width}`)
      await page.screenshot({ path: `${artifacts}homepage-injected-${width}-preview.png`, fullPage: true, animations: 'disabled' })
      await editButton.click()
    }
    await sourceButton.click()
    assert.equal(await page.locator('.mde__source').inputValue(), value)
    await config.selectOption('default')
    assert.equal(await theme.inputValue(), 'classic')
    assert.equal(await page.locator('.mde__source').inputValue(), value)
    await editButton.click()
    assert.equal(await page.locator('.markdown-visual-editor h1').evaluate(element => getComputedStyle(element).textAlign), 'left')
    assert.equal(await page.locator('main.mde-homepage').count(), 0)
  })
  await check('Source markers sit outside their semantic style and code fences escape clipping', async ({ page, set, state }) => {
    const value = '**粗体** *斜体* ++下划线++ ~~删除~~ ==高亮== `行内代码` ::loud[大声]\n\n```js\nconst value = 1\n```'
    for (const theme of ['classic', 'notebook']) {
      for (const width of [1000, 390]) {
        await page.setViewportSize({ width, height: 850 })
        await set({ value, theme, parser: 'plain', editingStyle: 'always', dark: width < 768 })
        const markers = await page.locator('.markdown-inline-syntax > .markdown-syntax-boundary').evaluateAll(elements =>
          elements.map(marker => ({
            tag: marker.parentElement.tagName, group: marker.parentElement.classList.contains('markdown-inline-syntax'),
            weight: getComputedStyle(marker).fontWeight, background: getComputedStyle(marker).backgroundColor,
          })))
        assert.ok(markers.length >= 12)
        assert.ok(markers.every(marker => marker.group && marker.tag === 'SPAN' && marker.weight === '400' && marker.background === 'rgba(0, 0, 0, 0)'))
        const fences = await page.locator('.markdown-editor-code-fence .markdown-syntax-boundary').evaluateAll(elements =>
          elements.map(marker => {
            const box = marker.getBoundingClientRect()
            const block = marker.closest('.markdown-editor-code').getBoundingClientRect()
            return { inPre: !!marker.closest('pre'), height: box.height, top: box.top, bottom: box.bottom, blockTop: block.top, blockBottom: block.bottom }
          }))
        assert.equal(fences.length, 2)
        assert.ok(fences.every(fence => !fence.inPre && fence.height > 0 && fence.top >= fence.blockTop - 1 && fence.bottom <= fence.blockBottom + 1))
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        assert.equal((await state()).value, value)
        await page.screenshot({ path: `${artifacts}media-syntax-${theme}-${width}.png`, animations: 'disabled' })
      }
    }
  })
  await check('Table backspace traverses cells and removes only a fully emptied row', async ({ page, set, state }) => {
    const value = '前文\n\n| H1 | H2 |\n| --- | --- |\n| A | B |\n| C | D |\n\n后文'
    await set({ value, editingStyle: 'structure' })
    const cell = (row, column) => page.locator(`[data-table-row="${row}"][data-table-column="${column}"]`)
    const active = () => page.evaluate(() => {
      const selection = window.getSelection()
      const node = selection.focusNode
      const cell = (node instanceof Element ? node : node.parentElement)?.closest('[data-table-row]')
      return cell ? [Number(cell.dataset.tableRow), Number(cell.dataset.tableColumn)] : null
    })
    await cell(2, 1).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Backspace')
    assert.equal(await cell(2, 1).textContent(), '')
    const afterD = (await state()).value
    await page.keyboard.press('Backspace')
    assert.deepEqual(await active(), [2, 0])
    assert.equal((await state()).value, afterD)
    await page.keyboard.press('Backspace')
    assert.equal(await cell(2, 0).textContent(), '')
    await page.keyboard.press('Backspace')
    assert.equal(await page.locator('.markdown-visual-editor table tr').count(), 2)
    assert.deepEqual(await active(), [1, 1])
    await page.keyboard.press('Control+z')
    assert.equal(await page.locator('.markdown-visual-editor table tr').count(), 3)
    await page.keyboard.press('Control+Shift+z')
    assert.equal(await page.locator('.markdown-visual-editor table tr').count(), 2)
    for (let index = 0; index < 4; index++) await page.keyboard.press('Backspace')
    assert.equal(await page.locator('.markdown-visual-editor table tr').count(), 1)
    assert.deepEqual(await active(), [0, 1])
    // Header text is deleted normally, its row remains until the entire table is empty.
    for (let index = 0; index < 6; index++) await page.keyboard.press('Backspace')
    assert.equal(await page.locator('.markdown-visual-editor table').count(), 0)
    assert.ok((await state()).value.startsWith('前文'))
    assert.ok((await state()).value.endsWith('后文'))
  })
  await check('Table arrows cross cell edges and leave the table without rewriting source', async ({ page, set, state }) => {
    const value = '前文\n\n| H1 | H2 |\n| --- | --- |\n| A | B |\n\n后文'
    await set({ value, editingStyle: 'structure' })
    const cell = (row, column) => page.locator(`[data-table-row="${row}"][data-table-column="${column}"]`)
    const active = () => page.evaluate(() => {
      const selection = window.getSelection()
      const node = selection.focusNode
      const cell = (node instanceof Element ? node : node.parentElement)?.closest('[data-table-row]')
      return cell ? [Number(cell.dataset.tableRow), Number(cell.dataset.tableColumn)] : null
    })
    await cell(1, 0).click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowRight')
    assert.deepEqual(await active(), [1, 1])
    await page.keyboard.press('ArrowLeft')
    assert.deepEqual(await active(), [1, 0])
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    assert.deepEqual(await active(), [0, 1])
    await page.keyboard.press('ArrowDown')
    assert.deepEqual(await active(), [1, 1])
    await page.keyboard.press('ArrowDown')
    assert.equal(await active(), null)
    assert.equal((await state()).value, value)
    await selectSource(page, value.indexOf('后文'))
    await page.keyboard.press('Backspace')
    assert.equal(await page.locator('table').count(), 1)
    assert.equal((await state()).value, value)
    await page.keyboard.press('Backspace')
    assert.deepEqual(await active(), [1, 1])
    assert.equal((await state()).value, value)
    await cell(0, 0).click()
    await page.keyboard.press('ArrowUp')
    assert.equal(await active(), null)
    assert.equal((await state()).value, value)
    await selectSource(page, value.indexOf('| H1'))
    await page.keyboard.press('ArrowRight')
    assert.deepEqual(await active(), [0, 0])
    await selectSource(page, value.indexOf('后文'))
    for (let index = 0; index < 3 && !(await active()); index++) await page.keyboard.press('ArrowLeft')
    assert.deepEqual(await active(), [1, 1])
    assert.equal((await state()).value, value)
    // With no trailing source paragraph, navigation exposes a virtual tail;
    // only actual typing materializes the required Markdown separator.
    const alone = '| H |\n| --- |\n| A |'
    await set({ value: alone })
    await cell(1, 0).click()
    await page.keyboard.press('ArrowDown')
    assert.equal(await active(), null)
    assert.equal((await state()).value, alone)
    await page.keyboard.insertText('后文')
    assert.equal((await state()).value, `${alone}\n\n后文`)
  })
  await check('Adjacent block navigation lands on visible content rather than source separators', async ({ page, set, state }) => {
    const value = '# 一级标题\n## 二级标题\n- 列表甲\n- 列表乙\n> 引用甲\n> 引用乙\n### 三级标题\n普通段落'
    const labels = ['一级标题', '二级标题', '列表甲', '列表乙', '引用甲', '引用乙', '三级标题', '普通段落']
    for (const theme of ['classic', 'notebook']) for (const editingStyle of ['structure', 'blur-hidden', 'always']) for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 850 })
      await set({ value, theme, editingStyle })
      await selectSource(page, value.indexOf(labels[0]) + 1)
      for (const direction of [1, -1]) {
        const ordered = direction === 1 ? labels.slice(1) : labels.slice(0, -1).reverse()
        for (const label of ordered) {
          await page.keyboard.press(direction === 1 ? 'ArrowDown' : 'ArrowUp')
          const caret = await page.evaluate(async ({ module, label }) => {
            const { sourceOffsetFromDOM } = await import(module)
            const root = document.querySelector('.markdown-visual-editor')
            const selection = window.getSelection()
            const range = selection.getRangeAt(0)
            const rect = range.getBoundingClientRect()
            const target = [...root.querySelectorAll('.markdown-editor-text')].find(node => node.textContent === label)
            const box = target.getBoundingClientRect()
            return { source: sourceOffsetFromDOM(root, selection.focusNode, selection.focusOffset, -1), y: rect.y, height: rect.height, top: box.top, bottom: box.bottom }
          }, { module: selectionModule, label })
          const bodyFrom = value.indexOf(label)
          const begin = editingStyle === 'always' ? value.lastIndexOf('\n', bodyFrom - 1) + 1 : bodyFrom
          assert.ok(caret.source >= begin && caret.source <= bodyFrom + label.length,
            `${theme}/${editingStyle} ${direction}: expected ${label}, got ${JSON.stringify(caret)}`)
          assert.ok(caret.height > 0 && caret.y >= caret.top - 2 && caret.y + caret.height <= caret.bottom + 2,
            `${theme}/${editingStyle}/${width}/${direction} ${label}: caret outside visible text ${JSON.stringify(caret)}`)
        }
      }
      assert.equal((await state()).value, value)
    }
    await set({ theme: 'classic', editingStyle: 'structure', dark: true })
    await page.screenshot({ path: `${artifacts}adjacent-block-navigation-mobile.png`, animations: 'disabled' })
    await page.setViewportSize({ width: 1000, height: 850 })
    await set({ dark: false })
    await page.screenshot({ path: `${artifacts}adjacent-block-navigation-desktop.png`, animations: 'disabled' })
  })
  await check('Navigation crosses adjacent code, quote and alert content without stopping on hidden fences', async ({ page, set, state }) => {
    const value = '# 标题\n```js\n代码甲\n代码乙\n```\n> [!NOTE]\n> 提示甲\n> 提示乙\n## 结尾'
    const labels = ['标题', '代码甲', '代码乙', '提示甲', '提示乙', '结尾']
    await set({ value, parser: 'legacy', editingStyle: 'structure' })
    await selectSource(page, value.indexOf(labels[0]) + 1)
    for (const direction of [1, -1]) {
      for (const label of direction === 1 ? labels.slice(1) : labels.slice(0, -1).reverse()) {
        await page.keyboard.press(direction === 1 ? 'ArrowDown' : 'ArrowUp')
        const offset = await page.evaluate(async module => {
          const { sourceOffsetFromDOM } = await import(module)
          const selection = window.getSelection()
          return sourceOffsetFromDOM(document.querySelector('.markdown-visual-editor'), selection.focusNode, selection.focusOffset, -1)
        }, selectionModule)
        assert.ok(offset >= value.indexOf(label) && offset <= value.indexOf(label) + label.length,
          `expected ${label}, got source offset ${offset}`)
      }
    }
    assert.equal((await state()).value, value)
  })
  await check('Heading content matches parser semantics for empty and closing-marker spellings', async ({ page, set, state }) => {
    for (const [value, selector, content] of [
      ['#', 'h1', ''],
      ['## 标题 ##', 'h2', '标题'],
      ['第一行\n第二行\n=======', 'h1', '第一行\n第二行'],
    ]) {
      await set({ value, editingStyle: 'structure' })
      const body = await page.locator(`.markdown-visual-editor ${selector}`).evaluate(element => {
        const copy = element.cloneNode(true)
        copy.querySelectorAll('.markdown-syntax-boundary, .markdown-editor-source-gap').forEach(node => node.remove())
        return copy.textContent
      })
      assert.equal(body, content)
      assert.equal((await state()).value, value)
    }
  })
  await check('Full document context preserves reference links and nested labels', async ({ page, set, state }) => {
    const value = '[***引用链接***][site]\n\n[site]: https://example.com "引用说明"'
    await set({ value, editingStyle: 'structure' })
    const link = page.locator('.markdown-visual-editor a[href="https://example.com"]')
    assert.equal(await link.count(), 1)
    assert.equal(await link.getAttribute('title'), '引用说明')
    assert.equal(await link.locator('em strong').count(), 1)
    await selectSource(page, value.indexOf('引用链接') + 1)
    await page.keyboard.insertText('新')
    assert.equal((await state()).value, value.replace('引用链接', '引新用链接'))
    assert.equal(await link.locator('em strong').count(), 1)
    await page.keyboard.press('Control+z')
    assert.equal((await state()).value, value)
  })
  await check('Host presentation shells and attributes agree with formal preview', async ({ page, set, state }) => {
    const value = '# 标题\n> **引用粗体**\n## 第二标题'
    await set({ value, parser: 'presentation', editingStyle: 'structure' })
    assert.equal(await page.locator('.markdown-visual-editor h1.workbench-heading').count(), 1)
    assert.equal(await page.locator('.markdown-visual-editor h1').evaluate(element => getComputedStyle(element).textAlign), 'center')
    assert.equal(await page.locator('.markdown-visual-editor blockquote.workbench-quote').count(), 1)
    assert.equal(await page.locator('.markdown-visual-editor strong.workbench-strong > span.workbench-strong-body').count(), 1)
    await selectSource(page, value.indexOf('引用粗体') + 2)
    await page.keyboard.insertText('新')
    assert.ok((await state()).value.includes('引用新粗体'))
    await page.keyboard.press('Control+z')
    assert.equal((await state()).value, value)
    await set({ mode: 'preview' })
    assert.equal(await page.locator('.mde__preview strong.workbench-strong > span.workbench-strong-body').count(), 1)
    assert.equal(await page.locator('.mde__preview h1').evaluate(element => getComputedStyle(element).textAlign), 'center')
  })
  await check('Alert and code presentation follow enabled host rules and renderer shells', async ({ page, set }) => {
    const value = '> [!NOTE]\n> 提示正文\n\n```js\nconst value = 1\n```'
    for (const parser of ['plain', 'legacy']) {
      await set({ value, parser, mode: 'visual', editingStyle: 'structure' })
      const title = await page.locator('.markdown-visual-editor .markdown-alert-title').allTextContents()
      const numbered = await page.locator('.markdown-visual-editor .markdown-editor-code.has-line-numbers').count()
      await set({ mode: 'preview' })
      assert.deepEqual(title, await page.locator('.mde__preview .markdown-alert-title').allTextContents())
      assert.equal(numbered > 0, await page.locator('.mde__preview .bd-code-line-number').count() > 0)
      assert.equal(title.length, parser === 'legacy' ? 1 : 0)
    }
  })
  await check('Plugin range hooks and explicit nested Markdown preserve source edits', async ({ page, set, state }) => {
    const value = '之前 ::box[***组合内容***] 之后 ::box[**第二项**]'
    await set({ value, parser: 'extension-ranges', editingStyle: 'structure' })
    assert.equal(await page.locator('.markdown-visual-editor .workbench-nested').count(), 2)
    assert.equal(await page.locator('.markdown-visual-editor .workbench-nested em strong').count(), 1)
    await selectSource(page, value.indexOf('组合内容') + 2)
    await page.keyboard.insertText('新')
    assert.equal((await state()).value, value.replace('组合内容', '组合新内容'))
    await page.keyboard.press('Control+z')
    assert.equal((await state()).value, value)
    for (const mode of ['preview', 'source', 'visual']) await set({ mode })
    assert.equal((await state()).value, value)
    assert.equal(await page.locator('.markdown-visual-editor .workbench-nested em strong').count(), 1)
  })
  await check('Source length validation never silently truncates input', async ({ page, set, state }) => {
    await set({ full: true, value: '', maxLength: 3 })
    await page.evaluate(() => window.editorWorkbench.setMode('source'))
    await page.locator('.mde__source').fill('abcdef中文')
    assert.equal((await state()).value, 'abcdef中文')
    assert.equal((await state()).validities.at(-1), false)
    await page.locator('.mde__source').fill('')
    assert.equal((await state()).synced, '')
    assert.equal((await state()).validities.at(-1), true)
    await set({ value: 'abc', maxLength: 3 })
    assert.equal((await state()).validities.at(-1), true)
    await set({ maxLength: 2 })
    assert.equal((await state()).validities.at(-1), false)
    await set({ maxLength: 4 })
    assert.equal((await state()).validities.at(-1), true)
    await set({ value: 'selected text', mode: 'source' })
    await page.locator('.mde__source').evaluate(textarea => textarea.setSelectionRange(0, 8))
    await page.evaluate(() => window.editorWorkbench.insert('bold'))
    assert.equal((await state()).value, '**selected** text')
    assert.equal(await page.locator('.mde__source').evaluate(textarea => document.activeElement === textarea), true)
    await set({ value: '', mode: 'source' })
    await page.evaluate(() => window.editorWorkbench.insertTable(2, 2))
    assert.equal((await state()).value.split('|').length - 1, 9)
    await page.evaluate(() => window.editorWorkbench.focus())
    assert.equal(await page.locator('.mde__source').evaluate(textarea => document.activeElement === textarea), true)
  })
  await check('Injected parser is authoritative for optional inline syntax', async ({ page, set }) => {
    await set({ value: '**literal** and *literal*' })
    assert.equal(await page.locator('.markdown-visual-editor strong, .markdown-visual-editor em').count(), 2)
    await set({ parser: 'no-emphasis', value: '**literal** and *literal*' })
    assert.equal(await page.locator('.markdown-visual-editor strong, .markdown-visual-editor em').count(), 0)
  })
  await check('Combined inline formatting preserves nested semantics and styles', async ({ page, set, state }) => {
    const cases = [
      ['***粗斜体***', 'em strong'],
      ['___粗斜体___', 'em strong'],
      ['**粗体与 *斜体* 组合**', 'strong em'],
      ['~~***删除粗斜体***~~', 's em strong'],
      ['++***下划线粗斜体***++', 'u em strong'],
      ['==***高亮粗斜体***==', 'mark em strong'],
      ['***粗斜体*** 和 [链接](https://example.com)', 'em strong'],
      ['***粗斜体*** 和 ![图片](./editor-overview.svg)', 'em strong'],
      ['[***链接粗斜体***](https://example.com)', 'a em strong'],
      ['***粗斜体*** :smile:', 'em strong'],
      ['***粗斜体***  \n下一行', 'em strong'],
      ['***粗斜体***\\\n下一行', 'em strong'],
      ['***粗斜体*** 和 [**链接粗体**](https://example.com/path_(x) "说明")', 'em strong'],
      ['***粗斜体*** 和 [`a]b`](<https://example.com/a(b)> (标题))', 'em strong'],
    ]
    for (const [value, selector] of cases) for (const editingStyle of ['always', 'blur-hidden', 'structure']) {
      await set({ value, editingStyle })
      const editor = page.locator('.markdown-visual-editor')
      assert.equal(await editor.locator(selector).count(), 1, `${editingStyle}: ${value}\n${await editor.innerHTML()}`)
      const styles = await editor.locator(selector).evaluate(element => ({
        weight: getComputedStyle(element).fontWeight,
        style: getComputedStyle(element).fontStyle,
      }))
      assert.ok(Number(styles.weight) >= 600, JSON.stringify(styles))
      assert.equal(styles.style, 'italic', `${value}: ${JSON.stringify(styles)}`)
      assert.equal((await state()).value, value)
    }
    const typed = '***手动粗斜体*** 与 [链接](https://example.com)'
    await set({ value: '', editingStyle: 'structure' })
    await selectSource(page, 0)
    for (const char of typed) await page.keyboard.insertText(char)
    assert.equal((await state()).value, typed)
    assert.equal(await page.locator('.markdown-visual-editor em strong').count(), 1)
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+Shift+z')
    assert.equal((await state()).value, typed)
    for (const mode of ['preview', 'source', 'visual']) {
      await set({ mode })
      assert.equal((await state()).value, typed)
    }
    assert.equal(await page.locator('.markdown-visual-editor em strong').count(), 1)
  })
  await check('Disabled block rules remain literal source in the visual editor', async ({ page, set, state }) => {
    const value = '# literal heading\n\n> literal quote\n\n~~literal strike~~\n\n---\n\n```js\nliteral fence\n```'
    await set({ parser: 'no-basics', value })
    assert.equal(await page.locator('.markdown-visual-editor h1, .markdown-visual-editor blockquote, .markdown-visual-editor s, .markdown-visual-editor hr, .markdown-visual-editor pre').count(), 0)
    assert.equal((await state()).value, value)
  })
  await check('Unicode text and emoji survive typing, deletion and undo', async ({ page, set, state }) => {
    const value = '中文👨‍👩‍👧‍👦'
    await set({ value, editingStyle: 'structure' })
    await selectSource(page, value.length)
    await page.keyboard.press('Backspace')
    assert.equal((await state()).value, '中文')
    await page.keyboard.press('Control+z')
    assert.equal((await state()).value, value)
    await page.keyboard.press('Control+Shift+z')
    assert.equal((await state()).value, '中文')
    await page.keyboard.insertText('输入')
    assert.equal((await state()).value, '中文输入')
  })
  await check('Paste and cross-block replacement keep a coherent source history', async ({ page, set, state }) => {
    const original = '第一段\n\n**保留**\n\n第三段'
    const pasted = '## 粘贴标题\n\n- 项目一\n- 项目二'
    await set({ value: original })
    await selectSource(page, original.length)
    await page.locator('.markdown-visual-editor').evaluate((editor, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', text)
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
    }, `\n\n${pasted}`)
    assert.equal((await state()).value, `${original}\n\n${pasted}`)
    await page.keyboard.press('Control+z')
    assert.equal((await state()).value, original)
    await selectSource(page, 0, original.length)
    await page.keyboard.insertText('替换')
    assert.equal((await state()).value, '替换')
    await page.keyboard.press('Control+z')
    assert.equal((await state()).value, original)
  })
  await check('Composition commits once and external draft restoration resets history', async ({ page, set, state }) => {
    await set({ value: '已有' })
    await selectSource(page, 2)
    await page.locator('.markdown-visual-editor').evaluate(editor => {
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
      editor.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '中文' }))
      editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }))
    })
    assert.equal((await state()).value, '已有中文')
    await page.keyboard.press('Control+z')
    assert.equal((await state()).value, '已有')
    await set({ value: '恢复的草稿' })
    await selectSource(page, 6)
    await page.keyboard.press('Control+z')
    assert.equal((await state()).value, '恢复的草稿')
  })
  await check('Disabled visual editor and source fallbacks cannot mutate Markdown', async ({ page, set, state }) => {
    const value = '<div>保留 HTML</div>\n\n正文'
    await set({ value, disabled: true })
    assert.equal(await page.locator('.markdown-visual-editor').getAttribute('contenteditable'), 'false')
    assert.equal(await page.locator('.markdown-visual-editor [contenteditable="true"]').count(), 0)
    await page.locator('.markdown-visual-editor').dispatchEvent('beforeinput', {
      inputType: 'insertText', data: '不可输入', bubbles: true, cancelable: true,
    })
    await page.evaluate(() => window.editorWorkbench.insert('**', '**'))
    assert.equal((await state()).value, value)
    await set({ mode: 'source' })
    assert.equal(await page.locator('.mde__source').isDisabled(), true)
  })
  await check('Mouse clicks keep the caret at the clicked styled text after syntax reveal', async ({ page, set }) => {
    const value = '# 居中标题\n\n++甲乙丙丁++ 与 **戊己庚辛** 以及 ::whisper[壬癸小声]'
    for (const theme of ['classic', 'notebook']) for (const editingStyle of ['always', 'blur-hidden', 'structure']) {
      for (const width of [1000, 390]) {
        await page.setViewportSize({ width, height: 850 })
        await set({ value, editingStyle, theme })
        for (const text of ['居中标题', '甲乙丙丁', '戊己庚辛', '壬癸小声']) {
          const point = await page.locator('.markdown-visual-editor').evaluate((editor, target) => {
            const holder = [...editor.querySelectorAll('.markdown-editor-text')].find(node => node.textContent === target)
            if (!holder?.firstChild) throw new Error(`No rendered body for ${target}`)
            const range = document.createRange()
            range.setStart(holder.firstChild, 1)
            range.collapse(true)
            const rect = range.getBoundingClientRect()
            return { x: rect.x, y: rect.y + rect.height / 2 }
          }, text)
          await page.mouse.click(point.x, point.y)
          await page.waitForTimeout(120)
          const offset = await page.evaluate(async module => {
            const { sourceOffsetFromDOM } = await import(module)
            const editor = document.querySelector('.markdown-visual-editor')
            const selection = window.getSelection()
            return sourceOffsetFromDOM(editor, selection.anchorNode, selection.anchorOffset, -1)
          }, selectionModule)
          assert.equal(offset, value.indexOf(text) + 1, `${theme}/${editingStyle}/${width}: ${text}`)
        }
      }
    }
  })
  await check('Backward keyboard selection keeps its anchor across inline syntax', async ({ page, set, state }) => {
    const value = '甲 **粗体** 和 ++下划线++ 乙'
    for (const editingStyle of ['always', 'blur-hidden', 'structure']) {
      await set({ value, editingStyle })
      await selectSource(page, value.length)
      let previous = value.length
      while (previous > 0) {
        await page.keyboard.press('Shift+ArrowLeft')
        const selected = await page.evaluate(async module => {
          const { sourceOffsetFromDOM } = await import(module)
          const editor = document.querySelector('.markdown-visual-editor')
          const selection = window.getSelection()
          return {
            anchor: sourceOffsetFromDOM(editor, selection.anchorNode, selection.anchorOffset, -1),
            focus: sourceOffsetFromDOM(editor, selection.focusNode, selection.focusOffset, -1),
          }
        }, selectionModule)
        assert.equal(selected.anchor, value.length, `${editingStyle}: selection anchor moved`)
        assert.ok(selected.focus >= 0 && selected.focus < previous, `${editingStyle}: focus did not advance from ${previous}: ${JSON.stringify(selected)}`)
        previous = selected.focus
      }
      assert.equal((await state()).value, value)
    }
  })
  await check('Enter at formatted content edges preserves content without empty wrappers', async ({ page, set, state }) => {
    for (const editingStyle of ['blur-hidden', 'structure']) {
      for (const [value, start, end, before, after] of [
        ['**bold**', 2, 6, '\n**bold**', '**bold**\n'],
        ['++下划线++', 2, 5, '\n++下划线++', '++下划线++\n'],
        ['***bold***', 3, 7, '\n***bold***', '***bold***\n'],
        ['- **bold**', 4, 8, '- \n- **bold**', '- **bold**\n- '],
        ['> ++下划线++', 4, 7, '> \n> ++下划线++', '> ++下划线++\n> '],
      ]) {
        await set({ value, editingStyle })
        await selectSource(page, start)
        await page.keyboard.press('Enter')
        assert.equal((await state()).value, before, `${editingStyle}: Enter at body start in ${value}`)
        await set({ value })
        await selectSource(page, end)
        await page.keyboard.press('Enter')
        assert.equal((await state()).value, after, `${editingStyle}: Enter at body end in ${value}`)
      }
    }
  })
  await check('Enter inside formatted text splits at the exact character', async ({ page, set, state }) => {
    for (const [value, offset, expected] of [
      ['**bold**', 3, '**b**\n**old**'],
      ['**bold**', 5, '**bol**\n**d**'],
      ['++下划线++', 3, '++下++\n++划线++'],
      ['***bold***', 4, '***b***\n***old***'],
      ['- **bold**', 5, '- **b**\n- **old**'],
    ]) {
      await set({ value, editingStyle: 'structure' })
      await selectSource(page, offset)
      await page.keyboard.press('Enter')
      assert.equal((await state()).value, expected, `Enter at ${offset} in ${value}`)
    }
  })
  await check('Escapes and entities render as visible text while retaining source', async ({ page, set, state }) => {
    const value = '\\*文字\\* &amp; &#x4E2D;'
    await set({ value, editingStyle: 'structure' })
    assert.equal(await page.locator('.markdown-visual-editor > p').textContent(), '*文字* & 中')
    assert.equal((await state()).value, value)
    await selectSource(page, value.length)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Backspace')
    assert.equal((await state()).value, '\\*文字\\* &amp; ')
    await page.keyboard.press('Control+z')
    assert.equal((await state()).value, value)
  })
    for (const [value, selector] of [
      ['一级标题\n========', 'h1'], ['二级标题\n--------', 'h2'],
      ['<https://example.com>', 'a[href="https://example.com"]'],
      ['https://example.com', 'a[href="https://example.com"]'],
      ['[链接](https://example.com "说明")', 'a[title="说明"]'],
      ['![说明](./editor-overview.svg "图片标题")', 'img[alt="说明"][title="图片标题"]'],
    ]) await check(`Basic heading / link spelling: ${value.replaceAll('\n', ' / ')}`, async ({ page, set }) => {
      await set({ value, mode: 'visual' })
      assert.equal(await page.locator(`.markdown-visual-editor ${selector}`).count(), 1, value)
    })
  await check('Host preview hooks include highlighting, link clicks, and Mermaid rendering', async ({ page, set, state }) => {
    await set({ value: '```js\nconst answer = 42\n```', mode: 'preview' })
    const highlighted = page.locator('.mde__preview .workbench-highlight')
    assert.equal(await highlighted.count(), 1)
    assert.equal(await highlighted.textContent(), 'const answer = 42\n')
    await set({ value: '[Open](https://example.com/path)', mode: 'preview' })
    await page.locator('.mde__preview a[href="https://example.com/path"]').click()
    assert.deepEqual((await state()).linkClicks, ['https://example.com/path'])

    await set({ value: '```mermaid\ngraph TD; A-->B\n```', mode: 'preview' })
    assert.equal(await page.locator('.mde__preview img[alt*="Mermaid"], .mde__preview svg').count(), 1)
    await set({ value: '```mermaid\ninvalid\n```' })
    assert.ok((await page.locator('.mde__preview').textContent()).includes('语法错误'))
    await page.screenshot({ path: `${artifacts}integration-mermaid-error.png`, animations: 'disabled' })
    await set({ value: '```mermaid\nstale\n```', mode: 'preview', deferMermaid: true })
    await page.waitForFunction(() => window.editorWorkbench.state().pendingMermaid === 1)
    await set({ value: 'new preview content', mode: 'source' })
    await set({ mode: 'preview' })
    await page.evaluate(() => window.editorWorkbench.resolveMermaid())
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.mde__preview svg').count(), 0)
    assert.ok((await page.locator('.mde__preview').textContent()).includes('new preview content'))
    assert.ok(!(await page.locator('.mde__preview').textContent()).includes('Stale diagram'))
  })
  await check('Upload failure is visible, recoverable, and does not modify Markdown', async ({ page, set, state }) => {
    await set({ full: true, errorUpload: true, value: '保留正文' })
    await page.locator('input[type="file"]').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('test-image') })
    await page.waitForTimeout(100)
    assert.equal((await state()).value, '保留正文')
    assert.ok(await page.getByRole('alert').count())
    assert.equal(await page.getByRole('button', { name: '上传图片' }).isEnabled(), true)
    await page.screenshot({ path: `${artifacts}integration-upload-error.png`, animations: 'disabled' })
    await set({ errorUpload: false })
    await set({ duplicateUpload: true })
    await page.locator('input[type="file"]').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('test-image') })
    await page.waitForTimeout(100)
    assert.ok((await state()).value.includes('!['))
    assert.equal(((await state()).value.match(/!\[图片\]\(\.\/editor-overview\.svg\)/g) || []).length, 1)

    const beforeDisabledUpload = (await state()).value
    await set({ deferUpload: true })
    await page.locator('input[type="file"]').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('test-image') })
    await page.waitForFunction(() => window.editorWorkbench.state().pendingUploads === 1)
    assert.equal(await page.getByRole('button', { name: '上传图片' }).isDisabled(), true)
    assert.equal(await page.locator('input[type="file"]').isDisabled(), true)
    await set({ disabled: true })
    await page.evaluate(() => window.editorWorkbench.resolveUpload())
    await page.waitForTimeout(100)
    assert.equal((await state()).value, beforeDisabledUpload)
  })
  await writeFile(`${artifacts}integration-browser-results.json`, JSON.stringify(results, null, 2))
  assert.ok(results.length, 'No integration cases matched')
  assert.equal(results.filter(result => result.status !== 'passed').length, 0, 'See .artifacts/integration-browser-results.json')
} finally {
  await browser?.close()
  server?.kill()
}
