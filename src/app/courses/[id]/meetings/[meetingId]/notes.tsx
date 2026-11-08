import { router, Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { KeyboardForm } from '@/components/KeyboardForm';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { MarkdownText } from '@/components/MarkdownText';
import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { confirmAction } from '@/lib/confirm';
import { canManageMeetings, canSeeMeetings } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import type { Course, Meeting } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** Notes on a completed meeting (ARU-28): read view for everyone who sees the meeting; `?edit=1` is the editor for
 *  the course's current owner or the teacher. */
export default function MeetingNotesScreen() {
  const { id: courseId, meetingId, edit } = useLocalSearchParams<{ id: string; meetingId: string; edit?: string }>();
  const { currentUser, courseMembers, getCourse, meetings } = useStore();
  const { t } = useI18n();

  const course = getCourse(courseId);
  const meeting = meetings.find((m) => m.id === meetingId && m.courseId === courseId);
  if (!course || !meeting || !canSeeMeetings(currentUser, course, courseMembers)) {
    return <EmptyState title={t('meetings.notFound')} />;
  }
  const canEdit = canManageMeetings(currentUser, course);

  if (edit === '1') {
    if (!canEdit) return <EmptyState title={t('meetings.notAllowed')} hint={t('notes.onlyEditHint')} />;
    if (meeting.status !== 'completed') {
      return <EmptyState title={t('notes.cantAdd')} hint={t('notes.cantAddHint')} />;
    }
    return <NotesEditor course={course} meeting={meeting} />;
  }
  return <NotesView course={course} meeting={meeting} canEdit={canEdit && meeting.status === 'completed'} />;
}

function NotesView({ course, meeting, canEdit }: { course: Course; meeting: Meeting; canEdit: boolean }) {
  const { getUser } = useStore();
  const { t } = useI18n();
  // Notes edited by someone who then deleted their account have no editor any more (ARU-75): "Deleted account".
  const editor = meeting.notesUpdatedById
    ? (getUser(meeting.notesUpdatedById)?.name ?? t('common.unknown'))
    : meeting.notes && meeting.notesUpdatedAt
      ? t('common.deletedAccount')
      : undefined;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: t('notes.title') }} />
      <View style={{ gap: 2 }}>
        <Text style={styles.title}>{meeting.topic}</Text>
        <Text style={styles.muted}>{formatDateTime(meeting.startsAt)}</Text>
      </View>
      {meeting.notes ? (
        <Card>
          <MarkdownText source={meeting.notes} />
          {editor && meeting.notesUpdatedAt ? (
            <Text style={[styles.muted, { paddingTop: 4 }]}>
              {t('notes.lastEdited', { name: editor, when: formatDateTime(meeting.notesUpdatedAt) })}
            </Text>
          ) : null}
        </Card>
      ) : (
        <EmptyState title={t('notes.none')} />
      )}
      {canEdit && (
        <Button
          title={t(meeting.notes ? 'notes.edit' : 'notes.add')}
          variant="secondary"
          // Replace the view, so Save (which goes back) lands on the course details.
          onPress={() =>
            router.replace({
              pathname: '/courses/[id]/meetings/[meetingId]/notes',
              params: { id: course.id, meetingId: meeting.id, edit: '1' },
            })
          }
        />
      )}
    </ScrollView>
  );
}

function NotesEditor({ course, meeting }: { course: Course; meeting: Meeting }) {
  const { setMeetingNotes } = useStore();
  const { busy, error, run } = useAction();
  const { t } = useI18n();
  // Prefilled once: a live update from another device doesn't overwrite what is being typed (last save wins).
  const [initial] = useState(meeting.notes ?? '');
  const [draft, setDraft] = useState(initial);
  const saving = useRef(false);
  const dirty = draft !== initial;

  // Leaving (after Save, or "Discard"): first turn the unsaved-changes prompt off, then navigate on the next render.
  const [leaving, setLeaving] = useState(false);
  const leave = useRef<() => void>(undefined);
  useEffect(() => {
    if (leaving) leave.current?.();
  }, [leaving]);

  usePreventRemove(dirty && !busy && !leaving, ({ repeat }) => {
    confirmAction(t('notes.discardTitle'), t('notes.discardMessage'), t('notes.discard'), {
      destructive: true,
      cancelText: t('notes.keepEditing'),
    }).then((discard) => {
      if (!discard) return;
      // Continue the navigation the user started (back button, swipe).
      leave.current = repeat;
      setLeaving(true);
    });
  });

  function save() {
    if (saving.current) return;
    saving.current = true;
    run(async () => {
      try {
        await setMeetingNotes(meeting.id, draft);
        leave.current = () => {
          if (router.canGoBack()) router.back();
          else router.replace({ pathname: '/courses/[id]', params: { id: course.id } });
        };
        setLeaving(true);
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    // Scrolls above the keyboard and closes it on drag or a tap outside the field; Save is always reachable (ARU-58).
    <KeyboardForm contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: t(meeting.notes ? 'notes.edit' : 'notes.add'),
          // Always above the keyboard, whatever the field's size (ARU-58); the Save below stays for when it's closed.
          headerRight: () => <HeaderSave busy={busy} onPress={save} />,
        }}
      />
      <Text style={styles.muted} numberOfLines={1}>
        {meeting.topic} · {formatDateTime(meeting.startsAt)}
      </Text>
      <MarkdownEditor value={draft} onChange={setDraft} placeholder={t('notes.placeholder')} />
      <ErrorText error={error} />
      <Button title={t(busy ? 'common.saving' : 'common.save')} onPress={save} disabled={busy} />
    </KeyboardForm>
  );
}

function HeaderSave({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('notes.saveA11y')}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      hitSlop={8}
      onPress={onPress}
      style={{ paddingHorizontal: 8, minHeight: 44, justifyContent: 'center' }}>
      <Text style={[styles.caps, { fontSize: 16, color: busy ? colors.muted : colors.primary }]}>
        {t(busy ? 'common.saving' : 'common.save')}
      </Text>
    </Pressable>
  );
}
