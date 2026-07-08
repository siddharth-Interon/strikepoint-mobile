import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { analyzeStock, getHistory, StockData, PricePoint } from "../services/api";
import { SignalBadge } from "../components/SignalBadge";
import { PriceChart } from "../components/PriceChart";
import { colors, radius } from "../components/Theme";

const PERIODS = ["1wk", "1mo", "3mo", "6mo", "1y"];

export function DetailScreen({ route, navigation }: any) {
  const { ticker, data: initialData } = route.params;
  const [data, setData] = useState<StockData | null>(initialData || null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [period, setPeriod] = useState("1mo");
  const [loading, setLoading] = useState(!initialData);

  useEffect(() => {
    if (!initialData) {
      analyzeStock(ticker).then(setData).catch(console.error).finally(() => setLoading(false));
    }
    getHistory(ticker, period).then(setHistory).catch(console.error);
  }, [ticker, period]);

  if (loading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  const closes = history.map((h) => h.close);
  const positive = data.change_pct >= 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {/* Nav */}
        <View style={styles.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.optionsBtn}
            onPress={() => navigation.navigate("Options", { ticker })}
          >
            <Text style={styles.optionsBtnText}>Options →</Text>
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.ticker}>{data.ticker}</Text>
          <Text style={styles.name}>{data.name}</Text>
          <Text style={styles.price}>${data.price.toFixed(2)}</Text>
          <View style={styles.changeRow}>
            <Ionicons
              name={positive ? "trending-up" : "trending-down"}
              size={16}
              color={positive ? colors.green : colors.red}
            />
            <Text style={[styles.change, { color: positive ? colors.green : colors.red }]}>
              {positive ? "+" : ""}{data.change_pct}% today
            </Text>
          </View>
          <View style={{ marginTop: 12 }}>
            <SignalBadge direction={data.direction} confidence={data.confidence} size="lg" />
          </View>
        </View>

        {/* Chart */}
        <View style={styles.chartWrap}>
          <PriceChart data={closes} positive={positive} height={120} />
        </View>

        {/* Period picker */}
        <View style={styles.periodRow}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                {p.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Indicators */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Technical Indicators</Text>
          <View style={styles.grid}>
            <Metric label="RSI" value={data.rsi.toFixed(1)}
              color={data.rsi > 70 ? colors.red : data.rsi < 30 ? colors.green : colors.text} />
            <Metric label="MACD" value={data.macd.toFixed(3)}
              color={data.macd > 0 ? colors.green : colors.red} />
            <Metric label="SMA 20" value={`$${data.sma20.toFixed(2)}`} />
            <Metric label="SMA 50" value={`$${data.sma50.toFixed(2)}`} />
          </View>
        </View>

        {/* Volume */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Volume</Text>
          <Text style={styles.metricValue}>{data.volume.toLocaleString()}</Text>
        </View>

        {data.sector && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sector</Text>
            <Text style={styles.metricValue}>{data.sector}</Text>
          </View>
        )}

        {/* Signal explanation */}
        <View style={styles.signalBox}>
          <Text style={styles.signalTitle}>
            Why {data.direction}?
          </Text>
          <Text style={styles.signalText}>
            {data.direction === "BUY"
              ? `RSI ${data.rsi.toFixed(0)} shows ${data.rsi < 50 ? "room to run" : "momentum"}, price is ${data.price > data.sma20 ? "above" : "below"} the 20-day average, and MACD ${data.macd > 0 ? "is positive — bulls are in control" : "is turning"}.`
              : data.direction === "SELL"
              ? `RSI ${data.rsi.toFixed(0)} ${data.rsi > 70 ? "is overbought" : "is elevated"}, price is ${data.price < data.sma20 ? "below the 20-day average" : "losing momentum"}, and MACD ${data.macd < 0 ? "is negative — bears dominate" : "is fading"}.`
              : `Mixed signals — RSI is neutral at ${data.rsi.toFixed(0)}, price near its moving averages. Wait for a clearer breakout before acting.`}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg },
  nav: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  optionsBtn: { backgroundColor: colors.greenDim, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.green },
  optionsBtnText: { color: colors.green, fontSize: 13, fontWeight: "600" },
  hero: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 20 },
  ticker: { color: colors.text, fontSize: 32, fontWeight: "800" },
  name: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  price: { color: colors.text, fontSize: 42, fontWeight: "700", marginTop: 12, letterSpacing: -1 },
  changeRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  change: { fontSize: 16, fontWeight: "600" },
  chartWrap: { paddingHorizontal: 24, marginBottom: 4 },
  periodRow: { flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: 12 },
  periodBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.surface },
  periodBtnActive: { backgroundColor: colors.green },
  periodText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  periodTextActive: { color: colors.bg },
  section: { paddingHorizontal: 24, paddingTop: 20 },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metric: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, flex: 1, minWidth: "44%", borderWidth: 1, borderColor: colors.border },
  metricLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  metricValue: { color: colors.text, fontSize: 18, fontWeight: "700" },
  signalBox: { margin: 24, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 18, borderWidth: 1, borderColor: colors.border },
  signalTitle: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 8 },
  signalText: { color: colors.textMuted, fontSize: 14, lineHeight: 22 },
});
