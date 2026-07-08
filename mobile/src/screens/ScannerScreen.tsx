import React, { useState, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { scanStocks, StockData } from "../services/api";
import { SignalBadge } from "../components/SignalBadge";
import { colors, radius } from "../components/Theme";

const PRESETS = {
  "Hot": "AAPL,TSLA,NVDA,MSFT,AMZN,META,AMD,GOOGL",
  "EV": "TSLA,RIVN,LCID,NIO,XPEV,FSR",
  "Crypto Adj": "COIN,HOOD,SQ,PYPL,MSTR",
  "AI": "NVDA,AMD,MSFT,GOOGL,META,PLTR,AI,SOUN",
};

export function ScannerScreen({ navigation }: any) {
  const [custom, setCustom] = useState("");
  const [results, setResults] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(false);
  const [activePreset, setActivePreset] = useState("Hot");

  const run = useCallback(async (tickers: string, preset?: string) => {
    setLoading(true);
    if (preset) setActivePreset(preset);
    try {
      const data = await scanStocks(tickers);
      setResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const renderItem = ({ item }: { item: StockData }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate("Detail", { ticker: item.ticker, data: item })}
      activeOpacity={0.75}
    >
      <View style={styles.left}>
        <Text style={styles.ticker}>{item.ticker}</Text>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.sector}>{item.sector || ""}</Text>
      </View>
      <View style={styles.mid}>
        <Text style={styles.price}>${item.price.toFixed(2)}</Text>
        <Text style={[styles.change, { color: item.change_pct >= 0 ? colors.green : colors.red }]}>
          {item.change_pct >= 0 ? "▲" : "▼"} {Math.abs(item.change_pct)}%
        </Text>
      </View>
      <View style={styles.right}>
        <SignalBadge direction={item.direction} confidence={item.confidence} />
        <Text style={styles.rsi}>RSI {item.rsi.toFixed(0)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Scanner</Text>
        {loading && <ActivityIndicator size="small" color={colors.green} />}
      </View>

      {/* Presets */}
      <View style={styles.presets}>
        {Object.entries(PRESETS).map(([name, tickers]) => (
          <TouchableOpacity
            key={name}
            style={[styles.presetBtn, activePreset === name && styles.presetBtnActive]}
            onPress={() => run(tickers, name)}
          >
            <Text style={[styles.presetText, activePreset === name && styles.presetTextActive]}>
              {name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Custom input */}
      <View style={styles.customRow}>
        <TextInput
          style={styles.customInput}
          placeholder="AAPL,TSLA,NVDA..."
          placeholderTextColor={colors.textDim}
          value={custom}
          onChangeText={setCustom}
          autoCapitalize="characters"
        />
        <TouchableOpacity
          style={styles.runBtn}
          onPress={() => { if (custom) run(custom); }}
          disabled={!custom || loading}
        >
          <Ionicons name="play" size={16} color={colors.bg} />
        </TouchableOpacity>
      </View>

      {/* Results */}
      <FlatList
        data={results}
        keyExtractor={(i) => i.ticker}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 20 }} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Pick a preset or enter tickers above</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14 },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  presets: { flexDirection: "row", paddingHorizontal: 20, gap: 8, flexWrap: "wrap", marginBottom: 12 },
  presetBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  presetBtnActive: { backgroundColor: colors.green, borderColor: colors.green },
  presetText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  presetTextActive: { color: colors.bg },
  customRow: { flexDirection: "row", paddingHorizontal: 20, gap: 10, marginBottom: 16 },
  customInput: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, height: 42, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  runBtn: { backgroundColor: colors.green, borderRadius: radius.md, width: 42, alignItems: "center", justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14 },
  left: { flex: 1.2 },
  mid: { flex: 1, alignItems: "flex-end" },
  right: { alignItems: "flex-end", gap: 4 },
  ticker: { color: colors.text, fontSize: 14, fontWeight: "700" },
  name: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  sector: { color: colors.textDim, fontSize: 10, marginTop: 1 },
  price: { color: colors.text, fontSize: 14, fontWeight: "600" },
  change: { fontSize: 12, marginTop: 2 },
  rsi: { color: colors.textDim, fontSize: 10, marginTop: 2 },
  empty: { padding: 48, alignItems: "center" },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
