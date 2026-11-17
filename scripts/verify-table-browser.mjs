import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const artifact = fileURLToPath(new URL('../.artifacts/', import.meta.url))
const url = process.env.MDE_TEST_URL || 'http://127.0.0.1:5197'
const server = process.env.MDE_TEST_URL ? undefined : spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--config', 'examples/vue-vite/vite.config.ts',
  '--host', '127.0.0.1', '--port', '5197', '--strictPort',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
let output = ''
server?.stdout.on('data', value => { output += value })
server?.stderr.on('data', value => { output += value })
let browser
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server?.exitCode != null) throw new Error(output)
    try { if ((await fetch(url)).ok) break } catch {}
    if (attempt === 99) throw new Error(`Vite did not become ready: ${output}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  await mkdir(artifact, { recursive: true })
  browser = await chromium.launch({
    headless: true,
    channel: process.env.MDE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  const button = name => page.getByRole('button', { name, exact: true })
  const editor = page.locator('.markdown-visual-editor')
  const cell = (row, column) => page.locator(`[data-table-row="${row}"][data-table-column="${column}"]`)
  const hoverColumn = async column => {
    const header = cell(0, column)
    await header.hover({ position: { x: 8, y: 2 } })
    await page.locator(`.markdown-table-controls--column[data-column="${column}"]`).waitFor()
    // An already-open bar changes its target only after the hover intent delay.
    await page.waitForTimeout(160)
  }
  const hoverRow = async row => {
    const last = page.locator(`[data-table-row="${row}"]`).last()
    const box = await last.boundingBox()
    await last.hover({ position: { x: box.width - 2, y: box.height / 2 } })
    await page.locator(`.markdown-table-controls--row[data-row="${row}"]`).waitFor()
    await page.waitForTimeout(160)
  }
  const editTableSource = async () => {
    await cell(1, 0).click()
    await page.keyboard.press('Alt+Enter')
  }
  const activeCell = () => page.evaluate(() => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    const element = (node instanceof Element ? node : node?.parentElement)?.closest('[data-table-row]')
    return element ? [Number(element.dataset.tableRow), Number(element.dataset.tableColumn)] : undefined
  })
  const visual = async () => { await button('编辑').click(); await editor.waitFor() }
  const readSource = async () => {
    await button('源码').click()
    const value = await page.locator('.mde__source').inputValue()
    await visual()
    return value
  }
  const setSource = async value => {
    await button('源码').click()
    await page.locator('.mde__source').fill(value)
    await visual()
  }
  const source = '原文 **不变**\n\n| H1 | H2 |\n| :--- | ---: |\n| A | B |\n| C | D |\n\n后文 `也不变`'
  await editor.waitFor()

  // The bundled introduction covers base syntax, with a local working image.
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'u', 's', 'mark', 'blockquote', 'ul', 'ol', 'table', 'pre', 'img']) {
    assert.ok(await editor.locator(tag).count(), tag)
  }
  await page.locator('.markdown-editor-image img').evaluate(img => img.decode())
  const initial = await readSource()
  assert.ok(initial.includes('# n0v0rland-md'))
  await button('标题').click()
  await page.screenshot({ path: `${artifact}playground-desktop.png`, animations: 'disabled' })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 900 })
  await button('切换暗色主题').click()
  await page.screenshot({ path: `${artifact}playground-mobile-dark.png`, animations: 'disabled' })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    JSON.stringify(await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, blocks: [...document.querySelectorAll('main,header,.mde__panel,.markdown-visual-surface,.markdown-visual-editor,.markdown-editor-code,pre,.markdown-editor-block')].map(el => [el.className, el.getBoundingClientRect().right, el.scrollWidth, getComputedStyle(el).overflowX]) }))))
  await button('切换亮色主题').click()
  await page.setViewportSize({ width: 1440, height: 1100 })

  // Choosing a level changes the line prefix, instead of nesting more hashes.
  await setSource('示例标题')
  await editor.click()
  await page.keyboard.press('End')
  for (const level of [2, 3, 4, 5, 6, 1]) {
    await button('标题').click()
    await page.getByRole('menuitem', { name: `H${level} 标题`, exact: true }).click()
    assert.equal(await readSource(), `${'#'.repeat(level)} 示例标题`)
    assert.equal(await editor.locator(`h${level}`).count(), 1)
  }
  await button('标题').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  assert.equal(await editor.locator('h6').count(), 1)
  await button('标题').click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  assert.equal(await page.getByRole('menu', { name: '标题级别' }).count(), 0)

  await setSource('')
  await editor.click()
  await button('链接').click()
  assert.equal(await readSource(), '[链接文字](https://example.com)')
  await setSource('项目主页')
  await editor.locator('.markdown-editor-text').selectText()
  await button('链接').click()
  assert.equal(await readSource(), '[项目主页](https://example.com)')

  // Showing syntax must not alter a single-line heading/paragraph line box.
  const stylePicker = page.getByRole('combobox', { name: '选择语法显示风格' })
  const metricsSource = '# 一级标题\n\n## 二级标题\n\n### 三级标题\n\n#### 四级标题\n\n##### 五级标题\n\n###### 六级标题\n\n**粗** *斜* ++线++ ~~删~~\n\n::whisper[小声] 与 ::loud[大声]'
  await setSource(metricsSource)
  for (const theme of ['classic', 'notebook']) {
    await page.getByRole('combobox', { name: '选择编辑器主题' }).selectOption(theme)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await stylePicker.selectOption('structure')
      await page.waitForTimeout(100)
      const measure = () => editor.locator(':scope > :is(h1,h2,h3,h4,h5,h6,p)').evaluateAll(nodes =>
        nodes.map(node => node.getBoundingClientRect().height))
      const hidden = await measure()
      await stylePicker.selectOption('always')
      await page.waitForTimeout(100)
      assert.deepEqual(await measure(), hidden, `${theme}, ${width}: delimiter line height`)
      assert.equal(await readSource(), metricsSource)
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.getByRole('combobox', { name: '选择编辑器主题' }).selectOption('classic')
  await stylePicker.selectOption('blur-hidden')

  // Syntax display styles: always, focus-revealed, and structural editing.
  await setSource('**x**')
  await stylePicker.selectOption('always')
  await page.waitForTimeout(80)
  assert.equal(await page.locator('.markdown-syntax-boundary.is-visible').count(), 2)
  await stylePicker.selectOption('structure')
  await page.waitForTimeout(80)
  assert.equal(await page.locator('.markdown-syntax-boundary.is-visible').count(), 0)
  await page.locator('strong .markdown-editor-text').selectText()
  await page.keyboard.press('Delete')
  assert.equal(await readSource(), '')

  // Structural navigation visits visible text / wrapper edges, never delimiters.
  const caretState = () => page.evaluate(async coreUrl => {
    const { sourceOffsetFromDOM } = await import(coreUrl)
    const root = document.querySelector('.markdown-visual-editor')
    const selection = window.getSelection()
    const element = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode.parentElement
    return {
      offset: sourceOffsetFromDOM(root, selection.anchorNode, selection.anchorOffset, -1),
      hidden: !!element?.closest('[data-source-hidden="true"]'),
    }
  }, `/@fs/${root.replaceAll('\\', '/')}packages/core/src/markdown-dom-selection.ts`)
  await setSource('A**粗体**B')
  await editor.click()
  await page.keyboard.press('Home')
  for (const expected of [0, 1, 3, 4, 5, 7, 8]) {
    if (expected) await page.keyboard.press('ArrowRight')
    assert.deepEqual(await caretState(), { offset: expected, hidden: false })
  }
  for (const expected of [7, 5, 4, 3, 1, 0]) {
    await page.keyboard.press('ArrowLeft')
    assert.deepEqual(await caretState(), { offset: expected, hidden: false })
  }
  await page.keyboard.press('End')
  await page.keyboard.press('Backspace')
  assert.equal(await readSource(), 'A**粗体**')
  // Backspace after a wrapper deletes its last content character, not a star.
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Backspace')
  assert.equal(await readSource(), 'A**粗**')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Backspace')
  assert.equal(await readSource(), 'A')

  for (const formatted of ['**x**', '*x*', '***x***', '++x++', '~~x~~', '==x==', '`x`', '::loud[x]', '::whisper[x]', '::inner[x]', '[x](https://example.com)']) {
    await setSource(formatted)
    await editor.click()
    await page.keyboard.press('End')
    assert.equal((await caretState()).hidden, false, formatted)
    await page.keyboard.press('Backspace')
    assert.equal(await readSource(), '', formatted)
  }
  // Empty list/quote structures remain editable, and need one more Backspace.
  for (const [value, empty, selector] of [
    ['- x', '- ', 'li'], ['1. x', '1. ', 'li'], ['- [ ] x', '- [ ] ', 'li'],
    ['> x', '> ', 'blockquote'],
  ]) {
    await setSource(value)
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Backspace')
    assert.ok(await editor.locator(selector).count(), value)
    assert.equal((await caretState()).hidden, false, value)
    await page.keyboard.press('Control+z')
    assert.ok((await editor.textContent()).includes('x'))
    await page.keyboard.press('Control+Shift+z')
    assert.ok(await editor.locator(selector).count())
    await page.keyboard.press('Backspace')
    assert.equal(await editor.locator(selector).count(), 0, value)
    await page.keyboard.type('继续')
    assert.equal(await readSource(), '继续', `${value} after ${empty}`)
    await setSource(empty)
    assert.ok(await editor.locator(selector).count(), `${empty} restored`)
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type('新')
    assert.equal(await readSource(), `${empty}新`)
  }
  // Empty emphasis is literal in the editor, including after a remount or blur.
  for (const style of ['always', 'blur-hidden', 'structure']) {
    await stylePicker.selectOption(style)
    await setSource('')
    await editor.click()
    await page.keyboard.type('****')
    assert.equal(await editor.textContent(), '****')
    assert.equal(await editor.locator('hr,strong,em').count(), 0)
    assert.equal(await readSource(), '****')
    assert.equal(await editor.textContent(), '****')
  }
  await stylePicker.selectOption('structure')
  await editor.click()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('内容')
  assert.equal(await editor.locator('strong .markdown-editor-text').textContent(), '内容')
  assert.equal((await caretState()).hidden, false)
  assert.equal(await readSource(), '**内容**')
  await setSource('A::whisper[文字]B')
  await editor.click()
  await page.keyboard.press('Home')
  for (let index = 0; index < 9; index++) {
    await page.keyboard.press('ArrowRight')
    assert.equal((await caretState()).hidden, false)
  }
  await setSource('A![示例](./editor-overview.svg)B')
  await editor.click()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Delete')
  assert.equal(await readSource(), 'A![示例](./editor-overview.svg)B', 'deleting at the image edge enters its caption without destroying the image')
  await editor.locator('.markdown-editor-image img').click()
  await page.keyboard.press('Delete')
  assert.equal(await readSource(), 'AB')
  await stylePicker.selectOption('blur-hidden')

  // A closed standalone header typed live creates a 2-row table atomically.
  await setSource('')
  await editor.click()
  await page.keyboard.type('| 表头1 | 表头2 |')
  assert.equal(await page.locator('table tr').count(), 2)
  assert.equal(await page.locator('table th').count(), 2)
  assert.equal(await cell(0, 0).textContent(), '表头1')
  assert.deepEqual(await activeCell(), [1, 0])
  await page.keyboard.press('Control+z')
  assert.equal(await page.locator('table').count(), 0)
  assert.equal(await editor.textContent(), '| 表头1 | 表头2 ')
  await page.keyboard.press('Control+Shift+z')
  assert.equal(await page.locator('table tr').count(), 2)
  // Restoring Markdown, incomplete headers, code and escaped pipes stay literal.
  for (const literal of ['| A | B |', '| A | B', '\\| A | B |', '```\n| A | B\n```']) {
    await setSource(literal)
    assert.equal(await page.locator('table').count(), 0)
    assert.equal(await readSource(), literal)
  }
  await setSource('```\n| A | B\n```')
  await page.locator('.markdown-editor-code .bd-code-line').filter({ hasText: '| A | B' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' |')
  assert.equal(await page.locator('table').count(), 0)

  // Empty-table Backspace, nonempty boundaries and adjacent paragraphs.
  const empty = '|  |  |\n| --- | --- |\n|  |  |'
  await setSource(empty)
  await cell(0, 0).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Backspace')
  assert.equal(await page.locator('table').count(), 0)
  await page.keyboard.type('继续输入')
  assert.equal(await readSource(), '继续输入')
  await setSource(source)
  await cell(0, 0).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Backspace')
  assert.equal(await readSource(), source)
  await cell(0, 0).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Control+Backspace')
  assert.equal(await readSource(), source)
  await cell(2, 1).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Delete')
  assert.equal(await readSource(), source)
  await cell(2, 1).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Control+Delete')
  assert.equal(await readSource(), source)
  await editor.locator(':scope > p').last().click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Backspace')
  assert.equal(await page.locator('table').count(), 1)
  assert.equal(await page.locator('.markdown-raw-block').count(), 0)
  assert.equal(await readSource(), source)
  await editor.locator(':scope > p').last().click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  assert.deepEqual(await activeCell(), [2, 1])
  assert.equal(await readSource(), source)

  // Selecting the entire visible table owns its hidden pipes and separator too.
  await setSource(source)
  await cell(0, 0).click()
  await page.evaluate(() => {
    const first = document.querySelector('[data-table-row="0"][data-table-column="0"] .markdown-editor-text').firstChild
    const last = document.querySelector('[data-table-row="2"][data-table-column="1"] .markdown-editor-text').firstChild
    const selection = window.getSelection()
    selection.setBaseAndExtent(last, last.textContent.length, first, 0)
  })
  await page.keyboard.press('Backspace')
  assert.equal(await page.locator('table').count(), 0)
  assert.equal(await page.locator('.markdown-raw-block').count(), 0)
  await page.keyboard.press('Control+z')
  assert.equal(await page.locator('table tr').count(), 3)
  await page.keyboard.press('Control+Shift+z')
  assert.equal(await page.locator('table').count(), 0)
  assert.ok(!(await readSource()).includes('|'))

  await setSource(source)
  const firstText = await cell(0, 0).locator('.markdown-editor-text').boundingBox()
  const lastText = await cell(2, 1).locator('.markdown-editor-text').boundingBox()
  await page.mouse.move(firstText.x, firstText.y + firstText.height / 2)
  await page.mouse.down()
  await page.mouse.move(lastText.x + lastText.width, lastText.y + lastText.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.keyboard.press('Delete')
  assert.equal(await page.locator('table').count(), 0)
  assert.ok(!(await readSource()).includes('|'))

  // A selection from a paragraph into a cell cannot leave half a table.
  await setSource('前文\n\n| H1 | H2 |\n| --- | --- |\n| A | B |\n\n后文')
  await editor.locator(':scope > p').first().click()
  await page.evaluate(() => {
    const first = document.querySelector('.markdown-visual-editor > p .markdown-editor-text').firstChild
    const last = document.querySelector('[data-table-row="1"][data-table-column="0"] .markdown-editor-text').firstChild
    window.getSelection().setBaseAndExtent(first, 1, last, 1)
  })
  await page.keyboard.press('Delete')
  assert.equal(await page.locator('table').count(), 0)
  assert.equal(await readSource(), '前\n\n后文')

  // Insert at the caret, with safe paragraph separators and a chosen size.
  await setSource('前文\n\n后文')
  await editor.click()
  await page.keyboard.press('Control+End')
  await button('表格').click()
  await page.getByRole('dialog', { name: '插入表格' }).waitFor()
  await page.getByLabel('表格行数', { exact: true }).fill('3')
  await page.getByLabel('表格列数', { exact: true }).fill('2')
  await button('插入表格').click()
  assert.equal(await page.locator('table tr').count(), 3)
  assert.equal(await page.locator('table th').count(), 2)
  assert.deepEqual(await activeCell(), [0, 0])
  const inserted = await readSource()
  assert.ok(inserted.startsWith('前文\n\n后文\n\n| '))
  assert.ok(inserted.endsWith('\n\n'))

  // Keyboard, empty cells, inline formatting and protected structure.
  await cell(1, 0).click()
  await page.keyboard.type('hello')
  assert.equal(await cell(1, 0).textContent(), 'hello')
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowRight')
  assert.deepEqual(await activeCell(), [1, 1])
  await cell(1, 0).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Delete')
  assert.equal(await page.locator('table tr').count(), 3)
  assert.deepEqual(await activeCell(), [1, 1])
  await page.keyboard.press('Backspace')
  assert.deepEqual(await activeCell(), [1, 0])
  await page.keyboard.press('Tab')
  await page.keyboard.type('**bold**')
  assert.equal(await cell(1, 1).locator('strong').textContent(), 'bold')
  await page.keyboard.press('Shift+Tab')
  assert.deepEqual(await activeCell(), [1, 0])
  await page.keyboard.press('ArrowDown')
  assert.deepEqual(await activeCell(), [2, 0])
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  assert.deepEqual(await activeCell(), [3, 0])
  assert.equal(await page.locator('table tr').count(), 4)
  await page.keyboard.press('Enter')
  assert.deepEqual(await activeCell(), [4, 0])
  await page.keyboard.press('Control+z')
  assert.equal(await page.locator('table tr').count(), 4)
  await page.keyboard.press('Control+Shift+z')
  assert.equal(await page.locator('table tr').count(), 5)
  // A clipboard literal pipe is escaped and multiline text stays in the cell.
  await cell(1, 0).click()
  await page.keyboard.press('End')
  await editor.evaluate(el => {
    const data = new DataTransfer()
    data.setData('text/plain', '|pasted\ntext')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  assert.equal(await page.locator('table th').count(), 2)
  assert.ok((await readSource()).includes('hello\\|pasted text'))

  // All structural commands preserve adjacent source and support one-step undo.
  await setSource(source)
  await cell(1, 0).click()
  await hoverRow(1)
  await button('下方加行').click()
  assert.equal(await page.locator('table tr').count(), 4)
  assert.deepEqual(await activeCell(), [2, 1])
  await page.keyboard.press('Control+z')
  assert.equal(await page.locator('table tr').count(), 3)
  await page.keyboard.press('Control+Shift+z')
  assert.equal(await page.locator('table tr').count(), 4)
  await hoverRow(2)
  await button('删除行').click()
  assert.equal(await page.locator('table tr').count(), 3)
  await cell(1, 0).click()
  await hoverColumn(0)
  await button('右侧加列').click()
  assert.equal(await page.locator('table th').count(), 3)
  assert.deepEqual(await activeCell(), [0, 1])
  await page.keyboard.type('new')
  await hoverColumn(1)
  await button('删除列').click()
  assert.equal(await page.locator('table th').count(), 2)
  await hoverColumn(1)
  await button('居中对齐').click()
  assert.equal(await cell(1, 1).evaluate(el => getComputedStyle(el).textAlign), 'center')
  assert.equal(await cell(0, 1).evaluate(el => getComputedStyle(el).textAlign), 'center')
  const changed = await readSource()
  assert.ok(changed.startsWith('原文 **不变**\n\n'))
  assert.ok(changed.endsWith('\n\n后文 `也不变`'))
  assert.ok(changed.includes(':---:'))

  // Edge controls act on the hovered row/column, independent of the caret.
  await hoverRow(1)
  await button('下方加行').click()
  assert.equal(await page.locator('table tr').count(), 4)
  await hoverColumn(1)
  await button('右侧加列').click()
  assert.equal(await page.locator('table th').count(), 3)
  await hoverRow(0)
  assert.equal(await button('删除行').isDisabled(), true)

  // A toolbar stays open across the edge-to-toolbar gap, then closes on leave.
  await hoverColumn(0)
  await button('左对齐').hover()
  await page.waitForTimeout(250)
  assert.ok(await page.getByRole('toolbar', { name: '表格列操作' }).isVisible())
  await page.mouse.move(4, 700)
  await page.waitForTimeout(450)
  assert.equal(await page.getByRole('toolbar', { name: '表格列操作' }).count(), 0)
  await cell(0, 0).evaluate(el => {
    const rect = el.getBoundingClientRect()
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: rect.left + 8, clientY: rect.top + 2 }))
  })
  await page.waitForTimeout(50)
  assert.equal(await page.getByRole('toolbar', { name: '表格列操作' }).count(), 0)
  await editor.dispatchEvent('pointerleave', { pointerType: 'mouse' })
  await page.waitForTimeout(180)
  assert.equal(await page.getByRole('toolbar', { name: '表格列操作' }).count(), 0)
  await hoverColumn(0)
  assert.equal(await button('删除列').evaluate(el => getComputedStyle(el).color), 'rgb(207, 34, 46)')
  await button('删除列').hover()
  assert.notEqual(await button('删除列').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
  // Keyboard-only access and Escape restore the editing caret.
  await cell(1, 0).click()
  await page.keyboard.press('Alt+ArrowUp')
  assert.ok(await button('左对齐').evaluate(el => el === document.activeElement))
  await page.keyboard.press('ArrowRight')
  assert.ok(await button('居中对齐').evaluate(el => el === document.activeElement))
  await page.keyboard.press('Escape')
  assert.ok(await editor.evaluate(el => el === document.activeElement))

  // Source edits are isolated; invalid drafts do not overwrite the document.
  await editTableSource()
  const draft = page.getByRole('textbox', { name: '当前表格源码', exact: true })
  await draft.waitFor()
  assert.equal(await editor.getAttribute('contenteditable'), 'false')
  const raw = await draft.inputValue()
  await draft.fill('invalid')
  await button('应用修改').click()
  assert.ok(await page.getByRole('alert').isVisible())
  assert.equal(await page.locator('table th').count(), 3)
  await button('取消').click()
  assert.equal(await editor.getAttribute('contenteditable'), 'true')
  await cell(1, 0).hover()
  await editTableSource()
  await draft.fill(raw.replace('H1', 'Edited'))
  await button('应用修改').click()
  assert.equal(await cell(0, 0).textContent(), 'Edited')
  await page.keyboard.press('Control+z')
  assert.equal(await cell(0, 0).textContent(), 'H1')
  await page.keyboard.press('Control+Shift+z')
  assert.equal(await cell(0, 0).textContent(), 'Edited')
  await page.keyboard.press('Shift+Enter')
  assert.equal(await activeCell(), undefined)
  await page.keyboard.type('after table')
  assert.ok((await readSource()).includes('after table'))

  // Empty last column guard, manual Markdown, escapes and source fallback.
  await setSource('| Only |\n| --- |\n| |')
  await cell(1, 0).click()
  await hoverColumn(0)
  assert.equal(await button('删除列').isDisabled(), true)
  await cell(1, 0).click()
  await page.keyboard.type('中文')
  assert.equal(await cell(1, 0).textContent(), '中文')
  await page.keyboard.press('End')
  await editor.evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }))
    el.dispatchEvent(new CompositionEvent('compositionupdate', { data: '输入法', bubbles: true }))
    el.dispatchEvent(new CompositionEvent('compositionend', { data: '输入法', bubbles: true }))
  })
  assert.equal(await cell(1, 0).textContent(), '中文输入法')
  await page.keyboard.type('\\|')
  assert.equal(await cell(1, 0).textContent(), '中文输入法|')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Backspace')
  assert.equal(await cell(1, 0).textContent(), '中文输入法')
  assert.equal(await page.locator('table th').count(), 1)
  await setSource(source)
  await cell(1, 0).click()
  await page.evaluate(() => {
    const start = document.querySelector('[data-table-row="1"][data-table-column="0"] .markdown-editor-text').firstChild
    const end = document.querySelector('[data-table-row="2"][data-table-column="1"] .markdown-editor-text').firstChild
    const range = document.createRange()
    range.setStart(start, 0)
    range.setEnd(end, 1)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.keyboard.press('Backspace')
  assert.equal(await page.locator('table th').count(), 2)
  assert.equal(await page.locator('table tr').count(), 3)
  assert.equal(await cell(1, 0).textContent(), '')
  assert.equal(await cell(2, 1).textContent(), '')
  await page.keyboard.press('Control+z')
  assert.equal(await cell(2, 1).textContent(), 'D')
  await setSource('| H |\n| --- |\n| `a\\|b` |')
  assert.ok(await cell(1, 0).isVisible())
  await setSource('| H1 | H2 |\n| --- | --- |\n| too | many | cells |')
  assert.ok(await page.locator('.markdown-raw-block').isVisible())
  await setSource(source)
  assert.equal(await readSource(), source)
  await cell(1, 0).click()

  // Both themes, colors, responsive controls and preview without editor UI.
  for (const theme of ['classic', 'notebook']) {
    await page.getByRole('combobox', { name: '选择编辑器主题' }).selectOption(theme)
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await hoverColumn(0)
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        controls: document.querySelector('.markdown-table-controls--column').getBoundingClientRect().right,
      }))
      assert.ok(metrics.scroll <= width, JSON.stringify(metrics))
      assert.ok(metrics.controls <= width, JSON.stringify(metrics))
      assert.equal(await page.locator('.markdown-table-controls--column button').count(), 6)
      assert.equal(await page.locator('.markdown-table-controls--column button svg').count(), 6)
      // Editable cells use precisely the same theme presentation as preview.
      const presentation = async selector => page.locator(selector).first().evaluate(el => {
        const css = getComputedStyle(el)
        return ['fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'padding', 'borderTop', 'textAlign', 'whiteSpace'].map(key => css[key])
      })
      const headStyle = await presentation('[data-table-row="0"][data-table-column="0"]')
      const bodyStyle = await presentation('[data-table-row="1"][data-table-column="0"]')
      await button('预览').click()
      assert.deepEqual(await presentation('.mde__preview th'), headStyle)
      assert.deepEqual(await presentation('.mde__preview td'), bodyStyle)
      await visual()
      if (theme === 'notebook' && width === 390) {
        await button('切换暗色主题').click()
        await hoverColumn(0)
        await page.screenshot({ path: `${artifact}table-mobile-dark.png`, fullPage: true, animations: 'disabled' })
        await button('切换亮色主题').click()
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await hoverColumn(0)
  await page.screenshot({ path: `${artifact}table-desktop.png`, animations: 'disabled' })
  await hoverRow(1)
  assert.equal(await page.locator('.markdown-table-controls--row button').count(), 3)
  await page.screenshot({ path: `${artifact}table-row-desktop.png`, animations: 'disabled' })
  await button('预览').click()
  assert.equal(await page.locator('.mde__preview table th').count(), 2)
  assert.equal(await page.locator('.markdown-table-ui').count(), 0)
  await visual()
  assert.equal(await readSource(), source)
  assert.equal(await page.locator('.mde__toolbar button:not(:has(svg))').count(), 0)

  // Host renderer wrappers and injected class-based themes apply to editing too.
  const fixtureUrl = `${url}/@fs/${root.replaceAll('\\', '/')}scripts/fixtures/table-theme.html`
  const fixture = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  fixture.on('pageerror', error => errors.push(error.message))
  await fixture.goto(fixtureUrl)
  await fixture.locator('.markdown-visual-editor table').waitFor()
  assert.equal(await fixture.locator('.markdown-visual-editor .fixture-shell > table.fixture-table .fixture-head').count(), 2)
  const fixtureMetrics = async () => fixture.locator('.bd-markdown-theme table').evaluate(table => {
    return [...table.querySelectorAll('th, td')].map(cell => {
      const css = getComputedStyle(cell)
      const rect = cell.getBoundingClientRect()
      return { color: css.color, background: css.backgroundColor, fontSize: css.fontSize,
        padding: css.padding, align: css.textAlign, width: rect.width, height: rect.height }
    })
  })
  const editingMetrics = await fixtureMetrics()
  await fixture.getByRole('button', { name: '切换模式' }).click()
  assert.deepEqual(await fixtureMetrics(), editingMetrics)
  await fixture.close()

  // Touch users can reach both compact toolbars without hovering.
  const touch = await browser.newPage({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })
  touch.on('pageerror', error => errors.push(error.message))
  await touch.goto(fixtureUrl)
  await touch.locator('[data-table-row="1"][data-table-column="0"]').tap()
  assert.ok(await touch.getByRole('toolbar', { name: '表格列操作' }).isVisible())
  assert.ok(await touch.getByRole('toolbar', { name: '表格行操作' }).isVisible())
  await touch.getByRole('button', { name: '下方加行', exact: true }).tap()
  assert.equal(await touch.locator('table tr').count(), 4)
  const touchMetrics = await touch.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
  assert.ok(touchMetrics.scroll <= touchMetrics.width)
  await touch.close()
  assert.deepEqual(errors, [])
  console.log('Table browser: insertion, typing, boundaries, row/column controls, alignment, history, source editing, theme and mobile checks passed')
} finally {
  await browser?.close()
  server?.kill()
}
