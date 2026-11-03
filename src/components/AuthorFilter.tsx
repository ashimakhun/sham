import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/lib/theme';

type Option = { value: string; label: string };

/**
 * Blog author filter (ARU-62): one "Filter: <All | author>" button that opens a list of authors (All first). Picking
 * an entry closes the list; tapping outside, Android back (or Esc on web) or the selected entry closes it unchanged.
 * Core `Modal`, so it works in Expo Go on iOS, Android and web.
 */
export function AuthorFilter({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? 'All';

  const pick = (v: string) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Filter by author, ${current}`}
        accessibilityHint="Opens the list of authors"
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
            testID="author-filter-backdrop"
            accessibilityRole="button"
            accessibilityLabel="Close author filter"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.sheet} accessibilityViewIsModal>
            <Text style={s.heading} accessibilityRole="header">
              Filter by author
            </Text>
            <ScrollView testID="author-filter-list" style={s.list} keyboardShouldPersistTaps="handled">
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
  buttonText: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: colors.text },
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
  heading: { fontSize: 13, fontWeight: '600', color: colors.muted, paddingHorizontal: 16, paddingVertical: 8 },
  list: { flexGrow: 0 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  rowText: { flex: 1, fontSize: 16, color: colors.text },
  rowTextSelected: { fontWeight: '700', color: colors.primary },
  check: { width: 18, fontSize: 16, fontWeight: '700', color: colors.primary, textAlign: 'right' },
});
