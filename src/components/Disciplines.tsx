import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, ErrorText, HiddenBadge, styles } from '@/components/ui';
import { disciplineFeedback, HIDDEN_DISCIPLINE } from '@/lib/disciplines';
import { ratingSummary, ratingSummaryLabel } from '@/lib/feedback';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { Course, Discipline, User } from '@/lib/types';
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

type DisciplineOption = { id: string | undefined; label: string; hidden?: boolean };

/**
 * ARU-63 AC 4 / AC 5: "No discipline", then "Hidden discipline" when `value` is a discipline hidden from the user (so
 * they can keep it), then the disciplines they can see (hidden ones only exist for the teacher, marked Hidden).
 */
function useDisciplineOptions(value: string | undefined) {
  const { disciplines, getDiscipline } = useStore();
  const hiddenFromMe = !!value && !getDiscipline(value);
  const options: DisciplineOption[] = [
    { id: undefined, label: 'No discipline' },
    ...(hiddenFromMe ? [{ id: value, label: HIDDEN_DISCIPLINE }] : []),
    ...disciplines.map((d) => ({ id: d.id, label: d.name, hidden: d.hidden })),
  ];
  const current = options.find((o) => o.id === value) ?? options[0];
  return { options, current };
}

/** The radio list of discipline options; `value` is checked. */
function DisciplineOptions({
  options,
  value,
  onChange,
  disabled,
}: {
  options: DisciplineOption[];
  value: string | undefined;
  onChange: (disciplineId: string | undefined) => void;
  disabled?: boolean;
}) {
  return (
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
  );
}

/** ARU-63 AC 4: the full discipline list with its label, used on the Create course form. */
export function DisciplinePicker({
  value,
  onChange,
  disabled,
}: {
  value: string | undefined;
  onChange: (disciplineId: string | undefined) => void;
  disabled?: boolean;
}) {
  const { options, current } = useDisciplineOptions(value);
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label} accessibilityLabel={`Discipline, ${current.label}`}>
        Discipline
      </Text>
      <DisciplineOptions options={options} value={value} onChange={onChange} disabled={disabled} />
    </View>
  );
}

/** ARU-70: who can change a course's discipline: the teacher (any course) or the course's current owner. */
export function canChangeCourseDiscipline(user: User | null | undefined, course: Course) {
  return !!user && (user.role === 'teacher' || course.createdById === user.id);
}

/** ARU-70 / ARU-71: the edit (pencil) icon, the same on course details and the Profile name. */
export const EDIT_ICON = 'create-outline' as const;

/** A second tap on the pencil within this window is ignored, so a double tap opens the list only once. */
const TOGGLE_GUARD_MS = 500;

/**
 * ARU-70 (was ARU-63 AC 5): on course details, the teacher (any course) or the current owner changes the course's
 * discipline. Collapsed it shows the current value and a pencil; the pencil opens the list, picking another option
 * saves and collapses, the same option or the pencil again collapses without saving.
 */
export function CourseDisciplineSection({ course }: { course: Course }) {
  const { currentUser, disciplines, getDiscipline, setCourseDiscipline } = useStore();
  const { busy, error, run, clearError } = useAction();
  const [open, setOpen] = useState(false);
  const lastToggle = useRef(0);
  const saving = useRef(false);
  const { options, current } = useDisciplineOptions(course.disciplineId);
  if (!canChangeCourseDiscipline(currentUser, course)) return null;
  // Nothing to pick and nothing set: no section (as on the Create course form); it appears once a discipline exists.
  if (disciplines.length === 0 && !course.disciplineId) return null;

  const close = () => {
    setOpen(false);
    clearError();
  };
  const toggle = () => {
    const now = Date.now();
    if (busy || now - lastToggle.current < TOGGLE_GUARD_MS) return;
    lastToggle.current = now;
    if (open) close();
    else setOpen(true);
  };
  const pick = (id: string | undefined) => {
    // Keeping the current value (also a hidden one) saves nothing.
    if (id === course.disciplineId) return close();
    if (saving.current) return; // a second tap before the first save finished
    saving.current = true;
    run(async () => {
      await setCourseDiscipline(course.id, id ?? null);
      setOpen(false);
    }).finally(() => {
      saving.current = false;
    });
  };
  const hidden = !!getDiscipline(course.disciplineId)?.hidden;

  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`Discipline, ${current.label}`}>
          <Text style={styles.label}>Discipline</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.body, { flexShrink: 1 }]} numberOfLines={2}>
              {current.label}
            </Text>
            {hidden ? <HiddenBadge /> : null}
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change discipline"
          accessibilityState={{ expanded: open, disabled: busy }}
          disabled={busy}
          onPress={toggle}
          style={({ pressed }) => [
            { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
            pressed && { opacity: 0.6 },
          ]}>
          <Ionicons name={EDIT_ICON} size={22} color={colors.primary} />
        </Pressable>
      </View>
      {open ? (
        <>
          <DisciplineOptions options={options} value={course.disciplineId} onChange={pick} disabled={busy} />
          {busy ? <Text style={styles.muted}>Saving…</Text> : null}
          <ErrorText error={error} />
        </>
      ) : null}
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
