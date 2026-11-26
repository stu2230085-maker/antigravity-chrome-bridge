import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

function flattenHtmlEntries() {
  return {
    name: 'flatten-html-entries',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      const entries = [
        { src: 'src/popup/popup.html', dest: 'popup.html' },
        { src: 'src/sidepanel/sidepanel.html', dest: 'sidepanel.html' },
      ];

      for (const entry of entries) {
        const nestedHtml = resolve(distDir, entry.src);
        const targetHtml = resolve(distDir, entry.dest);
        if (existsSync(nestedHtml)) {
          const html = readFileSync(nestedHtml, 'utf8').replaceAll('../../', './');
          writeFileSync(targetHtml, html, 'utf8');
        }
      }

      rmSync(resolve(distDir, 'src'), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: resolve(__dirname, 'public'),
  plugins: [flattenHtmlEntries()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome116',
    minify: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        popup: resolve(__dirname, 'src/popup/popup.html'),
        sidepanel: resolve(__dirname, 'src/sidepanel/sidepanel.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'popup.css' || assetInfo.name === 'sidepanel.css') {
            return assetInfo.name;
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
});
