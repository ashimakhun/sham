import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { canSeeListeners, ListenersList } from '@/components/ListenersList';
import { EmptyState, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { useStore } from '@/lib/store';

/** ARU-97: the Listeners page, opened from the "LISTENERS (n) >" row on course details. */
export default function ListenersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser, courseMembers, getCourse } = useStore();
  const { t } = useI18n();

  const course = getCourse(id);
  if (!course) return <EmptyState title={t('courses.notFound')} />;
  // Checked on every render, so a student removed meanwhile switches to "Not allowed" with no names left on screen.
  if (!canSeeListeners(currentUser, course.id, courseMembers)) {
    return <EmptyState title={t('courses.notAllowed')} hint={t('listeners.seeNotAllowedHint')} />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <ListenersList course={course} />
    </ScrollView>
  );
}
