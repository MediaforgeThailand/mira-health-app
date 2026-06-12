import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'static',
  site: 'https://mira.com',
  devToolbar: {
    enabled: false,
  },
  integrations: [sitemap()],
});
