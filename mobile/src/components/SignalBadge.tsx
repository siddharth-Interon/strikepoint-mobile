import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "./Theme";

interface Props {
  direction: "BUY" | "SELL" | "HOLD";
  confidence: number;
  size?: "sm" | "lg";
}

export function SignalBadge({ direction, confidence, size = "sm" }: Props) {
  const color =
    direction === "BUY" ? colors.green : direction === "SELL" ? colors.red : colors.yellow;
  const bg =
    direction === "BUY" ? colors.greenDim : direction === "SELL" ? colors.redDim : "#ffcc0022";

  const isLarge = size === "lg";

  return (
    <View style={[styles.wrap, { backgroundColor: bg, borderColor: color }, isLarge && styles.wrapLg]}>
      <Text style={[styles.label, { color }, isLarge && styles.labelLg]}>{direction}</Text>
      <Text style={[styles.conf, { color: colors.textMuted }, isLarge && styles.confLg]}>
        {confidence}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  wrapLg: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, gap: 8 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  labelLg: { fontSize: 16 },
  conf: { fontSize: 10 },
  confLg: { fontSize: 14 },
});
