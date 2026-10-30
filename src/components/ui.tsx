import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { colors, roleColor, roleLabel } from '@/lib/theme';
import type { HomeworkStatus, Role } from '@/lib/types';
import { formatUnread, withUnreadLabel } from '@/lib/unread';

type CardProps = {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  /**
   * Set to false when the card holds its own buttons: on iOS an accessible view groups all its children into one
   * element, so VoiceOver could not focus a nested button (ARU-27).
   */
  accessible?: boolean;
};

export function Card({ children, onPress, style, accessible }: CardProps) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessible={accessible}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }, style]}>
      {children}
    </Pressable>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  /** New-message count shown next to the title (ARU-31); nothing is shown at 0 and the label stays the title. */
  unread?: number;
};

export function Button({ title, onPress, variant = 'primary', disabled, unread = 0 }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? withUnreadLabel(title, unread) : undefined}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: colors.primary },
        variant === 'secondary' && { backgroundColor: colors.primarySoft },
        variant === 'danger' && { backgroundColor: '#FEF2F2' },
        (pressed || disabled) && { opacity: disabled ? 0.4 : 0.8 },
      ]}>
      <Text
        style={[
          styles.buttonText,
          variant === 'primary' && { color: '#fff' },
          variant === 'secondary' && { color: colors.primary },
          variant === 'danger' && { color: colors.danger },
        ]}>
        {title}
      </Text>
      {unread > 0 && <UnreadBadge count={unread} style={{ position: 'absolute', right: 12, top: 11 }} />}
    </Pressable>
  );
}

/** A new-message count bubble (ARU-31), the same on the course card's chat icon and the course's Chat button. Part
 *  of its button's label, so screen readers don't read it on its own. */
export function UnreadBadge({ count, style }: { count: number; style?: ViewStyle }) {
  if (count <= 0) return null;
  return (
    <View
      testID="unread-badge"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      pointerEvents="none"
      style={[styles.unread, style]}>
      <Text style={styles.unreadText} numberOfLines={1}>
        {formatUnread(count)}
      </Text>
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        {...props}
        style={[styles.input, props.multiline && { minHeight: 110, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

export function StatusBadge({ status }: { status: HomeworkStatus }) {
  const checked = status === 'checked';
  return (
    <View style={[styles.badge, { backgroundColor: checked ? colors.successSoft : colors.warningSoft }]}>
      <Text style={[styles.badgeText, { color: checked ? colors.success : colors.warning }]}>
        {checked ? 'Checked' : 'Waiting for check'}
      </Text>
    </View>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <View style={[styles.badge, { backgroundColor: roleColor[role] + '1A' }]}>
      <Text style={[styles.badgeText, { color: roleColor[role] }]}>{roleLabel[role]}</Text>
    </View>
  );
}

/** "Owner: <name> · <date>" line for a course (ARU-9); the owner is `Course.createdById`. */
export function OwnerLine({ name, date }: { name: string; date: string }) {
  return (
    <Text style={styles.muted} numberOfLines={1}>
      <Text style={{ fontWeight: '600' }}>Owner: </Text>
      <Text>
        {name} · {date}
      </Text>
    </Text>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </View>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => (
        <Pressable
          key={o.value}
          // Announced with its selected state by VoiceOver / TalkBack (ARU-38).
          accessibilityRole="tab"
          accessibilityLabel={o.label}
          accessibilityState={{ selected: value === o.value }}
          onPress={() => onChange(o.value)}
          style={[styles.segment, value === o.value && styles.segmentActive]}>
          <Text style={[styles.segmentText, value === o.value && { color: colors.text }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * A horizontal, scrollable row of single-select chips for a variable number of options (ARU-29). Unlike Segmented,
 * chips size to their label (long labels are cut with an ellipsis) and the row scrolls sideways instead of wrapping.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 8 }}>
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected }}
            // 36 pt chip + 4 pt on each side = a 44 pt touch target.
            hitSlop={4}
            onPress={() => {
              if (!selected) onChange(o.value);
            }}
            style={[styles.chip, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
            <Text numberOfLines={1} style={[styles.chipText, selected && { color: '#fff' }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  h1: { fontSize: 26, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  // Side padding keeps the label inside the background when the button sits in a row and sizes to its text (ARU-22).
  button: { borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { fontSize: 15, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  unread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  segmented: { flexDirection: 'row', backgroundColor: '#E9EAF0', borderRadius: 10, padding: 3 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.card },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  chip: {
    maxWidth: 200,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
});
