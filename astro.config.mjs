// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
// NOTE: `site` はドメイン確定後に本番URLへ差し替えること（canonical / OGP / sitemap に影響）。
export default defineConfig({
  site: 'https://hobnova.com',
  trailingSlash: 'always',

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [sitemap()]
});