import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AccessGate } from '@/components/AccessGate';
import { StoreProvider } from '@/lib/store';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <StoreProvider>
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
          <Stack.Screen name="homework/new" options={{ title: 'Add homework', presentation: 'modal' }} />
          <Stack.Screen name="homework/[id]" options={{ title: 'Homework' }} />
          <Stack.Screen name="courses/new" options={{ title: 'New course', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]" options={{ title: 'Course' }} />
          <Stack.Screen name="courses/[id]/chat" options={{ title: 'Chat' }} />
          <Stack.Screen name="courses/[id]/owner" options={{ title: 'Change owner', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/feedback" options={{ title: 'Feedback', presentation: 'modal' }} />
          <Stack.Screen name="courses/[id]/members" options={{ title: 'Listeners' }} />
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
          <Stack.Screen name="change-password" options={{ title: 'Change password', presentation: 'modal' }} />
          <Stack.Screen name="reset-password" options={{ title: 'Reset password' }} />
          <Stack.Screen name="disciplines/new" options={{ title: 'New discipline', presentation: 'modal' }} />
          <Stack.Screen name="disciplines/[id]" options={{ title: 'Discipline' }} />
        </Stack>
      </AccessGate>
    </StoreProvider>
  );
}
