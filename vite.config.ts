import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
  },
  build: {
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            // MathLive는 무겁고 CartesianPlotter에서만 쓰이므로 별도 청크로 분리
            { name: 'mathlive', test: /[\\/]node_modules[\\/]mathlive[\\/]/ },
          ],
        },
      },
    },
  },
})
