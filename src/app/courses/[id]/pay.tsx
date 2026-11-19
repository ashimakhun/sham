import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * ARU-161 AC 3: listeners no longer pay or send payment requests in the app (App Store 3.1.1 / 3.1.3(d), Google Play
 * payments policy). The old Pay address (ARU-99), opened directly on web or by a deep link, goes to the course instead
 * of showing the form, for everyone and on every platform; a browser refresh does the same. The database rules for
 * payment requests are unchanged; accountants and the teacher still see requests sent before this change.
 */
export default function PayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return <Redirect href="/courses" />;
  return <Redirect href={{ pathname: '/courses/[id]', params: { id } }} />;
}
