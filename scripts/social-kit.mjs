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

// Story Highlight covers: Instagram shows the centre as a circle, so the icon stays in the middle.
const covers = [
  ['start-here', 'Start here', '<path d="M8 5v14l11-7z" fill="#12151a"/>'],
  ['decoded', 'Decoded', '<path d="M5 7h5v5c0 3-2 5-4 6M14 7h5v5c0 3-2 5-4 6" fill="none" stroke="#12151a" stroke-width="2.4" stroke-linecap="round"/>'],
  ['features', 'Features', '<path d="M12 3l2.4 6.1L21 10l-5 4.3L17.5 21 12 17.6 6.5 21 8 14.3 3 10l6.6-.9z" fill="#12151a"/>'],
  ['tips', 'Tips', '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" fill="none" stroke="#12151a" stroke-width="2.2" stroke-linejoin="round"/>'],
];
fs.mkdirSync(path.join(kit, 'highlights'), { recursive: true });
const hp = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
for (const [file, , icon] of covers) {
  await hp.setContent(`<html><body style="margin:0;width:1080px;height:1920px;background:#12151a;display:grid;place-items:center">
    <div style="width:560px;height:560px;border-radius:50%;background:#dceeb1;display:grid;place-items:center">
      <svg width="280" height="280" viewBox="0 0 24 24">${icon}</svg></div></body></html>`);
  await hp.screenshot({ path: path.join(kit, 'highlights', `${file}.png`) });
}
await browser.close();

fs.writeFileSync(
  path.join(kit, 'bio.txt'),
  [
    'PROFILE (Instagram → Edit profile)',
    '',
    'Name (searchable, 30 chars max):',
    'Glossa | Explain Any Text',
    '',
    'Username: keep build_ai18, or switch to something like glossa.app if it is free',
    '',
    'Bio (150 chars max):',
    '📖 Select any text. Understand it. Keep it.',
    '🧠 Jargon decoded daily · finance, tech, legal',
    '🟩 Free Chrome extension · no API key ↓',
    '',
    'Links → Add link:',
    'URL: https://glossa.wovenbit.tech/links',
    'Title: Get Glossa (free)',
    '',
    'Category (Edit profile → Category): App Page   (or: Education)',
    'Contact options: add your email if you want collaboration requests',
    '',
    'Story Highlights (create from stories once they are posted, then Edit highlight → cover):',
    '  Start here  → highlights/start-here.png   (add the intro post shared to story)',
    '  Decoded     → highlights/decoded.png      (word-of-the-day stories)',
    '  Features    → highlights/features.png     (feature posts shared to story)',
    '  Tips        → highlights/tips.png         (tip stories)',
    '',
  ].join('\n')
);
lines.push('', 'Profile: profile-picture.png, bio.txt, highlights/');
fs.writeFileSync(path.join(kit, 'README.md'), lines.join('\n') + '\n');
console.log(`kit: ${posts.length} posts + profile picture in social/kit/`);
