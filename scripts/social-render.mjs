/**
 * Renders the Instagram slides in social/posts.json to JPEGs (1080×1350) in website/social/,
 * so the deployed site serves them at /social/<post>-<n>.jpg for the publisher to hand to Instagram.
 *   node scripts/social-render.mjs            all posts
 *   node scripts/social-render.mjs 03-memory  one post
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { TEMPLATES } from '../social/templates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'website/social');
const { posts } = JSON.parse(fs.readFileSync(path.join(root, 'social/posts.json'), 'utf8'));
const only = process.argv[2];

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
let count = 0;
for (const post of posts) {
  if (only && post.id !== only) continue;
  if (post.slides.length > 10) throw new Error(`${post.id}: Instagram carousels allow at most 10 slides`);
  for (const [i, slide] of post.slides.entries()) {
    const render = TEMPLATES[slide.t];
    if (!render) throw new Error(`${post.id}: unknown slide type "${slide.t}"`);
    await page.setContent(render(slide, { n: i + 1, total: post.slides.length }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, `${post.id}-${i + 1}.jpg`), type: 'jpeg', quality: 92 });
    count++;
  }
}
await browser.close();
console.log(`social: ${count} slides written to website/social/`);
