import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useFocusEffect, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';

import { KeyboardForm } from '@/components/KeyboardForm';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { MarkdownText } from '@/components/MarkdownText';
import { Button, Card, EmptyState, ErrorText, styles, ThemedSwitch } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { confirmAction } from '@/lib/confirm';
import { font } from '@/lib/fonts';
import { canDeleteListenerNote, canSeeMeetings, canWriteNotes, isNotesWriter } from '@/lib/roles';
import { NOTES_MAX } from '@/lib/markdown';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import type { Course, Meeting, MeetingListenerNote } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** Meeting notes (ARU-28, ARU-125; one kind since ARU-142): the read view lists every signed note on a completed
 *  meeting, oldest first; `?edit=1` is my own notes editor, for a current listener, the course's owner or the
 *  teacher. */
export default function MeetingNotesScreen() {
  const { id: courseId, meetingId, edit } = useLocalSearchParams<{ id: string; meetingId: string; edit?: string }>();
  const { currentUser, courseMembers, getCourse, meetings, meetingListenerNotes, saveMyMeetingNotes, refreshMeetingNotes } =
    useStore();
  const { t } = useI18n();
  // ARU-153: the editor's key, frozen while my own save is in flight (and after it succeeds, as the editor is leaving).
  // My save adds my note to the store, which would change the key from 'new' to the note's id, remount the editor and
  // lose the navigation it scheduled. A note saved on another device still changes the key (nothing is frozen then).
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  // ARU-143 AC 10: a note made private on another device disappears the next time this screen opens (realtime doesn't
  // tell a client that lost access to a row).
  useFocusEffect(
    useCallback(() => {
      refreshMeetingNotes().catch(() => {});
    }, [refreshMeetingNotes]),
  );

  const course = getCourse(courseId);
  const meeting = meetings.find((m) => m.id === meetingId && m.courseId === courseId);
  if (!course || !meeting || !canSeeMeetings(currentUser, course, courseMembers)) {
    return <EmptyState title={t('meetings.notFound')} />;
  }
  const notes = (meetingListenerNotes ?? []).filter((n) => n.meetingId === meeting.id);
  const myNote = currentUser ? notes.find((n) => n.authorId === currentUser.id) : undefined;

  if (edit === '1') {
    if (!isNotesWriter(currentUser, course, courseMembers)) {
      return <EmptyState title={t('meetings.notAllowed')} hint={t('notes.onlyEditHint')} />;
    }
    if (meeting.status !== 'completed') {
      return <EmptyState title={t('notes.cantAdd')} hint={t('notes.cantAddHint')} />;
    }
    const liveKey = myNote?.id ?? 'new';
    const onSave = async (text: string, isPublic: boolean) => {
      setPinnedKey(liveKey);
      try {
        await saveMyMeetingNotes(meeting.id, text, isPublic);
      } catch (e) {
        // A failed save keeps the editor open, so it follows the live entry again.
        setPinnedKey(null);
        throw e;
      }
    };
    return (
      <NotesEditor
        // A fresh editor once the entry exists (e.g. saved on another device), so Save changes that entry; but not
        // because of my own save (ARU-153).
        key={pinnedKey ?? liveKey}
        course={course}
        meeting={meeting}
        initialText={myNote?.body ?? ''}
        // ARU-143 AC 1 / 2: a new note starts private; my existing note shows its current state.
        initialPublic={myNote?.isPublic ?? false}
        onSave={onSave}
      />
    );
  }
  return (
    <NotesView
      course={course}
      meeting={meeting}
      canWrite={canWriteNotes(currentUser, course, courseMembers, meeting)}
      hasMine={!!myNote}
      notes={notes}
    />
  );
}

function NotesView({
  course,
  meeting,
  canWrite,
  hasMine,
  notes,
}: {
  course: Course;
  meeting: Meeting;
  canWrite: boolean;
  hasMine: boolean;
  notes: MeetingListenerNote[];
}) {
  const { currentUser, courseMembers } = useStore();
  const { t } = useI18n();
  // Replace the view, so Save (which goes back) lands on the course details.
  const openEditor = () =>
    router.replace({
      pathname: '/courses/[id]/meetings/[meetingId]/notes',
      params: { id: course.id, meetingId: meeting.id, edit: '1' },
    });
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      {/* ARU-142 AC 4: the pencil at the header's right opens my notes editor, for anyone who can write. */}
      <Stack.Screen
        options={{
          title: t('notes.title'),
          headerRight: canWrite
            ? () => <HeaderEdit label={t(hasMine ? 'notes.edit' : 'notes.add')} onPress={openEditor} />
            : undefined,
        }}
      />
      {/* ARU-129: the meeting is named by its date and time (no topic). */}
      <Text style={styles.title}>{formatDateTime(meeting.startsAt)}</Text>
      {/* ARU-142 AC 7: every note, oldest first, with no section heading. */}
      {notes.length === 0 ? (
        <EmptyState title={t('notes.none')} />
      ) : (
        <View testID="meeting-notes" style={{ gap: 12 }}>
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} canDelete={canDeleteListenerNote(currentUser, course, courseMembers, n)} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

/** ARU-125 AC 6: one entry: the author, when it was added, "Edited <date and time>" once changed, and the text.
 *  Delete for the author (AC 4) and for the course's current owner and the teacher (AC 9). */
function NoteCard({ note, canDelete }: { note: MeetingListenerNote; canDelete: boolean }) {
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
        {/* ARU-143 AC 6 / 11: my own private notes carry a "Private" badge, read together with my name. */}
        {note.isPublic ? (
          <Text style={{ ...font(600), color: colors.text }}>{author}</Text>
        ) : (
          <View
            accessible
            accessibilityLabel={`${author}, ${t('notes.privateBadge')}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ ...font(600), color: colors.text }}>{author}</Text>
            <View testID="private-badge" style={{ backgroundColor: colors.primarySoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={[styles.caps, { fontSize: 11, color: colors.primary }]}>{t('notes.privateBadge')}</Text>
            </View>
          </View>
        )}
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
          <Text style={[styles.linkText, { color: colors.danger, opacity: busy ? 0.4 : 1 }]}>{t('notes.deleteTitle')}</Text>
        </Pressable>
      )}
    </Card>
  );
}

function NotesEditor({
  course,
  meeting,
  initialText,
  initialPublic,
  onSave,
}: {
  course: Course;
  meeting: Meeting;
  initialText: string;
  initialPublic: boolean;
  onSave: (text: string, isPublic: boolean) => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const { t } = useI18n();
  // Prefilled once: a live update from another device doesn't overwrite what is being typed (last save wins).
  const [initial] = useState(initialText);
  const [draft, setDraft] = useState(initial);
  const [startPublic] = useState(initialPublic);
  const [isPublic, setPublic] = useState(startPublic);
  const saving = useRef(false);
  // ARU-143 AC 3: the text or the Publish switch changed (a switch change alone also asks to discard on leaving).
  const dirty = draft !== initial || isPublic !== startPublic;
  // Blank can't be saved (ARU-125 AC 2); nor can a note still over the limit (a merged note from ARU-142's migration
  // must be shortened first: the editor never cuts it); nor can nothing changed (ARU-143 AC 3).
  const blocked = busy || !dirty || draft.trim() === '' || draft.trim().length > NOTES_MAX;

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
        await onSave(draft, isPublic);
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
          // ARU-142 AC 5: the editor's title is "Notes".
          title: t('notes.title'),
          // Always above the keyboard, whatever the field's size (ARU-58); the Save below stays for when it's closed.
          headerRight: () => <HeaderSave busy={busy} disabled={blocked} onPress={save} />,
        }}
      />
      <Text style={styles.muted} numberOfLines={1}>
        {formatDateTime(meeting.startsAt)}
      </Text>
      <MarkdownEditor value={draft} onChange={setDraft} placeholder={t('notes.placeholder')} />
      {/* ARU-143 AC 1 / 11: the Publish switch (off = only me), its hint under it. */}
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
          <Text style={{ ...font(500), color: colors.text, fontSize: 16, flexShrink: 1 }}>{t('notes.publish')}</Text>
          <ThemedSwitch
            testID="notes-publish"
            accessibilityLabel={t('notes.publish')}
            accessibilityHint={t(isPublic ? 'notes.publicHint' : 'notes.privateHint')}
            value={isPublic}
            onValueChange={setPublic}
            disabled={busy}
          />
        </View>
        <Text style={styles.muted}>{t(isPublic ? 'notes.publicHint' : 'notes.privateHint')}</Text>
      </View>
      <ErrorText error={error} />
      <Button title={t(busy ? 'common.saving' : 'common.save')} onPress={save} disabled={blocked} />
    </KeyboardForm>
  );
}

/** ARU-126 AC 6 / ARU-142 AC 4: the read view's pencil (Ionicons create-outline), labelled "Add notes" / "Edit notes"
 *  (hidden, never shown). */
function HeaderEdit({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      testID="notes-edit"
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={{ paddingHorizontal: 8, minHeight: 44, justifyContent: 'center' }}>
      <Ionicons name="create-outline" size={22} color={colors.primary} />
    </Pressable>
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
