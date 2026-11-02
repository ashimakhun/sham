import { router } from 'expo-router';
import { useRef } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, ErrorText, HiddenBadge, styles } from '@/components/ui';
import { disciplineFeedback, HIDDEN_DISCIPLINE } from '@/lib/disciplines';
import { ratingSummary, ratingSummaryLabel } from '@/lib/feedback';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { Course, Discipline } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** ARU-63 AC 6: "Discipline: <name>" when the course has a discipline the viewer can see; nothing otherwise. */
export function DisciplineLabel({ course }: { course: Course }) {
  const { getDiscipline } = useStore();
  const discipline = getDiscipline(course.disciplineId);
  if (!discipline) return null;
  return (
    <Text style={styles.muted} numberOfLines={2} accessibilityLabel={`Discipline, ${discipline.name}`}>
      Discipline: {discipline.name}
    </Text>
  );
}

/**
 * ARU-63 AC 4 / AC 5: pick "No discipline" or one of the disciplines the user can see (hidden ones only exist for the
 * teacher, marked Hidden). `value` is the current discipline id; an id that doesn't resolve is a discipline hidden
 * from the user, shown as "Hidden discipline" so they can keep it.
 */
export function DisciplinePicker({
  value,
  onChange,
  disabled,
}: {
  value: string | undefined;
  onChange: (disciplineId: string | undefined) => void;
  disabled?: boolean;
}) {
  const { disciplines, getDiscipline } = useStore();
  const hiddenFromMe = !!value && !getDiscipline(value);
  const options: { id: string | undefined; label: string; hidden?: boolean }[] = [
    { id: undefined, label: 'No discipline' },
    ...(hiddenFromMe ? [{ id: value, label: HIDDEN_DISCIPLINE }] : []),
    ...disciplines.map((d) => ({ id: d.id, label: d.name, hidden: d.hidden })),
  ];
  const current = options.find((o) => o.id === value) ?? options[0];
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label} accessibilityLabel={`Discipline, ${current.label}`}>
        Discipline
      </Text>
      <View accessibilityRole="radiogroup" style={{ gap: 6 }}>
        {options.map((o) => {
          const selected = o.id === value;
          return (
            <Pressable
              key={o.id ?? 'none'}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(o.id)}
              style={({ pressed }) => [
                styles.input,
                { flexDirection: 'row', alignItems: 'center', gap: 8 },
                selected && { borderColor: colors.primary, backgroundColor: colors.primarySoft },
                pressed && { opacity: 0.7 },
              ]}>
              <Text style={[styles.body, { flexShrink: 1 }, selected && { color: colors.primary, fontWeight: '600' }]}>
                {o.label}
              </Text>
              {o.hidden ? <HiddenBadge /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** ARU-63 AC 5: on course details, the current owner changes the course's discipline (saved on tap). */
export function CourseDisciplineSection({ course }: { course: Course }) {
  const { currentUser, setCourseDiscipline } = useStore();
  const { busy, error, run } = useAction();
  if (!currentUser || course.createdById !== currentUser.id) return null;
  return (
    <Card style={{ gap: 8 }}>
      <DisciplinePicker
        value={course.disciplineId}
        disabled={busy}
        onChange={(id) => {
          // Keeping the current value (also a hidden one) changes nothing.
          if (id === course.disciplineId) return;
          run(() => setCourseDiscipline(course.id, id ?? null));
        }}
      />
      {busy ? <Text style={styles.muted}>Saving…</Text> : null}
      <ErrorText error={error} />
    </Card>
  );
}

/** A second tap within this window is ignored, so a quick double tap opens only one screen. */
const TAP_GUARD_MS = 800;

/** ARU-63 AC 9: a discipline in the Disciplines view: its name, Hidden badge (teacher) and rating summary. */
export function DisciplineCard({ discipline, onOpen }: { discipline: Discipline; onOpen?: () => void }) {
  const { courses, courseFeedback } = useStore();
  const feedback = disciplineFeedback(discipline.id, courses, courseFeedback);
  const rating = ratingSummary(feedback);
  const lastTap = useRef(0);
  const open = () => {
    const now = Date.now();
    if (now - lastTap.current < TAP_GUARD_MS) return;
    lastTap.current = now;
    onOpen?.();
    router.push({ pathname: '/disciplines/[id]', params: { id: discipline.id } });
  };
  return (
    <Card onPress={open}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.title, { flexShrink: 1 }]} numberOfLines={2}>
          {discipline.name}
        </Text>
        {discipline.hidden ? <HiddenBadge /> : null}
      </View>
      {rating ? (
        <Text style={styles.muted} accessibilityLabel={ratingSummaryLabel(feedback)}>
          {rating}
        </Text>
      ) : null}
    </Card>
  );
}
