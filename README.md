# Stock Tracker

A small personal stock research app.

- **Stocks tab**: watchlists by sector (technology, finance, healthcare, energy, consumer, industrials) with price, daily change, market cap, 52-week range and a price-history chart per ticker.
- **Options tab**: call contracts for any ticker, split into short-term (expiring within 45 days) and long-term (expiring 9+ months out), showing the strikes nearest the current price with bid/ask, breakeven, volume, open interest and implied volatility.

Stack: FastAPI (Python) serving a JSON API and a dependency-free HTML/JS frontend. Market data comes from Yahoo Finance through `yfinance`, so no API key is needed. Data may be delayed. This is a research tool, not investment advice.

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://localhost:8000.

## Deploy on Render

The repo includes `render.yaml`, a Render Blueprint that defines one free web service.

1. Push this repo to GitHub.
2. In the Render dashboard choose **New > Blueprint**, connect your GitHub account and pick this repo.
3. Review the service Render reads from `render.yaml` and click **Apply**.

Render installs `requirements.txt`, starts `uvicorn` on the port it assigns via `$PORT`, and polls `/healthz`. Every push to the default branch redeploys automatically.

Things to know:

- Free web services sleep after a period of inactivity, so the first request afterwards is slow.
- Yahoo Finance sometimes rate-limits cloud IP addresses. Responses are cached in memory (`CACHE_TTL_SECONDS`, default 120) to reduce calls. If you see "Market data provider error", wait a minute and retry.

## API

| Route | Returns |
| --- | --- |
| `GET /api/sectors` | Sectors and their tickers |
| `GET /api/sectors/{key}/quotes` | Quotes for a sector |
| `GET /api/stocks/{ticker}?period=6mo` | Quote plus daily closes (`1mo`, `3mo`, `6mo`, `1y`, `5y`) |
| `GET /api/options/{ticker}/calls?term=short` | Call contracts (`short` or `long`) |
| `GET /healthz` | Health check |

## Customize

- Sectors and tickers: `app/sectors.py`
- Short/long-term windows: `SHORT_TERM_MAX_DAYS` and `LONG_TERM_MIN_DAYS` in `app/market.py`
