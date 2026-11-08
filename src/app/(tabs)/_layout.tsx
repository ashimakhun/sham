import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';

import { useI18n } from '@/i18n/LanguageProvider';
import { font } from '@/lib/fonts';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';

export default function TabLayout() {
  const { ready, currentUser } = useStore();
  const { t } = useI18n();
  if (ready && !currentUser) return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        // ARU-119: Inter, SemiBold 600 titles and Light 300 tab labels.
        headerTitleStyle: { color: colors.text, ...font(600) },
        tabBarLabelStyle: font(300),
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen
        name="homework"
        options={{
          title: currentUser?.role === 'mentor' ? t('tabs.toCheck') : t('tabs.homework'),
          tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: t('tabs.courses'),
          tabBarIcon: ({ color, size }) => <Ionicons name="school-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="materials"
        options={{
          title: t('tabs.materials'),
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color as string} size={size} />,
        }}
      />
    </Tabs>
  );
}
