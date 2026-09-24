/**
 * Renders the brand mark SVG to PNG icons with headless Chromium.
 * Run: node scripts/icons.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/icons');
fs.mkdirSync(outDir, { recursive: true });

// Small sizes drop the faint lines' opacity a little less so they stay visible.
const svg = (size) => {
  const faint = size <= 16 ? 0.5 : 0.35;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5" fill="#dceeb1"/>
  <rect x="5" y="6" width="14" height="2.2" rx="1.1" fill="#181a20" opacity="${faint}"/>
  <rect x="5" y="10.9" width="14" height="2.2" rx="1.1" fill="#181a20"/>
  <rect x="5" y="15.8" width="9" height="2.2" rx="1.1" fill="#181a20" opacity="${faint}"/>
</svg>`;
};

fs.writeFileSync(path.join(outDir, 'icon.svg'), svg(128));

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
  await page.locator('svg').screenshot({ path: path.join(outDir, `icon${size}.png`), omitBackground: true });
}
await browser.close();
console.log('icons written to public/icons');
