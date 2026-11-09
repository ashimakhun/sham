import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { MeetingForm, nextFullHour } from '@/components/MeetingForm';
import { EmptyState } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { newId } from '@/lib/id';
import { canManageMeetings } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

/** Schedule a meeting for a course (ARU-10): the course owner or the teacher. */
export default function ScheduleMeetingScreen() {
  const { id: courseId } = useLocalSearchParams<{ id: string }>();
  const { currentUser, getCourse, addMeeting } = useStore();
  // One id per form: a retry after a network error cannot schedule a second meeting.
  const [id] = useState(newId);
  const [initial] = useState(() => ({ startsAt: nextFullHour(), topic: '', location: '' }));
  const { busy, error, run } = useAction();
  const { t } = useI18n();

  const course = getCourse(courseId);
  if (!course) return <EmptyState title={t('meetings.courseNotFound')} />;
  if (currentUser && !canManageMeetings(currentUser, course)) {
    return <EmptyState title={t('meetings.notAllowed')} hint={t('meetings.onlyScheduleHint')} />;
  }

  return (
    <MeetingForm
      initial={initial}
      submitTitle={t('meetings.schedule')}
      busyTitle={t('meetings.scheduling')}
      busy={busy}
      error={error}
      onSubmit={(values) =>
        run(async () => {
          await addMeeting({
            id,
            courseId: course.id,
            startsAt: values.startsAt.toISOString(),
            topic: values.topic,
            location: values.location,
          });
          if (router.canGoBack()) router.back();
          else router.replace({ pathname: '/courses/[id]', params: { id: course.id } });
        })
      }
    />
  );
}
