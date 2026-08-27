import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { devApi } from './vite-api-plugin.js'

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
})
