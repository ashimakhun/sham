import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { Text } from '@/components/AppText';

import { PeriodEditor } from '@/components/Accountant';
import { Button, Card, EmptyState, ErrorText, HiddenBadge, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
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
  const { t } = useI18n();
  if (!isAccountant(currentUser)) {
    return <EmptyState title={t('courses.notAllowed')} hint={t('accountant.selectNotAllowedHint')} />;
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
      ListEmptyComponent={<EmptyState title={t('accountant.noCourses')} />}
    />
  );
}

function CourseRow({ course, billing }: { course: Course; billing?: { startDay: number; endDay: number } }) {
  const { selectPaidCourse, unselectPaidCourse } = useStore();
  const [choosing, setChoosing] = useState(false);
  const { busy, error, run } = useAction();
  const { t, lang } = useI18n();
  return (
    <View testID={`select-${course.id}`}>
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={[styles.title, { flexShrink: 1 }]}>{course.title}</Text>
        {course.hidden ? <HiddenBadge /> : null}
      </View>
      {billing ? (
        <>
          <Text style={styles.muted}>{t('accountant.paidCourse', { period: periodText(billing, lang) })}</Text>
          <Button
            title={busy ? t('common.saving') : t('accountant.unselect')}
            variant="secondary"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const ok = await confirmAction(
                  t('accountant.unselectTitle'),
                  t('accountant.unselectMessage', { title: course.title }),
                  t('accountant.unselect'),
                  { destructive: true, cancelText: t('accountant.keep') },
                );
                if (ok) await unselectPaidCourse(course.id);
              })
            }
          />
        </>
      ) : choosing ? (
        <PeriodEditor
          initial={DEFAULT_PERIOD}
          saveTitle={t('accountant.select')}
          onCancel={() => setChoosing(false)}
          onSave={async (s, e) => {
            await selectPaidCourse(course.id, s, e);
            setChoosing(false);
          }}
        />
      ) : (
        <Button title={t('accountant.select')} variant="secondary" onPress={() => setChoosing(true)} />
      )}
      <ErrorText error={error} />
    </Card>
    </View>
  );
}
