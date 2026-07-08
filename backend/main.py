"""Strikepoint FastAPI backend — wraps all analysis logic for the mobile app."""

import math
import os
from datetime import datetime, date, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yfinance as yf
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Strikepoint API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

RISK_FREE_RATE = 0.045


# ── Black-Scholes helpers ────────────────────────────────────────────────────

def _norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def _norm_pdf(x):
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)

def option_price(spot, strike, days, iv_pct, kind="call", r=RISK_FREE_RATE):
    sigma = max(iv_pct, 1.0) / 100
    T = max(days, 1) / 365
    if spot <= 0 or strike <= 0:
        return max(spot - strike, 0) if kind == "call" else max(strike - spot, 0)
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if kind == "put":
        return strike * math.exp(-r * T) * _norm_cdf(-d2) - spot * _norm_cdf(-d1)
    return spot * _norm_cdf(d1) - strike * math.exp(-r * T) * _norm_cdf(d2)

def call_greeks(spot, strike, days, iv_pct):
    sigma = max(iv_pct, 1.0) / 100
    T = max(days, 1) / 365
    r = RISK_FREE_RATE
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return {
        "delta": round(_norm_cdf(d1), 3),
        "gamma": round(_norm_pdf(d1) / (spot * sigma * math.sqrt(T)), 4),
        "theta": round((-spot * _norm_pdf(d1) * sigma / (2 * math.sqrt(T)) - r * strike * math.exp(-r * T) * _norm_cdf(d2)) / 365, 3),
        "vega": round(spot * _norm_pdf(d1) * math.sqrt(T) / 100, 3),
        "prob_itm": round(_norm_cdf(d2) * 100, 1),
    }

def put_greeks(spot, strike, days, iv_pct):
    sigma = max(iv_pct, 1.0) / 100
    T = max(days, 1) / 365
    r = RISK_FREE_RATE
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return {
        "delta": round(_norm_cdf(d1) - 1, 3),
        "gamma": round(_norm_pdf(d1) / (spot * sigma * math.sqrt(T)), 4),
        "theta": round((-spot * _norm_pdf(d1) * sigma / (2 * math.sqrt(T)) + r * strike * math.exp(-r * T) * _norm_cdf(-d2)) / 365, 3),
        "vega": round(spot * _norm_pdf(d1) * math.sqrt(T) / 100, 3),
        "prob_itm": round(_norm_cdf(-d2) * 100, 1),
    }


# ── Technical analysis ───────────────────────────────────────────────────────

def analyze_ticker(ticker: str):
    try:
        t = yf.Ticker(ticker)
        df = t.history(period="3mo")
        if df.empty or len(df) < 20:
            return None

        closes = df["Close"].tolist()
        volumes = df["Volume"].tolist()
        spot = closes[-1]

        # SMAs
        sma20 = sum(closes[-20:]) / 20
        sma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else sma20

        # RSI
        gains, losses = [], []
        for i in range(1, 15):
            diff = closes[-i] - closes[-i - 1]
            (gains if diff > 0 else losses).append(abs(diff))
        avg_gain = sum(gains) / 14 if gains else 0
        avg_loss = sum(losses) / 14 if losses else 0.001
        rsi = 100 - (100 / (1 + avg_gain / avg_loss))

        # MACD
        ema12 = closes[-1]
        ema26 = closes[-1]
        for i, c in enumerate(closes[-26:]):
            ema12 = c * (2 / 13) + ema12 * (1 - 2 / 13) if i > 0 else c
            ema26 = c * (2 / 27) + ema26 * (1 - 2 / 27) if i > 0 else c
        macd = ema12 - ema26

        # Confidence via tanh
        trend_pct = (sma20 - sma50) / sma50
        momentum_pct = (closes[-1] - closes[-10]) / closes[-10]
        price_pos_pct = (closes[-1] - min(closes[-20:])) / (max(closes[-20:]) - min(closes[-20:]) + 0.001) - 0.5

        trend_s = math.tanh(trend_pct * 25)
        momentum_s = math.tanh(momentum_pct * 60)
        price_s = math.tanh(price_pos_pct * 25)
        composite = (trend_s + momentum_s + price_s) / 3
        confidence = round(min(50 + abs(composite) * 50, 97.0), 1)

        direction = "BUY" if composite > 0.05 else "SELL" if composite < -0.05 else "HOLD"

        # Change
        prev_close = closes[-2] if len(closes) > 1 else spot
        change_pct = round((spot - prev_close) / prev_close * 100, 2)

        info = t.info
        return {
            "ticker": ticker,
            "name": info.get("shortName", ticker),
            "price": round(spot, 2),
            "change_pct": change_pct,
            "direction": direction,
            "confidence": confidence,
            "rsi": round(rsi, 1),
            "macd": round(macd, 3),
            "sma20": round(sma20, 2),
            "sma50": round(sma50, 2),
            "volume": int(volumes[-1]) if volumes else 0,
            "market_cap": info.get("marketCap"),
            "sector": info.get("sector", ""),
        }
    except Exception:
        return None


def get_price_history(ticker: str, period: str = "1mo"):
    t = yf.Ticker(ticker)
    df = t.history(period=period)
    if df.empty:
        return []
    return [
        {"date": str(idx.date()), "close": round(float(row["Close"]), 2), "volume": int(row["Volume"])}
        for idx, row in df.iterrows()
    ]


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ok", "app": "Strikepoint API"}


@app.get("/analyze/{ticker}")
def analyze(ticker: str):
    result = analyze_ticker(ticker.upper())
    if not result:
        raise HTTPException(status_code=404, detail="No data for ticker")
    return result


@app.get("/history/{ticker}")
def history(ticker: str, period: str = "1mo"):
    data = get_price_history(ticker.upper(), period)
    if not data:
        raise HTTPException(status_code=404, detail="No history found")
    return data


@app.get("/scan")
def scan(tickers: str = "AAPL,TSLA,NVDA,MSFT,AMZN,META,GOOGL,AMD,RIVN,PLTR,SOFI,COIN,HOOD,SQ,PYPL"):
    ticker_list = [t.strip().upper() for t in tickers.split(",")]
    results = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(analyze_ticker, t): t for t in ticker_list}
        for f in as_completed(futures):
            r = f.result()
            if r:
                results.append(r)
    results.sort(key=lambda x: x["confidence"], reverse=True)
    return results


@app.get("/options/{ticker}")
def options_chain(ticker: str, expiry: Optional[str] = None):
    try:
        t = yf.Ticker(ticker.upper())
        expiries = t.options
        if not expiries:
            raise HTTPException(status_code=404, detail="No options data")

        if expiry is None:
            cutoff = date.today() + timedelta(days=7)
            expiry = next((e for e in expiries if date.fromisoformat(e) >= cutoff), expiries[0])

        chain = t.option_chain(expiry)
        spot = t.history(period="1d")["Close"].iloc[-1]

        calls = chain.calls[["strike", "bid", "ask", "lastPrice", "impliedVolatility", "openInterest"]].fillna(0)
        puts = chain.puts[["strike", "bid", "ask", "lastPrice", "impliedVolatility", "openInterest"]].fillna(0)

        call_wall = float(calls.loc[calls["openInterest"].idxmax(), "strike"]) if not calls.empty else None
        put_wall = float(puts.loc[puts["openInterest"].idxmax(), "strike"]) if not puts.empty else None

        days = (datetime.strptime(expiry, "%Y-%m-%d") - datetime.now()).days

        greeks_data = None
        if call_wall and days > 0:
            iv = float(calls.loc[calls["strike"] == call_wall, "impliedVolatility"].iloc[0]) * 100 if not calls[calls["strike"] == call_wall].empty else 30
            greeks_data = call_greeks(float(spot), call_wall, days, iv)

        return {
            "ticker": ticker.upper(),
            "spot": round(float(spot), 2),
            "expiry": expiry,
            "expiries": list(expiries[:12]),
            "days_to_expiry": days,
            "call_wall": call_wall,
            "put_wall": put_wall,
            "calls": calls.head(15).to_dict("records"),
            "puts": puts.head(15).to_dict("records"),
            "greeks": greeks_data,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/options/{ticker}/greeks")
def greeks_endpoint(ticker: str, strike: float, days: int, iv: float, kind: str = "call"):
    try:
        t = yf.Ticker(ticker.upper())
        spot = float(t.history(period="1d")["Close"].iloc[-1])
        g = call_greeks(spot, strike, days, iv) if kind == "call" else put_greeks(spot, strike, days, iv)
        price = option_price(spot, strike, days, iv, kind)
        return {"spot": round(spot, 2), "option_price": round(price, 2), **g}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/options/{ticker}/payoff")
def payoff_chart(ticker: str, strike: float, premium: float, days: int, iv: float, strategy: str = "covered_call"):
    try:
        t = yf.Ticker(ticker.upper())
        spot = float(t.history(period="1d")["Close"].iloc[-1])

        price_lo = min(spot * 0.75, strike * 0.92)
        price_hi = max(spot * 1.25, strike * 1.08)
        prices = [round(price_lo + (price_hi - price_lo) * i / 50, 2) for i in range(51)]

        expiry_payoff = []
        today_payoff = []

        for p in prices:
            if strategy == "covered_call":
                exp = min(strike, p) - spot + premium
                tod = premium - option_price(p, strike, days, iv, "call") + option_price(p, strike, 0, iv, "call")
            elif strategy == "cash_secured_put":
                exp = premium - max(strike - p, 0)
                tod = premium - option_price(p, strike, days, iv, "put")
            else:
                exp = min(strike, p) - spot + premium
                tod = exp
            expiry_payoff.append(round(exp, 2))
            today_payoff.append(round(tod, 2))

        return {"prices": prices, "expiry_payoff": expiry_payoff, "today_payoff": today_payoff, "spot": round(spot, 2)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AlertIn(BaseModel):
    ticker: str
    target_price: float
    direction: str  # "above" or "below"
    note: Optional[str] = ""

class PortfolioItem(BaseModel):
    ticker: str
    shares: float
    avg_cost: float

@app.post("/alerts")
def create_alert(alert: AlertIn):
    return {"status": "created", "alert": alert.dict()}

@app.post("/portfolio/pnl")
def portfolio_pnl(items: list[PortfolioItem]):
    results = []
    total_cost = 0
    total_value = 0
    for item in items:
        try:
            t = yf.Ticker(item.ticker.upper())
            price = float(t.history(period="1d")["Close"].iloc[-1])
            cost = item.shares * item.avg_cost
            value = item.shares * price
            pnl = value - cost
            pnl_pct = pnl / cost * 100
            total_cost += cost
            total_value += value
            results.append({
                "ticker": item.ticker.upper(),
                "shares": item.shares,
                "avg_cost": item.avg_cost,
                "current_price": round(price, 2),
                "cost_basis": round(cost, 2),
                "market_value": round(value, 2),
                "pnl": round(pnl, 2),
                "pnl_pct": round(pnl_pct, 2),
            })
        except Exception:
            pass
    return {
        "positions": results,
        "total_cost": round(total_cost, 2),
        "total_value": round(total_value, 2),
        "total_pnl": round(total_value - total_cost, 2),
        "total_pnl_pct": round((total_value - total_cost) / total_cost * 100, 2) if total_cost else 0,
    }
