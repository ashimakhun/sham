import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { useI18n } from '@/i18n/context';
import { colors, roleColor } from '@/lib/theme';
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
  testID?: string;
};

export function Card({ children, onPress, style, accessible, testID }: CardProps) {
  if (!onPress)
    return (
      <View testID={testID} style={[styles.card, style]}>
        {children}
      </View>
    );
  return (
    <Pressable
      testID={testID}
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
  /** ARU-69: show this icon instead of the title text. The title is then the button's screen reader label. */
  icon?: ComponentProps<typeof Ionicons>['name'];
  /**
   * ARU-78: with an `icon`, draw the unread badge with its ring over the icon's top-right corner, as on the course
   * card's chat icon (ARU-57), instead of at the button's right. Opt-in, so other buttons keep the badge at the right.
   */
  badgeOnIcon?: boolean;
};

export function Button({ title, onPress, variant = 'primary', disabled, unread = 0, icon, badgeOnIcon }: ButtonProps) {
  const { lang } = useI18n();
  const textColor = variant === 'primary' ? '#fff' : variant === 'danger' ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      // With an icon there is no visible text, so the label is always set; the unread count joins it (ARU-31).
      accessibilityLabel={unread > 0 ? withUnreadLabel(title, unread, lang) : icon ? title : undefined}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: colors.primary },
        variant === 'secondary' && { backgroundColor: colors.primarySoft },
        variant === 'danger' && { backgroundColor: '#FEF2F2' },
        (pressed || disabled) && { opacity: disabled ? 0.4 : 0.8 },
      ]}>
      {icon && badgeOnIcon ? (
        // ARU-78: a box the size of the glyph, so the badge can sit on the icon's corner while the icon stays centred.
        <View testID="button-icon-box" style={styles.buttonIconBox}>
          <Ionicons name={icon} size={24} color={textColor} accessibilityElementsHidden importantForAccessibility="no" />
          {/* Same offset from the icon as on the course card (ARU-57): centred on the top-right corner, anchored by
              `right` so a wider "99+" grows inwards over the icon. Absolute, so the icon and button height don't move. */}
          <UnreadBadge count={unread} ring style={{ position: 'absolute', top: -10, right: -10 }} />
        </View>
      ) : icon ? (
        // Same size as the course card's chat icon (ARU-25); the button keeps its full-width, 46 pt target.
        <Ionicons name={icon} size={24} color={textColor} style={{ marginVertical: -3 }} accessibilityElementsHidden importantForAccessibility="no" />
      ) : (
        <Text style={[styles.buttonText, { color: textColor, textAlign: 'center' }]}>{title}</Text>
      )}
      {unread > 0 && !(icon && badgeOnIcon) && <UnreadBadge count={unread} style={{ position: 'absolute', right: 12, top: 11 }} />}
    </Pressable>
  );
}

/** A new-message count bubble (ARU-31), the same on the course card's chat icon and the course's Chat button. Part
 *  of its button's label, so screen readers don't read it on its own. In the button colour (ARU-57). `ring` adds a
 *  thin card-coloured ring for when it sits over the chat icon, so the icon's outline breaks around it (ARU-57). */
export function UnreadBadge({ count, style, ring }: { count: number; style?: ViewStyle; ring?: boolean }) {
  if (count <= 0) return null;
  return (
    <View
      testID="unread-badge"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      pointerEvents="none"
      style={[styles.unread, ring && styles.unreadRing, style]}>
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
        // Multiline fields grow up to a cap, then scroll inside, so the form's buttons stay reachable (ARU-59).
        style={[styles.input, props.multiline && { minHeight: 110, maxHeight: 200, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

export function StatusBadge({ status }: { status: HomeworkStatus }) {
  const { t } = useI18n();
  const checked = status === 'checked';
  return (
    <View style={[styles.badge, { backgroundColor: checked ? colors.successSoft : colors.warningSoft }]}>
      <Text style={[styles.badgeText, { color: checked ? colors.success : colors.warning }]}>
        {checked ? t('homework.statusChecked') : t('homework.statusWaiting')}
      </Text>
    </View>
  );
}

/** The role in the app's language (ARU-109: role badges on Listeners, Change owner and attendance); `label` overrides it. */
export function RoleBadge({ role, label }: { role: Role; label?: string }) {
  const { t } = useI18n();
  return (
    <View style={[styles.badge, { backgroundColor: roleColor[role] + '1A' }]}>
      <Text style={[styles.badgeText, { color: roleColor[role] }]}>{label ?? t(`role.${role}`)}</Text>
    </View>
  );
}

/** "Owner: <name> · <date>" line for a course (ARU-9); the owner is `Course.createdById`. */
export function OwnerLine({ name, date }: { name: string; date: string }) {
  const { t } = useI18n();
  return (
    <Text style={styles.muted} numberOfLines={1}>
      <Text style={{ fontWeight: '600' }}>{t('courses.ownerPrefix')} </Text>
      <Text>
        {name} · {date}
      </Text>
    </Text>
  );
}

/** "Hidden" next to a hidden course's title (ARU-40); read with the title by screen readers. */
export function HiddenBadge() {
  const { t } = useI18n();
  return (
    <View style={[styles.badge, { backgroundColor: '#F3F4F6', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
      <Text style={[styles.badgeText, { color: colors.muted }]}>{t('common.hidden')}</Text>
    </View>
  );
}

/**
 * ARU-118 (same look as ARU-114): a round icon button, a glyph in a tinted 36 pt circle. Hit slop 4 makes the touch
 * area 44×44 pt. Dimmed (0.4) and disabled while `disabled`.
 */
export const ICON_BUTTON_SIZE = 36;
export function IconButton({
  icon,
  tone,
  label,
  onPress,
  disabled,
  testID,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  tone: 'success' | 'danger';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const color = tone === 'success' ? colors.success : colors.danger;
  const backgroundColor = tone === 'success' ? colors.successSoft : colors.dangerSoft;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={4}
      testID={testID}
      onPress={onPress}
      style={[styles.iconButton, { backgroundColor, opacity: disabled ? 0.4 : 1 }]}>
      <Ionicons name={icon} size={20} color={color} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
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

/** ARU-109 AC 3: an app message the catalog knows is shown in the app's language; any other text as it came. */
export function ErrorText({ error }: { error: string | null }) {
  const { te } = useI18n();
  if (!error) return null;
  return <Text style={{ color: colors.danger, fontSize: 14 }}>{te(error)}</Text>;
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
  // ARU-122: controls and states are upper case by style only (the source text and screen reader labels stay as
  // written), Medium 500, slightly spaced and 1 pt smaller than before so they don't get wider. Text is never cut
  // with numberOfLines, so a long Russian label wraps inside the button.
  caps: { textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '500' },
  buttonText: { fontSize: 14, fontWeight: '500', letterSpacing: 0.5, textTransform: 'uppercase' },
  // ARU-78: same 18 pt layout height as the plain icon (24 pt glyph, -3 margins), so the button height is unchanged.
  buttonIconBox: { width: 24, height: 24, marginVertical: -3 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '500', letterSpacing: 0.5, textTransform: 'uppercase' },
  // ARU-122: a tappable text action (View proof, Set exempt, Unselect, Edit…): upper case, 1 pt under the default 14.
  linkText: { fontSize: 13, fontWeight: '500', letterSpacing: 0.5, textTransform: 'uppercase' },
  iconButton: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    borderRadius: ICON_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  // Grows by the ring's width so the number keeps the same room inside it (ARU-57).
  unreadRing: { minWidth: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.card },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  segmented: { flexDirection: 'row', backgroundColor: '#E9EAF0', borderRadius: 10, padding: 3 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.card },
  segmentText: { fontSize: 12, fontWeight: '500', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.muted },
});
