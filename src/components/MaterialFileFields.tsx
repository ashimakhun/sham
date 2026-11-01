import { Pressable, Text, View } from 'react-native';

import { Field, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';

type Props = {
  name: string;
  onName: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  courseId: string | undefined;
  onCourse: (id: string | undefined) => void;
};

/** Name, Description (optional) and Course (optional) of a Knowledge base PDF (ARU-30): upload and edit screens. */
export function MaterialFileFields({ name, onName, description, onDescription, courseId, onCourse }: Props) {
  return (
    <>
      <Field label="Name" accessibilityLabel="Name" placeholder="e.g. Algebra workbook" value={name} onChangeText={onName} />
      <Field
        label="Description (optional)"
        accessibilityLabel="Description (optional)"
        placeholder="What is in it, which chapters to read…"
        value={description}
        onChangeText={onDescription}
        multiline
      />
      <CoursePicker value={courseId} onChange={onCourse} />
    </>
  );
}

/** One course or none: "No course" first, then every course by title (all signed-in users see course titles). */
export function CoursePicker({ value, onChange }: { value: string | undefined; onChange: (id: string | undefined) => void }) {
  const { courses } = useStore();
  const options = [
    { id: undefined as string | undefined, label: 'No course' },
    ...[...courses]
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
      .map((c) => ({ id: c.id as string | undefined, label: c.title })),
  ];
  // A linked course that is no longer listed counts as none.
  const selected = options.some((o) => o.id === value) ? value : undefined;
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>Course (optional)</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Course (optional)" style={pickerStyle.box}>
        {options.map((o, i) => {
          const checked = o.id === selected;
          return (
            <Pressable
              key={o.id ?? 'none'}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ checked }}
              onPress={() => onChange(o.id)}
              style={[pickerStyle.row, i > 0 && pickerStyle.divider]}>
              <View style={[pickerStyle.dot, checked && pickerStyle.dotOn]} />
              <Text numberOfLines={1} style={[styles.body, { flex: 1 }]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
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
