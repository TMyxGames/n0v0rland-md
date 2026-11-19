import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue(), {
    name: 'publish-editor-style-layers',
    apply: 'build',
    generateBundle() {
      for (const name of ['editor', 'visual', 'table', 'toolbar']) {
        this.emitFile({
          type: 'asset',
          fileName: `${name}.css`,
          source: readFileSync(new URL(`./src/styles/${name}.css`, import.meta.url)),
        })
      }
    },
  }],
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'style',
    },
    rollupOptions: {
      external: ['vue'],
    },
  },
})
