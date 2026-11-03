import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, EmptyState, ErrorText, styles } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { courseStarted, FEEDBACK_MAX, starsLabel } from '@/lib/feedback';
import { isCourseListener } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { Course, CourseFeedback } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** Add or edit one's feedback on a course (ARU-53): 1–5 stars and up to 1,000 characters of text. */
export default function CourseFeedbackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCourse, currentUser, courseMembers, meetings, courseFeedback } = useStore();

  // Read once, so a live update while typing doesn't swap the form (or close it if the user is removed: the save
  // then shows the error and keeps the text, AC 12).
  const [course] = useState(() => getCourse(id));
  const [mine] = useState(() => courseFeedback.find((f) => f.courseId === id && f.userId === currentUser?.id));
  const [allowed] = useState(
    () => !!course && isCourseListener(currentUser, course, courseMembers) && (!!mine || courseStarted(meetings, course.id)),
  );

  if (!course) return <EmptyState title="Course not found" />;
  if (!allowed) {
    return <EmptyState title="Can't leave feedback" hint="Listeners leave feedback once the first meeting is completed." />;
  }
  return <FeedbackForm course={course} mine={mine} />;
}

function FeedbackForm({ course, mine }: { course: Course; mine?: CourseFeedback }) {
  const { saveFeedback } = useStore();
  const { busy, error, run } = useAction();
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [body, setBody] = useState(mine?.body ?? '');
  const saving = useRef(false);
  const dirty = rating !== (mine?.rating ?? 0) || body !== (mine?.body ?? '');
  const canSave = rating >= 1 && !!body.trim() && body.trim().length <= FEEDBACK_MAX && !busy;

  // Same unsaved-changes prompt as the meeting notes editor (ARU-28).
  const [leaving, setLeaving] = useState(false);
  const leave = useRef<() => void>(undefined);
  useEffect(() => {
    if (leaving) leave.current?.();
  }, [leaving]);
  usePreventRemove(dirty && !busy && !leaving, ({ repeat }) => {
    confirmAction('Discard changes?', 'Your feedback will be lost.', 'Discard', {
      destructive: true,
      cancelText: 'Keep editing',
    }).then((discard) => {
      if (!discard) return;
      leave.current = repeat;
      setLeaving(true);
    });
  });

  function save() {
    if (saving.current || !canSave) return;
    saving.current = true;
    run(async () => {
      try {
        await saveFeedback({ id: mine?.id, courseId: course.id, rating, body });
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
    <KeyboardForm>
      <Text style={styles.title}>{course.title}</Text>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Rating</Text>
        <View style={{ flexDirection: 'row', gap: 4 }} accessibilityRole="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityLabel={starsLabel(n)}
              accessibilityState={{ selected: rating === n, checked: rating === n }}
              onPress={() => setRating(n)}
              hitSlop={4}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 30, color: n <= rating ? '#F59E0B' : colors.border }}>★</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Feedback</Text>
        <TextInput
          accessibilityLabel="Feedback"
          placeholder="What went well, what could be better…"
          placeholderTextColor={colors.muted}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={FEEDBACK_MAX}
          style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]}
        />
        <Text style={[styles.muted, { alignSelf: 'flex-end' }]}>
          {body.trim().length}/{FEEDBACK_MAX}
        </Text>
      </View>
      <ErrorText error={error} />
      <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={!canSave} />
    </KeyboardForm>
  );
}
