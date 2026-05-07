// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import react from '@astrojs/react';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  adapter: cloudflare(),

  security: {
    // Astro's built-in CSRF check rejects same-site multipart/form-data
    // POSTs that don't carry an Origin header (e.g. curl, native fetch
    // without explicit Origin). This codebase is an API-first app:
    // /api/* is locked down by the admin OAuth check (production) or the
    // dev-mode bypass (localhost), so the CSRF check is redundant and
    // breaks legitimate uploads. Disable it here and rely on auth.
    checkOrigin: false,
  },

  vite: {
    plugins: [tailwindcss()],
  },
});