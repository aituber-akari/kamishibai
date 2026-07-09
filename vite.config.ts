import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // PORT指定があればそれを使う。strictPort:false で衝突時は次のポートを自動で試す
  // （プレビュー環境や複数起動時のポート衝突回避）
  server: { port: Number(process.env.PORT) || 5173, strictPort: false },
})
