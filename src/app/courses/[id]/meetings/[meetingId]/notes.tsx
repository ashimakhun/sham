import { router, Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { MarkdownEditor } from '@/components/MarkdownEditor';
import { MarkdownText } from '@/components/MarkdownText';
import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { canManageMeetings, canSeeMeetings } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { formatDateTime } from '@/lib/theme';
import type { Course, Meeting } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** Notes on a completed meeting (ARU-28): read view for everyone who sees the meeting; `?edit=1` is the editor for
 *  the course's current owner or the teacher. */
export default function MeetingNotesScreen() {
  const { id: courseId, meetingId, edit } = useLocalSearchParams<{ id: string; meetingId: string; edit?: string }>();
  const { currentUser, courseMembers, getCourse, meetings } = useStore();

  const course = getCourse(courseId);
  const meeting = meetings.find((m) => m.id === meetingId && m.courseId === courseId);
  if (!course || !meeting || !canSeeMeetings(currentUser, course, courseMembers)) {
    return <EmptyState title="Meeting not found" />;
  }
  const canEdit = canManageMeetings(currentUser, course);

  if (edit === '1') {
    if (!canEdit) return <EmptyState title="Not allowed" hint="Only the course owner or the teacher can edit notes." />;
    if (meeting.status !== 'completed') {
      return <EmptyState title="Can't add notes" hint="Notes can be added only to completed meetings." />;
    }
    return <NotesEditor course={course} meeting={meeting} />;
  }
  return <NotesView course={course} meeting={meeting} canEdit={canEdit && meeting.status === 'completed'} />;
}

function NotesView({ course, meeting, canEdit }: { course: Course; meeting: Meeting; canEdit: boolean }) {
  const { getUser } = useStore();
  const editor = meeting.notesUpdatedById ? (getUser(meeting.notesUpdatedById)?.name ?? 'Unknown') : undefined;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: 'Notes' }} />
      <View style={{ gap: 2 }}>
        <Text style={styles.title}>{meeting.topic}</Text>
        <Text style={styles.muted}>{formatDateTime(meeting.startsAt)}</Text>
      </View>
      {meeting.notes ? (
        <Card>
          <MarkdownText source={meeting.notes} />
          {editor && meeting.notesUpdatedAt ? (
            <Text style={[styles.muted, { paddingTop: 4 }]}>
              Last edited by {editor}, {formatDateTime(meeting.notesUpdatedAt)}
            </Text>
          ) : null}
        </Card>
      ) : (
        <EmptyState title="No notes yet" />
      )}
      {canEdit && (
        <Button
          title={meeting.notes ? 'Edit notes' : 'Add notes'}
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
    confirmAction('Discard changes?', 'Your changes to the notes will be lost.', 'Discard', {
      destructive: true,
      cancelText: 'Keep editing',
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
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: meeting.notes ? 'Edit notes' : 'Add notes' }} />
      <View style={[styles.content, { flex: 1 }]}>
        <Text style={styles.muted} numberOfLines={1}>
          {meeting.topic} · {formatDateTime(meeting.startsAt)}
        </Text>
        <MarkdownEditor value={draft} onChange={setDraft} placeholder="What was covered in this meeting?" />
        <ErrorText error={error} />
        <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}
