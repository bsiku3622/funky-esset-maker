import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'

// mathjax-full/js/components/version.js falls back to `eval('require')` to read
// its own package.json when PACKAGE_VERSION is not defined — that throws in the
// browser. Defining the constant takes the static branch instead.
const MATHJAX_VERSION: string = createRequire(import.meta.url)(
  'mathjax-full/package.json',
).version

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    PACKAGE_VERSION: JSON.stringify(MATHJAX_VERSION),
  },
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
            // MathJax(SVG 출력)는 AI Figure Maker 전용 — 별도 청크로 지연 로드
            { name: 'mathjax', test: /[\\/]node_modules[\\/]mathjax-full[\\/]/ },
          ],
        },
      },
    },
  },
})
