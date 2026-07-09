import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (!normalizedId.includes('/node_modules/')) return;

          if (normalizedId.includes('/react/') || normalizedId.includes('/react-dom/')) {
            return 'react-vendor';
          }

          if (normalizedId.includes('/lucide-react/')) {
            return 'icon-vendor';
          }

          if (
            normalizedId.includes('/react-markdown/') ||
            normalizedId.includes('/remark-') ||
            normalizedId.includes('/rehype-') ||
            normalizedId.includes('/micromark') ||
            normalizedId.includes('/mdast-util-') ||
            normalizedId.includes('/hast-util-') ||
            normalizedId.includes('/unist-util-') ||
            normalizedId.includes('/unified/') ||
            normalizedId.includes('/vfile')
          ) {
            return 'markdown-vendor';
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
