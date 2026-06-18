import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from a GitHub Pages project site at https://<user>.github.io/darttrak/
// so production assets live under the /darttrak/ subpath. Dev/preview stay at root.
export default defineConfig(({ command }) => {
  const base = command === 'build' ? '/darttrak/' : '/'

  return {
    base,
    plugins: [
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
        manifest: {
          name: 'Darts Tracker',
          short_name: 'Darts',
          description: 'Fully local, offline darts score tracker',
          theme_color: '#1a1a2e',
          background_color: '#1a1a2e',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
            { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
            {
              src: `${base}icons/icon-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        },
      }),
    ],
  }
})
