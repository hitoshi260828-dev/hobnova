// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

import mdx from '@astrojs/mdx';

// https://astro.build/config
// 本番URL。canonical / OGP / sitemap の基準URLとして使用。
export default defineConfig({
  site: 'https://hobnova.jp',
  trailingSlash: 'always',

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [sitemap(), mdx()]
});