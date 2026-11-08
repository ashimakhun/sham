import { router } from 'expo-router';
import { useRef } from 'react';
import { View } from 'react-native';

import { Button, ErrorText } from '@/components/ui';
import { currentLanguage, type Language, translate } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { confirmDestructive } from '@/lib/confirm';
import { canDeleteCourse } from '@/lib/roles';
import { useStore } from '@/lib/store';
import type { Course } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** The confirmation text (ARU-85 AC 2), in the app's language (ARU-109). */
export function deleteCourseMessage(title: string, lang: Language = currentLanguage()) {
  return translate(lang, 'courses.deleteMessage', { title });
}

/** ARU-85: the teacher's "Delete course", the last item on the course screen. After a confirmation it deletes the
 *  course with everything in it and goes back to where the teacher came from. */
export function DeleteCourseButton({ course }: { course: Course }) {
  const { currentUser, deleteCourse } = useStore();
  const { t, lang } = useI18n();
  const { busy, error, run } = useAction();
  // Set from the first tap until the delete ends, so a double tap opens one confirmation and sends one request.
  const pending = useRef(false);
  if (!canDeleteCourse(currentUser?.role)) return null;

  function onPress() {
    if (busy || pending.current) return;
    pending.current = true;
    const target = course;
    confirmDestructive(t('courses.deleteCourse'), deleteCourseMessage(target.title, lang), t('courses.deleteConfirm'))
      .then(async (ok) => {
        if (!ok) return;
        await run(async () => {
          await deleteCourse(target.id);
          // Right away, before the refetch turns this screen into "Course not found". With no history (a deep
          // link or a web refresh): the Courses tab.
          if (router.canGoBack()) router.back();
          else router.replace('/courses');
        });
      })
      .finally(() => {
        pending.current = false;
      });
  }

  return (
    <View style={{ gap: 8, marginTop: 12 }}>
      <ErrorText error={error} />
      <Button title={busy ? t('courses.deleting') : t('courses.deleteCourse')} variant="danger" disabled={busy} onPress={onPress} />
    </View>
  );
}
