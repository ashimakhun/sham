// ARU-170: the Notifications page's switches: ARU-166's per-role list (today's order and labels, src/lib/notifications.ts),
// plus Homework due soon right after New homework for students and mentors (AC 9). The teacher never sees it.
import { currentLanguage, type Language, translate } from '@/i18n';

import { notificationSwitchesFor as baseSwitchesFor } from './notifications';
import type { NotificationKind, Role } from './types';

export function notificationSwitchesFor(
  role: Role,
  lang: Language = currentLanguage(),
): { kind: NotificationKind; label: string }[] {
  const list: { kind: NotificationKind; label: string }[] = baseSwitchesFor(role, lang);
  if (role === 'teacher') return list;
  const after = list.findIndex((s) => s.kind === 'new_homework');
  list.splice(after + 1, 0, { kind: 'homework_due', label: translate(lang, 'notifications.switch.homework_due') });
  return list;
}
