import { Text, View } from 'react-native';

import { Field } from '@/components/ui';
import { PASSWORD_PLACEHOLDER, PASSWORDS_DONT_MATCH, passwordsMismatch } from '@/lib/password';
import { colors } from '@/lib/theme';

/**
 * New password + Confirm new password, shared by Change password (ARU-76) and the forgotten-password reset (ARU-77).
 * Both hide what is typed and are marked as new passwords, so the iOS / Android password manager can offer to save
 * them. "Passwords don't match" shows under the confirmation once both are filled and differ.
 */
export function NewPasswordFields({
  password,
  onPassword,
  confirm,
  onConfirm,
  editable = true,
}: {
  password: string;
  onPassword: (v: string) => void;
  confirm: string;
  onConfirm: (v: string) => void;
  editable?: boolean;
}) {
  const mismatch = passwordsMismatch(password, confirm);
  return (
    <>
      <Field
        testID="new-password"
        label="New password"
        placeholder={PASSWORD_PLACEHOLDER}
        value={password}
        onChangeText={onPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        editable={editable}
      />
      <View style={{ gap: 6 }}>
        <Field
          testID="confirm-password"
          label="Confirm new password"
          value={confirm}
          onChangeText={onConfirm}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          editable={editable}
        />
        {mismatch && (
          <Text testID="passwords-mismatch" style={{ color: colors.danger, fontSize: 14 }}>
            {PASSWORDS_DONT_MATCH}
          </Text>
        )}
      </View>
    </>
  );
}
