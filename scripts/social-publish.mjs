/**
 * Posts the next due Instagram post from social/posts.json.
 *
 *   npm run social:publish                 post the oldest due post that isn't on Instagram yet
 *   npm run social:publish -- --dry-run    show what would be posted and check the images are live
 *   npm run social:publish -- --id=03-memory   post that one now (still skipped if already posted)
 *   npm run social:publish -- --list       the queue and what's already posted
 *   npm run social:publish -- --stories    post today's story (once a day; skipped if one went up in the last 20 h)
 *   npm run social:publish -- --check      verify the token and account
 *   npm run social:publish -- --refresh-token  print a fresh 60-day token (put it back in your secrets)
 *
 * Settings come from the environment or social/.env (gitignored):
 *   IG_ACCESS_TOKEN (required)  IG_USER_ID (optional)  SOCIAL_BASE_URL (default https://glossa.wovenbit.tech)
 *   IG_API_BASE (default https://graph.instagram.com/v25.0)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InstagramClient, buildCaption, duePosts, imageUrls, isPublished, postTime, storyForToday, storyUrl, videoUrl } from '../social/publish-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, 'social/.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const queue = JSON.parse(fs.readFileSync(path.join(root, 'social/posts.json'), 'utf8'));
const storiesFile = path.join(root, 'social/stories.json');
const stories = fs.existsSync(storiesFile) ? JSON.parse(fs.readFileSync(storiesFile, 'utf8')).stories : [];
const ist = (t) => new Date(t + 5.5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') + ' IST';
const base = process.env.SOCIAL_BASE_URL || 'https://glossa.wovenbit.tech';
const token = process.env.IG_ACCESS_TOKEN || '';

if (!token) {
  console.log('Instagram is not set up yet: IG_ACCESS_TOKEN is missing. See docs/instagram-setup.md.');
  process.exit(flag('list') || flag('dry-run') ? 0 : process.env.GITHUB_ACTIONS ? 0 : 1);
}

const ig = new InstagramClient({
  token,
  userId: process.env.IG_USER_ID || undefined,
  apiBase: process.env.IG_API_BASE || undefined,
  log: (s) => console.log(s),
});

async function imagesLive(urls, type = 'image/jpeg') {
  for (const url of urls) {
    const res = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (!res || !res.ok || !String(res.headers.get('content-type')).includes(type)) return url;
  }
  return null;
}

try {
  if (flag('refresh-token')) {
    const fresh = await ig.refreshToken();
    console.log(`New token (valid ${Math.round(fresh.expires_in / 86400)} days):\n${fresh.access_token}`);
    process.exit(0);
  }

  const me = await ig.me();
  console.log(`Instagram account: @${me.username} (${me.account_type || 'professional'})`);
  if (flag('check')) {
    const q = await ig.publishingQuota();
    console.log(`Token works. Posts published via the API in the last 24 h: ${q.used}/${q.total}.`);
    process.exit(0);
  }

  if (flag('stories')) {
    const story = storyForToday(stories);
    if (!story) {
      console.log('No story planned for today.');
      process.exit(0);
    }
    const recentStory = (await ig.liveStoryTimes()).some((t) => Date.now() - t < 20 * 3600_000);
    if (recentStory && !flag('force')) {
      console.log('A story already went up in the last 20 hours; skipping.');
      process.exit(0);
    }
    const url = storyUrl(story, base);
    const missing = await imagesLive([url]);
    if (missing) throw new Error(`Story image not live yet: ${missing}`);
    console.log(`Story ${story.id}…`);
    if (flag('dry-run')) {
      console.log('Dry run: nothing was posted. Image is live.');
      process.exit(0);
    }
    const done = await ig.publishStory(url);
    console.log(`Story published (${done.id}).`);
    process.exit(0);
  }

  const recent = await ig.recentCaptions();
  if (flag('list')) {
    for (const p of [...queue.posts].sort((a, b) => postTime(a) - postTime(b))) {
      const kind = p.type === 'reel' ? 'reel' : `${p.slides.length} slide${p.slides.length > 1 ? 's' : ''}`;
      console.log(`${isPublished(p, recent) ? '✓ posted ' : '  queued '} ${ist(postTime(p))}  ${p.id}  (${kind})`);
    }
    console.log(`\nStories: ${stories.length} planned, one a day.`);
    process.exit(0);
  }

  const pick = value('id') ? queue.posts.filter((p) => p.id === value('id')) : duePosts(queue.posts, recent).slice(0, 1);
  if (value('id') && !pick.length) throw new Error(`No post with id "${value('id')}".`);
  const post = pick[0];
  if (!post || isPublished(post, recent)) {
    console.log(post ? `"${post.id}" is already on Instagram.` : 'Nothing due right now.');
    process.exit(0);
  }

  const caption = buildCaption(post, queue.hashtags);
  if (post.type === 'reel') {
    const url = videoUrl(post, base);
    const missing = await imagesLive([url], 'video/mp4');
    if (missing) throw new Error(`Video not live yet: ${missing}\nCommit website/social/reels/${post.id}.mp4, push, and wait for the deploy.`);
    console.log(`Posting reel ${post.id}…`);
    if (flag('dry-run')) {
      console.log(`\n--- caption ---\n${caption}\n---------------\nDry run: nothing was posted. Video is live.`);
      process.exit(0);
    }
    const q = await ig.publishingQuota();
    if (q.used >= q.total) throw new Error(`Instagram's daily publishing limit is reached (${q.used}/${q.total}). Try later.`);
    const done = await ig.publishReel({ videoUrl: url, caption, thumbOffsetMs: post.thumbOffsetMs });
    console.log(`Published: ${done.permalink || done.id}`);
    process.exit(0);
  }

  const urls = imageUrls(post, base);
  const missing = await imagesLive(urls);
  if (missing) {
    throw new Error(`Image not live yet: ${missing}\nRun "npm run social:render", commit, push, and wait for the deploy.`);
  }
  console.log(`Posting ${post.id} (${urls.length} slide${urls.length > 1 ? 's' : ''})…`);
  if (flag('dry-run')) {
    console.log(`\n--- caption ---\n${caption}\n---------------\nDry run: nothing was posted. Images are live.`);
    process.exit(0);
  }

  const q = await ig.publishingQuota();
  if (q.used >= q.total) throw new Error(`Instagram's daily publishing limit is reached (${q.used}/${q.total}). Try later.`);
  const done = await ig.publish({ urls, caption });
  console.log(`Published: ${done.permalink || done.id}`);
} catch (err) {
  console.error(String(err.message || err));
  process.exit(1);
}
