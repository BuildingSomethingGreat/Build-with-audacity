# Earn: the micro-book agent

One command writes a micro-book, turns it into a PDF, puts it on sale, and advertises it.

```
pick niche → write book → render PDF → Stripe payment link → Meta ad (paused) → storefront on Fly
```

## Run it

```bash
npm install
cp .env.example .env
npm run agent   # writes a book into ./books
npm start       # storefront at http://localhost:8080
```

Any missing key switches that step to **dry-run**, so you can demo the whole pipeline with zero accounts.

## Keys you need

| Step | Where to get it |
|---|---|
| Writing | `ANTHROPIC_API_KEY` from console.anthropic.com |
| Selling | `STRIPE_SECRET_KEY` from Stripe → Developers → API keys (start with a `sk_test_` key) |
| Delivery receipts | Add a webhook in Stripe to `https://<app>.fly.dev/webhooks/stripe` for `checkout.session.completed`, then set `STRIPE_WEBHOOK_SECRET` |
| Ads | A Meta Business account, an ad account with a payment method, a Facebook Page, and a Marketing API access token |

## How the money moves

1. A Meta ad sends people to `/b/<slug>`.
2. The **Buy** button opens a Stripe Payment Link.
3. Stripe redirects to `/thanks`. The server confirms payment with Stripe, then unlocks the PDF.

No database, no email service. Books live on a Fly volume.

## Guardrails (read these)

- Ads are created **PAUSED**. You review them in Ads Manager before anything spends. Set `META_AUTO_ACTIVATE=true` only when you trust the output.
- `META_MAX_DAILY_BUDGET_CENTS` is a hard cap the agent cannot exceed.
- The writing prompt bans income and health claims. Still read every book before it goes live, since Meta will reject or flag policy problems.
- Stripe and Meta both require a human to verify the business. The agent runs the accounts, but it can't open them.

## Deploy

```bash
fly launch --no-deploy
fly volumes create books --size 1
fly secrets set ANTHROPIC_API_KEY=… STRIPE_SECRET_KEY=… BASE_URL=https://<app>.fly.dev ADMIN_TOKEN=…
fly deploy
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://<app>.fly.dev/admin/run
```

Set `AGENT_EVERY_HOURS=168` to publish a new book every week. Note: with scale-to-zero, the timer only runs while the machine is awake. For a reliable schedule, call `/admin/run` from a free cron service or a GitHub Action.

## Make it yours (workshop prompts)

- "Change the niche seeds to topics my audience cares about: …"
- "Generate a cover image and use it as the og:image and the ad image."
- "After each sale, email the buyer a download link."
- "Each week, pause ads with no sales and double the budget on winners, up to the cap."
