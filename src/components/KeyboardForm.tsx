import type { ReactNode } from 'react';
import { Platform, ScrollView, type StyleProp, type ViewStyle } from 'react-native';

import { styles } from '@/components/ui';

/**
 * Scrolling container for every form screen with a text field (ARU-58, ARU-59).
 *
 * - iOS: `automaticallyAdjustKeyboardInsets` makes the scroll view add the part of the keyboard that overlaps it as a
 *   bottom inset, measured natively in window coordinates. Unlike a `KeyboardAvoidingView`, it stays correct inside
 *   page-sheet modals and under the native header, so the last button can always be scrolled above the keyboard.
 * - The keyboard closes when the form is dragged (interactively on iOS) or a tap lands outside a field or button.
 *   That's the way out of a multiline field, where Return adds a line.
 * - Android resizes the window for the keyboard itself (unchanged); it gets the same dismiss behaviour.
 */
export function KeyboardForm({
  children,
  contentContainerStyle = [styles.content, { gap: 16 }],
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      testID="keyboard-form"
      style={styles.screen}
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic">
      {children}
    </ScrollView>
  );
}
