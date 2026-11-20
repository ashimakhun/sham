import { Redirect } from 'expo-router';

/**
 * ARU-165 AC 13: the email reset (ARU-77) is gone. The old sham://reset-password link opens the root instead: the
 * sign-in screen when signed out, the app when signed in. Never an email form.
 */
export default function OldResetPasswordLink() {
  return <Redirect href="/" />;
}
