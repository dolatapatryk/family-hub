import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'DEV_ALLOWED_HOSTS')
  const allowedHosts = (env.DEV_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean)

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      allowedHosts,
      proxy: {
        '/api': 'http://localhost:8080',
        '/health': 'http://localhost:8080',
      },
    },
  }
})
