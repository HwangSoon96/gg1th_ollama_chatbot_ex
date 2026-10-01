import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 백엔드 주소는 환경변수로 덮어쓸 수 있다. 기본값은 backend/main.py의 기동 주소.
const BACKEND = process.env.VITE_API_BASE ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    // 프론트는 항상 /api로 부른다. 백엔드 경로(/chat, /models)는 프록시가 벗겨서 넘긴다.
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
