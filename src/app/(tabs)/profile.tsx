import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Button, Card, RoleBadge, styles } from '@/components/ui';
import { useStore } from '@/lib/store';

export default function ProfileScreen() {
  const { currentUser, users, getUser, signOut, resetDemoData } = useStore();
  if (!currentUser) return null;

  const mentor = getUser(currentUser.mentorId);
  const students = users.filter((u) => u.mentorId === currentUser.id);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.h1}>{currentUser.name}</Text>
        <RoleBadge role={currentUser.role} />
      </Card>

      {mentor && (
        <Card>
          <Text style={styles.label}>MY MENTOR</Text>
          <Text style={styles.title}>{mentor.name}</Text>
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
        <Button
          title="Sign out"
          variant="secondary"
          onPress={() => {
            signOut();
            router.replace('/');
          }}
        />
        <Button title="Reset demo data" variant="danger" onPress={resetDemoData} />
      </View>
    </ScrollView>
  );
}
