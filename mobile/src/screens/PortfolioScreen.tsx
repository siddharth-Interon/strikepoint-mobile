import React, { useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getPortfolioPnl, PortfolioPosition } from "../services/api";
import { colors, radius } from "../components/Theme";

interface Position { ticker: string; shares: string; avg_cost: string }

export function PortfolioScreen({ navigation }: any) {
  const [positions, setPositions] = useState<Position[]>([
    { ticker: "", shares: "", avg_cost: "" },
  ]);
  const [results, setResults] = useState<{
    positions: PortfolioPosition[];
    total_pnl: number;
    total_pnl_pct: number;
    total_value: number;
    total_cost: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const addRow = () => setPositions([...positions, { ticker: "", shares: "", avg_cost: "" }]);
  const removeRow = (i: number) => setPositions(positions.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: keyof Position, val: string) => {
    const copy = [...positions];
    copy[i] = { ...copy[i], [field]: val };
    setPositions(copy);
  };

  const calculate = async () => {
    const valid = positions.filter((p) => p.ticker && parseFloat(p.shares) > 0 && parseFloat(p.avg_cost) > 0);
    if (!valid.length) {
      Alert.alert("Enter at least one position");
      return;
    }
    setLoading(true);
    try {
      const data = await getPortfolioPnl(
        valid.map((p) => ({ ticker: p.ticker.toUpperCase(), shares: parseFloat(p.shares), avg_cost: parseFloat(p.avg_cost) }))
      );
      setResults(data);
    } catch (e) {
      Alert.alert("Error fetching portfolio data");
    } finally {
      setLoading(false);
    }
  };

  const totalPositive = results ? results.total_pnl >= 0 : true;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {/* Nav */}
        <View style={styles.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Portfolio</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Positions input */}
        <Text style={styles.label}>Your Positions</Text>
        {positions.map((pos, i) => (
          <View key={i} style={styles.row}>
            <TextInput
              style={[styles.input, styles.inputTicker]}
              placeholder="TICKER"
              placeholderTextColor={colors.textDim}
              value={pos.ticker}
              onChangeText={(v) => updateRow(i, "ticker", v)}
              autoCapitalize="characters"
            />
            <TextInput
              style={[styles.input, styles.inputNum]}
              placeholder="Shares"
              placeholderTextColor={colors.textDim}
              value={pos.shares}
              onChangeText={(v) => updateRow(i, "shares", v)}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[styles.input, styles.inputNum]}
              placeholder="Avg $"
              placeholderTextColor={colors.textDim}
              value={pos.avg_cost}
              onChangeText={(v) => updateRow(i, "avg_cost", v)}
              keyboardType="decimal-pad"
            />
            <TouchableOpacity onPress={() => removeRow(i)} style={styles.removeBtn}>
              <Ionicons name="close-circle" size={20} color={colors.textDim} />
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity style={styles.addBtn} onPress={addRow}>
          <Ionicons name="add" size={18} color={colors.green} />
          <Text style={styles.addBtnText}>Add Position</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.calcBtn} onPress={calculate} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.calcBtnText}>Calculate P&L</Text>
          )}
        </TouchableOpacity>

        {/* Results */}
        {results && (
          <>
            {/* Summary */}
            <View style={[styles.summaryCard, { borderColor: totalPositive ? colors.green : colors.red }]}>
              <Text style={styles.summaryLabel}>Total Portfolio Value</Text>
              <Text style={styles.summaryValue}>${results.total_value.toLocaleString()}</Text>
              <View style={styles.pnlRow}>
                <Ionicons
                  name={totalPositive ? "trending-up" : "trending-down"}
                  size={18}
                  color={totalPositive ? colors.green : colors.red}
                />
                <Text style={[styles.pnlText, { color: totalPositive ? colors.green : colors.red }]}>
                  {totalPositive ? "+" : ""}{results.total_pnl.toFixed(2)} ({totalPositive ? "+" : ""}{results.total_pnl_pct.toFixed(2)}%)
                </Text>
              </View>
              <Text style={styles.costBasis}>Cost basis: ${results.total_cost.toLocaleString()}</Text>
            </View>

            {/* Individual positions */}
            <Text style={styles.label}>Positions</Text>
            {results.positions.map((pos, i) => (
              <TouchableOpacity
                key={i}
                style={styles.posCard}
                onPress={() => navigation.navigate("Detail", { ticker: pos.ticker })}
              >
                <View style={styles.posLeft}>
                  <Text style={styles.posTicker}>{pos.ticker}</Text>
                  <Text style={styles.posShares}>{pos.shares} shares @ ${pos.avg_cost}</Text>
                </View>
                <View style={styles.posRight}>
                  <Text style={styles.posValue}>${pos.market_value.toLocaleString()}</Text>
                  <Text style={[styles.posPnl, { color: pos.pnl >= 0 ? colors.green : colors.red }]}>
                    {pos.pnl >= 0 ? "+" : ""}{pos.pnl.toFixed(2)} ({pos.pnl_pct.toFixed(1)}%)
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  navTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 24, marginBottom: 10, marginTop: 20 },
  row: { flexDirection: "row", paddingHorizontal: 20, gap: 8, marginBottom: 8, alignItems: "center" },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  inputTicker: { flex: 1.2 },
  inputNum: { flex: 1 },
  removeBtn: { padding: 4 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 24, paddingVertical: 12 },
  addBtnText: { color: colors.green, fontSize: 14, fontWeight: "600" },
  calcBtn: { backgroundColor: colors.green, marginHorizontal: 24, borderRadius: radius.lg, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  calcBtnText: { color: colors.bg, fontSize: 16, fontWeight: "700" },
  summaryCard: { marginHorizontal: 24, marginTop: 24, backgroundColor: colors.surface, borderRadius: radius.xl, padding: 24, borderWidth: 1.5, alignItems: "center" },
  summaryLabel: { color: colors.textMuted, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  summaryValue: { color: colors.text, fontSize: 36, fontWeight: "800", letterSpacing: -1 },
  pnlRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  pnlText: { fontSize: 18, fontWeight: "700" },
  costBasis: { color: colors.textMuted, fontSize: 12, marginTop: 8 },
  posCard: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  posLeft: {},
  posRight: { alignItems: "flex-end" },
  posTicker: { color: colors.text, fontSize: 15, fontWeight: "700" },
  posShares: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  posValue: { color: colors.text, fontSize: 15, fontWeight: "600" },
  posPnl: { fontSize: 12, marginTop: 2, fontWeight: "600" },
});
