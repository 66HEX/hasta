import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  root: fileURLToPath(new URL('./tests/frameworks', import.meta.url)),
  plugins: [
    react({ include: '**/react.tsx' }),
    svelte(),
    solid({ include: '**/solid*.tsx', ssr: true }),
  ],
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  resolve: { dedupe: ['react', 'react-dom', 'vue', 'svelte', 'solid-js'] },
});
