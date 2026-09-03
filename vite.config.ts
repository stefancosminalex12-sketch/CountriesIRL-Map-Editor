import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 5173 unless the environment asks for another port, so this can run alongside
  // another dev server without either of them having to move.
  server: { port: Number(process.env.PORT) || 5173, open: false },
})
