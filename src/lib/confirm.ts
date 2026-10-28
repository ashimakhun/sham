import { Alert, Platform } from 'react-native';

/** Asks the user to confirm an action: native Alert on iOS/Android, window.confirm on web. */
export function confirmAction(
  title: string,
  message: string,
  confirmText: string,
  { destructive = false, cancelText = 'Cancel' }: { destructive?: boolean; cancelText?: string } = {},
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const confirm = (globalThis as { confirm?: (text: string) => boolean }).confirm;
    return Promise.resolve(confirm?.(`${title}\n\n${message}`) ?? false);
  }
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

/** Asks the user to confirm a destructive action (red confirm button). */
export function confirmDestructive(title: string, message: string, confirmText: string): Promise<boolean> {
  return confirmAction(title, message, confirmText, { destructive: true });
}
