import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { canSeeListeners, ListenersList } from '@/components/ListenersList';
import { EmptyState, styles } from '@/components/ui';
import { useStore } from '@/lib/store';

/** ARU-97: the Listeners page, opened from the "LISTENERS (n) >" row on course details. */
export default function ListenersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser, courseMembers, getCourse } = useStore();

  const course = getCourse(id);
  if (!course) return <EmptyState title="Course not found" />;
  // Checked on every render, so a student removed meanwhile switches to "Not allowed" with no names left on screen.
  if (!canSeeListeners(currentUser, course.id, courseMembers)) {
    return <EmptyState title="Not allowed" hint="Only teachers, mentors and listeners of this course see its listeners." />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <ListenersList course={course} />
    </ScrollView>
  );
}
