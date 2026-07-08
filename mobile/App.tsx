import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createStackNavigator } from "@react-navigation/stack";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { HomeScreen } from "./src/screens/HomeScreen";
import { ScannerScreen } from "./src/screens/ScannerScreen";
import { DetailScreen } from "./src/screens/DetailScreen";
import { OptionsScreen } from "./src/screens/OptionsScreen";
import { PortfolioScreen } from "./src/screens/PortfolioScreen";
import { colors } from "./src/components/Theme";

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, cardStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Detail" component={DetailScreen} />
      <Stack.Screen name="Options" component={OptionsScreen} />
      <Stack.Screen name="Portfolio" component={PortfolioScreen} />
    </Stack.Navigator>
  );
}

function ScannerStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, cardStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="Scanner" component={ScannerScreen} />
      <Stack.Screen name="Detail" component={DetailScreen} />
      <Stack.Screen name="Options" component={OptionsScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer
          theme={{
            dark: true,
            colors: {
              primary: colors.green,
              background: colors.bg,
              card: colors.surface,
              text: colors.text,
              border: colors.border,
              notification: colors.green,
            },
          }}
        >
          <StatusBar style="light" />
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerShown: false,
              tabBarStyle: {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
                borderTopWidth: 1,
              },
              tabBarActiveTintColor: colors.green,
              tabBarInactiveTintColor: colors.textDim,
              tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
              tabBarIcon: ({ color, size, focused }) => {
                const icons: Record<string, any> = {
                  Watchlist: focused ? "home" : "home-outline",
                  Scanner: focused ? "pulse" : "pulse-outline",
                };
                return <Ionicons name={icons[route.name]} size={size} color={color} />;
              },
            })}
          >
            <Tab.Screen name="Watchlist" component={HomeStack} />
            <Tab.Screen name="Scanner" component={ScannerStack} />
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
