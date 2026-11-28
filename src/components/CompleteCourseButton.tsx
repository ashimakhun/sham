import { useRef } from 'react';
import { View } from 'react-native';

import { Button, ErrorText } from '@/components/ui';
import { type Language, translate } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { confirmAction } from '@/lib/confirm';
import { canCompleteCourse, isCourseCompleted, scheduledMeetingCount } from '@/lib/courseCompletion';
import { useStore } from '@/lib/store';
import type { Course } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** ARU-197 AC 2: the Complete course confirmation; with Scheduled meetings it also says how many will be canceled. */
export function completeCourseMessage(scheduled: number, lang: Language) {
  const base = translate(lang, 'courses.completeMessage');
  return scheduled > 0 ? `${base} ${translate(lang, 'courses.completeMeetingsCanceled', { count: scheduled })}` : base;
}

/**
 * ARU-197: "Complete course" on an active course and "Reopen course" on a completed one, for the course's current
 * owner and the teacher (nobody else sees either). Each asks for a confirmation first. The store reloads after the
 * save, so the badge, the buttons and the canceled meetings follow without leaving the screen; other viewers get the
 * change live (courses and course_meetings are in realtime).
 */
export function CompleteCourseButton({ course }: { course: Course }) {
  const { currentUser, meetings, completeCourse, reopenCourse } = useStore();
  const { t, lang } = useI18n();
  const { busy, error, run } = useAction();
  // Set from the first tap until the save ends, so a double tap opens one confirmation and sends one request.
  const pending = useRef(false);
  if (!canCompleteCourse(currentUser, course)) return null;

  const completed = isCourseCompleted(course);

  function onPress() {
    if (busy || pending.current) return;
    pending.current = true;
    const id = course.id;
    const asked = completed
      ? confirmAction(t('courses.reopenCourse'), t('courses.reopenMessage'), t('courses.reopenConfirm'))
      : confirmAction(
          t('courses.completeCourse'),
          completeCourseMessage(scheduledMeetingCount(meetings, id), lang),
          t('courses.completeConfirm'),
        );
    asked
      .then(async (ok) => {
        if (ok) await run(() => (completed ? reopenCourse(id) : completeCourse(id)));
      })
      .finally(() => {
        pending.current = false;
      });
  }

  const title = completed
    ? t(busy ? 'courses.reopening' : 'courses.reopenCourse')
    : t(busy ? 'courses.completing' : 'courses.completeCourse');
  return (
    <View style={{ gap: 8, marginTop: 12 }}>
      <ErrorText error={error} />
      <Button testID="complete-course-button" title={title} variant="secondary" disabled={busy} onPress={onPress} />
    </View>
  );
}
