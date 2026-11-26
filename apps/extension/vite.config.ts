import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

function flattenPopupHtml() {
  return {
    name: 'flatten-popup-html',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      const nestedHtml = resolve(distDir, 'src/popup/popup.html');
      const targetHtml = resolve(distDir, 'popup.html');
      if (existsSync(nestedHtml)) {
        const html = readFileSync(nestedHtml, 'utf8').replaceAll('../../', './');
        writeFileSync(targetHtml, html, 'utf8');
        rmSync(resolve(distDir, 'src'), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: resolve(__dirname, 'public'),
  plugins: [flattenPopupHtml()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome116',
    minify: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        popup: resolve(__dirname, 'src/popup/popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'popup.css') {
            return 'popup.css';
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
});
