import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Required for FFmpeg.wasm SharedArrayBuffer support (dev server)
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },

  // Preview server also needs the headers for local production testing
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },

  build: {
    // Target modern browsers — Vercel CDN handles legacy support
    target: "es2020",
    // Increase chunk size warning limit — FFmpeg.wasm is large by nature
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Split vendor code for better caching on Vercel's edge network
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) {
            return "react-vendor";
          }
        },
      },
    },
  },
})
