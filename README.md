# ADV Amazon Ledger

Seller dashboard for ADV products: sales and profit by period, stock in Amazon warehouses,
monthly sales per SKU, and a product watchlist with Keepa sales ranks.

**Live dashboard:** https://vladcostas.github.io/adv-amz-ledger/

## How the data updates

Nobody needs to run anything. A GitHub Actions job
([`.github/workflows/update-ledger.yml`](.github/workflows/update-ledger.yml)) runs every 6 hours:

1. `scripts/update-ledger.js` pulls from Amazon SP-API and Keepa:
   - **Sales** (orders, units, sales incl. VAT, pending) from the orders report, last 30 days, all 12 marketplaces.
     Non-euro sales are converted at ECB daily rates.
   - **VAT** estimated at the destination country's standard rate.
   - **Amazon fees** at each SKU's fee per unit over the last 60 days of settlements.
   - **Refunds** and **account-level charges** from Amazon's financial events, by posting date.
   - **Product cost** from [`data/costs.json`](data/costs.json), else the watchlist cost for the ASIN.
   - **Stock** from FBA Inventory (Pan-EU pool, UK, and AE/SA when there is stock).
   - **Keepa** sales ranks and monthly-sold estimates for watchlist products (the stalest ones each run,
     within the Keepa token allowance; every rank refreshes at least daily).
2. It rewrites [`data.js`](data.js) (the page's figures) and `data/state.json` (fee and per-SKU history it needs
   next time), commits them, and republishes the site.

Days older than 30 are never changed. To run it now: GitHub → **Actions** → **Update ledger data** → **Run workflow**.

### Setup (repo owner, once)

Add these under GitHub → repo **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Value |
|---|---|
| `AMAZON_CLIENT_ID` | LWA client ID (`amzn1.application-oa2-client…`) |
| `AMAZON_CLIENT_SECRET` | LWA client secret (`amzn1.oa2-cs.v1…`) |
| `AMAZON_REFRESH_TOKEN` | Refresh token (`Atzr|…`) |
| `KEEPA_API_KEY` | Keepa API key (optional; without it ranks stop updating) |

Only the repo owner can add secrets. Collaborators can run the workflow once they exist.

### Product costs

`data/costs.json` holds the unit cost per SKU (EUR). The first version was worked out from the
Sellerboard-based daily cost totals the ledger had in October 2026. Edit it (or replace it with a
Sellerboard export) when costs change; the dashboard's "Cost of goods" uses it from the next run.
SKUs missing from it fall back to the watchlist cost, and `META.missingCostUnits` counts units with no cost at all.

## Running it on your PC (optional)

Needs Node.js 20.6+. Copy `.env.example` to `.env`, fill in the keys (shared via a password manager,
never chat/email — `.env` is git-ignored), then:

```bash
npm install
node --env-file=.env scripts/update-ledger.js
```

Open `index.html` through any local web server to see the result. `server.js` (`npm run dev`) is the
older local sync server; the dashboard no longer uses it.

## Working together

Changes are pushed directly to `main`, which is the live site, so check a change locally first.
Pull before you start (`git pull`), since the update job commits `data.js` every 6 hours.
