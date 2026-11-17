import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const scripts = [
  'verify-caret-mapping-browser.mjs',
  'verify-navigation-browser.mjs',
  'verify-syntax-layout-browser.mjs',
  'verify-editor-integration-browser.mjs',
  'verify-table-browser.mjs',
]

for (const script of scripts) {
  console.log(`\nRunning ${script}`)
  const child = spawn(process.execPath, [`scripts/${script}`], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (status, signal) => resolve(status ?? (signal ? 1 : 0)))
  })
  if (code !== 0) {
    process.exitCode = code
    break
  }
}
