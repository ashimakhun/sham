import { Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { Field, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';

type Props = {
  name: string;
  onName: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  courseId: string | undefined;
  onCourse: (id: string | undefined) => void;
  courseOnly: boolean;
  onCourseOnly: (v: boolean) => void;
};

/**
 * Name, Description (optional), Course (optional) and, once a course is picked, Who can see it (ARU-42) of a
 * Knowledge base PDF (ARU-30): upload and edit screens.
 */
export function MaterialFileFields(props: Props) {
  const { name, onName, description, onDescription, courseId, onCourse, courseOnly, onCourseOnly } = props;
  const { t } = useI18n();
  return (
    <>
      <Field
        label={t('files.nameLabel')}
        accessibilityLabel={t('files.nameLabel')}
        placeholder={t('files.namePlaceholder')}
        value={name}
        onChangeText={onName}
      />
      <Field
        label={t('files.descriptionLabel')}
        accessibilityLabel={t('files.descriptionLabel')}
        placeholder={t('files.descriptionPlaceholder')}
        value={description}
        onChangeText={onDescription}
        multiline
      />
      <CoursePicker value={courseId} onChange={onCourse} />
      {/* Only with a course: "No course" is always Everyone (the store saves it so). */}
      {courseId !== undefined && (
        <RadioGroup
          label={t('files.visibilityLabel')}
          hint={t('files.visibilityHint')}
          options={[
            { value: 'everyone', label: t('files.visibilityEveryone') },
            { value: 'course', label: t('files.visibilityCourse') },
          ]}
          value={courseOnly ? 'course' : 'everyone'}
          onChange={(v) => onCourseOnly(v === 'course')}
        />
      )}
    </>
  );
}

const NONE = '__none__';
const CURRENT = '__current__';

/**
 * One course or none: "No course" first, then every course by title. A linked course that isn't in the list (a hidden
 * course the author can't see, ARU-40) shows as "Current course" and stays linked unless another option is picked.
 */
export function CoursePicker({ value, onChange }: { value: string | undefined; onChange: (id: string | undefined) => void }) {
  const { courses } = useStore();
  const { t } = useI18n();
  const listed = value === undefined || courses.some((c) => c.id === value);
  const options = [
    { value: NONE, label: t('files.noCourse') },
    ...(listed ? [] : [{ value: CURRENT, label: t('files.currentCourse') }]),
    ...[...courses]
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
      .map((c) => ({ value: c.id, label: c.title })),
  ];
  const selected = value === undefined ? NONE : listed ? value : CURRENT;
  return (
    <RadioGroup
      label={t('files.courseLabel')}
      options={options}
      value={selected}
      onChange={(v) => {
        if (v === CURRENT) return;
        onChange(v === NONE ? undefined : v);
      }}
    />
  );
}

function RadioGroup<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={pickerStyle.box}>
        {options.map((o, i) => {
          const checked = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ checked }}
              onPress={() => onChange(o.value)}
              style={[pickerStyle.row, i > 0 && pickerStyle.divider]}>
              <View style={[pickerStyle.dot, checked && pickerStyle.dotOn]} />
              <Text numberOfLines={1} style={[styles.body, { flex: 1 }]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </View>
  );
}

const pickerStyle = {
  box: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, minHeight: 44, paddingHorizontal: 14 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border },
  dotOn: { borderColor: colors.primary, backgroundColor: colors.primary },
};
