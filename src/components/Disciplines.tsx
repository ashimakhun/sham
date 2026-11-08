import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { Card, ErrorText, HiddenBadge, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { disciplineFeedback } from '@/lib/disciplines';
import { ratingSummary, ratingSummaryLabel } from '@/lib/feedback';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { Course, Discipline, User } from '@/lib/types';
import { useAction } from '@/lib/useAction';
import { font } from '@/lib/fonts';

/** ARU-63 AC 6: "Discipline: <name>" when the course has a discipline the viewer can see; nothing otherwise. */
export function DisciplineLabel({ course }: { course: Course }) {
  const { getDiscipline } = useStore();
  const { t } = useI18n();
  const discipline = getDiscipline(course.disciplineId);
  if (!discipline) return null;
  return (
    <Text style={styles.muted} numberOfLines={2} accessibilityLabel={t('disciplines.a11yLabel', { name: discipline.name })}>
      {t('disciplines.courseLine', { name: discipline.name })}
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
  const { t } = useI18n();
  const hiddenFromMe = !!value && !getDiscipline(value);
  const options: DisciplineOption[] = [
    { id: undefined, label: t('disciplines.none') },
    ...(hiddenFromMe ? [{ id: value, label: t('disciplines.hidden') }] : []),
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
            <Text style={[styles.body, { flexShrink: 1 }, selected && { color: colors.primary, ...font(500) }]}>
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
  const { t } = useI18n();
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label} accessibilityLabel={t('disciplines.a11yLabel', { name: current.label })}>
        {t('disciplines.fieldLabel')}
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

/** A second tap on the pencil within this window is ignored, so a double tap opens Edit course only once (ARU-103). */
export const TOGGLE_GUARD_MS = 500;

/**
 * ARU-103 AC 1 / AC 3: the pencil on the right of the course name card. A 44×44 "Edit course" button that opens the
 * Edit course modal; a double tap opens it only once.
 */
export function EditCoursePencil({ courseId }: { courseId: string }) {
  const { t } = useI18n();
  const lastTap = useRef(0);
  const open = () => {
    const now = Date.now();
    if (now - lastTap.current < TOGGLE_GUARD_MS) return;
    lastTap.current = now;
    router.push({ pathname: '/courses/[id]/edit', params: { id: courseId } });
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('disciplines.editCourse')}
      onPress={open}
      style={({ pressed }) => [
        { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
        pressed && { opacity: 0.6 },
      ]}>
      <Ionicons name={EDIT_ICON} size={22} color={colors.primary} />
    </Pressable>
  );
}

/**
 * ARU-103 (was ARU-70 / ARU-63 AC 5 on course details): the Discipline section of Edit course. The teacher (any
 * course) or the current owner sees the current value and the option list; picking another option saves at once,
 * picking the current one saves nothing. Permission is worked out at render time, so a mentor who hands the course
 * to someone else loses the section on the next update.
 */
export function EditCourseDisciplineSection({ course }: { course: Course }) {
  const { currentUser, disciplines, getDiscipline, setCourseDiscipline } = useStore();
  const { busy, error, run } = useAction();
  const saving = useRef(false);
  const { options, current } = useDisciplineOptions(course.disciplineId);
  const { t } = useI18n();
  if (!canChangeCourseDiscipline(currentUser, course)) return null;
  // Nothing to pick and nothing set: no section (as on the Create course form); it appears once a discipline exists.
  if (disciplines.length === 0 && !course.disciplineId) return null;

  const pick = (id: string | undefined) => {
    // Keeping the current value (also a hidden one) saves nothing.
    if (id === course.disciplineId) return;
    if (saving.current) return; // a second tap before the first save finished
    saving.current = true;
    run(async () => {
      await setCourseDiscipline(course.id, id ?? null);
    }).finally(() => {
      saving.current = false;
    });
  };
  const hidden = !!getDiscipline(course.disciplineId)?.hidden;

  return (
    <Card style={{ gap: 8 }}>
      <View style={{ gap: 2 }} accessible accessibilityLabel={t('disciplines.a11yLabel', { name: current.label })}>
        <Text style={styles.label}>{t('disciplines.fieldLabel')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.body, { flexShrink: 1 }]} numberOfLines={2}>
            {current.label}
          </Text>
          {hidden ? <HiddenBadge /> : null}
        </View>
      </View>
      <DisciplineOptions options={options} value={course.disciplineId} onChange={pick} disabled={busy} />
      {busy ? <Text style={styles.muted}>{t('common.saving')}</Text> : null}
      <ErrorText error={error} />
    </Card>
  );
}

/** A second tap within this window is ignored, so a quick double tap opens only one screen. */
const TAP_GUARD_MS = 800;

/** ARU-63 AC 9: a discipline in the Disciplines view: its name, Hidden badge (teacher) and rating summary. */
export function DisciplineCard({ discipline, onOpen }: { discipline: Discipline; onOpen?: () => void }) {
  const { courses, courseFeedback } = useStore();
  const { lang } = useI18n();
  const feedback = disciplineFeedback(discipline.id, courses, courseFeedback);
  const rating = ratingSummary(feedback, lang);
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
        <Text style={styles.muted} accessibilityLabel={ratingSummaryLabel(feedback, lang)}>
          {rating}
        </Text>
      ) : null}
    </Card>
  );
}
