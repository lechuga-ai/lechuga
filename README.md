# Lechuga

A chat app, in the style of the ones you know, that runs open source models on Cloudflare and charges for them by use at a published markup. It's an alpha, made by two friends for friends and family. Lechuga is lettuce in Spanish. The one we run is at [lechuga.ai](https://lechuga.ai).

This repository is everything behind it: one Cloudflare Worker, one React app, one SQLite database. You can read it to check our claims about pricing and privacy, run it on your own machine, or deploy your own.

## What it does

- Chat with open source models through Workers AI, with the model's reasoning shown as it happens and replies streamed. An effort setting per message (low skips the thinking; medium is the default).
- Attach files and pictures: pastes and drops become chiclets, PDFs and Office files are converted to text on the server, pictures go to a model with vision. Long chats can be compacted into a summary.
- A memory: two short notes per person (what to remember, and how to be with them) that go into the model's instructions in their own chats, never a shared one. Written by "Remember this chat", by the model's `remember` tool when asked, by an overnight pass (a cron trigger) that folds in the day's chats, or by hand under Account. The system prompt itself lives in one file, `worker/src/prompt.ts`.
- The model can search the web (Brave) and read pages while it answers, when it decides it needs to; each step shows above the reply with links to what it read. Searches are charged to the chat at a published price.
- Share a chat with people by username or email: they read all of it and can carry it on, every message carries who typed it, and the replies are charged to whoever started the chat. Profiles with a name and a photo.
- Invite-only accounts: magic-link or Google sign-in, a username chosen once, five invites each, a request-access form.
- One free chat a day on the home page for visitors without an account. Nothing about it is stored.
- Prepaid credits: every reply is charged from its token counts and shows what it cost. Packs and a monthly plan through Stripe Checkout.
- An admin area: requests inbox, invites, accounts with what each has paid and cost, credits given by hand, suspension, and spend against the AI Gateway's daily limit.
- Limits against abuse, all enforced on the server and set in one config file.

## How it's put together

One Worker serves everything: the API under `/api`, and the built React app for every other path. Chats, accounts and the credit ledger live in D1 (Cloudflare's SQLite). Model calls go to Workers AI through an AI Gateway's OpenAI-compatible endpoint, which reports token usage on the last chunk of the stream; billing depends on that. Sign-in is [Better Auth](https://www.better-auth.com) running inside the worker, with mail sent through Resend. Stripe is called with plain `fetch`, no SDK.

```
worker/                  Hono API + static assets, Wrangler config
  wrangler.example.toml  copy to wrangler.toml and fill in your own ids
  .dev.vars.example      copy to .dev.vars: the names of every secret
  config.json            models and rates, packs, limits, username rules, terms version
  src/
    index.ts             entry: public routes, then the session check, then private routes
    auth.ts              Better Auth setup and the invite gate
    chat.ts              chats and messages: limits, history trimming, charging, "remember this chat"
    prompt.ts            the system prompt: who Lechuga is, what it can do, how to be, what it remembers
    memory.ts            what Lechuga keeps about a person across chats, and the model's remember tool
    nightly.ts           the overnight pass that folds the day's private chats into memory (cron in wrangler.toml)
    reply.ts             one reply, start to finish: model, tool, model again, streamed as events
    tools.ts             what the model may call: web_search (Brave), read_page; add new tools here
    gateway.ts           the model call through the AI Gateway, with token usage
    sharing.ts           who is in a chat (chatAccess is the one gate for every chat route)
    attachments.ts       files and pictures on a message; convert.ts turns PDFs and Office files into text
    summary.ts           compacting a long chat into a summary the model works from
    credits.ts           the ledger: every balance change is a row plus an update, in one batch
    billing.ts           Stripe Checkout and the customer portal; the account's purchase history
    billing-webhook.ts   Stripe's webhook: signature-checked, safe to deliver twice
    stripe.ts            the few Stripe calls, and webhook verification
    trial.ts             the home page's free chat
    invites.ts           invites and the gate helpers
    requests.ts          the public request-access and feedback forms, in-app notes
    admin.ts             everything under /api/admin
    me.ts, username.ts   the profile (name, photo) and the one-time username step
    email.ts, email/     sending through Resend; the templates, the invite in HTML and text
    db/                  numbered SQL migrations, 0001 onwards
web/                     Vite + React
  src/
    Root.tsx             session gate and top-level routes
    Visitor.tsx          signed out: home page, free chat, sign-in, public pages
    App.tsx              signed in: sidebar, start page, chats
    routes/, components/
eval/                    shell scripts that test a running copy
```

### The order of things in `index.ts`

1. `www.` redirects to the apex.
2. A Better Auth instance is built per request (the D1 binding only exists inside one).
3. **Public routes**, deliberately few: `/api/auth/*`, `/api/config`, `/api/models`, `/api/invites/lookup/:token`, `/api/requests/access`, `/api/requests/feedback`, `/api/try`, and `/api/billing/webhook` (whose gate is Stripe's signature).
4. **The session check.** Everything else under `/api` is a 401 without a session. Routes read the user from the request context, never from input. Someone else's chat is a 404, the same as one that doesn't exist.
5. `/api/admin/*` additionally requires the signed-in email to be in `ADMIN_EMAILS`, and answers 404 otherwise.
6. Everything else is the React app. Both `run_worker_first = true` and `not_found_handling = "single-page-application"` in `wrangler.toml` are needed for that.

### Money

1 credit is $0.0001. Rates in `config.json` are credits per **million** tokens: Cloudflare's price times `costs.markup`. A reply is charged after it finishes, from the gateway's token counts, in the same database batch that stores it; the ledger row also records the tokens and what the reply cost us. `credit_ledger` is only ever added to, `user.balance` is its running total, and `npm run db:check:<tier>` lists any account where the two disagree. Packs are found in Stripe by lookup key (`leaf`, `head`, `monthly`), so no price ids live in the code. Credits are only enforced where `STRIPE_SECRET_KEY` is set; without it balances are tracked and nobody is stopped at zero.

### Limits

All in `config.json`: messages per day and per minute, replies in flight at once per account (the balance is checked before a reply and charged after, so this is what stops an overdraft), a cap on reply length, history sent to the model trimmed to a token budget, invites per day, free chats per visitor and per day, and a daily ceiling on the two public forms. Turnstile guards the public forms and sign-in. `reserved_usernames` and `blocked_username_fragments` in the same file include offensive words, because that is what they exist to refuse.

## The native apps (iOS and Android)

`web/ios` and `web/android` are Capacitor projects: the same React app, built with `npm run build:native` (which reads `web/.env.native` and writes `web/dist-native`), inside a native shell. Xcode and Android Studio build and ship them; `npm run cap:sync` from `web/` rebuilds and copies the web build into both projects, and `npm run ios` or `npm run android` opens the project. On Apple silicon Macs the iOS app runs from the Mac App Store as is, so it stands in for a Mac app.

Inside the app the pages come from the phone, so a few things differ from the site, all keyed on `NATIVE` in `web/src/native.ts`: every `/api` call goes to the absolute `VITE_API_BASE` (dev by default; set it to prod for a release); sign-in returns a bearer token (Better Auth's `bearer` plugin) that is stored and sent instead of the cookie, and uses the emailed code, not the link; Google sign-in is off until it has Google's native SDK; and buying credits is hidden, because both stores require their own in-app purchase for anything like credits. The worker allows the app's two origins (`worker/src/native-app.ts`) for CORS and trusts them in Better Auth. Turnstile can't run on the iOS app's pages (it needs an http(s) origin, which Capacitor on iOS can't provide), so the worker lets the app's two origins through the bot check without a token (`passesBotCheck` in `worker/src/turnstile.ts`); the invite gate and the forms' daily ceilings are what stand behind it there.

Still to do on the apps: Google sign-in (needs Google's native SDK); Android has been set up the same way but not yet run on a device; the launch screen is still Capacitor's; and the icons are upscaled from the 256px favicon until there is a larger source.

## Running it locally

You need Node 20+ and a Cloudflare account (the free plan is enough to look around; model replies need Workers AI).

```
npm install
cp worker/wrangler.example.toml worker/wrangler.toml     # your account id and gateway name
cp worker/.dev.vars.example worker/.dev.vars             # see the comments inside
```

Create the local database by running each migration once, in order, from `worker/`:

```
npm run db:migrate:local
npm run db:migrate:local:0002
...                                  # one script per file in src/db/, up to the highest number
```

Then, from the repo root:

```
npm run dev
```

Open **http://localhost:5173** (Vite, with hot reload; it proxies `/api` to the worker on 8787). Put your own email in `ADMIN_EMAILS` in `.dev.vars`: admins never need an invite, which is how you get into an empty database. With no `RESEND_API_KEY`, the magic link is printed in the terminal instead of emailed.

If the page loads but shows no model picker, the worker half of `npm run dev` has died while Vite kept going. Stop it and start it again.

`npm run build` puts the built app in `worker/public`, which is what the deployed worker serves. You don't need it for local work — Vite serves the app itself — but run it once if you want to see exactly what gets deployed.

## Deploying your own

Create two D1 databases, an AI Gateway, and a Turnstile widget, and put their ids in `wrangler.toml`. Then, per tier (`dev`, `prod`), from `worker/`:

```
npx wrangler secret put <NAME> --env dev
```

| Secret | Needed | Purpose |
|---|---|---|
| `CF_API_TOKEN` | always | the model calls: an account API token with Workers AI and AI Gateway read |
| `BETTER_AUTH_SECRET` | always | signs sessions; a different value per tier (`openssl rand -base64 32`) |
| `TURNSTILE_SECRET` | always | checks the bot test on the server |
| `ADMIN_EMAILS` | always | comma-separated emails that can open `/admin`; a secret so nobody's address is in the repo |
| `RESEND_API_KEY` | deployed tiers | all outgoing mail |
| `GOOGLE_CLIENT_SECRET` | optional | turns on the Google button |
| `STRIPE_SECRET_KEY` | optional | a **restricted** key; turns on buying and enforcement |
| `STRIPE_WEBHOOK_SECRET` | with Stripe | signing secret of that tier's webhook endpoint |
| `BRAVE_SEARCH_API_KEY` | optional | lets the model search the web; without it, it can still read pages it's given |

Run the migrations against the tier, then deploy from the repo root:

```
npm run db:migrate:dev --workspace worker        # then :0002, :0003, ...
npm run deploy:dev                               # builds the web app, uploads worker and assets
```

Three outside registrations are tied to a tier's hostname and must follow it if it changes: the Turnstile widget's hostnames, the Google OAuth redirect URI (`<BASE_URL>/api/auth/callback/google`), and the Stripe webhook URL (`<BASE_URL>/api/billing/webhook`).

## Releasing

**The website.** Apply any new migration to dev, then prod (`npm run db:migrate:<tier>:<n> --workspace worker`), always before the code that needs it. Then `npm run deploy:dev`, look at dev.lechuga.ai, then `npm run deploy:prod`. Each deploy builds the web app and uploads it with the worker, whether you run it from the repo root or from `worker/` (a `predeploy` step in `worker/package.json` does the build, so there is no way to ship stale pages). If the release is worth telling people about, it gets an entry in `NEWS` (see Changing things).

**The iOS app, to TestFlight or the App Store.** The app talks to whatever worker is live, so a build that needs a worker change goes out after that worker.

1. In `web/.env.native`, point `VITE_API_BASE` at the tier the build should talk to: `https://lechuga.ai` for anything other people will run.
2. From `web/`: `npm run cap:sync` (builds the web app for the shell and copies it into `ios/` and `android/`).
3. `npm run ios` opens Xcode. In the App target's General tab, raise **Build**: Apple refuses a second upload with the same number. Version changes only when people should notice.
4. Set the destination to **Any iOS Device (arm64)**, then Product > Archive. In the Organizer: Distribute App > TestFlight & App Store > Upload. Signing is automatic; the project already declares it uses only standard HTTPS encryption, so there is no export-compliance question.
5. In App Store Connect, the app's TestFlight tab shows the build once processed (10 to 30 minutes). Internal testers get it immediately. External testers need Beta App Review once per version: it asks for a privacy policy URL (`https://lechuga.ai/privacy`) and notes for the reviewer; say the app is invite only and give them an invited address.
6. For the App Store itself, the same archive is submitted from the app's distribution page with the listing filled in. "Make this app available on Mac" under Pricing and Availability is what puts it on Apple silicon Macs.

**The Android app.** Not yet released. When it is: a release keystore (kept out of the repo, see `web/android/.gitignore`, and backed up: losing it means never updating the app again), `npm run android`, Build > Generate Signed Bundle, and the Play Console.

## Changing things

- **Schema:** add `worker/src/db/000N_name.sql` and its three scripts in `worker/package.json`. Apply it local, then dev, then prod, and always **before** deploying code that needs it. SQLite can't add a column twice, so a migration runs once per database.
- **Models and prices:** `config.json`. The first model is the default; `"retired": true` takes one out of the picker while old chats on it keep working. Check a model's abilities (vision, function calling) against Cloudflare's model page before relying on them.
- **Tools:** add an entry to `TOOLS` in `worker/src/tools.ts`: a description the model reads, a `run` function, what it costs. `reply.ts` handles the rounds; `config.json` `tools` has the prices and the cap on rounds. A tool backed by someone's own account (mail, a calendar) will also need an account link and a check for it.
- **What the model is told:** `basePreamble` in `chat.ts`: the date, that its knowledge has an end, where people are, how to think and behave, and which tools it has. It's sent with every reply, so every word costs on every message.
- **What's new:** add a dated entry at the top of `NEWS` in `web/src/routes/StaticPages.tsx` with each release.
- **Installed as an app:** `web/public/manifest.webmanifest` is what Safari's Add to Home Screen / Add to Dock and Chrome's Install read: the name, colours and icons (`web/public/icons/`, all made from `favicon.png`; the maskable ones keep the lettuce inside the centre so Android's launcher shapes don't clip it). `web/public/sw.js` is a small cache that makes an installed copy open instantly; it never touches `/api`, and it's registered only from a production build. If you change what it caches, bump its `CACHE` name so old copies are dropped. Installed copies on iOS and macOS don't share cookies with the browser, so they sign in with an emailed code (`emailOTP` in `worker/src/auth.ts`, `web/src/installed.ts`) instead of the link.
- **Terms:** when the meaning of `web/src/components/Legal.tsx` changes, update its date and `terms_version`.

## Testing

The scripts in `eval/` run against a live copy, local or deployed. Most need a session cookie, copied whole from the `Cookie` header of any `/api` request in the browser's network tab. A session cookie is as good as a password; never paste one anywhere.

```
export SESSION_COOKIE='better-auth.session_token=...'
BASE_URL=http://localhost:8787 eval/verify_models.sh     # one message per model
BASE_URL=http://localhost:8787 eval/smoke.sh             # a longer run per model
USER_A_COOKIE=... USER_B_COOKIE=... eval/auth_test.sh    # one account can't touch another's chats
D1_ENV=local eval/invite_test.sh                         # invites, username rules, admin 404s
eval/billing_test.sh                                     # signs its own Stripe events; cleans up after itself
eval/sharing_test.sh                                     # who can see a chat, who can change it, who pays; makes its own accounts
eval/tools_test.sh                                       # the model reads a page and (with a Brave key) searches; makes its own account
```

## Contributing

This is where Lechuga is actually built, so what you see is the live state, alpha and all. Issues and pull requests are welcome; it's a side project run by two people, so replies may not be quick.

`worker/wrangler.toml` is deliberately absent and gitignored: it holds one deployment's Cloudflare ids. Copy `worker/wrangler.example.toml` to it and fill in your own.

## Licence

MIT: use it, change it, run your own, sell it if you like. See [LICENSE](LICENSE). The name "Lechuga" and the logo are ours; a copy that isn't ours should wear its own name.

## Security

See [SECURITY.md](SECURITY.md). Secrets live only in Wrangler and in the gitignored `.dev.vars`.
