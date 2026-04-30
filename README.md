# PicMove

Send pictures from your iPhone, grab them on PC.

## One-time Supabase setup

1. Open https://supabase.com/dashboard/project/hnkjhhabebzmcwwhhfeu/storage/buckets
2. Click **New bucket**
3. Name: `pics` — toggle **Public bucket** ON — Save
4. Storage → Policies → on the `pics` bucket, add a policy:
   - **Allow public uploads**: For role `anon`, allow `INSERT` with check `bucket_id = 'pics'`
   - **Allow public deletes** (optional): For role `anon`, allow `DELETE` with check `bucket_id = 'pics'`
   - Public read happens automatically because the bucket is public

## Run locally

```
npm install
npm run dev
```

Open http://localhost:3007

## AI photo editing

Add your OpenAI key to `.env.local`:

```
OPENAI_API_KEY=sk-...
OPENAI_IMAGE_MODEL=gpt-image-2
```

In the gallery, click the sparkle button on a photo, optionally choose another image as the reference plate/background, adjust the prompt, and generate. The edited PNG is saved back into the same Supabase folder.

## Deploy

```
npx vercel
```

Add the env vars from `.env.local` in the Vercel project settings.

Then on your iPhone, open the deployed URL in Safari → Share → **Add to Home Screen**.
