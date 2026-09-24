import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['DEV_ALLOWED_HOSTS', 'VITE_SUPABASE_URL'])
  const allowedHosts = (env.DEV_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean)
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim()

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      allowedHosts,
      proxy: supabaseUrl ? {
        '/supabase': {
          target: supabaseUrl,
          changeOrigin: true,
          ws: true,
          rewrite: path => path.replace(/^\/supabase/, '') || '/',
        },
      } : undefined,
    },
  }
})
