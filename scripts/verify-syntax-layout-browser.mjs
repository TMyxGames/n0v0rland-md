import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const artifacts = fileURLToPath(new URL('../.artifacts/', import.meta.url))
const url = process.env.MDE_TEST_URL || 'http://127.0.0.1:5200'
const server = process.env.MDE_TEST_URL ? undefined : spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--config', 'examples/vue-vite/vite.config.ts',
  '--host', '127.0.0.1', '--port', '5200', '--strictPort',
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  const editor = page.locator('.markdown-visual-editor')
  await editor.waitFor()

  const setSource = async value => {
    await page.getByRole('button', { name: '源码', exact: true }).click()
    await page.locator('.mde__source').fill(value)
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await editor.waitFor()
  }
  const editingStyle = page.locator('select[aria-label="选择语法显示风格"]')
  const themePicker = page.locator('select[aria-label="选择编辑器主题"]')
  const source = [
    '# Heading 1',
    '## Heading 2',
    '### Heading 3',
    '#### Heading 4',
    '##### Heading 5',
    '###### Heading 6',
    '',
    '**bold** *italic* ++underlined++ ~~strike~~ `inline code`',
    '',
    '- first item',
    '- second item',
    '',
    '> quoted text',
    '',
    '| A | B |',
    '| --- | --- |',
    '| one | two |',
    '',
    '```js',
    'const value = 1',
    '```',
  ].join('\n')
  await setSource(source)

  for (const selector of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'u', 's', 'code', 'ul', 'blockquote', 'table', 'pre']) {
    assert.ok(await editor.locator(selector).count(), `missing rendered ${selector}`)
  }

  const measureBlocks = () => editor.evaluate(rootElement => [...rootElement.children].map(element => {
    const rect = element.getBoundingClientRect()
    const css = getComputedStyle(element)
    return {
      tag: element.tagName,
      className: typeof element.className === 'string' ? element.className : '',
      text: (element.textContent || '').trim().slice(0, 24),
      top: Number(rect.top.toFixed(2)),
      height: Number(rect.height.toFixed(2)),
      lineHeight: css.lineHeight,
      margin: css.margin,
    }
  }))
  const measureBoundaries = () => editor.evaluate(rootElement => [...rootElement.querySelectorAll('.markdown-syntax-boundary')].map(element => {
    const rect = element.getBoundingClientRect()
    return {
      text: element.textContent,
      height: Number(rect.height.toFixed(2)),
      width: Number(rect.width.toFixed(2)),
      visible: element.classList.contains('is-visible'),
      display: getComputedStyle(element).display,
    }
  }))

  for (const theme of ['classic', 'notebook']) {
    await themePicker.selectOption(theme)
    await editingStyle.selectOption('blur-hidden')
    const hiddenBlocks = await measureBlocks()
    const hiddenBoundaries = await measureBoundaries()
    assert.ok(hiddenBoundaries.length > 0)
    assert.ok(hiddenBoundaries.every(boundary => boundary.height === 0
      && (boundary.width === 0 || boundary.display === 'block') && !boundary.visible),
      `${theme}: hidden syntax boundaries should not occupy layout space`)

    await editingStyle.selectOption('always')
    const visibleBlocks = await measureBlocks()
    const visibleBoundaries = await measureBoundaries()
    assert.ok(visibleBoundaries.every(boundary => boundary.visible))
    const withoutCodeFences = blocks => blocks.filter(block => !block.className.includes('markdown-editor-code'))
    assert.deepEqual(
      withoutCodeFences(visibleBlocks).map(({ tag, className, text, top, height }) => ({ tag, className, text, top, height })),
      withoutCodeFences(hiddenBlocks).map(({ tag, className, text, top, height }) => ({ tag, className, text, top, height })),
      `${theme}: showing inline or block syntax changed non-code block layout`,
    )
  }

  await editingStyle.selectOption('blur-hidden')
  const blankLineCases = []
  for (const emptyLineCount of [0, 1, 2, 3]) {
    const markdown = `- one\n- two${'\n'.repeat(emptyLineCount + 1)}> quote`
    await setSource(markdown)
    const result = await editor.evaluate(rootElement => {
      const children = [...rootElement.children]
      const list = children.find(element => element.tagName === 'UL')
      const quote = children.find(element => element.tagName === 'BLOCKQUOTE')
      const gap = quote.getBoundingClientRect().top - list.getBoundingClientRect().bottom
      return {
        emptyLineNodes: rootElement.querySelectorAll(':scope > .markdown-editor-empty-line').length,
        visualGap: Number(gap.toFixed(2)),
        blocks: children.map(element => ({
          tag: element.tagName,
          from: element.getAttribute('data-source-from'),
          to: element.getAttribute('data-source-to'),
        })),
      }
    })
    blankLineCases.push({ emptyLineCount, ...result })
    assert.equal(result.emptyLineNodes, emptyLineCount, `source blank lines: ${emptyLineCount}`)
  }
  assert.ok(blankLineCases.every((item, index) => index === 0
    || item.visualGap > blankLineCases[index - 1].visualGap),
  `list-to-quote spacing should grow with source blank lines: ${JSON.stringify(blankLineCases)}`)

  const overflow = []
  for (const theme of ['classic', 'notebook']) {
    await themePicker.selectOption(theme)
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await setSource(source)
      overflow.push(await editor.evaluate((element, currentTheme) => ({
        theme: currentTheme,
        width: innerWidth,
        editorWidth: element.clientWidth,
        editorScrollWidth: element.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
      }), theme))
    }
  }
  assert.ok(overflow.every(metrics => metrics.documentScrollWidth <= metrics.width),
    JSON.stringify(overflow))
  assert.deepEqual(errors, [])

  await mkdir(artifacts, { recursive: true })
  await themePicker.selectOption('classic')
  await editingStyle.selectOption('blur-hidden')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await setSource(source)
  await page.screenshot({ path: `${artifacts}syntax-layout-desktop-light.png`, fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 850 })
  await page.getByRole('button', { name: '切换暗色主题', exact: true }).click()
  await page.screenshot({ path: `${artifacts}syntax-layout-mobile-dark.png`, fullPage: true, animations: 'disabled' })

  console.log(JSON.stringify({
    result: 'syntax layout checks passed',
    themes: ['classic', 'notebook'],
    syntaxToggleKeepsBlockGeometry: true,
    viewportMetrics: overflow,
    blankLineCases,
    screenshots: [`${artifacts}syntax-layout-desktop-light.png`, `${artifacts}syntax-layout-mobile-dark.png`],
  }, null, 2))
} finally {
  await browser?.close()
  server?.kill()
}
