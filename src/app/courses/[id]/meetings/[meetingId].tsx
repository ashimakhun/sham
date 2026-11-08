import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { MeetingForm } from '@/components/MeetingForm';
import { EmptyState } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { canManageMeetings } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

/** Edit or reschedule a Scheduled meeting (ARU-15): the course owner or the teacher. */
export default function EditMeetingScreen() {
  const { id: courseId, meetingId } = useLocalSearchParams<{ id: string; meetingId: string }>();
  const { currentUser, getCourse, meetings, updateMeeting } = useStore();
  const { busy, error, run } = useAction();
  const { t } = useI18n();

  const course = getCourse(courseId);
  const meeting = meetings.find((m) => m.id === meetingId && m.courseId === courseId);
  // Captured when the screen opens: a live update (e.g. canceled on another device) doesn't swap the form away;
  // the save is then rejected by the database and the error shown.
  const [opened] = useState(() =>
    meeting
      ? {
          status: meeting.status,
          startsAt: meeting.startsAt,
          values: { startsAt: new Date(meeting.startsAt), topic: meeting.topic, location: meeting.location ?? '' },
        }
      : undefined,
  );

  if (!course || !opened) return <EmptyState title={t('meetings.notFound')} />;
  if (currentUser && !canManageMeetings(currentUser, course)) {
    return <EmptyState title={t('meetings.notAllowed')} hint={t('meetings.onlyEditHint')} />;
  }
  if (opened.status !== 'scheduled') {
    return <EmptyState title={t('meetings.cantEdit')} hint={t('meetings.cantEditHint')} />;
  }

  return (
    <MeetingForm
      initial={opened.values}
      submitTitle={t('common.save')}
      busyTitle={t('common.saving')}
      busy={busy}
      error={error}
      checkTimeOnlyWhenChanged
      onSubmit={(values) =>
        run(async () => {
          await updateMeeting(meetingId, {
            // Unchanged time: send back exactly what was loaded, so it isn't treated as a reschedule.
            startsAt: values.timeChanged ? values.startsAt.toISOString() : opened.startsAt,
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
