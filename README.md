# PicMove

Send pictures from your iPhone, grab them on PC.

## Configuration

Copy `.env.example` to `.env.local` and fill in your values (Supabase URL +
anon key, OpenAI key). `.env*.local` is gitignored — never commit real secrets.

## One-time Supabase setup

PicMove uses a **private** bucket and **Supabase Auth** — only signed-in users
can see or change anything.

1. **Storage → bucket `pics`**: create it if missing and make sure **Public** is
   **OFF**.
2. **Run the setup SQL** — paste the SQL from `scripts/setup-supabase.mjs` into
   the Supabase **SQL Editor** and run it. It makes the bucket private, sets the
   25 MB / images-only limits, and creates "signed-in users only" access rules.
3. **Create your login**: Authentication → Users → **Add user** → enter your
   email + a password, and enable **Auto Confirm**. That's the account you'll
   sign in with.

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

## Security notes

PicMove is **private**: the bucket is not public, and every page sits behind a
login (Supabase Auth). Photos are served as **short-lived signed URLs** that the
app generates only for signed-in users.

- **No anonymous access.** Strangers can't view, upload, or delete anything —
  they hit the login screen first, and the raw photo links don't work without a
  valid session.
- **The AI edit endpoint requires a logged-in user**, and is also rate-limited
  (5/min per IP, 200/day) and same-origin only. Still set a monthly spend cap on
  your OpenAI key as the ultimate backstop.
- **The folder "lock" only hides the cover thumbnail** from other signed-in
  users; it is not an extra encryption layer.
- One-time DB setup (`scripts/setup-supabase.mjs`) reads `SUPABASE_DB_URL` from
  the environment — never hardcode the database password. Prefer pasting the SQL
  into the Supabase SQL editor instead of shipping admin credentials.

