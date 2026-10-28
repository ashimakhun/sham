import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Button, Card, ErrorText, RoleBadge, styles } from '@/components/ui';
import { canManageRoles } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

export default function ProfileScreen() {
  const { currentUser, session, courses, courseMembers, getUser, signOut } = useStore();
  const { busy, error, run } = useAction();
  if (!currentUser) return null;

  const openCourse = (id: string) => router.push({ pathname: '/courses/[id]', params: { id } });

  // Courses I attend; their owner is my mentor there (ARU-7). Teachers are never listeners.
  const myMemberships = new Set(courseMembers.filter((m) => m.userId === currentUser.id).map((m) => m.courseId));
  const listening = courses.filter((c) => myMemberships.has(c.id));
  // Courses I own, each with its listeners (mentors and the teacher).
  const owned = courses.filter((c) => c.createdById === currentUser.id);
  const isStaff = currentUser.role === 'teacher' || currentUser.role === 'mentor';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.h1}>{currentUser.name}</Text>
        <Text style={styles.muted}>{session?.user.email}</Text>
        <RoleBadge role={currentUser.role} />
      </Card>

      {(currentUser.role === 'student' || listening.length > 0) && (
        <Card>
          <Text style={styles.label}>MY COURSES</Text>
          {listening.length ? (
            listening.map((c) => (
              <View key={c.id} style={{ gap: 2 }}>
                <Text style={[styles.title, { fontSize: 15 }]} numberOfLines={2} onPress={() => openCourse(c.id)}>
                  {c.title}
                </Text>
                <Text style={styles.muted}>Mentor: {getUser(c.createdById)?.name ?? 'Unknown'}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No mentor yet — ask your teacher or mentor to add you to a course</Text>
          )}
        </Card>
      )}

      {isStaff && (
        <Card>
          <Text style={styles.label}>COURSES I OWN</Text>
          {owned.length ? (
            owned.map((c) => {
              const listeners = courseMembers
                .filter((m) => m.courseId === c.id)
                .map((m) => getUser(m.userId)?.name ?? 'Unknown user')
                .sort((a, b) => a.localeCompare(b));
              return (
                <View key={c.id} style={{ gap: 2 }}>
                  <Text style={[styles.title, { fontSize: 15 }]} numberOfLines={2} onPress={() => openCourse(c.id)}>
                    {c.title}
                  </Text>
                  <Text style={styles.muted}>{listeners.length ? listeners.join(', ') : 'No listeners yet'}</Text>
                </View>
              );
            })
          ) : (
            <Text style={styles.muted}>You do not own any courses yet.</Text>
          )}
        </Card>
      )}

      <View style={{ gap: 10, marginTop: 8 }}>
        {canManageRoles(currentUser.role) && (
          <Button title="Manage roles" variant="secondary" onPress={() => router.push('/roles')} />
        )}
        <ErrorText error={error} />
        {/* The root screen redirects to sign-in once the session is gone. */}
        <Button title="Sign out" variant="secondary" disabled={busy} onPress={() => run(signOut)} />
      </View>
    </ScrollView>
  );
}
