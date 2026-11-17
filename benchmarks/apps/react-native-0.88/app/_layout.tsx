import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/colors';
import { queryClient } from '@/lib/queryClient';
import { reportInitiallyDrawn } from '@/modules/app-startup-module';

export default function RootLayout() {
  useEffect(() => {
    requestAnimationFrame(() => {
      reportInitiallyDrawn();
    });
  }, []);

  return (
    <GestureHandlerRootView>
      <QueryClientProvider client={queryClient}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="pokemon/[id]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.75],
              headerShown: false,
              sheetCornerRadius: 16,
              contentStyle: { backgroundColor: Colors.white },
            }}
          />
          {/* The benchmark's deep-link screen: no header, so only what it mounts is on screen. */}
          <Stack.Screen name="bench/mount" options={{ headerShown: false }} />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
