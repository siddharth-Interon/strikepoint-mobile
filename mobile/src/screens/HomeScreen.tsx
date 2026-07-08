import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, RefreshControl, ScrollView, Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { analyzeStock, scanStocks, StockData } from "../services/api";
import { SignalBadge } from "../components/SignalBadge";
import { colors, radius } from "../components/Theme";

const HOT = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "META", "AMD", "GOOGL", "RIVN", "PLTR"];

export function HomeScreen({ navigation }: any) {
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<StockData[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadScan = useCallback(async () => {
    setScanning(true);
    try {
      const data = await scanStocks(HOT.join(","));
      setResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => { loadScan(); }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const data = await analyzeStock(query.trim().toUpperCase());
      navigation.navigate("Detail", { ticker: data.ticker, data });
    } catch (e) {
      alert("Ticker not found");
    } finally {
      setSearching(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadScan();
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: StockData }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate("Detail", { ticker: item.ticker, data: item })}
      activeOpacity={0.75}
    >
      <View style={styles.cardLeft}>
        <Text style={styles.ticker}>{item.ticker}</Text>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
      </View>
      <View style={styles.cardMid}>
        <Text style={styles.price}>${item.price.toFixed(2)}</Text>
        <Text style={[styles.change, { color: item.change_pct >= 0 ? colors.green : colors.red }]}>
          {item.change_pct >= 0 ? "+" : ""}{item.change_pct}%
        </Text>
      </View>
      <SignalBadge direction={item.direction} confidence={item.confidence} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>Strikepoint</Text>
        <TouchableOpacity onPress={() => navigation.navigate("Portfolio")}>
          <Ionicons name="briefcase-outline" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textDim} style={{ marginRight: 6 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search ticker..."
            placeholderTextColor={colors.textDim}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="characters"
            returnKeyType="search"
            onSubmitEditing={handleSearch}
          />
          {searching && <ActivityIndicator size="small" color={colors.green} />}
        </View>
        <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
          <Text style={styles.searchBtnText}>Go</Text>
        </TouchableOpacity>
      </View>

      {/* Scanner */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Live Scanner</Text>
        {scanning && <ActivityIndicator size="small" color={colors.green} />}
      </View>

      <FlatList
        data={results}
        keyExtractor={(i) => i.ticker}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  logo: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.green,
    letterSpacing: -0.5,
  },
  searchRow: { flexDirection: "row", paddingHorizontal: 20, gap: 10, marginBottom: 16 },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  searchBtn: {
    backgroundColor: colors.green,
    borderRadius: radius.md,
    width: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBtnText: { color: colors.bg, fontWeight: "700", fontSize: 15 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sectionTitle: { color: colors.textMuted, fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: colors.bg,
  },
  cardLeft: { flex: 1 },
  cardMid: { alignItems: "flex-end", marginRight: 12 },
  ticker: { color: colors.text, fontSize: 15, fontWeight: "700" },
  name: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  price: { color: colors.text, fontSize: 15, fontWeight: "600" },
  change: { fontSize: 12, marginTop: 2 },
  sep: { height: 1, backgroundColor: colors.border, marginLeft: 20 },
});
