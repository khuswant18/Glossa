# Instagram auto-posting: setup

Glossa posts to Instagram through Instagram's official API. Nothing here uses your password. A GitHub Action posts the next post from `social/posts.json` every day at 19:00 IST.

You do the account steps once (about 15 minutes). The code is already in the repo.

## 1. Make your Instagram account professional
In the Instagram app: **Settings → Account type and tools → Switch to professional account**. Choose **Creator** or **Business**; both work. This is free, and you can switch back.

## 2. Create a Meta developer app
1. Go to <https://developers.facebook.com>, log in, and accept the developer terms if asked.
2. **My Apps → Create app**.
3. For the use case, pick the one for Instagram, named something like **"Manage messaging & content on Instagram"**. When it asks for an app type, choose **Business**.
4. Name it, e.g. "Glossa Instagram", and create it.

Meta renames menus often. If something is missing, look for **"Instagram API with Instagram login"**. That's the version this setup uses, and it doesn't need a Facebook Page.

## 3. Connect your account and get a token
1. In the app dashboard, open **Instagram → API setup with Instagram login**.
2. Under **Generate access tokens**, click **Add account** and log in to your Instagram account.
   - If it says your account needs a role: go to **App roles → Roles → Add people → Instagram tester**, enter your username, then accept the invite in Instagram under **Settings → Website permissions → Apps and websites → Tester invites**.
3. Make sure the permissions include `instagram_business_basic` and `instagram_business_content_publish`.
4. Click **Generate token** next to your account and copy it. It lasts 60 days.

You don't need App Review to post to your own account while the app is in development mode.

## 4. Test it on your computer
Create `social/.env` (git ignores it) containing:
```
IG_ACCESS_TOKEN=paste-your-token-here
```
Then run:
```bash
npm run social:publish -- --check     # shows your @username and today's posting quota
npm run social:list                   # the queue, and what's already posted
npm run social:publish -- --dry-run   # shows the next post and checks its images are live; posts nothing
npm run social:publish                # posts it for real
```

## 5. Turn on daily posting
1. On GitHub, open the Glossa repo → **Settings → Secrets and variables → Actions → New repository secret**.
2. Name: `IG_ACCESS_TOKEN`. Value: your token.
3. That's it. The **Instagram** workflow runs every day at 13:30 UTC (19:00 IST).

To post now or test: **Actions → Instagram → Run workflow**. You can enter a post id, or tick "Dry run".

## 6. Every ~50 days: refresh the token
```bash
npm run social:publish -- --refresh-token
```
Paste the new token into `social/.env` and into the GitHub secret.

## Adding or changing posts
1. Edit `social/posts.json`. Each post has a `date`, `slides` and a `caption`. Text in `[[double brackets]]` gets the lime highlight. Slide types: `cover`, `term`, `feature`, `list`, `cta`; the existing posts show every option.
2. Run `npm run social:render` to make the images in `website/social/`.
3. Commit and push. Images must be live on the site before their post date, because Instagram downloads them from `https://glossa.wovenbit.tech/social/...`.

Each run posts the **oldest post whose date has arrived and isn't on Instagram yet**. It checks your recent captions, so a post never goes out twice, even if the workflow runs again or you posted it by hand.

## Limits
- 100 API posts per 24 hours. A carousel counts as one.
- Up to 10 slides per carousel. Images are JPEG, 1080×1350.
- Captions up to 2,200 characters and 30 hashtags; the tests check both.
