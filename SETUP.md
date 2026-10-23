# Castle: going live (all free tiers)

The data engine works without any of this: `npm run ingest -- --local` writes real SEC data to
`.data/castle.json`, and `npm run dev` shows it. These steps put it online and keep it updating.

## 1. Supabase (database)

1. Create a free account at [supabase.com](https://supabase.com) and click **New project**. Any name and region; save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and click **Run**. Then do the same with [`supabase/migrations/0002_history.sql`](supabase/migrations/0002_history.sql) (the history tables for the what-if engine; the site doesn't read them yet).
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

## 4. Accounts (optional)

Sign-in is optional for visitors and off until you finish these steps: without them the site shows no Sign in button.
`<ref>` below is your Supabase project ref, the first part of `NEXT_PUBLIC_SUPABASE_URL` (`https://<ref>.supabase.co`).

1. **Database.** Supabase → SQL Editor → run [`supabase/migrations/0003_accounts.sql`](supabase/migrations/0003_accounts.sql).
   Then run [`supabase/tests/0003_accounts_rls.sql`](supabase/tests/0003_accounts_rls.sql): it checks that each user can reach only
   their own workspace and that "Delete account" works, inside a transaction it rolls back. The last result must read
   **All account checks passed**. For shared deal books, do the same with
   [`supabase/migrations/0004_books.sql`](supabase/migrations/0004_books.sql) and
   [`supabase/tests/0004_books_rls.sql`](supabase/tests/0004_books_rls.sql) (**All shared book checks passed**).
2. **Return addresses.** Supabase → Authentication → URL Configuration: Site URL `https://castle-finance-hub.vercel.app`
   (later, the custom domain); Redirect URLs: `https://castle-finance-hub.vercel.app/**` and `http://localhost:3000/**`.
3. **Google.** [Google Cloud console](https://console.cloud.google.com) → a new project "Castle" → APIs & Services:
   - **OAuth consent screen** (Google Auth Platform → Branding): app name *Castle*, your support email, authorized domain `<ref>.supabase.co`;
     Audience: External; publish the app (the basic scopes need no Google review).
   - **Clients → Create client → Web application**: authorized JavaScript origins `https://castle-finance-hub.vercel.app` and
     `http://localhost:3000`; authorized redirect URI `https://<ref>.supabase.co/auth/v1/callback`.
   - Copy the client ID and secret into Supabase → Authentication → Sign In / Providers → **Google**, and enable it.
   - Until the custom domain is verified, Google's screen says "to continue to `<ref>.supabase.co`"; with the domain and Google's
     brand verification it says "Castle".
4. **GitHub.** GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**: name *Castle*, homepage
   `https://castle-finance-hub.vercel.app`, callback `https://<ref>.supabase.co/auth/v1/callback`. Generate a client secret, then
   paste the client ID and secret into Supabase → Sign In / Providers → **GitHub**, and enable it.
5. **Turn the button on.** Vercel → Settings → Environment Variables: `NEXT_PUBLIC_AUTH_PROVIDERS` = `google,github`
   (type **Config**, like the Supabase values), then Redeploy. Add the same line to `.env.local` to try it locally.
6. **Later: LinkedIn and Microsoft.** LinkedIn: [developer portal](https://www.linkedin.com/developers/apps) → create an app (it
   asks for a LinkedIn Page) → Products → *Sign In with LinkedIn using OpenID Connect* → the same callback URL → Supabase provider
   **LinkedIn (OIDC)**. Microsoft: Azure portal → App registrations → New (accounts in any organization and personal accounts) →
   the same callback URL → a client secret → Supabase provider **Azure** (tenant URL `https://login.microsoftonline.com/common`).
   Then add `linkedin` / `microsoft` to `NEXT_PUBLIC_AUTH_PROVIDERS`.

Email sign-in links need a mail sender (Supabase's built-in one only reaches your own team, two messages an hour), so
they wait for the custom domain (Resend's free tier, set as Supabase's custom SMTP).

## 5. Custom domain (launch day)

Buy the domain anywhere (Cloudflare, Namecheap, Porkbun …), then, with `castle.example` standing for it:

1. **Vercel** → the project → Settings → Domains → add `castle.example` (and `www.castle.example`, set to redirect to it).
   Add the DNS records Vercel shows at your registrar; HTTPS comes on by itself within minutes. Keep
   `castle-finance-hub.vercel.app`: old links, live Excel links and shared books keep working.
2. **Vercel** → Environment Variables: `NEXT_PUBLIC_SITE_URL` = `https://castle.example` (type Config), then Redeploy.
   Link previews, the sitemap and robots.txt now use the domain.
3. **Supabase** → Authentication → URL Configuration: Site URL `https://castle.example`; add `https://castle.example/**`
   to the Redirect URLs (keep the vercel.app one).
4. **Google Cloud** → your OAuth client: add `https://castle.example` to the authorized JavaScript origins. Then
   Branding: add the domain under authorized domains, set the home page `https://castle.example/about` and the
   privacy policy `https://castle.example/privacy`, and submit for brand verification (free), so the sign-in screen
   says "Castle" instead of the Supabase address. It asks you to prove you own the domain through Search Console (next step).
5. **Google Search Console** (search.google.com/search-console) → add the domain → verify with the DNS record it gives
   you → Sitemaps → submit `https://castle.example/sitemap.xml`.
6. **GitHub** → your OAuth app: homepage `https://castle.example`.
7. **Check:** open the site on your phone; sign in and out; paste a deal's tear-sheet link and a shared book into
   LinkedIn's Post Inspector (linkedin.com/post-inspector) and check the preview card; run Lighthouse in Chrome's
   DevTools on the Hub (mobile).

Optional once the domain exists: email sign-in links (Resend free tier → verify the domain → Supabase → Authentication →
SMTP Settings with Resend's SMTP details), and `NEXT_PUBLIC_CONTACT_EMAIL` for "Report a data issue".

## Checking it works

- Actions → latest "Ingest SEC data" run is green, and the log ends with `saved to Supabase: N deals, M IPOs`.
- Supabase → Table Editor → `deals` has rows.
- The live site shows real deals, with no red "Live data is unavailable" banner. (The deployed site never shows sample data; if it can't reach Supabase it says why in that banner.)
