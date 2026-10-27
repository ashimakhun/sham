import { ScrollView, Text, View } from 'react-native';

import { Button, Card, ErrorText, RoleBadge, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

export default function ProfileScreen() {
  const { currentUser, session, users, getUser, signOut } = useStore();
  const { busy, error, run } = useAction();
  if (!currentUser) return null;

  const mentor = getUser(currentUser.mentorId);
  const students = users.filter((u) => u.mentorId === currentUser.id);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.h1}>{currentUser.name}</Text>
        <Text style={styles.muted}>{session?.user.email}</Text>
        <RoleBadge role={currentUser.role} />
      </Card>

      {currentUser.role === 'student' && (
        <Card>
          <Text style={styles.label}>MY MENTOR</Text>
          {mentor ? (
            <Text style={styles.title}>{mentor.name}</Text>
          ) : (
            <Text style={styles.muted}>No mentor assigned yet. Ask your teacher.</Text>
          )}
        </Card>
      )}

      {currentUser.role === 'mentor' && (
        <Card>
          <Text style={styles.label}>MY STUDENTS</Text>
          {students.length ? (
            students.map((s) => (
              <Text key={s.id} style={styles.body}>
                {s.name}
              </Text>
            ))
          ) : (
            <Text style={styles.muted}>No students assigned yet.</Text>
          )}
        </Card>
      )}

      <View style={{ gap: 10, marginTop: 8 }}>
        <ErrorText error={error} />
        {/* The root screen redirects to sign-in once the session is gone. */}
        <Button title="Sign out" variant="secondary" disabled={busy} onPress={() => run(signOut)} />
      </View>
    </ScrollView>
  );
}
