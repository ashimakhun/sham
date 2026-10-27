import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';

import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';

export default function TabLayout() {
  const { ready, currentUser } = useStore();
  if (ready && !currentUser) return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen
        name="homework"
        options={{
          title: currentUser?.role === 'mentor' ? 'To check' : 'Homework',
          tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="materials"
        options={{
          title: 'Materials',
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color as string} size={size} />,
        }}
      />
    </Tabs>
  );
}
