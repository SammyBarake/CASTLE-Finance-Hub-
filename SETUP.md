# Castle: going live (all free tiers)

The data engine works without any of this: `npm run ingest -- --local` writes real SEC data to
`.data/castle.json`, and `npm run dev` shows it. These steps put it online and keep it updating.

## 1. Supabase (database)

1. Create a free account at [supabase.com](https://supabase.com) and click **New project**. Any name and region; save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and click **Run**.
3. Open **Project Settings → API** (or **API Keys**). You need three values:
   - **Project URL**
   - **anon / publishable key**: read-only, safe for the website
   - **service_role / secret key**: full write access. Keep it private; it must never appear in the website or in git.
4. Add them to `.env.local` (git-ignored):
   ```
   NEXT_PUBLIC_SUPABASE_URL=<Project URL>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   SUPABASE_URL=<Project URL>
   SUPABASE_SERVICE_ROLE_KEY=<service_role key>
   ```

> Free Supabase projects pause after about a week without activity. The ingest (every 3 hours) keeps yours active.

## 2. GitHub Actions (daily updates)

In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Name | Value |
|---|---|
| `SEC_USER_AGENT` | `Castle research <your email>` |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |

Then fill the database once: **Actions → Ingest SEC data → Run workflow**, with `from` = `2024-09-01`.
The first run takes roughly 30–60 minutes. After that it runs automatically at 09:30 and 21:30 ET
and takes a few minutes. (Public repos get unlimited Actions minutes; private repos get 2,000 a month, and this uses about 150–300.)

## 3. Vercel (website)

1. Sign in at [vercel.com](https://vercel.com) with GitHub, then **Add New → Project** and import this repo. The Next.js defaults are correct.
2. Under **Environment Variables**, add only the two public values:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

   Choose type **Config**, not **Secret**. Vercel does not pass Secret values with a `NEXT_PUBLIC_` prefix to the
   build, so the site gets empty keys (the red "Live data is unavailable" banner). These two values are public by
   design: the anon key can only read.

   Do **not** add the service_role key to Vercel.
3. Deploy (after changing variables, Redeploy). Pages rebuild themselves every 15 minutes, so they pick up each ingest automatically.

## Checking it works

- Actions → latest "Ingest SEC data" run is green, and the log ends with `saved to Supabase: N deals, M IPOs`.
- Supabase → Table Editor → `deals` has rows.
- The live site shows real deals, with no red "Live data is unavailable" banner. (The deployed site never shows sample data; if it can't reach Supabase it says why in that banner.)
