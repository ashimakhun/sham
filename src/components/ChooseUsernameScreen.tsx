import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/AppText';
import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, ErrorText, Field, styles } from '@/components/ui';
import { translate } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { NAME_MAX } from '@/lib/profileName';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';
import { isValidUsername, USERNAME_MAX } from '@/lib/username';

// ARU-108: the English texts (tests use them); the screen shows them in the chosen language.
export const CHOOSE_USERNAME_TITLE = translate('en', 'chooseUsername.title');
export const CHOOSE_USERNAME_TEXT = translate('en', 'chooseUsername.text');

/** AC 2: the current name, unless it looks like an email (old sign-ups without a name got their email as the name). */
export function prefillDisplayName(name: string | undefined) {
  return name && !name.includes('@') ? name : '';
}

/**
 * ARU-168 AC 1: the screen an older account (no username) sees instead of everything else. AccessGate (ARU-43) shows
 * it before the waiting / declined screen and before the tabs, whatever route is opened (deep links included).
 */
export function ChooseUsernameScreen() {
  const { currentUser, chooseUsername, signOut } = useStore();
  const { t, tm } = useI18n();
  const { busy, error, run } = useAction();
  const [username, setUsername] = useState('');
  const [name, setName] = useState(() => prefillDisplayName(currentUser?.name));

  // AC 2: part 1's rules. The display name: 1–80 characters once trimmed (an "@" typed here is allowed).
  const usernameBroken = username.trim() !== '' && !isValidUsername(username);
  const nameOk = name.trim() !== '' && name.trim().length <= NAME_MAX;
  const canSave = isValidUsername(username) && nameOk;

  return (
    <SafeAreaView style={styles.screen} testID="choose-username">
      {/* Edge cases: scrolls above the keyboard; long Russian text wraps. */}
      <KeyboardForm contentContainerStyle={[styles.content, { gap: 16, flexGrow: 1, justifyContent: 'center' }]}>
        <View style={{ gap: 8 }}>
          <Text style={[styles.h1, { textAlign: 'center' }]} accessibilityRole="header">
            {t('chooseUsername.title')}
          </Text>
          <Text style={[styles.body, { textAlign: 'center' }]}>{t('chooseUsername.text')}</Text>
        </View>
        <View style={{ gap: 4 }}>
          <Field
            label={t('signIn.username')}
            placeholder={t('signIn.usernamePlaceholder')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            maxLength={USERNAME_MAX}
            accessibilityLabel={t('chooseUsername.usernameA11y')}
            testID="choose-username-field"
          />
          {usernameBroken ? (
            <Text style={{ color: colors.danger, fontSize: 14 }} testID="choose-username-rule" accessibilityLiveRegion="polite">
              {t('signIn.usernameRule')}
            </Text>
          ) : null}
        </View>
        <View style={{ gap: 4 }}>
          <Field
            label={t('signIn.displayName')}
            placeholder={t('signIn.displayNamePlaceholder')}
            value={name}
            onChangeText={setName}
            autoComplete="nickname"
            maxLength={NAME_MAX}
            accessibilityLabel={t('chooseUsername.displayNameA11y')}
            accessibilityHint={t('signIn.displayNameHint')}
            testID="choose-display-name-field"
          />
          <Text style={styles.muted}>{t('signIn.displayNameHint')}</Text>
        </View>
        <ErrorText error={tm(error)} />
        <Button
          title={busy ? t('common.saving') : t('common.save')}
          onPress={() => run(() => chooseUsername(username, name))}
          disabled={!canSave || busy}
        />
        <Button title={t('common.signOut')} variant="secondary" onPress={() => run(signOut)} disabled={busy} />
      </KeyboardForm>
    </SafeAreaView>
  );
}
