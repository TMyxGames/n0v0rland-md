import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packages = ['core', 'markdown-it-adapter', 'preset', 'theme', 'vue']
const output = mkdtempSync(join(tmpdir(), 'n0v0rland-md-pack-'))
const readManifest = name => JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'))
const manifests = Object.fromEntries(packages.map(name => [name, readManifest(name)]))
const version = manifests.vue.version
assert.equal(new Set(Object.values(manifests).map(pkg => pkg.version)).size, 1, 'All public packages release together')
assert.ok(manifests.vue.peerDependencies.vue)
assert.ok(manifests['markdown-it-adapter'].peerDependencies['markdown-it'])
assert.equal(manifests.vue.dependencies?.vue, undefined, 'Vue must come from the host')
assert.equal(manifests['markdown-it-adapter'].dependencies?.['markdown-it'], undefined, 'Markdown-it must come from the host')

try {
  for (const name of packages) {
    const cwd = join(root, 'packages', name)
    const method = process.env.npm_execpath
    if (method && /\.(?:c?js|mjs)$/i.test(method)) {
      execFileSync(process.execPath, [method, 'pack', '--pack-destination', output], { cwd, stdio: 'inherit' })
    } else {
      execFileSync(method || 'pnpm', ['pack', '--pack-destination', output], { cwd, stdio: 'inherit' })
    }
    const archive = join(output, readdirSync(output).find(file => file.endsWith(`-${name}-${version}.tgz`)))
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
    const archiveFiles = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/))
    for (const entry of Object.values(manifest.exports)) {
      const targets = typeof entry === 'string' ? [entry] : Object.values(entry)
      for (const target of targets) assert.ok(archiveFiles.has(`package/${target.slice(2)}`), `${name}: ${target} is packaged`)
    }
    for (const [dependency, range] of Object.entries(manifest.dependencies || {})) {
      assert.ok(!range.startsWith('workspace:'), `${name}: ${dependency} resolved the workspace protocol`)
      if (dependency.startsWith('@n0v0rland-md/')) assert.equal(range, version)
    }
    console.log(`PASS packed ${manifest.name}@${version}`)
  }
} finally {
  for (const file of readdirSync(output)) rmSync(join(output, file))
  rmdirSync(output)
}
