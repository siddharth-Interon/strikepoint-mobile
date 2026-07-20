import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Modal, Animated, Dimensions, FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { analyzeStock, getOptions, OptionsData, StockData } from "../services/api";
import { colors, radius } from "../components/Theme";

const SW = Dimensions.get("window").width;

// ── RISK CONFIG ───────────────────────────────────────────────────────────────
const RISK_LEVELS = [
  { key: "highest", label: "Highest Risk", emoji: "🚀", color: "#ff3b30", otm: 2,  expIdx: 0, holdDays: "3–5 days",  upside: "+80–200%",  note: "Deep OTM, short expiry. Most contracts expire worthless but winners are huge." },
  { key: "high",    label: "High Risk",    emoji: "📈", color: "#ff9f0a", otm: 1,  expIdx: 1, holdDays: "1–2 weeks", upside: "+40–90%",   note: "Slightly OTM. Good balance of cost and leverage. Watch momentum closely." },
  { key: "moderate",label: "Moderate",     emoji: "⚖️", color: "#ffd60a", otm: 0,  expIdx: 2, holdDays: "2–3 weeks", upside: "+20–50%",   note: "Near-the-money. Moves with the stock, more forgiving on timing." },
  { key: "low",     label: "Low Risk",     emoji: "🛡️", color: "#30d158", otm: -1, expIdx: 3, holdDays: "1–2 months",upside: "+10–30%",   note: "ITM option. High delta, acts like owning shares but with less capital." },
  { key: "lowest",  label: "Lowest Risk",  emoji: "💤", color: "#636366", otm: -2, expIdx: 4, holdDays: "2–3 months",upside: "+5–15%",    note: "Deep ITM LEAPS-style. Slow and steady, minimal time decay risk." },
] as const;
type RiskKey = typeof RISK_LEVELS[number]["key"];

// ── TICKER CONTEXT ────────────────────────────────────────────────────────────
const TICKER_CTX: Record<string, { trend: "bullish"|"bearish"|"neutral"; reason: string; catalyst: string }> = {
  AAPL: { trend:"bullish",  reason:"Strong iPhone 16 demand cycle, services revenue accelerating. Trading above 20-day SMA.", catalyst:"Earnings Aug 1" },
  TSLA: { trend:"bearish",  reason:"Delivery numbers missed estimates. RSI overbought at 72. Watch for pullback to $230 support.", catalyst:"Earnings Jul 23" },
  NVDA: { trend:"bullish",  reason:"Blackwell GPU demand exceeding supply. AI capex spending from hyperscalers remains elevated.", catalyst:"Earnings Aug 28" },
  MSFT: { trend:"bullish",  reason:"Azure cloud growth re-accelerating. Copilot monetization gaining traction.", catalyst:"Earnings Jul 30" },
  AMZN: { trend:"bullish",  reason:"AWS growth at 17% YoY, margins expanding. Prime ad revenue outperforming.", catalyst:"Earnings Aug 1" },
  META: { trend:"neutral",  reason:"Ad revenue strong but Reality Labs losses weigh on sentiment. RSI at 51 — no clear direction.", catalyst:"Earnings Jul 30" },
  PLTR: { trend:"bullish",  reason:"US government AI contracts expanding. AIP platform gaining enterprise traction rapidly.", catalyst:"Earnings Aug 4" },
  COIN: { trend:"bearish",  reason:"Crypto market cooling after recent highs. Regulatory uncertainty in EU.", catalyst:"Earnings Jul 31" },
};

// ── BLACK-SCHOLES ─────────────────────────────────────────────────────────────
function normCDF(x: number): number {
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return 0.5 * (1 + sign * y);
}

function bsPrice(S: number, K: number, T: number, iv: number, isCall: boolean): number {
  if (T <= 0) return isCall ? Math.max(0, S-K) : Math.max(0, K-S);
  const sigma = iv / 100;
  const d1 = (Math.log(S/K) + 0.5*sigma*sigma*T) / (sigma*Math.sqrt(T));
  const d2 = d1 - sigma*Math.sqrt(T);
  if (isCall) return S*normCDF(d1) - K*normCDF(d2);
  return K*normCDF(-d2) - S*normCDF(-d1);
}

// ── HOLD EXTENSION DATES ──────────────────────────────────────────────────────
const EXTEND_DATES = [
  { label:"2 weeks",  days:14 },
  { label:"1 month",  days:30 },
  { label:"2 months", days:60 },
  { label:"3 months", days:90 },
  { label:"6 months", days:180 },
  { label:"9 months", days:270 },
  { label:"1 year",   days:365 },
  { label:"18 months",days:548 },
];

// ── TYPES ─────────────────────────────────────────────────────────────────────
interface ChainRow {
  strike: number;
  c_bid: number;
  c_ask: number;
  p_bid: number;
  p_ask: number;
  iv: number;
  atm: boolean;
}

interface HeldOption {
  ticker: string;
  strike: number;
  type: "C"|"P";
  premium: number;
  iv: number;
  spot: number;
}

// ── MAIN SCREEN ───────────────────────────────────────────────────────────────
export function OptionsScreen({ route, navigation }: any) {
  const { ticker } = route.params ?? { ticker: "AAPL" };

  const [opts, setOpts]           = useState<OptionsData | null>(null);
  const [stock, setStock]         = useState<StockData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [selExpiry, setSelExpiry] = useState<string>("");
  const [risk, setRisk]           = useState<RiskKey>("moderate");
  const [heldOpt, setHeldOpt]     = useState<HeldOption | null>(null);
  const [extDays, setExtDays]     = useState(30);
  const [sheetVisible, setSheetVisible] = useState(false);
  const sheetAnim = useRef(new Animated.Value(400)).current;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getOptions(ticker).catch(() => null),
      analyzeStock(ticker).catch(() => null),
    ]).then(([o, s]) => {
      setOpts(o);
      setStock(s);
      if (o?.expiry) setSelExpiry(o.expiry);
    }).finally(() => setLoading(false));
  }, [ticker]);

  const openSheet = (opt: HeldOption) => {
    setHeldOpt(opt);
    setExtDays(30);
    setSheetVisible(true);
    sheetAnim.setValue(500);
    Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }).start();
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, { toValue: 500, duration: 220, useNativeDriver: true }).start(() => setSheetVisible(false));
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={colors.green} /></View>;
  }

  const spot     = opts?.spot ?? stock?.price ?? 0;
  const expiries = opts?.expiries ?? [];
  const ctx      = TICKER_CTX[ticker] ?? { trend:"neutral", reason:"Analyzing price action and volume.", catalyst:"Check earnings calendar" };
  const isBull   = ctx.trend === "bullish" || (ctx.trend === "neutral" && (stock?.direction ?? "BUY") !== "SELL");
  const riskCfg  = RISK_LEVELS.find(r => r.key === risk)!;

  // Build chain from API data
  const chain = buildChain(opts, spot, selExpiry);

  // Find ATM index and recommended index
  const atmIdx = chain.findIndex(r => r.atm);
  const safeAtm = atmIdx === -1 ? Math.floor(chain.length / 2) : atmIdx;
  const recIdx  = Math.max(0, Math.min(chain.length - 1, safeAtm - riskCfg.otm));

  return (
    <SafeAreaView style={s.safe}>
      {/* NAV */}
      <View style={s.nav}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.navTitle}>{ticker} Options</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* SPOT PRICE HERO */}
        <View style={s.hero}>
          <Text style={s.heroPrice}>${spot.toFixed(2)}</Text>
          {stock && (
            <Text style={[s.heroChg, { color: stock.change_pct >= 0 ? colors.green : colors.red }]}>
              {stock.change_pct >= 0 ? "+" : ""}{stock.change_pct.toFixed(2)}% today
            </Text>
          )}
        </View>

        {/* RISK PICKER */}
        <Text style={s.sectionLabel}>Risk Level</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.riskRow}>
          {RISK_LEVELS.map(r => (
            <TouchableOpacity
              key={r.key}
              style={[s.riskBtn, risk === r.key && { borderColor: r.color, backgroundColor: r.color + "18" }]}
              onPress={() => setRisk(r.key)}
            >
              <Text style={s.riskEmoji}>{r.emoji}</Text>
              <Text style={[s.riskLabel, risk === r.key && { color: r.color }]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* RECOMMENDATION CARD */}
        {chain.length > 0 && (
          <RecommendationCard
            ticker={ticker}
            chain={chain}
            recIdx={recIdx}
            riskCfg={riskCfg}
            isBull={isBull}
            ctx={ctx}
            stock={stock}
            expiries={expiries}
          />
        )}

        {/* EXPIRY PICKER */}
        <Text style={s.sectionLabel}>Expiration Date</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.expiryRow}>
          {expiries.map(e => (
            <TouchableOpacity
              key={e}
              style={[s.expiryBtn, selExpiry === e && s.expiryBtnActive]}
              onPress={() => setSelExpiry(e)}
            >
              <Text style={[s.expiryText, selExpiry === e && s.expiryTextActive]}>{e}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* OPTIONS CHAIN */}
        <View style={s.chainWrap}>
          <View style={s.chainTitleRow}>
            <Text style={s.chainTitle}>{ticker} Options Chain</Text>
            <Text style={s.chainSub}>· {selExpiry}  ★ = Recommendation</Text>
          </View>

          {/* Table header */}
          <View style={s.chainHeader}>
            <View style={s.callSide}>
              <Text style={[s.colHead, { color: colors.green }]}>CALL (C)</Text>
              <Text style={s.colSubHead}>Bet stock goes UP</Text>
            </View>
            <View style={s.strikeSide}>
              <Text style={[s.colHead, { color: colors.textMuted }]}>STRIKE</Text>
            </View>
            <View style={s.putSide}>
              <Text style={[s.colHead, { color: colors.red }]}>PUT (P)</Text>
              <Text style={s.colSubHead}>Bet stock goes DOWN</Text>
            </View>
          </View>

          <View style={s.subHeader}>
            <Text style={[s.subCol, { textAlign: "right", flex: 1 }]}>BID</Text>
            <Text style={[s.subCol, { textAlign: "right", flex: 1 }]}>ASK</Text>
            <Text style={[s.subCol, { textAlign: "right", flex: 0.7 }]}>IV</Text>
            <Text style={[s.subCol, { textAlign: "center", flex: 1.1 }]}></Text>
            <Text style={[s.subCol, { textAlign: "left",  flex: 0.7 }]}>IV</Text>
            <Text style={[s.subCol, { textAlign: "left",  flex: 1 }]}>BID</Text>
            <Text style={[s.subCol, { textAlign: "left",  flex: 1 }]}>ASK</Text>
          </View>

          {chain.map((row, i) => {
            const isRec = i === recIdx;
            const isAtm = row.atm;
            return (
              <ChainRow
                key={row.strike}
                row={row}
                isRec={isRec}
                isAtm={isAtm}
                isBull={isBull}
                ticker={ticker}
                spot={spot}
                onSelect={openSheet}
              />
            );
          })}

          {/* Legend */}
          <View style={s.legend}>
            <Text style={s.legendItem}><Text style={{ color: colors.green }}>C</Text> = Call — buy if stock rises</Text>
            <Text style={s.legendItem}><Text style={{ color: colors.red }}>P</Text> = Put — buy if stock falls</Text>
            <Text style={s.legendItem}><Text style={{ color: colors.yellow }}>◆</Text> ATM — closest to stock price</Text>
            <Text style={s.legendItem}><Text style={{ color: colors.green }}>★</Text> Recommendation — tap row to simulate hold</Text>
          </View>
        </View>

      </ScrollView>

      {/* HOLD EXTENSION BOTTOM SHEET */}
      <Modal visible={sheetVisible} transparent animationType="none" onRequestClose={closeSheet}>
        <TouchableOpacity style={s.sheetOverlay} activeOpacity={1} onPress={closeSheet} />
        <Animated.View style={[s.sheet, { transform: [{ translateY: sheetAnim }] }]}>
          {/* Handle */}
          <View style={s.sheetHandle} />

          {/* Sheet header */}
          <View style={s.sheetHeader}>
            <View>
              <Text style={s.sheetTitle}>📅 What if I hold longer?</Text>
              {heldOpt && (
                <Text style={s.sheetSubtitle}>
                  {heldOpt.ticker} ${heldOpt.strike} {heldOpt.type === "C" ? "Call" : "Put"}  ·  Entry ${heldOpt.premium.toFixed(2)} (${(heldOpt.premium * 100).toFixed(0)}/contract)
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={closeSheet} style={s.sheetClose}>
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Date picker */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.extDatesRow}>
            {EXTEND_DATES.map(d => (
              <TouchableOpacity
                key={d.days}
                style={[s.extDateBtn, extDays === d.days && s.extDateBtnActive]}
                onPress={() => setExtDays(d.days)}
              >
                <Text style={[s.extDateText, extDays === d.days && s.extDateTextActive]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* P&L table */}
          {heldOpt && <HoldTable opt={heldOpt} days={extDays} />}
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
}

// ── RECOMMENDATION CARD ───────────────────────────────────────────────────────
function RecommendationCard({ ticker, chain, recIdx, riskCfg, isBull, ctx, stock, expiries }: any) {
  const rec       = chain[recIdx];
  const typeChar  = isBull ? "C" : "P";
  const action    = isBull ? "BUY CALL" : "BUY PUT";
  const actionCol = isBull ? colors.green : colors.red;
  const trendCol  = ctx.trend==="bullish" ? colors.green : ctx.trend==="bearish" ? colors.red : colors.yellow;
  const trendLbl  = ctx.trend==="bullish" ? "↑ Bullish" : ctx.trend==="bearish" ? "↓ Bearish" : "→ Neutral";
  const premium   = isBull ? rec.c_ask : rec.p_ask;
  const cost      = Math.round(premium * 100);

  // Pick suggested expiry based on risk
  const suggestedExp = expiries[Math.min(riskCfg.expIdx, expiries.length - 1)] ?? expiries[0] ?? "";

  return (
    <View style={[rc.card, { borderColor: riskCfg.color + "44" }]}>
      {/* Card header */}
      <View style={rc.header}>
        <View style={[rc.badge, { backgroundColor: riskCfg.color + "22", borderColor: riskCfg.color + "55" }]}>
          <Text style={[rc.badgeText, { color: riskCfg.color }]}>🤖 Recommendation</Text>
        </View>
        <Text style={rc.headerSub}>Based on your risk level · updated live</Text>
      </View>

      {/* Trade summary */}
      <View style={rc.tradeRow}>
        <View style={{ flex: 1 }}>
          <Text style={rc.tradePrimary}>{ticker} ${rec.strike} {typeChar}</Text>
          <Text style={rc.tradeSub}>Suggested expiry: {suggestedExp}  ·  ~${cost}/contract</Text>
        </View>
        <View style={{ gap: 5, alignItems: "flex-end" }}>
          <View style={[rc.actionBadge, { backgroundColor: actionCol + "22", borderColor: actionCol + "44" }]}>
            <Text style={[rc.actionText, { color: actionCol }]}>{action}</Text>
          </View>
          <View style={[rc.trendBadge, { backgroundColor: trendCol + "18", borderColor: trendCol + "30" }]}>
            <Text style={[rc.trendText, { color: trendCol }]}>{trendLbl}</Text>
          </View>
        </View>
      </View>

      {/* Why this trade */}
      <View style={rc.reasonBox}>
        <Text style={rc.reasonTitle}>Why this trade?</Text>
        <Text style={rc.reasonText}>{ctx.reason}</Text>
      </View>

      {/* Stats grid */}
      <View style={rc.statsGrid}>
        <StatBox label="Upside"     value={riskCfg.upside}                  valueColor={colors.green} />
        <StatBox label="Hold"       value={riskCfg.holdDays} />
        <StatBox label="Confidence" value={stock ? `${stock.confidence}%` : "—"} valueColor={actionCol} />
        <StatBox label="RSI"
          value={stock ? stock.rsi.toFixed(1) : "—"}
          valueColor={stock && stock.rsi > 70 ? colors.red : stock && stock.rsi < 30 ? colors.green : colors.text}
        />
      </View>

      {/* Catalyst */}
      <View style={rc.catalystRow}>
        <Text style={rc.catalystIcon}>📅</Text>
        <Text style={rc.catalystText}>
          <Text style={{ color: colors.yellow, fontWeight: "700" }}>{ctx.catalyst}</Text>
          {" "}— consider closing before this date to avoid earnings risk.
        </Text>
      </View>

      <Text style={rc.disclaimer}>⚠️ Not financial advice. Always do your own research.</Text>
    </View>
  );
}

// ── CHAIN ROW ─────────────────────────────────────────────────────────────────
function ChainRow({ row, isRec, isAtm, isBull, ticker, spot, onSelect }: {
  row: ChainRow; isRec: boolean; isAtm: boolean; isBull: boolean;
  ticker: string; spot: number;
  onSelect: (opt: HeldOption) => void;
}) {
  const rowBg   = isRec ? colors.green + "14" : isAtm ? "#ffffff08" : "transparent";
  const borderT = isRec ? colors.green + "55" : "transparent";
  const borderB = isRec ? colors.green + "55" : colors.border;
  const strikeColor = isAtm ? colors.yellow : colors.textDim;

  const handleCallPress = () => onSelect({ ticker, strike: row.strike, type: "C", premium: row.c_ask, iv: row.iv, spot });
  const handlePutPress  = () => onSelect({ ticker, strike: row.strike, type: "P", premium: row.p_ask, iv: row.iv + 2, spot });

  return (
    <View style={[cr.row, { backgroundColor: rowBg, borderTopColor: borderT, borderBottomColor: borderB }]}>
      {/* CALL side — tappable */}
      <TouchableOpacity style={cr.callSide} onPress={handleCallPress} activeOpacity={0.6}>
        <Text style={[cr.num, { color: colors.green, flex: 1, textAlign: "right" }]}>{row.c_bid.toFixed(2)}</Text>
        <Text style={[cr.num, { flex: 1, textAlign: "right" }]}>{row.c_ask.toFixed(2)}</Text>
        <Text style={[cr.num, { color: colors.textMuted, flex: 0.7, textAlign: "right" }]}>{row.iv}%</Text>
      </TouchableOpacity>

      {/* STRIKE */}
      <View style={cr.strikeSide}>
        <Text style={[cr.strikeText, { color: strikeColor }]}>
          ${row.strike}{isRec ? " ★" : isAtm ? " ◆" : ""}
        </Text>
      </View>

      {/* PUT side — tappable */}
      <TouchableOpacity style={cr.putSide} onPress={handlePutPress} activeOpacity={0.6}>
        <Text style={[cr.num, { color: colors.textMuted, flex: 0.7, textAlign: "left" }]}>{(row.iv+2)}%</Text>
        <Text style={[cr.num, { color: colors.red, flex: 1, textAlign: "left" }]}>{row.p_bid.toFixed(2)}</Text>
        <Text style={[cr.num, { flex: 1, textAlign: "left" }]}>{row.p_ask.toFixed(2)}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── HOLD TABLE ────────────────────────────────────────────────────────────────
function HoldTable({ opt, days }: { opt: HeldOption; days: number }) {
  const { strike, type, premium, iv, spot } = opt;
  const isCall = type === "C";
  const T = days / 365;
  const moves = [-30, -20, -10, -5, 0, 5, 10, 20, 30];

  const rows = moves.map(pct => {
    const newSpot   = spot * (1 + pct / 100);
    const projPrice = bsPrice(newSpot, strike, T, iv, isCall);
    const pnl       = (projPrice - premium) * 100;
    const pnlPct    = ((projPrice - premium) / premium) * 100;
    return { pct, newSpot, projPrice, pnl, pnlPct };
  });

  return (
    <ScrollView style={ht.scroll} showsVerticalScrollIndicator={false}>
      <Text style={ht.tableTitle}>
        If held <Text style={{ color: colors.yellow }}>+{days} more days</Text> — projected P&L per contract
      </Text>
      <View style={ht.headerRow}>
        <Text style={[ht.head, { flex: 1.1 }]}>Price</Text>
        <Text style={[ht.head, { flex: 0.9 }]}>Move</Text>
        <Text style={[ht.head, { flex: 1, textAlign: "right" }]}>Value</Text>
        <Text style={[ht.head, { flex: 1.2, textAlign: "right" }]}>P&L</Text>
      </View>
      {rows.map(r => {
        const isPos = r.pnl >= 0;
        const col   = isPos ? colors.green : colors.red;
        const bg    = r.pct === 0 ? "#ffffff08" : "transparent";
        const moveLbl = r.pct === 0 ? "→ flat" : (r.pct > 0 ? `↑ +${r.pct}%` : `↓ ${r.pct}%`);
        const moveCol = r.pct === 0 ? colors.textMuted : r.pct > 0 ? colors.green : colors.red;
        return (
          <View key={r.pct} style={[ht.row, { backgroundColor: bg }]}>
            <Text style={[ht.cell, { flex: 1.1, fontWeight: "600" }]}>${r.newSpot.toFixed(0)}</Text>
            <Text style={[ht.cell, { flex: 0.9, color: moveCol }]}>{moveLbl}</Text>
            <Text style={[ht.cell, { flex: 1, textAlign: "right" }]}>${r.projPrice.toFixed(2)}</Text>
            <View style={{ flex: 1.2, alignItems: "flex-end" }}>
              <Text style={[ht.cell, { color: col, fontWeight: "800" }]}>
                {isPos ? "+" : ""}${Math.round(r.pnl)}
              </Text>
              <Text style={[ht.pctText, { color: col }]}>
                {isPos ? "+" : ""}{Math.round(r.pnlPct)}%
              </Text>
            </View>
          </View>
        );
      })}
      <Text style={ht.disclaimer}>Estimates assume constant IV. Not financial advice.</Text>
    </ScrollView>
  );
}

// ── STAT BOX ──────────────────────────────────────────────────────────────────
function StatBox({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={sb.box}>
      <Text style={sb.label}>{label}</Text>
      <Text style={[sb.value, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

// ── BUILD CHAIN FROM API DATA ─────────────────────────────────────────────────
function buildChain(opts: OptionsData | null, spot: number, expiry: string): ChainRow[] {
  if (!opts || !opts.calls?.length || !opts.puts?.length) return [];

  // Merge calls and puts by strike
  const callMap: Record<number, any> = {};
  const putMap:  Record<number, any> = {};
  opts.calls.forEach(c => { callMap[c.strike] = c; });
  opts.puts.forEach(p  => { putMap[p.strike]  = p; });

  const strikes = Array.from(new Set([...Object.keys(callMap), ...Object.keys(putMap)]))
    .map(Number).sort((a, b) => a - b);

  // Keep 9 strikes centered around ATM
  const atmStrike = strikes.reduce((best, s) => Math.abs(s - spot) < Math.abs(best - spot) ? s : best, strikes[0]);
  const atmIdx    = strikes.indexOf(atmStrike);
  const start     = Math.max(0, atmIdx - 4);
  const slice     = strikes.slice(start, start + 9);

  return slice.map(strike => {
    const c   = callMap[strike] ?? {};
    const p   = putMap[strike]  ?? {};
    const iv  = c.impliedVolatility ? Math.round(c.impliedVolatility * 100) : 25;
    return {
      strike,
      c_bid: c.bid  ?? 0,
      c_ask: c.ask  ?? 0,
      p_bid: p.bid  ?? 0,
      p_ask: p.ask  ?? 0,
      iv,
      atm: strike === atmStrike,
    };
  });
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.bg },
  center:       { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg },
  nav:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  navTitle:     { color: colors.text, fontSize: 17, fontWeight: "700" },
  hero:         { alignItems: "center", paddingVertical: 16 },
  heroPrice:    { color: colors.text, fontSize: 36, fontWeight: "800", letterSpacing: -1 },
  heroChg:      { fontSize: 14, fontWeight: "600", marginTop: 2 },
  sectionLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 20, marginBottom: 10, marginTop: 20 },
  riskRow:      { paddingHorizontal: 20, gap: 8 },
  riskBtn:      { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", minWidth: 90 },
  riskEmoji:    { fontSize: 18, marginBottom: 3 },
  riskLabel:    { color: colors.textMuted, fontSize: 10, fontWeight: "700", textAlign: "center" },
  expiryRow:    { paddingHorizontal: 20, gap: 8 },
  expiryBtn:    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  expiryBtnActive:   { backgroundColor: colors.green, borderColor: colors.green },
  expiryText:        { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  expiryTextActive:  { color: colors.bg },
  chainWrap:    { marginHorizontal: 16, marginTop: 20, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  chainTitleRow:{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  chainTitle:   { color: colors.text, fontSize: 12, fontWeight: "800" },
  chainSub:     { color: colors.textMuted, fontSize: 10, marginLeft: 6 },
  chainHeader:  { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  callSide:     { flex: 3, alignItems: "center" },
  strikeSide:   { flex: 1.1, alignItems: "center" },
  putSide:      { flex: 3, alignItems: "center" },
  colHead:      { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  colSubHead:   { fontSize: 8, color: colors.textMuted, marginTop: 2 },
  subHeader:    { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  subCol:       { color: colors.textMuted, fontSize: 8, fontWeight: "600", textTransform: "uppercase" },
  legend:       { padding: 12, gap: 5, borderTopWidth: 1, borderTopColor: colors.border },
  legendItem:   { color: colors.textDim, fontSize: 10, lineHeight: 16 },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet:        { backgroundColor: "#111", borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "75%", position: "absolute", bottom: 0, left: 0, right: 0 },
  sheetHandle:  { width: 40, height: 4, backgroundColor: "#333", borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 4 },
  sheetHeader:  { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetTitle:   { color: colors.yellow, fontSize: 14, fontWeight: "800" },
  sheetSubtitle:{ color: colors.textMuted, fontSize: 10, marginTop: 3 },
  sheetClose:   { backgroundColor: "#ffffff14", borderRadius: 14, width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  extDatesRow:  { paddingHorizontal: 18, paddingVertical: 12, gap: 8 },
  extDateBtn:   { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#ffd60a14", borderWidth: 1, borderColor: "#ffd60a44" },
  extDateBtnActive:  { backgroundColor: "#ffd60a30", borderColor: colors.yellow },
  extDateText:       { color: colors.yellow, fontSize: 11, fontWeight: "700" },
  extDateTextActive: { color: colors.yellow },
});

const rc = StyleSheet.create({
  card:        { marginHorizontal: 16, marginTop: 16, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, padding: 14, gap: 12 },
  header:      { gap: 3 },
  badge:       { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  badgeText:   { fontSize: 11, fontWeight: "800" },
  headerSub:   { color: colors.textMuted, fontSize: 10 },
  tradeRow:    { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  tradePrimary:{ color: colors.text, fontSize: 20, fontWeight: "900", letterSpacing: -0.5 },
  tradeSub:    { color: colors.textMuted, fontSize: 10, marginTop: 3 },
  actionBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  actionText:  { fontSize: 11, fontWeight: "800" },
  trendBadge:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  trendText:   { fontSize: 10, fontWeight: "700" },
  reasonBox:   { backgroundColor: "#ffffff06", borderRadius: 10, padding: 10, gap: 4 },
  reasonTitle: { color: colors.text, fontSize: 11, fontWeight: "700" },
  reasonText:  { color: "#ffffff99", fontSize: 11, lineHeight: 16 },
  statsGrid:   { flexDirection: "row", gap: 6 },
  catalystRow: { flexDirection: "row", gap: 8, backgroundColor: "#ffd60a0a", borderWidth: 1, borderColor: "#ffd60a22", borderRadius: 10, padding: 10, alignItems: "flex-start" },
  catalystIcon:{ fontSize: 14 },
  catalystText:{ color: "#ffffff88", fontSize: 10, lineHeight: 15, flex: 1 },
  disclaimer:  { color: colors.textDim, fontSize: 9, textAlign: "center" },
});

const cr = StyleSheet.create({
  row:      { flexDirection: "row", alignItems: "center", borderTopWidth: 0.5, borderBottomWidth: 0.5, minHeight: 40 },
  callSide: { flex: 3, flexDirection: "row", paddingHorizontal: 4, paddingVertical: 8 },
  strikeSide:{ flex: 1.1, alignItems: "center", backgroundColor: "#ffffff06", paddingVertical: 8 },
  putSide:  { flex: 3, flexDirection: "row", paddingHorizontal: 4, paddingVertical: 8 },
  num:      { color: colors.text, fontSize: 11, fontVariant: ["tabular-nums"] },
  strikeText:{ fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
});

const sb = StyleSheet.create({
  box:   { flex: 1, backgroundColor: "#00000066", borderRadius: 9, padding: 8, alignItems: "center" },
  label: { color: colors.textMuted, fontSize: 8, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  value: { color: colors.text, fontSize: 13, fontWeight: "800" },
});

const ht = StyleSheet.create({
  scroll:      { paddingHorizontal: 18, paddingTop: 4, maxHeight: 360 },
  tableTitle:  { color: colors.textMuted, fontSize: 10, marginBottom: 8 },
  headerRow:   { flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  head:        { color: colors.textMuted, fontSize: 9, fontWeight: "600", textTransform: "uppercase" },
  row:         { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  cell:        { color: colors.text, fontSize: 11, fontVariant: ["tabular-nums"] },
  pctText:     { fontSize: 8, fontWeight: "500", opacity: 0.7 },
  disclaimer:  { color: colors.textMuted, fontSize: 9, textAlign: "center", paddingVertical: 12 },
});
