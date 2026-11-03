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

/** Shows a short message with an OK button (ARU-76/77 "Password changed"): native Alert, or window.alert on web. */
export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') {
    const alert = (globalThis as { alert?: (text: string) => void }).alert;
    alert?.(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

/** Asks the user to confirm a destructive action (red confirm button). */
export function confirmDestructive(title: string, message: string, confirmText: string): Promise<boolean> {
  return confirmAction(title, message, confirmText, { destructive: true });
}
