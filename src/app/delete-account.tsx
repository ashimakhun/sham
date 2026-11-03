import { Redirect, router } from 'expo-router';

import { DeleteAccountForm } from '@/components/DeleteAccountForm';
import { useStore } from '@/lib/store';

/** ARU-75: the Delete account screen, opened from the Profile tab (students and mentors). */
export default function DeleteAccountScreen() {
  const { currentUser } = useStore();
  // Deleted (or signed out): the sign-in screen, which says "Your account was deleted".
  if (!currentUser) return <Redirect href="/" />;
  return <DeleteAccountForm onCancel={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} />;
}
