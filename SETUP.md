# Castle: going live (all free tiers)

The data engine works without any of this: `npm run ingest -- --local` writes real SEC data to
`.data/castle.json`, and `npm run dev` shows it. These steps put it online and keep it updating.

## 1. Supabase (database)

1. Create a free account at [supabase.com](https://supabase.com) and click **New project**. Any name and region; save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and click **Run**. Then do the same with [`supabase/migrations/0002_history.sql`](supabase/migrations/0002_history.sql) (the history tables behind the what-if screen) and [`supabase/migrations/0005_private_series.sql`](supabase/migrations/0005_private_series.sql) (keeps the raw market series off the public keys; nothing on the site reads them).
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

> Free Supabase projects pause after about a week without activity. The ingest (several times a day) keeps yours active.

## 2. GitHub Actions (automatic updates)

In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Name | Value |
|---|---|
| `SEC_USER_AGENT` | `Castle research <your email>` |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |

Then fill the database once: **Actions → Ingest SEC data → Run workflow**, with `from` = `2021-01-01`. The first run takes a
few hours and saves as it goes; if GitHub's 6-hour limit stops it, run it again and it carries on. A new database has no buyer
reactions and nothing can fetch them now, so the "Did buyers win?" study stays hidden unless its figures are moved over from the
old project (`Deal.reaction`, and the `unplacedReactions` row in `meta`). After that, everything runs by itself (times in UTC):

| Workflow | When | What it does |
|---|---|---|
| `ingest.yml` | Every 6 hours, plus hourly on weekdays 11:50–23:50 | Full run (a few minutes) / quick run: the last two days, no macro (about 2 minutes) |
| `monitor.yml` | Daily, 13:15 | Fails, and GitHub emails you, if the data is 8+ hours old or over 3% of records trip a quality rule |
| `history.yml` | 2nd of each month, 08:00 | Refreshes the what-if history tables |
| `keepalive.yml` | Daily, 04:17 | Pushes an empty commit to `main` once it has had no commit for 30 days: GitHub disables scheduled workflows after 60 days without repository activity |
| `ci.yml` | Each push to `main` and pull request | Lint, tests, build, page smoke test |

GitHub delays scheduled runs by up to hours and drops many, so the site says "several times a day", never "hourly". Keep the
repository public: Actions minutes are then unlimited. On a private one this schedule alone uses about 1,200–1,400 of the 2,000
free minutes a month, and a rebuild can use the rest (the **rebuild** box on the same form re-reads every deal after a parser change; it takes hours).

## 3. Vercel (website)

1. Sign in at [vercel.com](https://vercel.com) with GitHub, then **Add New → Project** and import this repo. The Next.js defaults are correct.
2. Under **Environment Variables**, add only the two public values:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

   Choose type **Config**, not **Secret**. Vercel does not pass Secret values with a `NEXT_PUBLIC_` prefix to the
   build, so the site gets empty keys (the red "Live data is unavailable" banner). These two values are public by
   design: the anon key can only read.

   Do **not** add the service_role key to Vercel.
3. Deploy (after changing variables, Redeploy). Pages refresh themselves at most once a minute, so they pick up each ingest automatically.

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

## 5. Custom domain and email (launch day)

The domain is the one thing here that costs money. With `castle.example` standing for it:

1. **Check the name.** Search it in USPTO's [Trademark Search](https://tmsearch.uspto.gov), classes 36 (financial services) and
   42 (software as a service), before paying for anything.
2. **Buy the domain** anywhere (Cloudflare, Namecheap, Porkbun …). Turn on two-factor sign-in at the registrar and WHOIS
   redaction for the domain.
3. **Vercel** → the project → Settings → Domains → add `castle.example` (and `www.castle.example`, set to redirect to it).
   Add the DNS records Vercel shows at your registrar; HTTPS comes on by itself within minutes. Keep
   `castle-finance-hub.vercel.app`: old links, live Excel links and shared books keep working.
4. **Vercel** → Environment Variables: `NEXT_PUBLIC_SITE_URL` = `https://castle.example` (type **Config**, not Secret: see
   section 3), then Redeploy. Link previews, the sitemap, robots.txt and every page's canonical tag now use the domain, so search
   engines index it and not the vercel.app address. View a page's source to check: `/deal-flow` should carry
   `<link rel="canonical" href="https://castle.example/deal-flow"/>`.
5. **`hello@castle.example`.** Forward it to your own inbox with your registrar's or Cloudflare's free email forwarding, and send
   it a test from another account. To reply from that address, use a provider that can send (a mailbox on Zoho Mail's free plan,
   say, in place of the forwarding): Gmail's "Send mail as" through an outside address is reportedly ending in January 2027.
6. **Vercel** → Environment Variables: `NEXT_PUBLIC_CONTACT_EMAIL` = `hello@castle.example` (type **Config**), then Redeploy.
   "Report a data issue" now opens it instead of a GitHub issue form.
7. **GitHub** → the repository's Actions secrets: set `SEC_USER_AGENT` to `Castle research hello@castle.example`.
8. **Google Search Console** (search.google.com/search-console) → add the domain → verify with the DNS record it gives
   you → Sitemaps → submit `https://castle.example/sitemap.xml`.
9. **Check:** open the site on your phone; paste a deal's tear-sheet link into LinkedIn's Post Inspector
   (linkedin.com/post-inspector) and check the preview card; run Lighthouse in Chrome's DevTools on the Hub (mobile).

Sign-in stays off until it's needed (`NEXT_PUBLIC_AUTH_PROVIDERS` empty; section 4). When it goes on:

- **Supabase** → Authentication → URL Configuration: Site URL `https://castle.example`; add `https://castle.example/**`
  to the Redirect URLs (keep the vercel.app one).
- **Google Cloud** → your OAuth client: add `https://castle.example` to the authorized JavaScript origins. Then
  Branding: add the domain under authorized domains, set the home page `https://castle.example/about` and the
  privacy policy `https://castle.example/privacy`, and submit for brand verification (free), so the sign-in screen
  says "Castle" instead of the Supabase address. It asks you to prove you own the domain through Search Console (step 8).
- **GitHub** → your OAuth app: homepage `https://castle.example`.
- **Check:** sign in and out; paste a shared book's link into the Post Inspector too.
- Optional: email sign-in links (Resend free tier → verify the domain → Supabase → Authentication → SMTP Settings with
  Resend's SMTP details).

## Checking it works

- Actions → latest "Ingest SEC data" run is green, and its Ingest step ends with `saved to Supabase: N deals, M IPOs`.
- Supabase → Table Editor → `deals` has rows.
- The live site shows real deals, with no red "Live data is unavailable" banner. (The deployed site never shows sample data; if it can't reach Supabase it says why in that banner.)
