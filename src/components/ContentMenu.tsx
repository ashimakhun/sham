import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/AppText';
import { styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { canReport } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { ContentKind } from '@/lib/types';

export type MenuAction = { key: string; label: string; destructive?: boolean; onPress: () => void };

/** ARU-158: opens the Report screen for one piece of content. */
export function openReport(kind: ContentKind, id: string) {
  router.push({ pathname: '/report', params: { kind, id } });
}

/**
 * ARU-158: a small action sheet (Report, Delete; ARU-162 adds Block). The same on iOS, Android and web: a sheet at the
 * bottom over a dimmed backdrop; a tap outside or Cancel closes it. An action closes the sheet, then runs.
 */
export function ActionMenu({ visible, actions, onClose }: { visible: boolean; actions: MenuAction[]; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        testID="action-menu-backdrop"
        accessibilityRole="button"
        accessibilityLabel={t('report.menuCancel')}
        style={menuStyles.backdrop}
        onPress={onClose}
      />
      <View style={menuStyles.sheet} testID="action-menu">
        {actions.map((a) => (
          <Pressable
            key={a.key}
            testID={`action-${a.key}`}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={() => {
              onClose();
              a.onPress();
            }}
            style={({ pressed }) => [menuStyles.item, pressed && { opacity: 0.6 }]}>
            <Text style={[menuStyles.itemText, a.destructive && { color: colors.danger }]}>{a.label}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('report.menuCancel')}
          onPress={onClose}
          style={({ pressed }) => [menuStyles.item, menuStyles.cancel, pressed && { opacity: 0.6 }]}>
          <Text style={[menuStyles.itemText, { color: colors.muted }]}>{t('report.menuCancel')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/** ARU-158 AC 1: the ⋯ button that opens the menu; nothing when there is no action (e.g. my own content). */
export function MoreButton({ onPress, testID = 'content-menu' }: { onPress: () => void; testID?: string }) {
  const { t } = useI18n();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('report.moreActions')}
      hitSlop={8}
      onPress={onPress}
      style={menuStyles.more}>
      <Ionicons name="ellipsis-horizontal" size={22} color={colors.muted} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/**
 * ARU-158 AC 1: the ⋯ menu on a meeting note, a Blog post, a PDF or a review, with Report on someone else's content
 * (not on my own or a deleted account's). Renders nothing when the menu would be empty. ARU-162 adds Block here.
 */
export function ReportMenu({ kind, id, authorId }: { kind: ContentKind; id: string; authorId: string | null | undefined }) {
  const { currentUser } = useStore();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const actions: MenuAction[] = [];
  if (canReport(currentUser, authorId)) {
    actions.push({ key: 'report', label: t('report.menuReport'), onPress: () => openReport(kind, id) });
  }
  if (!actions.length) return null;
  return (
    <>
      <MoreButton onPress={() => setOpen(true)} testID={`content-menu-${id}`} />
      <ActionMenu visible={open} actions={actions} onClose={() => setOpen(false)} />
    </>
  );
}

const menuStyles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    overflow: 'hidden',
  },
  item: {
    minHeight: 52,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cancel: { borderBottomWidth: 0 },
  itemText: { ...styles.title, color: colors.primary },
  more: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
