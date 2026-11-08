import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/AppText';

import { colors } from '@/lib/theme';
import { font } from '@/lib/fonts';

type Option = { value: string; label: string };
/** What the list filters by (ARU-80): the Blog's authors (default) or the Homework tab's courses. */
type Noun = 'author' | 'course';

const nounText: Record<Noun, { plural: string; testID: string }> = {
  author: { plural: 'authors', testID: 'author-filter' },
  course: { plural: 'courses', testID: 'course-filter' },
};

/**
 * Blog author filter (ARU-62): one "Filter: <All | author>" button that opens a list of authors (All first). Picking
 * an entry closes the list; tapping outside, Android back (or Esc on web) or the selected entry closes it unchanged.
 * Core `Modal`, so it works in Expo Go on iOS, Android and web. ARU-80: `noun="course"` reuses it as the Homework tab's
 * course filter ("Filter by course", testIDs `course-filter-*`); the Blog wording and testIDs stay the default.
 */
export function AuthorFilter({
  options,
  value,
  onChange,
  noun = 'author',
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  noun?: Noun;
}) {
  const [open, setOpen] = useState(false);
  const { plural, testID } = nounText[noun];
  const current = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? 'All';

  const pick = (v: string) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Filter by ${noun}, ${current}`}
        accessibilityHint={`Opens the list of ${plural}`}
        onPress={() => setOpen(true)}
        style={s.button}>
        <Text style={s.buttonText} numberOfLines={1} ellipsizeMode="tail">
          Filter: {current}
        </Text>
        <Text style={s.caret} importantForAccessibility="no" accessibilityElementsHidden>
          ▾
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={s.backdrop}>
          {/* Tap outside the list: close without changing the filter. */}
          <Pressable
            testID={`${testID}-backdrop`}
            accessibilityRole="button"
            accessibilityLabel={`Close ${noun} filter`}
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.sheet} accessibilityViewIsModal>
            <Text style={s.heading} accessibilityRole="header">
              {`Filter by ${noun}`}
            </Text>
            <ScrollView testID={`${testID}-list`} style={s.list} keyboardShouldPersistTaps="handled">
              {options.map((o) => {
                const selected = o.value === value;
                return (
                  <Pressable
                    key={o.value}
                    accessibilityRole="button"
                    accessibilityLabel={o.label}
                    accessibilityState={{ selected }}
                    onPress={() => pick(o.value)}
                    style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.bg }]}>
                    <Text style={[s.rowText, selected && s.rowTextSelected]} numberOfLines={1} ellipsizeMode="tail">
                      {o.label}
                    </Text>
                    <Text style={s.check} importantForAccessibility="no" accessibilityElementsHidden>
                      {selected ? '✓' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  buttonText: { flexShrink: 1, fontSize: 15, ...font(500), color: colors.text },
  caret: { fontSize: 14, color: colors.muted },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    // Clear of the status bar and home indicator; the dialog is centred and its list scrolls (AC 6).
    paddingVertical: 64,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
    maxHeight: '100%',
    borderRadius: 14,
    backgroundColor: colors.card,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  heading: { fontSize: 13, ...font(500), color: colors.muted, paddingHorizontal: 16, paddingVertical: 8 },
  list: { flexGrow: 0 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  rowText: { flex: 1, fontSize: 16, color: colors.text },
  rowTextSelected: { ...font(600), color: colors.primary },
  check: { width: 18, fontSize: 16, ...font(600), color: colors.primary, textAlign: 'right' },
});
