// @vitest-environment node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM helper without types
import { InstagramClient, buildCaption, duePosts, fingerprint, imageUrls, isPublished, postTime, storyForToday, storyUrl } from '../../social/publish-lib.mjs';

const queue = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../social/posts.json'), 'utf8'));
const { stories } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../social/stories.json'), 'utf8'));

describe('post queue', () => {
  it('is valid: unique ids, dates, at most 10 slides, captions and hashtags within limits', () => {
    const ids = new Set();
    for (const p of queue.posts) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(Number.isFinite(postTime(p))).toBe(true);
      expect(p.slides.length).toBeGreaterThan(0);
      expect(p.slides.length).toBeLessThanOrEqual(10);
      const caption = buildCaption(p, queue.hashtags);
      expect(caption.length).toBeLessThanOrEqual(2200);
      expect((caption.match(/#\w+/g) || []).length).toBeLessThanOrEqual(30);
      expect(new Set(queue.posts.map((x: { caption: string }) => fingerprint(x.caption))).size).toBe(queue.posts.length);
    }
  });

  it('is scheduled at 07:00 and 19:00 IST, two a day, with no clashes', () => {
    const timed = queue.posts.filter((p: { at?: string }) => p.at);
    const times = timed.map((p: { at: string }) => p.at);
    expect(new Set(times).size).toBe(times.length);
    for (const t of times) expect(t).toMatch(/T(01|13):30:00Z$/);
  });

  it('stories: one per day, unique, each rendered at 9:16', () => {
    const days = stories.map((s: { date: string }) => s.date);
    expect(new Set(days).size).toBe(days.length);
    for (const s of stories) expect(fs.existsSync(path.resolve(__dirname, `../../website/social/stories/${s.id}.jpg`))).toBe(true);
    expect(storyForToday(stories, Date.parse(`${stories[0].date}T07:30:00Z`)).id).toBe(stories[0].id);
    expect(storyForToday(stories, Date.parse('2020-01-01T00:00:00Z'))).toBeNull();
    expect(storyUrl({ id: 's1' }, 'https://g.tech/')).toBe('https://g.tech/social/stories/s1.jpg');
  });

  it('never changes the first caption line of the post already published', () => {
    const intro = queue.posts.find((p: { id: string }) => p.id === '01-intro');
    // The live post's first line (fingerprint = first 80 characters of it).
    expect(fingerprint(intro.caption)).toBe("every time you hit a word you don't know, you leave the page. glossa explains it");
  });

  it('every slide has a rendered image', () => {
    for (const p of queue.posts) {
      p.slides.forEach((_: unknown, i: number) => expect(fs.existsSync(path.resolve(__dirname, `../../website/social/${p.id}-${i + 1}.jpg`))).toBe(true));
    }
  });

  it('picks the oldest due post that is not on Instagram yet', () => {
    const posts = [
      { id: 'b', date: '2026-10-02', caption: 'Second post\nmore' },
      { id: 'a', date: '2026-10-01', caption: 'First post' },
      { id: 'c', date: '2026-10-09', caption: 'Future post' },
    ];
    expect(duePosts(posts, [], '2026-10-05').map((p: { id: string }) => p.id)).toEqual(['a', 'b']);
    expect(duePosts(posts, ['First post\n\n#glossa'], '2026-10-05').map((p: { id: string }) => p.id)).toEqual(['b']);
    expect(isPublished(posts[0], ['  second   POST \n other text'])).toBe(true);
  });

  it('builds captions with de-duplicated hashtags and image URLs on the site', () => {
    const caption = buildCaption({ caption: 'Hello', tags: ['a', 'b'] }, { a: ['#x', '#y'], b: ['#y', '#z'] });
    expect(caption).toBe('Hello\n\n#x #y #z');
    expect(imageUrls({ id: '01-intro', slides: [{}, {}] }, 'https://glossa.wovenbit.tech/')).toEqual([
      'https://glossa.wovenbit.tech/social/01-intro-1.jpg',
      'https://glossa.wovenbit.tech/social/01-intro-2.jpg',
    ]);
  });
});

describe('Instagram client against a fake Graph API', () => {
  const calls: { method: string; path: string; params: Record<string, string> }[] = [];
  let polls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://x');
      const params = Object.fromEntries(req.method === 'GET' ? url.searchParams : new URLSearchParams(body));
      calls.push({ method: req.method || '', path: url.pathname, params });
      const json = (o: unknown, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(o));
      if (params.access_token !== 'tok') return json({ error: { message: 'Invalid OAuth access token' } }, 400);
      if (url.pathname === '/v25.0/me') return json({ user_id: '1789', username: 'glossa.app', account_type: 'BUSINESS' });
      if (url.pathname === '/v25.0/1789/media' && req.method === 'POST') return json({ id: `c${calls.length}` });
      if (url.pathname === '/v25.0/1789/media_publish') return json({ id: 'm1' });
      if (url.pathname === '/v25.0/m1') return json({ permalink: 'https://instagram.com/p/abc' });
      if (/^\/v25\.0\/c\d+$/.test(url.pathname)) return json({ status_code: ++polls % 2 ? 'IN_PROGRESS' : 'FINISHED' });
      json({ error: { message: 'unknown' } }, 404);
    });
  });
  let base = '';
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v25.0`;
  });
  afterAll(() => server.close());

  it('publishes a carousel: item containers, waits for processing, carousel container, publish', async () => {
    const ig = new InstagramClient({ token: 'tok', apiBase: base, pollMs: 1 });
    const out = await ig.publish({ urls: ['https://s/1.jpg', 'https://s/2.jpg'], caption: 'Hi' });
    expect(out).toEqual({ id: 'm1', permalink: 'https://instagram.com/p/abc' });
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts[0].params).toMatchObject({ image_url: 'https://s/1.jpg', is_carousel_item: 'true' });
    expect(posts[1].params).toMatchObject({ image_url: 'https://s/2.jpg', is_carousel_item: 'true' });
    expect(posts[2].params).toMatchObject({ media_type: 'CAROUSEL', caption: 'Hi' });
    expect(posts[2].params.children.split(',')).toHaveLength(2);
    expect(posts[3]).toMatchObject({ path: '/v25.0/1789/media_publish' });
  });

  it('publishes a story: STORIES container, wait, publish', async () => {
    calls.length = 0;
    const ig = new InstagramClient({ token: 'tok', apiBase: base, userId: '1789', pollMs: 1 });
    const out = await ig.publishStory('https://s/story.jpg');
    expect(out.id).toBe('m1');
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts[0].params).toMatchObject({ image_url: 'https://s/story.jpg', media_type: 'STORIES' });
    expect(posts[1].path).toBe('/v25.0/1789/media_publish');
  });

  it('reports Instagram errors clearly', async () => {
    const ig = new InstagramClient({ token: 'bad', apiBase: base, pollMs: 1 });
    await expect(ig.me()).rejects.toThrow('Instagram API 400: Invalid OAuth access token');
  });
});
