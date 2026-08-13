# PortfolioGuidance

A private, installable web app (PWA) for your **Zerodha** portfolio: a **sectoral-allocation
dashboard** and a **target-average buy/sell calculator**. Static files only — **no server** for
the app itself (same model as *mealfast* and *healthdashboard*). Live holdings are pulled from
Zerodha through a tiny free **Cloudflare Worker** that holds your API secret, so nothing sensitive
is ever in this repo or on your phone.

> The full portfolio-scoring / guidance engine (methodology-v2) is intentionally **on the backlog**.
> This app is the foundation: get holdings in, see allocation, size buys/sells.

## Files
```
index.html      app shell / markup            manifest.json   installable-app metadata
app.js          all logic                     sw.js           offline cache
style.css       styling                       config.js       your Worker URL (not a secret)
sectors.js      bundled stock -> sector map    icons/          home-screen icons
push.bat        one-click publish to GitHub    worker/         the Cloudflare Worker (Kite proxy)
```

## What it does
- **Dashboard** — total value / invested / P&L / day change, a donut of **sector allocation**, and a ranked sector breakdown.
- **Holdings** — every position with qty, avg, LTP, value and P&L; tap the sector chip to reclassify.
- **Calculator** —
  - *Average down (buy):* how many shares to buy at the current price to reach a **target average cost**.
  - *Trim (sell):* shares to sell to reach a target remaining **value**, target **quantity**, or to **book a set profit** — with proceeds and realised P&L.
- **Settings** — Connect/Refresh Zerodha, edit the sector map, JSON backup/restore, or load demo data.

Holdings live only in your phone's browser storage plus any JSON backup you export. Public repo, code-only.

---

## Setup (one time)

### A. Publish the app to GitHub Pages (~5 min, no Mac)
1. Create a **public** repo `github.com/rajkumarpattabi/portfolioguidance`.
2. From this folder, first time only:
   ```
   git init
   git add -A
   git commit -m "PortfolioGuidance"
   git branch -M main
   git remote add origin https://github.com/rajkumarpattabi/portfolioguidance.git
   git push -u origin main
   ```
   After that, just double-click **push.bat** to publish changes.
3. Repo → **Settings → Pages** → Source: `main` / `/ (root)` → Save.
4. Your URL: `https://rajkumarpattabi.github.io/portfolioguidance/`

You can install and use it right now in **Demo** mode. Do steps B–C to connect Zerodha.

### B. Create a free Kite Connect app (Zerodha)
Kite Connect is now **free for personal use** (holdings included; you don't need the paid
historical/market-data add-on for this app).
1. Go to **developers.kite.trade** → sign up / log in → **Create new app** (type: Connect).
2. Set the **Redirect URL** to your Worker's callback (you'll get the Worker URL in step C; it looks
   like `https://portfolioguidance.<your-subdomain>.workers.dev/callback`). You can create the app
   first with a placeholder and edit this after step C.
3. Copy the **API key** and **API secret**.

### C. Deploy the Cloudflare Worker (free)
From the `worker/` folder:
1. Install once: `npm i -g wrangler` then `wrangler login` (opens Cloudflare; free account is fine).
2. Create the session store:
   ```
   npx wrangler kv namespace create SESSION
   ```
   Paste the returned **id** into `worker/wrangler.toml` (`PASTE_KV_NAMESPACE_ID`).
3. In `worker/wrangler.toml` set **APP_URL** to your Pages URL and **KITE_API_KEY** to your api key.
4. Set the two secrets (encrypted, never in the repo):
   ```
   npx wrangler secret put KITE_API_SECRET     # paste your Kite api secret
   npx wrangler secret put APP_KEY             # any pass-phrase you invent
   ```
5. Deploy: `npx wrangler deploy` → note the Worker URL it prints.
6. Put that Worker URL (without `/callback`) into **`config.js`** as `WORKER_URL`, e.g.
   `https://portfolioguidance.<your-subdomain>.workers.dev`, then run **push.bat**.
7. Back in the Kite app (step B), set the **Redirect URL** to `<Worker URL>/callback`.

### D. Install on iPhone
Open your Pages URL in **Safari** → Share → **Add to Home Screen** → Add. It opens full-screen and
works offline.

---

## Daily use
- Open the app → tap **Connect** (top-right). The first time it asks for your **APP_KEY** (the
  pass-phrase from step C-4); it's remembered on-device after that.
- Complete the **Kite login** (Zerodha requires this once a day — access tokens expire at 6 AM).
- Your holdings load; the dashboard and calculator use them. Tap **Refresh** any time for fresh prices.

## Notes & limits
- **Once-a-day Kite login is unavoidable** — it's a Zerodha regulatory rule, not an app limitation.
- The Worker is **stateless about your data**: it only keeps the day's session token in KV; your
  holdings are never stored there — they go straight to your phone.
- Sector data isn't provided by Zerodha, so `sectors.js` ships a starter map; anything unmapped shows
  as *Unclassified* and you can assign it in-app (saved on your device).
- **Not investment advice.** This app organises your own holdings and does arithmetic; it does not
  recommend trades.
