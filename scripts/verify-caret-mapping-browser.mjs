import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const url = process.env.MDE_TEST_URL || 'http://127.0.0.1:5198'
const server = process.env.MDE_TEST_URL ? undefined : spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--config', 'examples/vue-vite/vite.config.ts',
  '--host', '127.0.0.1', '--port', '5198', '--strictPort',
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
  browser = await chromium.launch({
    headless: true,
    channel: process.env.MDE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  const editor = page.locator('.markdown-visual-editor')
  const sourceButton = page.getByRole('button', { name: '源码', exact: true })
  const visualButton = page.getByRole('button', { name: '编辑', exact: true })
  const readSource = async () => {
    await sourceButton.click()
    const value = await page.locator('.mde__source').inputValue()
    await visualButton.click()
    await editor.waitFor()
    return value
  }
  const setSource = async value => {
    await sourceButton.click()
    await page.locator('.mde__source').fill(value)
    await visualButton.click()
    await editor.waitFor()
  }
  const caretState = () => page.evaluate(async coreUrl => {
    const { sourceOffsetFromDOM } = await import(coreUrl)
    const root = document.querySelector('.markdown-visual-editor')
    const selection = window.getSelection()
    const node = selection?.anchorNode
    const element = node instanceof Element ? node : node?.parentElement
    return {
      offset: sourceOffsetFromDOM(root, node, selection.anchorOffset, -1),
      hidden: !!element?.closest('[data-source-hidden="true"]'),
      node: node?.nodeName,
      offsetInNode: selection?.anchorOffset,
    }
  }, `/@fs/${root.replaceAll('\\', '/')}packages/core/src/markdown-dom-selection.ts`)
  const placeCaret = (sourceOffset) => page.evaluate(async ({ coreUrl, sourceOffset }) => {
    const { domPositionFromSourceOffset } = await import(coreUrl)
    const root = document.querySelector('.markdown-visual-editor')
    const position = domPositionFromSourceOffset(root, sourceOffset)
    root.focus()
    const range = document.createRange()
    range.setStart(position.node, position.offset)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }, { coreUrl: `/@fs/${root.replaceAll('\\', '/')}packages/core/src/markdown-dom-selection.ts`, sourceOffset })
  const selectionRect = () => page.evaluate(() => {
    const selection = window.getSelection()
    const range = document.createRange()
    range.setStart(selection.anchorNode, selection.anchorOffset)
    range.collapse(true)
    const rect = range.getBoundingClientRect()
    return { x: rect.x, y: rect.y }
  })
  const selectionState = () => page.evaluate(async coreUrl => {
    const { sourceOffsetFromDOM } = await import(coreUrl)
    const root = document.querySelector('.markdown-visual-editor')
    const selection = window.getSelection()
    const map = (node, offset) => sourceOffsetFromDOM(root, node, offset, -1)
    return {
      anchor: selection ? map(selection.anchorNode, selection.anchorOffset) : -1,
      focus: selection ? map(selection.focusNode, selection.focusOffset) : -1,
      collapsed: selection?.isCollapsed ?? true,
    }
  }, `/@fs/${root.replaceAll('\\', '/')}packages/core/src/markdown-dom-selection.ts`)
  const style = page.getByRole('combobox', { name: '选择语法显示风格' })
  await style.selectOption('structure')

  await setSource('- A\n- B\n\n++下划线++ 与 **粗体** 以及 ***嵌套***')
  await editor.locator('li').last().locator('.markdown-editor-text').first().click()
  await page.keyboard.press('End')
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    await page.keyboard.press(key)
    const state = await caretState()
    assert.ok(state.offset >= 0, `${key}: source offset must be mapped`)
    assert.equal(state.hidden, false, `${key}: caret must leave hidden syntax`)
  }
  assert.equal(await readSource(), '- A\n- B\n\n++下划线++ 与 **粗体** 以及 ***嵌套***')

  for (const [value, start, expected] of [
    ['++下划线++', 2, [3, 4, 5, 7]],
    ['***嵌套***', 3, [4, 5, 8]],
    ['- ++项目++\n- **第二项**', 4, [5, 6, 8]],
  ]) {
    await setSource(value)
    await placeCaret(start)
    assert.equal((await caretState()).offset, start, `restore ${JSON.stringify(value)} at ${start}`)
    for (const offset of expected) {
      await page.keyboard.press('ArrowRight')
      const state = await caretState()
      assert.equal(state.offset, offset, `${JSON.stringify(value)} at offset ${offset}: ${JSON.stringify(state)}`)
      assert.equal(state.hidden, false, `${JSON.stringify(value)} at offset ${offset}`)
    }
    assert.equal(await readSource(), value)
  }
  await setSource('***嵌套***')
  const nestedText = editor.locator('strong .markdown-editor-text')
  const nestedBox = await nestedText.boundingBox()
  await page.mouse.click(nestedBox.x + 1, nestedBox.y + nestedBox.height / 2)
  assert.equal((await caretState()).offset, 3, 'mouse click at nested text start should map to its source start')
  const nestedCaret = await selectionRect()
  assert.ok(Math.abs(nestedCaret.x - nestedBox.x) <= 2, 'nested caret should align with the clicked text start')

  await setSource('- ++项目++')
  const listText = editor.locator('li .markdown-editor-text').first()
  const listBox = await listText.boundingBox()
  await page.mouse.click(listBox.x + 1, listBox.y + listBox.height / 2)
  assert.equal((await caretState()).offset, 4, 'mouse click at list text start should skip its hidden markers')
  const listCaret = await selectionRect()
  assert.ok(Math.abs(listCaret.x - listBox.x) <= 2, 'list caret should align with the clicked text start')

  await setSource('A**x**B')
  await placeCaret(1)
  assert.equal((await caretState()).offset, 1, 'preserve the position before a formatted wrapper')
  const bodyEnd = await page.evaluate(async coreUrl => {
    const { sourceOffsetFromDOM } = await import(coreUrl)
    const root = document.querySelector('.markdown-visual-editor')
    const strong = root.querySelector('strong')
    const text = strong.querySelector('.markdown-editor-text')
    return sourceOffsetFromDOM(root, text, text.textContent.length, -1)
  }, `/@fs/${root.replaceAll('\\', '/')}packages/core/src/markdown-dom-selection.ts`)
  assert.equal(bodyEnd, 4, 'the boundary before hidden closing syntax remains the visible body end')
  await placeCaret(0)
  await page.keyboard.press('ArrowRight')
  assert.equal((await caretState()).offset, 1, 'keyboard navigation should retain the outer wrapper edge')

  await setSource('- A\n- B')
  await placeCaret(7)
  await page.keyboard.press('ArrowUp')
  assert.equal((await caretState()).offset, 3, 'list ArrowUp should preserve the source column')
  await page.keyboard.press('ArrowDown')
  assert.equal((await caretState()).offset, 7, 'list ArrowDown should return to the original source column')

  await setSource('| a\\|b :smile: |\n| --- |')
  const sourceOffsets = await page.evaluate(async coreUrl => {
    const { sourceOffsetFromDOM } = await import(coreUrl)
    const root = document.querySelector('.markdown-visual-editor')
    const holder = root.querySelector('[data-source-offsets]')
    return {
      offsets: holder?.dataset.sourceOffsets?.split(',').map(Number),
      mapped: Array.from(holder.firstChild.textContent, (_, index) =>
        sourceOffsetFromDOM(root, holder.firstChild, index, -1)),
      emoji: root.querySelector('.markdown-editor-emoji')?.dataset.sourceFrom,
    }
  }, `/@fs/${root.replaceAll('\\', '/')}packages/core/src/markdown-dom-selection.ts`)
  assert.deepEqual(sourceOffsets.offsets, [2, 3, 5, 6, 7])
  assert.deepEqual(sourceOffsets.mapped, [2, 3, 5, 6])
  assert.ok(sourceOffsets.emoji, 'emoji source range should remain addressable')

  const emptyLines = '上行\n\n下行'
  await setSource(emptyLines)
  await page.evaluate(async ({ coreUrl, sourceOffset }) => {
    const { domPositionFromSourceOffset } = await import(coreUrl)
    const root = document.querySelector('.markdown-visual-editor')
    const position = domPositionFromSourceOffset(root, sourceOffset)
    window.__caretAnchor = {
      line: position.node instanceof Element
        ? position.node
        : position.node.parentElement?.closest('.markdown-editor-empty-line'),
      offset: position.offset,
    }
  }, { coreUrl: `/@fs/${root.replaceAll('\\', '/')}packages/core/src/markdown-dom-selection.ts`, sourceOffset: 3 })
  assert.equal(await page.evaluate(() => window.__caretAnchor.line?.classList.contains('markdown-editor-empty-line')), true,
    'blank-line caret should use the empty paragraph before its BR')
  const emptyLine = editor.locator('.markdown-editor-empty-line')
  const emptyBox = await emptyLine.boundingBox()
  await page.mouse.click(emptyBox.x + 2, emptyBox.y + emptyBox.height / 2)
  assert.equal((await caretState()).offset, 3, 'mouse click on an empty line should map to its BR caret')

  await page.setViewportSize({ width: 390, height: 900 })
  const wrapped = '窄屏自动换行测试：' + '这是一段用于验证真实视觉行移动的长文本。'.repeat(8)
  await setSource(wrapped)
  await placeCaret(16)
  const wrappedStart = await selectionRect()
  const wrappedStartState = await caretState()
  await page.keyboard.press('ArrowDown')
  const wrappedDown = await selectionRect()
  const wrappedDownState = await caretState()
  assert.ok(wrappedDown.y > wrappedStart.y + 4, '390px wrapped text ArrowDown should move the caret to a lower visual line')
  assert.ok(wrappedDownState.offset > wrappedStartState.offset, 'wrapped text ArrowDown should advance the source offset')
  await page.keyboard.press('ArrowUp')
  const wrappedUp = await selectionRect()
  const wrappedUpState = await caretState()
  assert.ok(Math.abs(wrappedUp.y - wrappedStart.y) <= 4, 'wrapped text ArrowUp should return to the original visual line')
  assert.ok(Math.abs(wrappedUpState.offset - wrappedStartState.offset) <= 2, 'wrapped text ArrowUp should restore the source column')

  await setSource('上行\n\n下行')
  await placeCaret(1)
  const blankStart = await selectionRect()
  await page.keyboard.press('ArrowDown')
  const blankDown = await selectionRect()
  const blankDownState = await caretState()
  assert.ok(blankDownState.offset >= 2 && blankDownState.offset <= 3, `ArrowDown into an empty line should map near the blank-line boundary (offset ${blankDownState.offset}, rect ${blankStart.y} -> ${blankDown.y})`)
  await page.keyboard.press('ArrowUp')
  const blankUp = await selectionRect()
  const blankUpState = await caretState()
  assert.ok(Math.abs(blankUpState.offset - 1) <= 1, `ArrowUp from an empty line should return near the prior line (offset ${blankUpState.offset}, rect ${blankUp.y})`)

  await setSource('***嵌套***')
  await placeCaret(8)
  const reverseStart = await selectionState()
  await page.keyboard.press('Shift+ArrowLeft')
  const reverseOne = await selectionState()
  assert.equal(reverseOne.anchor, reverseStart.anchor, 'reverse nested selection should retain its anchor')
  assert.ok(reverseOne.focus < reverseOne.anchor, 'reverse nested selection should move focus left through visible text')
  await page.keyboard.press('Shift+ArrowLeft')
  const reverseTwo = await selectionState()
  assert.ok(reverseTwo.focus < reverseOne.focus, 'reverse nested selection should continue through nested text')
  assert.equal(reverseTwo.collapsed, false, 'reverse nested selection should remain non-collapsed')

  assert.deepEqual(errors, [])
  console.log('Caret mapping browser checks passed.')
} finally {
  await browser?.close()
  if (server && server.exitCode == null) {
    server.kill()
    await new Promise(resolve => {
      if (server.exitCode != null) resolve()
      else server.once('exit', resolve)
    })
  }
}
