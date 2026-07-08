import React from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Svg, { Path, Defs, LinearGradient, Stop } from "react-native-svg";
import { colors } from "./Theme";

interface Props {
  data: number[];
  positive?: boolean;
  height?: number;
}

const W = Dimensions.get("window").width - 48;

export function PriceChart({ data, positive = true, height = 80 }: Props) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: height - ((v - min) / range) * height,
  }));

  const linePath =
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  const areaPath =
    linePath +
    ` L ${pts[pts.length - 1].x.toFixed(1)} ${height} L 0 ${height} Z`;

  const stroke = positive ? colors.green : colors.red;
  const gradId = positive ? "gUp" : "gDown";

  return (
    <View style={[styles.wrap, { height }]}>
      <Svg width={W} height={height}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity="0.25" />
            <Stop offset="1" stopColor={stroke} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d={areaPath} fill={`url(#${gradId})`} />
        <Path d={linePath} stroke={stroke} strokeWidth={2} fill="none" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
});
