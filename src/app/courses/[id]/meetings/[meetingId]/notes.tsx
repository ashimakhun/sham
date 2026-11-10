import { router, Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';

import { KeyboardForm } from '@/components/KeyboardForm';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { MarkdownText } from '@/components/MarkdownText';
import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { confirmAction } from '@/lib/confirm';
import {
  canDeleteListenerNote,
  canManageMeetings,
  canSeeMeetings,
  isCourseListener,
} from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import type { Course, Meeting, MeetingListenerNote } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** Notes on a completed meeting (ARU-28): read view for everyone who sees the meeting; `?edit=1` is the editor for
 *  the course's current owner or the teacher. ARU-125: the view also lists the listeners' notes; `?mine=1` is a
 *  current listener's editor for their own notes. */
export default function MeetingNotesScreen() {
  const {
    id: courseId,
    meetingId,
    edit,
    mine,
  } = useLocalSearchParams<{ id: string; meetingId: string; edit?: string; mine?: string }>();
  const { currentUser, courseMembers, getCourse, meetings, meetingListenerNotes, setMeetingNotes, saveMyMeetingNotes } =
    useStore();
  const { t } = useI18n();

  const course = getCourse(courseId);
  const meeting = meetings.find((m) => m.id === meetingId && m.courseId === courseId);
  if (!course || !meeting || !canSeeMeetings(currentUser, course, courseMembers)) {
    return <EmptyState title={t('meetings.notFound')} />;
  }
  const canEdit = canManageMeetings(currentUser, course);
  const listenerNotes = (meetingListenerNotes ?? []).filter((n) => n.meetingId === meeting.id);
  const myNote = currentUser ? listenerNotes.find((n) => n.authorId === currentUser.id) : undefined;

  if (edit === '1') {
    if (!canEdit) return <EmptyState title={t('meetings.notAllowed')} hint={t('notes.onlyEditHint')} />;
    if (meeting.status !== 'completed') {
      return <EmptyState title={t('notes.cantAdd')} hint={t('notes.cantAddHint')} />;
    }
    return (
      <NotesEditor
        course={course}
        meeting={meeting}
        initialText={meeting.notes ?? ''}
        title={t(meeting.notes ? 'notes.edit' : 'notes.add')}
        placeholder={t('notes.placeholder')}
        onSave={(text) => setMeetingNotes(meeting.id, text)}
      />
    );
  }
  if (mine === '1') {
    if (!isCourseListener(currentUser, course, courseMembers)) {
      return <EmptyState title={t('meetings.notAllowed')} hint={t('notes.listenersOnlyHint')} />;
    }
    if (meeting.status !== 'completed') {
      return <EmptyState title={t('notes.cantAdd')} hint={t('notes.cantAddHint')} />;
    }
    return (
      <NotesEditor
        // A fresh editor once the entry exists (e.g. saved on another device), so Save changes that entry.
        key={myNote?.id ?? 'new'}
        course={course}
        meeting={meeting}
        initialText={myNote?.body ?? ''}
        title={t(myNote ? 'notes.editMine' : 'notes.addMine')}
        placeholder={t('notes.myPlaceholder')}
        // AC 2: blank text can't be saved (the database refuses it too).
        requireText
        onSave={(text) => saveMyMeetingNotes(meeting.id, text)}
      />
    );
  }
  return (
    <NotesView
      course={course}
      meeting={meeting}
      canEdit={canEdit && meeting.status === 'completed'}
      listenerNotes={listenerNotes}
    />
  );
}

function NotesView({
  course,
  meeting,
  canEdit,
  listenerNotes,
}: {
  course: Course;
  meeting: Meeting;
  canEdit: boolean;
  listenerNotes: MeetingListenerNote[];
}) {
  // ARU-125: a listener adds or edits their own notes from the meeting row ("Add my notes" / "Edit my notes").
  const { currentUser, courseMembers, getUser } = useStore();
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
      ) : listenerNotes.length === 0 ? (
        <EmptyState title={t('notes.none')} />
      ) : null}
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
      {/* ARU-125 AC 6: below the owner's notes, every listener's entry, oldest first. */}
      {listenerNotes.length > 0 && (
        <View testID="listener-notes" style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={styles.label}>
            {t('notes.listenersHeading').toUpperCase()}
          </Text>
          {listenerNotes.map((n) => (
            <ListenerNoteCard
              key={n.id}
              note={n}
              canDelete={canDeleteListenerNote(currentUser, course, courseMembers, n)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

/** ARU-125 AC 6: one listener's entry: the author, when it was added, "Edited <date and time>" once changed, and the
 *  text. Delete for the author (AC 4) and for the course's current owner and the teacher (AC 9). */
function ListenerNoteCard({ note, canDelete }: { note: MeetingListenerNote; canDelete: boolean }) {
  const { currentUser, getUser, deleteMeetingListenerNotes } = useStore();
  const { busy, error, run } = useAction();
  const { t } = useI18n();
  const own = !!currentUser && note.authorId === currentUser.id;
  // AC 12: no author any more means they deleted their account.
  const author = note.authorId ? (getUser(note.authorId)?.name ?? t('common.unknown')) : t('common.deletedAccount');
  const edited = new Date(note.updatedAt).getTime() > new Date(note.createdAt).getTime();

  function remove() {
    run(async () => {
      const confirmed = await confirmAction(
        t('notes.deleteTitle'),
        own ? t('notes.deleteMine') : t('notes.deleteOther', { name: author }),
        t('notes.delete'),
        { destructive: true },
      );
      if (!confirmed) return;
      await deleteMeetingListenerNotes(note.id);
    });
  }

  return (
    <Card testID={`listener-note-${note.id}`}>
      <View style={{ gap: 2 }}>
        <Text style={{ fontWeight: '600', color: colors.text }}>{author}</Text>
        <Text style={styles.muted}>{formatDateTime(note.createdAt)}</Text>
        {edited ? <Text style={styles.muted}>{t('notes.edited', { when: formatDateTime(note.updatedAt) })}</Text> : null}
      </View>
      <MarkdownText source={note.body} />
      <ErrorText error={error} />
      {canDelete && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={own ? t('notes.deleteTitle') : t('notes.deleteOtherA11y', { name: author })}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          hitSlop={8}
          onPress={remove}
          style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colors.danger, fontWeight: '600', opacity: busy ? 0.4 : 1 }}>{t('notes.deleteTitle')}</Text>
        </Pressable>
      )}
    </Card>
  );
}

function NotesEditor({
  course,
  meeting,
  initialText,
  title,
  placeholder,
  requireText = false,
  onSave,
}: {
  course: Course;
  meeting: Meeting;
  initialText: string;
  title: string;
  placeholder: string;
  /** ARU-125: Save is disabled while the text is blank (the owner's notes are cleared with blank text instead). */
  requireText?: boolean;
  onSave: (text: string) => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const { t } = useI18n();
  // Prefilled once: a live update from another device doesn't overwrite what is being typed (last save wins).
  const [initial] = useState(initialText);
  const [draft, setDraft] = useState(initial);
  const saving = useRef(false);
  const dirty = draft !== initial;
  const blocked = busy || (requireText && draft.trim() === '');

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
    if (saving.current || blocked) return;
    saving.current = true;
    run(async () => {
      try {
        await onSave(draft);
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
          title,
          // Always above the keyboard, whatever the field's size (ARU-58); the Save below stays for when it's closed.
          headerRight: () => <HeaderSave busy={busy} disabled={blocked} onPress={save} />,
        }}
      />
      <Text style={styles.muted} numberOfLines={1}>
        {meeting.topic} · {formatDateTime(meeting.startsAt)}
      </Text>
      <MarkdownEditor value={draft} onChange={setDraft} placeholder={placeholder} />
      <ErrorText error={error} />
      <Button title={t(busy ? 'common.saving' : 'common.save')} onPress={save} disabled={blocked} />
    </KeyboardForm>
  );
}

function HeaderSave({ busy, disabled = busy, onPress }: { busy: boolean; disabled?: boolean; onPress: () => void }) {
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('notes.saveA11y')}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={{ paddingHorizontal: 8, minHeight: 44, justifyContent: 'center' }}>
      <Text style={[styles.caps, { fontSize: 16, color: disabled ? colors.muted : colors.primary }]}>
        {t(busy ? 'common.saving' : 'common.save')}
      </Text>
    </Pressable>
  );
}
