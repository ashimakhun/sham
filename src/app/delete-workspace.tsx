import { Redirect, router } from 'expo-router';

import { DeleteWorkspaceForm } from '@/components/DeleteWorkspaceForm';
import { useStore } from '@/lib/store';

/** ARU-180: the teacher's Delete workspace screen, opened from Delete account on the Profile tab. */
export default function DeleteWorkspaceScreen() {
  const { currentUser } = useStore();
  // Deleted (or signed out): the sign-in screen, which says "Your account and workspace were deleted".
  if (!currentUser) return <Redirect href="/" />;
  // Students and mentors keep ARU-75's Delete account screen.
  if (currentUser.role !== 'teacher') return <Redirect href="/delete-account" />;
  return <DeleteWorkspaceForm onCancel={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} />;
}
