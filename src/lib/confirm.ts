import { Alert, Platform } from 'react-native';

/** Asks the user to confirm a destructive action: native Alert on iOS/Android, window.confirm on web. */
export function confirmDestructive(title: string, message: string, confirmText: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const confirm = (globalThis as { confirm?: (text: string) => boolean }).confirm;
    return Promise.resolve(confirm?.(`${title}\n\n${message}`) ?? false);
  }
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmText, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
