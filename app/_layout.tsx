import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { MD3LightTheme, PaperProvider } from 'react-native-paper';
import 'react-native-reanimated';

import { TourPill } from '@/components/showcase/TourPill';
import { useColorScheme } from '@/components/useColorScheme';
import { MiraDesign } from '@/constants/Design';
import { miraQueryClient } from '@/lib/api/client';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const miraPaperTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    background: MiraDesign.color.canvas,
    error: MiraDesign.color.danger,
    outline: MiraDesign.color.line,
    primary: MiraDesign.color.blue,
    secondary: MiraDesign.color.primary,
    surface: MiraDesign.color.surface,
    surfaceVariant: MiraDesign.color.blueSoft,
  },
  roundness: MiraDesign.radius.sm,
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <QueryClientProvider client={miraQueryClient}>
      <PaperProvider theme={miraPaperTheme}>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="tour/[module]" options={{ headerShown: false }} />
            <Stack.Screen name="package-detail" options={{ headerShown: false }} />
            <Stack.Screen name="checkout" options={{ headerShown: false }} />
            <Stack.Screen name="chat" options={{ headerShown: false }} />
            <Stack.Screen name="orders" options={{ headerShown: false }} />
            <Stack.Screen name="order-status" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="partner" options={{ headerShown: false }} />
            <Stack.Screen name="admin-panel" options={{ headerShown: false }} />
            <Stack.Screen name="admin" options={{ headerShown: false }} />
            <Stack.Screen name="sales-portal" options={{ headerShown: false }} />
            <Stack.Screen name="staff-referral" options={{ headerShown: false }} />
            <Stack.Screen name="prototype" options={{ headerShown: false }} />
            <Stack.Screen name="r/[ref_code]" options={{ headerShown: false }} />
          </Stack>
          <TourPill />
        </ThemeProvider>
      </PaperProvider>
    </QueryClientProvider>
  );
}
