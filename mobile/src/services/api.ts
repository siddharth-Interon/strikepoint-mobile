import axios from "axios";

// Change this to your deployed backend URL when live
export const BASE_URL = "http://localhost:8000";

const api = axios.create({ baseURL: BASE_URL, timeout: 15000 });

export interface StockData {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
  direction: "BUY" | "SELL" | "HOLD";
  confidence: number;
  rsi: number;
  macd: number;
  sma20: number;
  sma50: number;
  volume: number;
  market_cap?: number;
  sector?: string;
}

export interface PricePoint {
  date: string;
  close: number;
  volume: number;
}

export interface OptionsData {
  ticker: string;
  spot: number;
  expiry: string;
  expiries: string[];
  days_to_expiry: number;
  call_wall?: number;
  put_wall?: number;
  calls: any[];
  puts: any[];
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    prob_itm: number;
  };
}

export interface PayoffData {
  prices: number[];
  expiry_payoff: number[];
  today_payoff: number[];
  spot: number;
}

export interface PortfolioPosition {
  ticker: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  cost_basis: number;
  market_value: number;
  pnl: number;
  pnl_pct: number;
}

export const analyzeStock = (ticker: string): Promise<StockData> =>
  api.get(`/analyze/${ticker}`).then((r) => r.data);

export const getHistory = (ticker: string, period = "1mo"): Promise<PricePoint[]> =>
  api.get(`/history/${ticker}`, { params: { period } }).then((r) => r.data);

export const scanStocks = (tickers?: string): Promise<StockData[]> =>
  api.get("/scan", tickers ? { params: { tickers } } : {}).then((r) => r.data);

export const getOptions = (ticker: string, expiry?: string): Promise<OptionsData> =>
  api.get(`/options/${ticker}`, expiry ? { params: { expiry } } : {}).then((r) => r.data);

export const getPayoff = (
  ticker: string,
  strike: number,
  premium: number,
  days: number,
  iv: number,
  strategy = "covered_call"
): Promise<PayoffData> =>
  api
    .get(`/options/${ticker}/payoff`, { params: { strike, premium, days, iv, strategy } })
    .then((r) => r.data);

export const getPortfolioPnl = (
  items: { ticker: string; shares: number; avg_cost: number }[]
): Promise<{ positions: PortfolioPosition[]; total_cost: number; total_value: number; total_pnl: number; total_pnl_pct: number }> =>
  api.post("/portfolio/pnl", items).then((r) => r.data);
