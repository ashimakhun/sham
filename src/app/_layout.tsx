import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { StoreProvider } from '@/lib/store';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <StoreProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTintColor: colors.primary,
          headerBackButtonDisplayMode: 'minimal',
          // Solid header on iOS so screen content starts below it instead of underneath.
          headerTransparent: false,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="homework/new" options={{ title: 'Add homework', presentation: 'modal' }} />
        <Stack.Screen name="homework/[id]" options={{ title: 'Homework' }} />
        <Stack.Screen name="materials/new" options={{ title: 'New material', presentation: 'modal' }} />
        <Stack.Screen name="materials/[id]" options={{ title: 'Material' }} />
      </Stack>
    </StoreProvider>
  );
}
