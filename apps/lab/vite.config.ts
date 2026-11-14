import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const source = fileURLToPath(new URL('../../packages/hasta/src/', import.meta.url));
const digest = createHash('sha256');
const collector = createHash('sha256');
const labSource = fileURLToPath(new URL('./src/', import.meta.url));
const webSource = fileURLToPath(new URL('../web/src/', import.meta.url));

for (const file of ['./vite.config.ts', './index.html', '../../package-lock.json']) {
  collector.update(file).update(readFileSync(new URL(file, import.meta.url)));
}

for (const directory of [labSource, webSource]) {
  for (const file of readdirSync(directory, { recursive: true, encoding: 'utf8' }).toSorted()) {
    if (/\.(?:ts|tsx|css)$/u.test(file)) {
      collector
        .update(directory === labSource ? 'lab/' : 'web/')
        .update(file)
        .update(readFileSync(`${directory}/${file}`));
    }
  }
}

for (const file of readdirSync(source, { recursive: true, encoding: 'utf8' }).toSorted()) {
  if (file.endsWith('.ts')) {
    digest.update(file).update(readFileSync(`${source}/${file}`));
  }
}

let revision = 'unversioned';

try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // Source archives still carry the digest of the actual predictor sources
}

const provenance = {
  revision,
  sourceHash: digest.digest('hex'),
  collectorHash: collector.digest('hex'),
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'collection-build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'collection-build.json',
          source: JSON.stringify(provenance, null, 2),
        });
      },
      async handleHotUpdate({ file, server }) {
        if ([source, labSource, webSource].some((directory) => file.startsWith(directory))) {
          await server.restart();

          return [];
        }
      },
    },
  ],
  publicDir: '../web/public',
  define: { HASTA_BUILD: JSON.stringify(provenance) },
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('../web/src', import.meta.url)) },
      { find: /^hasta\/core$/u, replacement: `${source}/core/index.ts` },
      { find: /^hasta\/vanilla$/u, replacement: `${source}/vanilla/index.ts` },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5174, strictPort: true },
  build: { target: 'es2022' },
});
