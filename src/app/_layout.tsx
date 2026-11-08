import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AccessGate } from '@/components/AccessGate';
import { LanguageProvider, useI18n } from '@/i18n/LanguageProvider';
import { StoreProvider } from '@/lib/store';
import { colors } from '@/lib/theme';

export default function RootLayout() {
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
            headerTitleStyle: { color: colors.text },
            contentStyle: { backgroundColor: colors.bg },
          }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="homework/new" options={{ title: t('homework.addTitle'), presentation: 'modal' }} />
          <Stack.Screen name="homework/[id]" options={{ title: t('homework.detailTitle') }} />
          <Stack.Screen name="homework/photos" options={{ title: t('homework.photosByCourseTitle'), presentation: 'modal' }} />
          <Stack.Screen name="courses/new" options={{ title: t('courses.newTitle'), presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]" options={{ title: t('courses.detailTitle') }} />
          <Stack.Screen name="courses/[id]/chat" options={{ title: 'Chat' }} />
          <Stack.Screen name="courses/[id]/edit" options={{ title: t('courses.editTitle'), presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/owner" options={{ title: t('courses.changeOwner'), presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/feedback" options={{ title: t('feedback.title'), presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/members" options={{ title: t('listeners.title') }} />
          <Stack.Screen name="courses/[id]/pay" options={{ title: 'Pay', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/listeners" options={{ title: t('listeners.addTitle'), presentation: 'modal' }} />
          <Stack.Screen
            name="courses/[id]/meetings/new"
            options={{ title: t('meetings.scheduleTitle'), presentation: 'modal' }}
          />
          <Stack.Screen
            name="courses/[id]/meetings/[meetingId]"
            options={{ title: t('meetings.editTitle'), presentation: 'modal' }}
          />
          <Stack.Screen name="courses/[id]/meetings/[meetingId]/notes" options={{ title: t('notes.title') }} />
          <Stack.Screen
            name="courses/[id]/meetings/[meetingId]/assign-homework"
            options={{ title: t('meetings.assignHomework'), presentation: 'modal' }}
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
          <Stack.Screen name="disciplines/new" options={{ title: t('disciplines.newTitle'), presentation: 'modal' }} />
          <Stack.Screen name="disciplines/[id]" options={{ title: t('disciplines.detailTitle') }} />
        </Stack>
      </AccessGate>
    </>
  );
}
