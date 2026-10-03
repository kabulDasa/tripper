import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works from GitHub Pages sub-paths too.
  base: './',
  // maplibre-gl v6 locates its worker via import.meta.url; pre-bundling breaks that.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Tripper DIY — planner & pod preview',
        short_name: 'Tripper',
        description: 'Plan a route, build a .trb bundle and preview it on an emulated Tripper pod.',
        theme_color: '#111318',
        background_color: '#111318',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Map tiles and routing need the network while planning.
        globPatterns: ['**/*.{js,css,html,svg,png,trb}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1500 }, // maplibre-gl alone is ~1 MB
  // MapLibre starts its worker as a module worker.
  worker: { format: 'es' },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
