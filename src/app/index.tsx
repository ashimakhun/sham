import { Redirect } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, RoleBadge, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { colors, roleLabel } from '@/lib/theme';
import type { Role } from '@/lib/types';

const roleOrder: Role[] = ['teacher', 'mentor', 'student'];

// Demo sign-in: pick a seeded user. Replaced by real auth once a backend is connected.
export default function SignInScreen() {
  const { ready, currentUser, users, signIn } = useStore();

  if (!ready) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (currentUser) return <Redirect href="/homework" />;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ gap: 4, marginVertical: 12 }}>
          <Text style={styles.h1}>Sham</Text>
          <Text style={styles.muted}>Homework, checks and lessons in one place. Choose who you are:</Text>
        </View>
        {roleOrder.map((role) => (
          <View key={role} style={{ gap: 8 }}>
            <Text style={[styles.label, { marginTop: 8 }]}>{roleLabel[role].toUpperCase()}S</Text>
            {users
              .filter((u) => u.role === role)
              .map((u) => (
                <Card key={u.id} onPress={() => signIn(u.id)} style={styles.row}>
                  <Text style={styles.title}>{u.name}</Text>
                  <RoleBadge role={u.role} />
                </Card>
              ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
