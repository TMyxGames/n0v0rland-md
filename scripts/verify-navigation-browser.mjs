import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = JSON.parse(await readFile(new URL('./fixtures/navigation.json', import.meta.url), 'utf8'))
const url = 'http://127.0.0.1:5199'
const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--config', 'examples/vue-vite/vite.config.ts',
  '--host', '127.0.0.1', '--port', '5199', '--strictPort',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
let output = ''
server.stdout.on('data', value => { output += value })
server.stderr.on('data', value => { output += value })
let browser

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode != null) throw new Error(output)
    try { if ((await fetch(url)).ok) break } catch {}
    if (attempt === 99) throw new Error(`Vite did not become ready: ${output}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({
    headless: true,
    channel: process.env.MDE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  const editor = page.locator('.markdown-visual-editor')
  const modeButton = name => page.getByRole('button', { name, exact: true })
  const setSource = async value => {
    await modeButton('源码').click()
    await page.locator('.mde__source').waitFor()
    await page.locator('.mde__source').fill(value)
    await modeButton('编辑').click()
  }
  const getSource = async () => {
    await modeButton('源码').click()
    const value = await page.locator('.mde__source').inputValue()
    await modeButton('编辑').click()
    return value
  }
  const setCaret = async (target, offset) => target.evaluate((element, position) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let text
    let remaining = position
    while ((text = walker.nextNode())) {
      if (remaining <= text.length) {
        const selection = window.getSelection()
        selection.removeAllRanges()
        const range = document.createRange()
        range.setStart(text, remaining)
        range.collapse(true)
        selection.addRange(range)
        return
      }
      remaining -= text.length
    }
    throw new Error('caret offset outside rendered text')
  }, offset)
  const sourceOffset = async () => page.evaluate(async corePath => {
    const { sourceOffsetFromDOM } = await import(corePath)
    const root = document.querySelector('.markdown-visual-editor')
    const selection = window.getSelection()
    return sourceOffsetFromDOM(root, selection.anchorNode, selection.anchorOffset, -1)
  }, `/@fs/${root.replaceAll('\\', '/')}packages/core/src/markdown-dom-selection.ts`)

  // Exercise Enter inside formatted list items, preserving both adjacent lines.
  await setSource(fixture.list)
  await editor.locator('li .markdown-editor-text').nth(1).click()
  await setCaret(editor.locator('li .markdown-editor-text').nth(1), 4)
  await page.keyboard.press('Enter')
  assert.equal(await getSource(), '- alpha\n- **bold**\n- ** line**\n- ++underlined line++')
  await setSource(fixture.list)
  await editor.locator('li .markdown-editor-text').nth(2).click()
  await setCaret(editor.locator('li .markdown-editor-text').nth(2), 5)
  await page.keyboard.press('Enter')
  assert.equal(await getSource(), '- alpha\n- **bold line**\n- ++under++\n- ++lined line++')

  for (const [value, expected] of [
    ['1. root\n   - child', '1. root\n   - child\n   - '],
    ['- root\n  1. child', '- root\n  1. child\n  2. '],
  ]) {
    await setSource(value)
    await editor.locator('li').last().click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    assert.equal(await getSource(), expected)
  }

  // Task markers continue as unchecked items and are removed on empty Enter.
  await setSource(fixture.tasks)
  await editor.locator('li .markdown-editor-text').first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  assert.equal(await getSource(), '- [ ] first task\n- [ ] \n- [x] done task')

  await setSource(fixture.list)
  await editor.locator('li .markdown-editor-text').last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowUp')
  const verticalPosition = async () => page.evaluate(() => {
    const selection = window.getSelection()
    const node = selection.anchorNode
    const range = document.createRange()
    range.setStart(node, selection.anchorOffset)
    range.collapse(true)
    const caret = range.getBoundingClientRect()
    const item = (node instanceof Element ? node : node.parentElement)?.closest('li')
    const line = item?.getBoundingClientRect()
    return { text: item?.textContent, caretTop: caret.top, lineTop: line?.top, lineBottom: line?.bottom }
  })
  let position = await verticalPosition()
  assert.ok(position.text?.includes('bold line'))
  assert.ok(position.caretTop >= position.lineTop - 2 && position.caretTop <= position.lineBottom + 2)
  await page.keyboard.press('ArrowDown')
  position = await verticalPosition()
  assert.ok(position.text?.includes('underlined line'))
  assert.ok(position.caretTop >= position.lineTop - 2 && position.caretTop <= position.lineBottom + 2)

  // Source blank lines must each have an editable, mapped visual line.
  await setSource(fixture.paragraphs)
  const emptyLines = editor.locator(':scope > .markdown-editor-empty-line')
  assert.equal(await emptyLines.count(), 2)
  const emptyMarkup = await emptyLines.evaluateAll(nodes => nodes.map(node => node.outerHTML))
  assert.ok(emptyMarkup.every(markup => markup.includes('data-source-from') && markup.includes('<br')))

  // A list block can include its line terminator in its mapped source span.
  await setSource('- one\n- two\n> quote')
  assert.equal(await editor.locator(':scope > .markdown-editor-empty-line').count(), 0)
  await setSource('- one\n- two\n\n> quote')
  const listGap = editor.locator(':scope > .markdown-editor-empty-line')
  assert.equal(await listGap.count(), 1)
  assert.equal(await listGap.getAttribute('data-source-from'), '12')
  assert.equal(await listGap.getAttribute('data-source-to'), '13')

  // Horizontal navigation across hidden emphasis delimiters maps to source offsets.
  await page.getByRole('combobox', { name: '选择语法显示风格' }).selectOption('structure')
  await setSource(fixture.hiddenSyntax)
  await editor.click()
  await page.keyboard.press('Home')
  const hidden = await editor.locator('[data-source-hidden="true"]').evaluateAll(nodes =>
    nodes.map(node => [Number(node.dataset.sourceFrom), Number(node.dataset.sourceTo)]))
  let previous = 0
  while (previous < fixture.hiddenSyntax.length) {
    await page.keyboard.press('ArrowRight')
    const next = await sourceOffset()
    assert.ok(next > previous, `right arrow must advance: ${previous} -> ${next}`)
    assert.ok(hidden.every(([from, to]) => !(next > from && next < to)), `caret inside hidden syntax at ${next}`)
    previous = next
  }
  assert.equal(previous, fixture.hiddenSyntax.length)
  while (previous > 0) {
    await page.keyboard.press('ArrowLeft')
    const next = await sourceOffset()
    assert.ok(next < previous, `left arrow must advance: ${previous} -> ${next}`)
    assert.ok(hidden.every(([from, to]) => !(next > from && next < to)), `caret inside hidden syntax at ${next}`)
    previous = next
  }
  assert.deepEqual(errors, [])
  console.log('Navigation browser verification passed')
} finally {
  await browser?.close()
  server.kill()
}
