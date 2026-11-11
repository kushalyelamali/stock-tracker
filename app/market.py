"""Market data access (Yahoo Finance via yfinance) with a small in-memory cache."""

import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

import yfinance as yf

CACHE_TTL = int(os.getenv("CACHE_TTL_SECONDS", "120"))
SHORT_TERM_MAX_DAYS = 45    # calls expiring within this window are "short-term"
LONG_TERM_MIN_DAYS = 270    # calls expiring beyond this are "long-term" (LEAPS-style)

_cache: dict[str, tuple[float, object]] = {}


def cached(key: str, loader, ttl: int = CACHE_TTL):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = loader()
    _cache[key] = (time.time(), value)
    return value


def _num(value, digits: int = 2):
    """Convert to a JSON-safe rounded float, or None."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else round(f, digits)


def _quote(ticker: str) -> dict:
    try:
        info = yf.Ticker(ticker).fast_info
        price, prev = _num(info["last_price"]), _num(info["previous_close"])
        change = _num((price - prev) / prev * 100) if price and prev else None
        return {
            "ticker": ticker,
            "price": price,
            "previousClose": prev,
            "changePct": change,
            "marketCap": _num(info["market_cap"], 0),
            "dayHigh": _num(info["day_high"]),
            "dayLow": _num(info["day_low"]),
            "yearHigh": _num(info["year_high"]),
            "yearLow": _num(info["year_low"]),
            "volume": _num(info["last_volume"], 0),
        }
    except Exception as exc:  # one bad ticker should not sink the whole table
        return {"ticker": ticker, "error": str(exc)[:120]}


def quotes(tickers: list[str]) -> list[dict]:
    def load():
        with ThreadPoolExecutor(max_workers=8) as pool:
            rows = list(pool.map(_quote, tickers))
        if all("error" in r for r in rows):
            raise RuntimeError(rows[0]["error"])
        return rows

    return cached("quotes:" + ",".join(tickers), load)


def history(ticker: str, period: str = "6mo") -> list[dict]:
    def load():
        frame = yf.Ticker(ticker).history(period=period, interval="1d")
        if frame.empty:
            raise RuntimeError(f"No price history for {ticker}")
        return [
            {"date": idx.strftime("%Y-%m-%d"), "close": _num(row["Close"])}
            for idx, row in frame.iterrows()
        ]

    return cached(f"history:{ticker}:{period}", load, ttl=CACHE_TTL * 5)


def calls(ticker: str, term: str, max_expirations: int = 3, per_expiration: int = 12) -> dict:
    """Call contracts for a ticker, bucketed as short-term or long-term by expiration."""

    def load():
        tk = yf.Ticker(ticker)
        today = date.today()
        dated = [(e, (datetime.strptime(e, "%Y-%m-%d").date() - today).days) for e in tk.options]
        if term == "short":
            picked = [(e, d) for e, d in dated if 0 <= d <= SHORT_TERM_MAX_DAYS]
        else:
            picked = [(e, d) for e, d in dated if d >= LONG_TERM_MIN_DAYS]
        picked = picked[:max_expirations]

        spot = _num(tk.fast_info["last_price"])
        groups = []
        for expiration, days in picked:
            frame = tk.option_chain(expiration).calls
            if spot:  # keep the strikes closest to the current price
                frame = frame.assign(_dist=(frame["strike"] - spot).abs())
                frame = frame.nsmallest(per_expiration, "_dist").sort_values("strike")
            contracts = []
            for _, r in frame.iterrows():
                bid, ask = _num(r.get("bid")), _num(r.get("ask"))
                mid = _num((bid + ask) / 2) if bid and ask else _num(r.get("lastPrice"))
                strike = _num(r.get("strike"))
                contracts.append({
                    "contract": r.get("contractSymbol"),
                    "strike": strike,
                    "last": _num(r.get("lastPrice")),
                    "bid": bid,
                    "ask": ask,
                    "volume": _num(r.get("volume"), 0),
                    "openInterest": _num(r.get("openInterest"), 0),
                    "impliedVol": _num((r.get("impliedVolatility") or 0) * 100, 1),
                    "inTheMoney": bool(r.get("inTheMoney")),
                    "breakeven": _num(strike + mid) if strike and mid else None,
                })
            groups.append({"expiration": expiration, "daysToExpiry": days, "contracts": contracts})
        return {"ticker": ticker, "term": term, "spot": spot, "expirations": groups}

    return cached(f"calls:{ticker}:{term}", load)
