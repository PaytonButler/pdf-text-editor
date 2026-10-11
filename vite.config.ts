
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'pdf',
              test: /node_modules\/pdfjs-dist\//,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})
