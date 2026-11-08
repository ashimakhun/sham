import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { AccessGate } from '@/components/AccessGate';
import { LanguageProvider, useI18n } from '@/i18n/LanguageProvider';
import { font, INTER_FONTS } from '@/lib/fonts';
import { StoreProvider } from '@/lib/store';
import { colors } from '@/lib/theme';

// ARU-119 AC 5: keep the splash screen up until the fonts are ready, so text never flashes in the system font.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // The Inter faces ship with the app (no download); they load from the bundle at start.
  const [fontsLoaded, fontError] = useFonts(INTER_FONTS);
  const ready = fontsLoaded || !!fontError;
  useEffect(() => {
    // AC 6: if they can't load, open anyway; text then uses the system font, with no error shown.
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;

  return (
    <StoreProvider>
      {/* ARU-108: the app's language (account choice, else the phone's); every screen below reads it. */}
      <LanguageProvider>
        <AppStack />
      </LanguageProvider>
    </StoreProvider>
  );
}

function AppStack() {
  const { t } = useI18n();
  return (
    <>
      <StatusBar style="dark" />
      {/* ARU-43: accounts waiting for (or declined) approval see only the waiting / declined screen. */}
      <AccessGate>
        <Stack
          screenOptions={{
            headerTintColor: colors.primary,
            headerBackButtonDisplayMode: 'minimal',
            // Solid header on iOS so screen content starts below it instead of underneath.
            headerTransparent: false,
            headerTitleStyle: { color: colors.text, ...font(600) },
            contentStyle: { backgroundColor: colors.bg },
          }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="homework/new" options={{ title: 'Add homework', presentation: 'modal' }} />
          <Stack.Screen name="homework/[id]" options={{ title: 'Homework' }} />
          <Stack.Screen name="homework/photos" options={{ title: 'Download by course', presentation: 'modal' }} />
          <Stack.Screen name="courses/new" options={{ title: 'New course', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]" options={{ title: 'Course' }} />
          <Stack.Screen name="courses/[id]/chat" options={{ title: 'Chat' }} />
          <Stack.Screen name="courses/[id]/edit" options={{ title: 'Edit course', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/owner" options={{ title: 'Change owner', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/feedback" options={{ title: 'Feedback', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/members" options={{ title: 'Listeners' }} />
          <Stack.Screen name="courses/[id]/pay" options={{ title: 'Pay', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/listeners" options={{ title: 'Add listeners', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/meetings/new" options={{ title: 'Schedule meeting', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/meetings/[meetingId]" options={{ title: 'Edit meeting', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/meetings/[meetingId]/notes" options={{ title: 'Notes' }} />
          <Stack.Screen
            name="courses/[id]/meetings/[meetingId]/assign-homework"
            options={{ title: 'Assign homework', presentation: 'modal' }}
          />
          <Stack.Screen name="materials/new" options={{ title: 'New material', presentation: 'modal' }} />
          <Stack.Screen name="materials/[id]" options={{ title: 'Material' }} />
          <Stack.Screen name="materials/files/new" options={{ title: 'Upload PDF', presentation: 'modal' }} />
          <Stack.Screen name="materials/files/[id]" options={{ title: 'File' }} />
          <Stack.Screen name="materials/files/[id]/edit" options={{ title: 'Edit file', presentation: 'modal' }} />
          <Stack.Screen name="roles" options={{ title: 'Manage roles' }} />
          <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
          <Stack.Screen name="accountant/courses" options={{ title: 'Select courses' }} />
          <Stack.Screen name="accountant/[id]" options={{ title: 'Payments' }} />
          <Stack.Screen name="general-chat" options={{ title: 'General chat' }} />
          {/* ARU-101: a pushed page (not a modal), so iOS swipe-back and Android back return to Profile. */}
          <Stack.Screen name="telegram" options={{ title: 'Telegram notifications' }} />
          <Stack.Screen name="change-password" options={{ title: t('changePassword.title'), presentation: 'modal' }} />
          <Stack.Screen name="reset-password" options={{ title: t('reset.title') }} />
          <Stack.Screen name="disciplines/new" options={{ title: 'New discipline', presentation: 'modal' }} />
          <Stack.Screen name="disciplines/[id]" options={{ title: 'Discipline' }} />
        </Stack>
      </AccessGate>
    </>
  );
}
