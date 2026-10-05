/**
 * Instagram publishing via the official Instagram API (with Instagram Login):
 * https://developers.facebook.com/docs/instagram-platform/content-publishing/
 * Flow: create a media container per image (carousel items first), wait until FINISHED, publish.
 * No dependencies; Node 20+ (global fetch).
 */

export const MAX_HASHTAGS = 30;
export const MAX_CAPTION = 2200;

export function buildCaption(post, hashtagGroups = {}) {
  const tags = [...new Set((post.tags || []).flatMap((g) => hashtagGroups[g] || []))].slice(0, MAX_HASHTAGS);
  const caption = [post.caption.trim(), tags.join(' ')].filter(Boolean).join('\n\n');
  return caption.length > MAX_CAPTION ? caption.slice(0, MAX_CAPTION) : caption;
}

/** First line of a caption, normalised: how a post is recognised as already published. */
export function fingerprint(caption) {
  return String(caption || '')
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

export function isPublished(post, recentCaptions) {
  const fp = fingerprint(post.caption);
  return recentCaptions.some((c) => fingerprint(c) === fp);
}

/** When a post is scheduled: an exact `at` (ISO time), or a plain `date` meaning 19:00 IST that day. */
export function postTime(p) {
  return Date.parse(p.at || `${p.date}T13:30:00Z`);
}

/** Posts whose time has arrived and that aren't on Instagram yet, oldest first. */
export function duePosts(posts, recentCaptions, now = Date.now()) {
  const t = typeof now === 'string' ? Date.parse(`${now}T23:59:59Z`) : now;
  return posts.filter((p) => postTime(p) <= t && !isPublished(p, recentCaptions)).sort((a, b) => postTime(a) - postTime(b));
}

export function imageUrls(post, baseUrl) {
  return post.slides.map((_, i) => `${baseUrl.replace(/\/+$/, '')}/social/${post.id}-${i + 1}.jpg`);
}

/** A reel's video on the site: website/social/reels/<id>.mp4. */
export function videoUrl(post, baseUrl) {
  return `${baseUrl.replace(/\/+$/, '')}/social/reels/${post.id}.mp4`;
}

export function storyUrl(story, baseUrl) {
  return `${baseUrl.replace(/\/+$/, '')}/social/stories/${story.id}.jpg`;
}

/** Hours a feed post waits after the previous one, so a late or catch-up run never posts back to back. */
export const MIN_GAP_HOURS = 5;

/** Whether the last feed post is recent enough that the next one should wait. */
export function tooSoon(lastPostTime, now = Date.now()) {
  return Number.isFinite(lastPostTime) && now - lastPostTime < MIN_GAP_HOURS * 3600_000;
}

/** A story goes up from 13:00 IST (07:30 UTC) on its date. */
export function storyTime(story) {
  return Date.parse(`${story.date}T07:30:00Z`);
}

/** Today's story (UTC date), if any. Stories are only posted on their own day; missed ones are skipped. */
export function storyForToday(stories, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  return stories.find((s) => s.date === today) || null;
}

export class InstagramClient {
  /**
   * @param {{ token: string, userId?: string, apiBase?: string, pollMs?: number, log?: (s: string) => void }} opts
   */
  constructor({ token, userId, apiBase = 'https://graph.instagram.com/v25.0', pollMs = 3000, log = () => undefined }) {
    this.token = token;
    this.userId = userId;
    this.apiBase = apiBase.replace(/\/+$/, '');
    this.pollMs = pollMs;
    this.log = log;
  }

  async call(method, path, params = {}) {
    const url = new URL(`${this.apiBase}/${path.replace(/^\//, '')}`);
    const body = new URLSearchParams({ ...params, access_token: this.token });
    let res;
    if (method === 'GET') {
      for (const [k, v] of body) url.searchParams.set(k, v);
      res = await fetch(url);
    } else {
      res = await fetch(url, { method, body });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const e = data.error || {};
      throw new Error(`Instagram API ${res.status}: ${e.message || 'request failed'}${e.error_user_msg ? ` (${e.error_user_msg})` : ''}`);
    }
    return data;
  }

  async me() {
    const data = await this.call('GET', 'me', { fields: 'user_id,username,account_type' });
    this.userId = this.userId || data.user_id || data.id;
    return data;
  }

  async ensureUser() {
    if (!this.userId) await this.me();
    return this.userId;
  }

  /** Recent feed posts (newest first): [{ caption, time }]. */
  async recentMedia(limit = 50) {
    const id = await this.ensureUser();
    const data = await this.call('GET', `${id}/media`, { fields: 'caption,timestamp', limit: String(limit) });
    return (data.data || []).map((m) => ({ caption: m.caption || '', time: Date.parse(m.timestamp) }));
  }

  async recentCaptions(limit = 50) {
    return (await this.recentMedia(limit)).map((m) => m.caption);
  }

  async publishingQuota() {
    const id = await this.ensureUser();
    const data = await this.call('GET', `${id}/content_publishing_limit`, { fields: 'quota_usage,config' });
    const row = (data.data || [])[0] || {};
    return { used: row.quota_usage ?? 0, total: row.config?.quota_total ?? 100 };
  }

  async waitFinished(containerId, timeoutMs) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const { status_code: status } = await this.call('GET', containerId, { fields: 'status_code' });
      if (status === 'FINISHED' || status === 'PUBLISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`Instagram could not process the media (${status}).`);
      if (Date.now() > end) throw new Error('Instagram took too long to process the media.');
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }

  /** Publishes one post (single image, or carousel of up to 10). Returns { id, permalink }. */
  async publish({ urls, caption }) {
    const id = await this.ensureUser();
    let container;
    if (urls.length === 1) {
      container = (await this.call('POST', `${id}/media`, { image_url: urls[0], caption })).id;
    } else {
      if (urls.length > 10) throw new Error('A carousel can have at most 10 slides.');
      const children = [];
      for (const [i, url] of urls.entries()) {
        this.log(`  slide ${i + 1}/${urls.length}`);
        children.push((await this.call('POST', `${id}/media`, { image_url: url, is_carousel_item: 'true' })).id);
      }
      for (const child of children) await this.waitFinished(child, 120_000);
      container = (await this.call('POST', `${id}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption })).id;
    }
    await this.waitFinished(container, 120_000);
    const media = await this.call('POST', `${id}/media_publish`, { creation_id: container });
    const info = await this.call('GET', media.id, { fields: 'permalink' }).catch(() => ({}));
    return { id: media.id, permalink: info.permalink || '' };
  }

  /** Publishes one reel from a public MP4 (9:16), also shown in the feed. Returns { id, permalink }. */
  async publishReel({ videoUrl, caption, thumbOffsetMs }) {
    const id = await this.ensureUser();
    const params = { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: 'true' };
    if (thumbOffsetMs !== undefined) params.thumb_offset = String(thumbOffsetMs);
    const container = (await this.call('POST', `${id}/media`, params)).id;
    await this.waitFinished(container, 420_000);
    const media = await this.call('POST', `${id}/media_publish`, { creation_id: container });
    const info = await this.call('GET', media.id, { fields: 'permalink' }).catch(() => ({}));
    return { id: media.id, permalink: info.permalink || '' };
  }

  /** Times of stories currently live (last 24 h); empty if the account can't list them. */
  async liveStoryTimes() {
    const id = await this.ensureUser();
    try {
      const data = await this.call('GET', `${id}/stories`, { fields: 'timestamp' });
      return (data.data || []).map((s) => Date.parse(s.timestamp)).filter(Number.isFinite);
    } catch {
      return [];
    }
  }

  /** Publishes one image story (9:16). Returns { id }. */
  async publishStory(url) {
    const id = await this.ensureUser();
    const container = (await this.call('POST', `${id}/media`, { image_url: url, media_type: 'STORIES' })).id;
    await this.waitFinished(container, 120_000);
    const media = await this.call('POST', `${id}/media_publish`, { creation_id: container });
    return { id: media.id };
  }

  /** Long-lived tokens last 60 days; this returns a fresh one (call at least every ~50 days). */
  async refreshToken() {
    const host = new URL(this.apiBase).origin;
    const url = new URL(`${host}/refresh_access_token`);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', this.token);
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Token refresh failed: ${data.error?.message || res.status}`);
    return data;
  }
}
