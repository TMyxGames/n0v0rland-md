import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@n0v0rland-md/core': fileURLToPath(new URL('../../packages/core/src', import.meta.url)),
      '@n0v0rland-md/markdown-it-adapter': fileURLToPath(new URL('../../packages/markdown-it-adapter/src', import.meta.url)),
      '@n0v0rland-md/preset': fileURLToPath(new URL('../../packages/preset/src', import.meta.url)),
      '@n0v0rland-md/theme/icons.css': fileURLToPath(new URL('../../packages/theme/src/icons.css', import.meta.url)),
      '@n0v0rland-md/theme/classic.css': fileURLToPath(new URL('../../packages/theme/src/classic.css', import.meta.url)),
      '@n0v0rland-md/theme': fileURLToPath(new URL('../../packages/theme/src/semantic.css', import.meta.url)),
      '@n0v0rland-md/vue': fileURLToPath(new URL('../../packages/vue/src', import.meta.url)),
    },
  },
})
