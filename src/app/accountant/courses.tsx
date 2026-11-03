import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { PeriodEditor } from '@/components/Accountant';
import { Button, Card, EmptyState, ErrorText, HiddenBadge, styles } from '@/components/ui';
import { DEFAULT_PERIOD, isAccountant, periodText } from '@/lib/billing';
import { confirmAction } from '@/lib/confirm';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';
import type { Course } from '@/lib/types';

/**
 * ARU-65 AC 3 / AC 5: an accountant selects paid courses (any course they can see) and unselects them. Selecting
 * asks for the payment period (default 1-5). The list is shared: another accountant's selections show here too.
 */
export default function SelectPaidCoursesScreen() {
  const { currentUser, courses, courseBilling, loading, refresh } = useStore();
  if (!isAccountant(currentUser)) {
    return <EmptyState title="Not allowed" hint="Only accountants select paid courses." />;
  }
  const sorted = [...courses].sort((a, b) => a.title.localeCompare(b.title));
  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, { gap: 12 }]}
      data={sorted}
      keyExtractor={(c) => c.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh().catch(() => {})} />}
      renderItem={({ item }) => <CourseRow course={item} billing={courseBilling.find((b) => b.courseId === item.id)} />}
      ListEmptyComponent={<EmptyState title="No courses yet" />}
    />
  );
}

function CourseRow({ course, billing }: { course: Course; billing?: { startDay: number; endDay: number } }) {
  const { selectPaidCourse, unselectPaidCourse } = useStore();
  const [choosing, setChoosing] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <View testID={`select-${course.id}`}>
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={[styles.title, { flexShrink: 1 }]}>{course.title}</Text>
        {course.hidden ? <HiddenBadge /> : null}
      </View>
      {billing ? (
        <>
          <Text style={styles.muted}>Paid course · {periodText(billing)}</Text>
          <Button
            title={busy ? 'Saving…' : 'Unselect'}
            variant="secondary"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const ok = await confirmAction(
                  'Unselect paid course',
                  `${course.title} will stop being a paid course for everyone.`,
                  'Unselect',
                  { destructive: true, cancelText: 'Keep' },
                );
                if (ok) await unselectPaidCourse(course.id);
              })
            }
          />
        </>
      ) : choosing ? (
        <PeriodEditor
          initial={DEFAULT_PERIOD}
          saveTitle="Select"
          onCancel={() => setChoosing(false)}
          onSave={async (s, e) => {
            await selectPaidCourse(course.id, s, e);
            setChoosing(false);
          }}
        />
      ) : (
        <Button title="Select" variant="secondary" onPress={() => setChoosing(true)} />
      )}
      <ErrorText error={error} />
    </Card>
    </View>
  );
}
