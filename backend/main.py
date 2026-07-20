"""Strikepoint FastAPI backend — wraps all analysis logic for the mobile app."""

import math
import os
from datetime import datetime, date, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
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

@app.get("/app", response_class=HTMLResponse)
def mobile_app():
    return HTMLResponse(content=MOBILE_UI)

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

MOBILE_UI = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Strikepoint">
<title>Strikepoint</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--bg:#000;--surface:#0d0d0d;--card:#111;--border:#222;--green:#00c805;--red:#ff3b30;--blue:#0a84ff;--text:#fff;--muted:#888;--yellow:#ffd60a}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro",sans-serif;min-height:100vh;padding-bottom:80px;overflow-x:hidden}
.screen{display:none;padding:0 0 20px}
.screen.active{display:block}
/* Nav */
.nav{position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-top:1px solid var(--border);display:flex;padding:8px 0 max(8px,env(safe-area-inset-bottom));z-index:100}
.nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;color:var(--muted);font-size:10px;cursor:pointer;padding:4px 0;transition:color .2s}
.nav-btn.active{color:var(--green)}
.nav-btn svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
/* Header */
.header{padding:60px 16px 16px;background:linear-gradient(180deg,#0d0d0d 0%,transparent 100%)}
.header h1{font-size:28px;font-weight:700;letter-spacing:-.5px}
.header p{color:var(--muted);font-size:13px;margin-top:3px}
/* Search */
.search-wrap{padding:0 16px 12px}
.search{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:10px 14px;color:var(--text);font-size:16px;width:100%;outline:none}
.search::placeholder{color:var(--muted)}
/* Cards */
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:14px 16px;margin:0 16px 10px;cursor:pointer;transition:opacity .15s}
.card:active{opacity:.7}
.card-row{display:flex;justify-content:space-between;align-items:center}
.ticker{font-size:17px;font-weight:700}
.name{font-size:12px;color:var(--muted);margin-top:2px}
.price{font-size:17px;font-weight:600;text-align:right}
.change{font-size:12px;text-align:right;margin-top:2px}
.signal{display:inline-block;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.5px;margin-top:8px}
.BUY{background:rgba(0,200,5,.15);color:var(--green)}
.SELL{background:rgba(255,59,48,.15);color:var(--red)}
.HOLD{background:rgba(255,214,10,.15);color:var(--yellow)}
.pos{color:var(--green)}
.neg{color:var(--red)}
/* Loader */
.loader{text-align:center;padding:40px;color:var(--muted);font-size:14px}
.spinner{width:28px;height:28px;border:2px solid var(--border);border-top-color:var(--green);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 12px}
@keyframes spin{to{transform:rotate(360deg)}}
/* Detail */
.back-btn{background:none;border:none;color:var(--green);font-size:16px;cursor:pointer;padding:60px 16px 8px;display:flex;align-items:center;gap:6px}
.detail-header{padding:0 16px 20px}
.detail-ticker{font-size:36px;font-weight:800;letter-spacing:-1px}
.detail-name{color:var(--muted);font-size:14px;margin-top:2px}
.detail-price{font-size:42px;font-weight:700;margin-top:16px}
.detail-change{font-size:18px;margin-top:4px}
/* Chart */
.chart-wrap{padding:0 16px;margin-bottom:20px}
.chart-periods{display:flex;gap:8px;margin-bottom:10px}
.period-btn{background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--muted);font-size:12px;padding:5px 12px;cursor:pointer}
.period-btn.active{background:var(--green);border-color:var(--green);color:#000;font-weight:700}
svg.chart{width:100%;overflow:visible}
/* Stats grid */
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 16px;margin-bottom:20px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px}
.stat-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.stat-value{font-size:20px;font-weight:700;margin-top:4px}
/* Options table */
.table-wrap{overflow-x:auto;padding:0 16px;margin-bottom:20px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{color:var(--muted);text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.3px}
td{padding:10px 8px;border-bottom:1px solid rgba(255,255,255,.04)}
tr:active td{background:var(--surface)}
.section-title{font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;padding:0 16px;margin-bottom:10px;margin-top:20px}
/* Portfolio */
.pnl-summary{background:var(--card);border:1px solid var(--border);border-radius:16px;margin:0 16px 20px;padding:20px;text-align:center}
.pnl-total{font-size:36px;font-weight:700}
.pnl-pct{font-size:16px;margin-top:4px}
.add-position{background:var(--surface);border:1px solid var(--border);border-radius:12px;margin:0 16px 10px;padding:14px}
.add-position input{background:none;border:none;color:var(--text);font-size:15px;width:100%;outline:none;padding:6px 0}
.add-position input::placeholder{color:var(--muted)}
.add-position .divider{border:none;border-top:1px solid var(--border);margin:8px 0}
.btn{background:var(--green);color:#000;border:none;border-radius:12px;padding:13px;width:100%;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px;transition:opacity .2s}
.btn:active{opacity:.7}
.btn-outline{background:none;color:var(--green);border:1px solid var(--green);border-radius:12px;padding:13px;width:100%;font-size:16px;font-weight:600;cursor:pointer;margin-top:8px}
/* Scanner presets */
.presets{display:flex;gap:8px;padding:0 16px 14px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.presets::-webkit-scrollbar{display:none}
.preset{background:var(--surface);border:1px solid var(--border);border-radius:20px;color:var(--text);font-size:13px;font-weight:600;padding:7px 16px;white-space:nowrap;cursor:pointer;flex-shrink:0}
.preset.active{background:var(--green);border-color:var(--green);color:#000}
.confidence-bar{height:3px;background:var(--border);border-radius:2px;margin-top:8px}
.confidence-fill{height:100%;border-radius:2px;background:var(--green);transition:width .6s}
</style>
</head>
<body>

<!-- WATCHLIST -->
<div id="screen-watch" class="screen active">
  <div class="header"><h1>Strikepoint</h1><p id="watch-time">Loading market data...</p></div>
  <div class="search-wrap"><input class="search" id="watch-search" placeholder="Search ticker (e.g. AAPL)" autocapitalize="characters" autocorrect="off" spellcheck="false"></div>
  <div id="watch-list"><div class="loader"><div class="spinner"></div>Loading watchlist...</div></div>
</div>

<!-- SCANNER -->
<div id="screen-scan" class="screen">
  <div class="header"><h1>Scanner</h1><p>Real-time signals</p></div>
  <div class="presets">
    <button class="preset active" onclick="runScan('hot')">🔥 Hot</button>
    <button class="preset" onclick="runScan('ev')">⚡ EV</button>
    <button class="preset" onclick="runScan('ai')">🤖 AI</button>
    <button class="preset" onclick="runScan('crypto')">₿ Crypto</button>
    <button class="preset" onclick="runScan('mag7')">🌟 Mag7</button>
  </div>
  <div id="scan-list"><div class="loader"><div class="spinner"></div>Scanning...</div></div>
</div>

<!-- DETAIL (hidden overlay) -->
<div id="screen-detail" class="screen">
  <button class="back-btn" onclick="goBack()">
    <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg> Back
  </button>
  <div id="detail-content"><div class="loader"><div class="spinner"></div>Loading...</div></div>
</div>

<!-- OPTIONS -->
<div id="screen-opts" class="screen">
  <div class="header"><h1>Options</h1><p>Chain &amp; Greeks</p></div>
  <div class="search-wrap"><input class="search" id="opts-search" placeholder="Enter ticker (e.g. TSLA)" autocapitalize="characters" autocorrect="off" spellcheck="false"></div>
  <div id="opts-content"><div class="loader" style="padding-top:60px">Enter a ticker to load options chain</div></div>
</div>

<!-- PORTFOLIO -->
<div id="screen-port" class="screen">
  <div class="header"><h1>Portfolio</h1><p>Live P&amp;L tracker</p></div>
  <div class="add-position">
    <input id="port-ticker" placeholder="Ticker (e.g. AAPL)" autocapitalize="characters" autocorrect="off" spellcheck="false">
    <hr class="divider">
    <input id="port-shares" placeholder="Shares" type="number" inputmode="decimal">
    <hr class="divider">
    <input id="port-cost" placeholder="Avg cost per share" type="number" inputmode="decimal">
    <button class="btn" onclick="addPosition()">Add Position</button>
  </div>
  <div id="port-summary"></div>
  <div id="port-list"></div>
  <button class="btn-outline" style="margin:0 16px;width:calc(100% - 32px)" onclick="calcPnl()">Refresh P&L</button>
</div>

<!-- BOTTOM NAV -->
<nav class="nav">
  <button class="nav-btn active" onclick="showScreen('watch',this)">
    <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    Watchlist
  </button>
  <button class="nav-btn" onclick="showScreen('scan',this)">
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    Scanner
  </button>
  <button class="nav-btn" onclick="showScreen('opts',this)">
    <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
    Options
  </button>
  <button class="nav-btn" onclick="showScreen('port',this)">
    <svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/></svg>
    Portfolio
  </button>
</nav>

<script>
const API = '';  // same origin
const WATCHLIST = ['AAPL','TSLA','NVDA','MSFT','AMZN','META','GOOGL'];
const BASKETS = {
  hot: 'AAPL,TSLA,NVDA,MSFT,AMZN,META,GOOGL,AMD,PLTR,COIN',
  ev: 'TSLA,RIVN,LCID,NIO,XPEV,LI,CHPT,BLNK,FSR,F',
  ai: 'NVDA,MSFT,GOOGL,META,AMD,PLTR,AI,SOUN,BBAI,UPST',
  crypto: 'COIN,HOOD,MSTR,MARA,RIOT,CLSK,HUT,BTBT,SQ,PYPL',
  mag7: 'AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA'
};

let positions = JSON.parse(localStorage.getItem('sp_positions') || '[]');
let prevScreen = 'watch';

function fmt(n){return n>=1e9?(n/1e9).toFixed(1)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':n.toLocaleString()}
function clr(v){return v>0?'pos':v<0?'neg':''}
function pct(v){return (v>0?'+':'')+v.toFixed(2)+'%'}

function showScreen(id, btn){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('screen-'+id).classList.add('active');
  if(btn) btn.classList.add('active');
  if(id==='scan') runScan('hot');
  if(id==='port') calcPnl();
}

// ── WATCHLIST ────────────────────────────────────────────────────────────────
async function loadWatch(){
  const el = document.getElementById('watch-list');
  el.innerHTML = '<div class="loader"><div class="spinner"></div>Loading...</div>';
  try {
    const res = await fetch(API+'/scan?tickers='+WATCHLIST.join(','));
    const data = await res.json();
    renderStockList(el, data);
    document.getElementById('watch-time').textContent = 'Updated '+new Date().toLocaleTimeString();
  } catch(e){
    el.innerHTML = '<div class="loader">Failed to load. Is backend running?</div>';
  }
}

document.getElementById('watch-search').addEventListener('keydown', async e=>{
  if(e.key==='Enter'){
    const t = e.target.value.trim().toUpperCase();
    if(!t) return;
    openDetail(t);
  }
});

// ── SCANNER ───────────────────────────────────────────────────────────────────
async function runScan(basket){
  document.querySelectorAll('.preset').forEach(b=>b.classList.remove('active'));
  event.target.classList.add('active');
  const el = document.getElementById('scan-list');
  el.innerHTML = '<div class="loader"><div class="spinner"></div>Scanning '+basket.toUpperCase()+'...</div>';
  try{
    const tickers = BASKETS[basket]||BASKETS.hot;
    const res = await fetch(API+'/scan?tickers='+tickers);
    const data = await res.json();
    renderStockList(el, data);
  }catch(e){
    el.innerHTML = '<div class="loader">Scan failed. Check backend.</div>';
  }
}

function renderStockList(el, data){
  if(!data.length){el.innerHTML='<div class="loader">No results</div>';return}
  el.innerHTML = data.map(s=>`
    <div class="card" onclick="openDetail('${s.ticker}')">
      <div class="card-row">
        <div><div class="ticker">${s.ticker}</div><div class="name">${s.name||s.ticker}</div></div>
        <div><div class="price">$${s.price.toFixed(2)}</div><div class="change ${clr(s.change_pct)}">${pct(s.change_pct)}</div></div>
      </div>
      <div class="card-row" style="margin-top:8px">
        <span class="signal ${s.direction}">${s.direction} ${s.confidence}%</span>
        <span style="font-size:12px;color:var(--muted)">RSI ${s.rsi}</span>
      </div>
      <div class="confidence-bar"><div class="confidence-fill" style="width:${s.confidence}%;background:${s.direction==='BUY'?'var(--green)':s.direction==='SELL'?'var(--red)':'var(--yellow)'}"></div></div>
    </div>`).join('');
}

// ── DETAIL ────────────────────────────────────────────────────────────────────
async function openDetail(ticker){
  prevScreen = document.querySelector('.screen.active').id.replace('screen-','');
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('screen-detail').classList.add('active');
  const el = document.getElementById('detail-content');
  el.innerHTML = '<div class="loader"><div class="spinner"></div>Analyzing '+ticker+'...</div>';
  try{
    const [stock, hist] = await Promise.all([
      fetch(API+'/analyze/'+ticker).then(r=>r.json()),
      fetch(API+'/history/'+ticker+'?period=1mo').then(r=>r.json())
    ]);
    renderDetail(el, stock, hist, '1mo');
    el.dataset.ticker = ticker;
  }catch(e){
    el.innerHTML = '<div class="loader">Failed to load '+ticker+'</div>';
  }
}

function renderDetail(el, s, hist, period){
  const prices = hist.map(h=>h.close);
  const min = Math.min(...prices), max = Math.max(...prices);
  const W=300, H=80;
  const pts = prices.map((p,i)=>{
    const x = i/(prices.length-1)*W;
    const y = H - (p-min)/(max-min+.01)*H;
    return x+','+y;
  }).join(' ');
  const isUp = prices[prices.length-1]>=prices[0];
  const color = isUp ? '#00c805' : '#ff3b30';

  const signalColor = s.direction==='BUY'?'var(--green)':s.direction==='SELL'?'var(--red)':'var(--yellow)';

  el.innerHTML = `
    <div class="detail-header">
      <div class="detail-ticker">${s.ticker}</div>
      <div class="detail-name">${s.name||s.ticker}</div>
      <div class="detail-price">$${s.price.toFixed(2)}</div>
      <div class="detail-change ${clr(s.change_pct)}">${pct(s.change_pct)} today</div>
      <div style="margin-top:10px"><span class="signal ${s.direction}">${s.direction} &bull; ${s.confidence}% confidence</span></div>
    </div>
    <div class="chart-wrap">
      <div class="chart-periods">
        ${['1wk','1mo','3mo','6mo','1y'].map(p=>`<button class="period-btn${p===period?' active':''}" onclick="changePeriod('${s.ticker}','${p}',this)">${p.replace('mo','M').replace('wk','W').replace('y','Y')}</button>`).join('')}
      </div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:120px">
        <defs>
          <linearGradient id="cg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity=".3"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="0,${H} ${pts} ${W},${H}" fill="url(#cg)"/>
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/>
      </svg>
    </div>
    <div class="stats-grid">
      <div class="stat"><div class="stat-label">RSI</div><div class="stat-value" style="color:${s.rsi>70?'var(--red)':s.rsi<30?'var(--green)':'var(--text)'}">${s.rsi}</div></div>
      <div class="stat"><div class="stat-label">MACD</div><div class="stat-value ${clr(s.macd)}">${s.macd>0?'+':''}${s.macd}</div></div>
      <div class="stat"><div class="stat-label">SMA 20</div><div class="stat-value">$${s.sma20}</div></div>
      <div class="stat"><div class="stat-label">SMA 50</div><div class="stat-value">$${s.sma50}</div></div>
      <div class="stat"><div class="stat-label">Volume</div><div class="stat-value">${fmt(s.volume)}</div></div>
      <div class="stat"><div class="stat-label">Mkt Cap</div><div class="stat-value">${s.market_cap?fmt(s.market_cap):'—'}</div></div>
    </div>
    <div style="padding:0 16px">
      <div style="background:var(--card);border:1px solid ${signalColor}33;border-radius:16px;padding:16px">
        <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Signal Breakdown</div>
        <div style="font-size:15px;line-height:1.6">
          ${s.rsi>70?'⚠️ RSI overbought — potential pullback':s.rsi<30?'🟢 RSI oversold — potential bounce':'✅ RSI neutral'}<br>
          ${s.price>s.sma20?'📈 Price above SMA20 — bullish':'📉 Price below SMA20 — bearish'}<br>
          ${s.macd>0?'✅ MACD positive — upward momentum':'⚠️ MACD negative — downward momentum'}
        </div>
      </div>
      <button class="btn" style="margin-top:12px" onclick="openOptions('${s.ticker}')">View Options Chain →</button>
    </div>`;
}

async function changePeriod(ticker, period, btn){
  btn.closest('.chart-periods').querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  try{
    const [stock, hist] = await Promise.all([
      fetch(API+'/analyze/'+ticker).then(r=>r.json()),
      fetch(API+'/history/'+ticker+'?period='+period).then(r=>r.json())
    ]);
    renderDetail(document.getElementById('detail-content'), stock, hist, period);
  }catch(e){}
}

function openOptions(ticker){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('screen-opts').classList.add('active');
  document.querySelectorAll('.nav-btn')[2].classList.add('active');
  document.getElementById('opts-search').value = ticker;
  loadOptions(ticker);
}

function goBack(){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+prevScreen).classList.add('active');
  const idx = {watch:0,scan:1,opts:2,port:3}[prevScreen]||0;
  document.querySelectorAll('.nav-btn')[idx].classList.add('active');
}

// ── OPTIONS ───────────────────────────────────────────────────────────────────
document.getElementById('opts-search').addEventListener('keydown', e=>{
  if(e.key==='Enter'){loadOptions(e.target.value.trim().toUpperCase())}
});

async function loadOptions(ticker){
  if(!ticker) return;
  const el = document.getElementById('opts-content');
  el.innerHTML = '<div class="loader"><div class="spinner"></div>Loading options for '+ticker+'...</div>';
  try{
    const data = await fetch(API+'/options/'+ticker).then(r=>r.json());
    renderOptions(el, data);
  }catch(e){
    el.innerHTML = '<div class="loader">No options data for '+ticker+'</div>';
  }
}

function renderOptions(el, d){
  const g = d.greeks||{};
  el.innerHTML = `
    <div class="stats-grid" style="margin-top:0">
      <div class="stat"><div class="stat-label">Spot</div><div class="stat-value">$${d.spot}</div></div>
      <div class="stat"><div class="stat-label">Expiry</div><div class="stat-value" style="font-size:14px">${d.expiry}</div></div>
      <div class="stat"><div class="stat-label">Call Wall</div><div class="stat-value pos">$${d.call_wall||'—'}</div></div>
      <div class="stat"><div class="stat-label">Put Wall</div><div class="stat-value neg">$${d.put_wall||'—'}</div></div>
    </div>
    ${g.delta?`
    <div class="section-title">Greeks (ATM Call)</div>
    <div class="stats-grid">
      <div class="stat"><div class="stat-label">Delta</div><div class="stat-value">${g.delta}</div></div>
      <div class="stat"><div class="stat-label">Gamma</div><div class="stat-value">${g.gamma}</div></div>
      <div class="stat"><div class="stat-label">Theta</div><div class="stat-value neg">${g.theta}</div></div>
      <div class="stat"><div class="stat-label">Vega</div><div class="stat-value">${g.vega}</div></div>
    </div>`:''}
    <div class="section-title">Calls</div>
    <div class="table-wrap">
      <table>
        <tr><th>Strike</th><th>Bid</th><th>Ask</th><th>IV%</th><th>OI</th></tr>
        ${d.calls.map(c=>`<tr style="${c.strike>=d.spot-2&&c.strike<=d.spot+2?'background:rgba(0,200,5,.06)':''}">
          <td style="font-weight:600">$${c.strike}</td>
          <td class="pos">${c.bid.toFixed(2)}</td>
          <td>${c.ask.toFixed(2)}</td>
          <td>${(c.impliedVolatility*100).toFixed(0)}%</td>
          <td style="color:var(--muted)">${fmt(c.openInterest)}</td>
        </tr>`).join('')}
      </table>
    </div>
    <div class="section-title">Puts</div>
    <div class="table-wrap">
      <table>
        <tr><th>Strike</th><th>Bid</th><th>Ask</th><th>IV%</th><th>OI</th></tr>
        ${d.puts.map(p=>`<tr>
          <td style="font-weight:600">$${p.strike}</td>
          <td class="neg">${p.bid.toFixed(2)}</td>
          <td>${p.ask.toFixed(2)}</td>
          <td>${(p.impliedVolatility*100).toFixed(0)}%</td>
          <td style="color:var(--muted)">${fmt(p.openInterest)}</td>
        </tr>`).join('')}
      </table>
    </div>`;
}

// ── PORTFOLIO ─────────────────────────────────────────────────────────────────
function addPosition(){
  const ticker = document.getElementById('port-ticker').value.trim().toUpperCase();
  const shares = parseFloat(document.getElementById('port-shares').value);
  const cost = parseFloat(document.getElementById('port-cost').value);
  if(!ticker||isNaN(shares)||isNaN(cost)) return alert('Fill in all fields');
  positions.push({ticker,shares,avg_cost:cost});
  localStorage.setItem('sp_positions', JSON.stringify(positions));
  document.getElementById('port-ticker').value='';
  document.getElementById('port-shares').value='';
  document.getElementById('port-cost').value='';
  calcPnl();
}

async function calcPnl(){
  if(!positions.length){
    document.getElementById('port-summary').innerHTML='';
    document.getElementById('port-list').innerHTML='<div class="loader" style="padding-top:20px">Add positions above to track P&L</div>';
    return;
  }
  document.getElementById('port-list').innerHTML='<div class="loader"><div class="spinner"></div>Calculating P&L...</div>';
  try{
    const res = await fetch(API+'/portfolio/pnl',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(positions)});
    const data = await res.json();
    const pnlColor = data.total_pnl>=0?'var(--green)':'var(--red)';
    document.getElementById('port-summary').innerHTML=`
      <div class="pnl-summary">
        <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Total Portfolio</div>
        <div class="pnl-total" style="color:${pnlColor}">${data.total_pnl>=0?'+':''}$${Math.abs(data.total_pnl).toFixed(2)}</div>
        <div class="pnl-pct" style="color:${pnlColor}">${pct(data.total_pnl_pct)}</div>
        <div style="margin-top:10px;font-size:13px;color:var(--muted)">$${data.total_value.toFixed(2)} value &bull; $${data.total_cost.toFixed(2)} cost</div>
      </div>`;
    document.getElementById('port-list').innerHTML = data.positions.map((p,i)=>`
      <div class="card">
        <div class="card-row">
          <div><div class="ticker">${p.ticker}</div><div class="name">${p.shares} shares @ $${p.avg_cost}</div></div>
          <div><div class="price">$${p.current_price}</div><div class="change ${clr(p.pnl_pct)}">${pct(p.pnl_pct)}</div></div>
        </div>
        <div class="card-row" style="margin-top:8px">
          <span style="font-size:13px;color:var(--muted)">Value: $${p.market_value.toFixed(2)}</span>
          <span style="font-size:13px;font-weight:700;color:${p.pnl>=0?'var(--green)':'var(--red)'}">${p.pnl>=0?'+':''}$${p.pnl.toFixed(2)}</span>
        </div>
        <button onclick="removePosition(${i})" style="background:none;border:none;color:var(--red);font-size:12px;margin-top:8px;cursor:pointer">Remove</button>
      </div>`).join('');
  }catch(e){
    document.getElementById('port-list').innerHTML='<div class="loader">Failed to calculate P&L</div>';
  }
}

function removePosition(i){
  positions.splice(i,1);
  localStorage.setItem('sp_positions',JSON.stringify(positions));
  calcPnl();
}

// ── INIT ──────────────────────────────────────────────────────────────────────
loadWatch();
</script>
</body>
</html>'''

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
