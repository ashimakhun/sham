import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';

import { Text } from '@/components/AppText';

import { DateTimeField } from '@/components/DateTimeField';
import { KeyboardForm } from '@/components/KeyboardForm';
import { nextFullHour } from '@/components/MeetingForm';
import { Button, EmptyState, ErrorText, Field, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { newId } from '@/lib/id';
import { canManageMeetings } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import { useAction } from '@/lib/useAction';
import { useNow } from '@/lib/useNow';

const TITLE_MAX = 200;

/** Assign homework to a completed meeting (ARU-32): the course's current owner or the teacher, once per meeting. */
export default function AssignHomeworkScreen() {
  const { id: courseId, meetingId } = useLocalSearchParams<{ id: string; meetingId: string }>();
  const { currentUser, getCourse, meetings, assignments, addAssignment } = useStore();
  // One id per form: a retry after a network error cannot assign twice.
  const [id] = useState(newId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState<Date>();
  const { busy, error, run } = useAction();
  const { t } = useI18n();
  const saving = useRef(false);
  const now = useNow(15_000);

  const course = getCourse(courseId);
  const meeting = meetings.find((m) => m.id === meetingId && m.courseId === courseId);
  // An assignment this form saved itself doesn't count: the screen is closing.
  const existing = assignments.find((a) => a.meetingId === meetingId && a.id !== id);

  if (!course || !meeting) return <EmptyState title={t('meetings.notFound')} />;
  if (currentUser && !canManageMeetings(currentUser, course)) {
    return <EmptyState title={t('meetings.notAllowed')} hint={t('meetings.onlyAssignHint')} />;
  }
  if (meeting.status !== 'completed') {
    return <EmptyState title={t('meetings.cantAssign')} hint={t('meetings.cantAssignHint')} />;
  }
  if (existing) return <EmptyState title={t('meetings.alreadyAssigned')} hint={t('errors.meetingHasHomework')} />;

  const dueOk = !dueAt || dueAt.getTime() > now;
  const titleOk = title.trim().length > 0 && title.trim().length <= TITLE_MAX;

  function save() {
    if (saving.current) return;
    saving.current = true;
    run(async () => {
      try {
        await addAssignment({
          id,
          meetingId: meeting!.id,
          courseId: course!.id,
          title,
          description,
          dueAt: dueAt?.toISOString(),
        });
        if (router.canGoBack()) router.back();
        else router.replace({ pathname: '/courses/[id]', params: { id: course!.id } });
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    <KeyboardForm>
      <Text style={styles.muted} numberOfLines={2}>
        {course.title} · {meeting.topic} · {formatDateTime(meeting.startsAt)}
      </Text>
      <Field
        label={t('meetings.hwTitleLabel')}
        placeholder={t('meetings.hwTitlePlaceholder')}
        value={title}
        onChangeText={setTitle}
        maxLength={TITLE_MAX}
      />
      <Field
        label={t('meetings.hwDescriptionLabel')}
        placeholder={t('meetings.hwDescriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        multiline
      />
      {dueAt ? (
        <>
          <DateTimeField label={t('meetings.deadline')} value={dueAt} onChange={setDueAt} />
          {!dueOk && <Text style={{ color: colors.warning, fontSize: 14 }}>{t('errors.deadlinePast')}</Text>}
          <Button title={t('meetings.removeDeadline')} variant="secondary" onPress={() => setDueAt(undefined)} />
        </>
      ) : (
        <Button
          title={t('meetings.addDeadline')}
          variant="secondary" // Default: tomorrow, on the next full hour.
          onPress={() => setDueAt(new Date(nextFullHour(new Date(now)).getTime() + 24 * 60 * 60 * 1000))}
        />
      )}
      <ErrorText error={error} />
      <Button title={t(busy ? 'common.saving' : 'common.save')} onPress={save} disabled={!titleOk || !dueOk || busy} />
    </KeyboardForm>
  );
}
