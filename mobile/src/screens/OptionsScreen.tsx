import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path, Line, Text as SvgText } from "react-native-svg";
import { getOptions, getPayoff, OptionsData, PayoffData } from "../services/api";
import { colors, radius } from "../components/Theme";

const W = Dimensions.get("window").width - 48;
const STRATEGIES = ["covered_call", "cash_secured_put", "collar"];

export function OptionsScreen({ route, navigation }: any) {
  const { ticker } = route.params;
  const [opts, setOpts] = useState<OptionsData | null>(null);
  const [payoff, setPayoff] = useState<PayoffData | null>(null);
  const [strategy, setStrategy] = useState("covered_call");
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [payoffLoading, setPayoffLoading] = useState(false);

  useEffect(() => {
    getOptions(ticker, expiry)
      .then((d) => {
        setOpts(d);
        if (!expiry) setExpiry(d.expiry);
        loadPayoff(d, strategy);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [ticker, expiry]);

  const loadPayoff = async (data: OptionsData, strat: string) => {
    if (!data.call_wall) return;
    setPayoffLoading(true);
    try {
      const strike = strat === "covered_call" ? (data.call_wall || data.spot * 1.05) : (data.put_wall || data.spot * 0.95);
      const iv = 35;
      const premium = 2.5;
      const p = await getPayoff(ticker, strike, premium, data.days_to_expiry, iv, strat);
      setPayoff(p);
    } catch (e) {
      console.error(e);
    } finally {
      setPayoffLoading(false);
    }
  };

  const switchStrategy = (s: string) => {
    setStrategy(s);
    if (opts) loadPayoff(opts, s);
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.green} /></View>;
  }

  if (!opts) {
    return <View style={styles.center}><Text style={{ color: colors.textMuted }}>No options data</Text></View>;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {/* Nav */}
        <View style={styles.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>{ticker} Options</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Spot + walls */}
        <View style={styles.heroRow}>
          <Stat label="Spot" value={`$${opts.spot.toFixed(2)}`} />
          <Stat label="Call Wall" value={opts.call_wall ? `$${opts.call_wall}` : "—"} color={colors.green} />
          <Stat label="Put Wall" value={opts.put_wall ? `$${opts.put_wall}` : "—"} color={colors.red} />
          <Stat label="DTE" value={String(opts.days_to_expiry)} />
        </View>

        {/* Expiry picker */}
        <Text style={styles.label}>Expiry</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.expiryScroll}>
          {opts.expiries.map((e) => (
            <TouchableOpacity
              key={e}
              style={[styles.expiryBtn, expiry === e && styles.expiryBtnActive]}
              onPress={() => setExpiry(e)}
            >
              <Text style={[styles.expiryText, expiry === e && styles.expiryTextActive]}>{e}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Strategy picker */}
        <Text style={styles.label}>Strategy</Text>
        <View style={styles.stratRow}>
          {STRATEGIES.map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.stratBtn, strategy === s && styles.stratBtnActive]}
              onPress={() => switchStrategy(s)}
            >
              <Text style={[styles.stratText, strategy === s && styles.stratTextActive]}>
                {s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Greeks */}
        {opts.greeks && (
          <>
            <Text style={styles.label}>Greeks</Text>
            <View style={styles.greeksGrid}>
              <Greek label="Δ Delta" value={opts.greeks.delta} />
              <Greek label="Γ Gamma" value={opts.greeks.gamma} />
              <Greek label="Θ Theta" value={opts.greeks.theta} color={colors.red} />
              <Greek label="ν Vega" value={opts.greeks.vega} />
              <Greek label="P(ITM)" value={`${opts.greeks.prob_itm}%`} />
            </View>
          </>
        )}

        {/* Payoff chart */}
        <Text style={styles.label}>Payoff at Expiry</Text>
        {payoffLoading ? (
          <ActivityIndicator color={colors.green} style={{ marginVertical: 40 }} />
        ) : payoff ? (
          <PayoffChart data={payoff} />
        ) : null}

        {/* Top calls */}
        <Text style={styles.label}>Top Calls</Text>
        <View style={styles.table}>
          <TableHeader />
          {opts.calls.slice(0, 8).map((c, i) => (
            <TableRow key={i} row={c} spot={opts.spot} type="call" />
          ))}
        </View>

        {/* Top puts */}
        <Text style={styles.label}>Top Puts</Text>
        <View style={styles.table}>
          <TableHeader />
          {opts.puts.slice(0, 8).map((p, i) => (
            <TableRow key={i} row={p} spot={opts.spot} type="put" />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PayoffChart({ data }: { data: PayoffData }) {
  const H = 160;
  const allVals = [...data.expiry_payoff, ...data.today_payoff];
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;

  const toY = (v: number) => H - ((v - minV) / range) * (H - 20) - 10;
  const toX = (i: number) => (i / (data.prices.length - 1)) * W;

  const expiryPath = data.expiry_payoff
    .map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`)
    .join(" ");

  const todayPath = data.today_payoff
    .map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`)
    .join(" ");

  // zero line
  const zeroY = toY(0);
  const spotIdx = data.prices.findIndex((p) => p >= data.spot);
  const spotX = spotIdx >= 0 ? toX(spotIdx) : W / 2;

  return (
    <View style={styles.chartBox}>
      <Svg width={W} height={H}>
        <Line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke={colors.border} strokeWidth={1} strokeDasharray="4 4" />
        <Line x1={spotX} y1={0} x2={spotX} y2={H} stroke={colors.textDim} strokeWidth={1} strokeDasharray="4 4" />
        <Path d={todayPath} stroke={colors.green} strokeWidth={1.5} fill="none" strokeDasharray="5 3" />
        <Path d={expiryPath} stroke={colors.green} strokeWidth={2.5} fill="none" />
        <SvgText x={4} y={14} fill={colors.textMuted} fontSize={10}>At expiry</SvgText>
        <SvgText x={4} y={26} fill={colors.green} fontSize={10} opacity={0.6}>Today (BS)</SvgText>
      </Svg>
    </View>
  );
}

function TableHeader() {
  return (
    <View style={[styles.tableRow, { backgroundColor: colors.surface }]}>
      {["Strike", "Bid", "Ask", "IV%", "OI"].map((h) => (
        <Text key={h} style={styles.tableHead}>{h}</Text>
      ))}
    </View>
  );
}

function TableRow({ row, spot, type }: { row: any; spot: number; type: string }) {
  const itm = type === "call" ? row.strike <= spot : row.strike >= spot;
  return (
    <View style={[styles.tableRow, itm && styles.tableRowITM]}>
      <Text style={[styles.tableCell, { color: itm ? colors.green : colors.text }]}>
        ${row.strike}
      </Text>
      <Text style={styles.tableCell}>${row.bid?.toFixed(2) || "—"}</Text>
      <Text style={styles.tableCell}>${row.ask?.toFixed(2) || "—"}</Text>
      <Text style={styles.tableCell}>{row.impliedVolatility ? (row.impliedVolatility * 100).toFixed(0) + "%" : "—"}</Text>
      <Text style={styles.tableCell}>{row.openInterest?.toLocaleString() || "—"}</Text>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

function Greek({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <View style={styles.greekCard}>
      <Text style={styles.greekLabel}>{label}</Text>
      <Text style={[styles.greekValue, color ? { color } : {}]}>
        {typeof value === "number" ? value.toFixed(3) : value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  navTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  heroRow: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 20, paddingVertical: 16, backgroundColor: colors.surface, marginHorizontal: 20, borderRadius: radius.lg, marginBottom: 20, borderWidth: 1, borderColor: colors.border },
  stat: { alignItems: "center" },
  statLabel: { color: colors.textMuted, fontSize: 10, textTransform: "uppercase", marginBottom: 4 },
  statValue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 24, marginBottom: 10, marginTop: 20 },
  expiryScroll: { paddingLeft: 24, marginBottom: 4 },
  expiryBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.surface, marginRight: 8, borderWidth: 1, borderColor: colors.border },
  expiryBtnActive: { backgroundColor: colors.green, borderColor: colors.green },
  expiryText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  expiryTextActive: { color: colors.bg },
  stratRow: { flexDirection: "row", paddingHorizontal: 24, gap: 8, flexWrap: "wrap" },
  stratBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  stratBtnActive: { backgroundColor: colors.greenDim, borderColor: colors.green },
  stratText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  stratTextActive: { color: colors.green },
  greeksGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 24, gap: 10 },
  greekCard: { flex: 1, minWidth: "28%", backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  greekLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 4 },
  greekValue: { color: colors.text, fontSize: 16, fontWeight: "700" },
  chartBox: { marginHorizontal: 24, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: colors.border },
  table: { marginHorizontal: 24, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  tableRow: { flexDirection: "row", paddingVertical: 10, paddingHorizontal: 8 },
  tableRowITM: { backgroundColor: colors.greenDim },
  tableHead: { flex: 1, color: colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  tableCell: { flex: 1, color: colors.text, fontSize: 12 },
});
