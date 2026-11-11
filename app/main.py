"""Stock Tracker API + static frontend."""

import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import market
from .sectors import SECTORS

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")

app = FastAPI(title="Stock Tracker")


def _ticker(raw: str) -> str:
    ticker = raw.strip().upper()
    if not TICKER_RE.match(ticker):
        raise HTTPException(400, "Invalid ticker symbol")
    return ticker


def _upstream(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Market data provider error: {str(exc)[:160]}")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/api/sectors")
def list_sectors():
    return [{"key": k, "name": v["name"], "tickers": v["tickers"]} for k, v in SECTORS.items()]


@app.get("/api/sectors/{key}/quotes")
def sector_quotes(key: str):
    sector = SECTORS.get(key)
    if not sector:
        raise HTTPException(404, "Unknown sector")
    return {"sector": sector["name"], "quotes": _upstream(market.quotes, sector["tickers"])}


@app.get("/api/stocks/{ticker}")
def stock_detail(ticker: str, period: str = Query("6mo", pattern="^(1mo|3mo|6mo|1y|5y)$")):
    ticker = _ticker(ticker)
    quote = _upstream(market.quotes, [ticker])[0]
    return {"quote": quote, "history": _upstream(market.history, ticker, period)}


@app.get("/api/options/{ticker}/calls")
def option_calls(ticker: str, term: str = Query("short", pattern="^(short|long)$")):
    return _upstream(market.calls, _ticker(ticker), term)


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
