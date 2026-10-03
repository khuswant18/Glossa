/**
 * Builds a manual posting kit for Instagram's own scheduler (no developer account needed):
 * social/kit/<date>-<post>/ with the slide images in order and caption.txt, plus a profile picture and bio.
 *   node scripts/social-kit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildCaption } from '../social/publish-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kit = path.join(root, 'social/kit');
const { posts, hashtags } = JSON.parse(fs.readFileSync(path.join(root, 'social/posts.json'), 'utf8'));

fs.rmSync(kit, { recursive: true, force: true });
fs.mkdirSync(kit, { recursive: true });

const lines = ['# Instagram posting kit', '', 'Upload each folder as one post (select the images in order: 1, 2, 3…), paste caption.txt, and schedule it for its date at 19:00.', ''];
for (const p of posts) {
  const dir = path.join(kit, `${p.date}-${p.id}`);
  fs.mkdirSync(dir);
  p.slides.forEach((_, i) => fs.copyFileSync(path.join(root, `website/social/${p.id}-${i + 1}.jpg`), path.join(dir, `${i + 1}.jpg`)));
  fs.writeFileSync(path.join(dir, 'caption.txt'), buildCaption(p, hashtags) + '\n');
  lines.push(`- ${p.date}  ${p.id}  (${p.slides.length} image${p.slides.length > 1 ? 's' : ''})`);
}

// Profile picture: the Glossa mark, kept inside the circle Instagram crops to.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
await page.setContent(`<html><body style="margin:0;width:1080px;height:1080px;background:#dceeb1;display:grid;place-items:center">
  <div style="display:grid;gap:62px;width:560px">
    <i style="display:block;height:66px;border-radius:33px;background:#12151a;opacity:.35"></i>
    <i style="display:block;height:66px;border-radius:33px;background:#12151a"></i>
    <i style="display:block;height:66px;border-radius:33px;background:#12151a;opacity:.35;width:62%"></i>
  </div></body></html>`);
await page.screenshot({ path: path.join(kit, 'profile-picture.png') });
await browser.close();

fs.writeFileSync(
  path.join(kit, 'bio.txt'),
  [
    'Name: Glossa · explain any text',
    '',
    'Bio:',
    'Select any text. Understand it. Keep it. 🟩',
    'Free Chrome extension · no API key',
    'Explains words in context & remembers them',
    '',
    'Link: https://glossa.wovenbit.tech',
    '',
  ].join('\n')
);
lines.push('', 'Profile: profile-picture.png and bio.txt');
fs.writeFileSync(path.join(kit, 'README.md'), lines.join('\n') + '\n');
console.log(`kit: ${posts.length} posts + profile picture in social/kit/`);
