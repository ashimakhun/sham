import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { MeetingForm } from '@/components/MeetingForm';
import { EmptyState } from '@/components/ui';
import { canManageMeetings } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

/** Edit or reschedule a Scheduled meeting (ARU-15): the course owner or the teacher. */
export default function EditMeetingScreen() {
  const { id: courseId, meetingId } = useLocalSearchParams<{ id: string; meetingId: string }>();
  const { currentUser, getCourse, meetings, updateMeeting } = useStore();
  const { busy, error, run } = useAction();

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

  if (!course || !opened) return <EmptyState title="Meeting not found" />;
  if (currentUser && !canManageMeetings(currentUser, course)) {
    return <EmptyState title="Not allowed" hint="Only the course owner or the teacher can edit meetings." />;
  }
  if (opened.status !== 'scheduled') {
    return <EmptyState title="Can't edit this meeting" hint="Completed and canceled meetings can't be changed." />;
  }

  return (
    <MeetingForm
      initial={opened.values}
      submitTitle="Save"
      busyTitle="Saving…"
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
