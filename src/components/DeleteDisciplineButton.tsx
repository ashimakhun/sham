import { router } from 'expo-router';
import { useRef } from 'react';
import { View } from 'react-native';

import { Button, ErrorText } from '@/components/ui';
import { currentLanguage, type Language, translate } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { confirmDestructive } from '@/lib/confirm';
import { canManageDisciplines, coursesInDiscipline } from '@/lib/disciplines';
import { useStore } from '@/lib/store';
import type { Discipline } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** The confirmation text (ARU-83 AC 2, word for word, "course(s)" included), with the number of courses the delete
 *  takes with it. ARU-109: a plural text, so Russian says "2 курса" / "5 курсов". */
export function deleteDisciplineMessage(name: string, courseCount: number, lang: Language = currentLanguage()) {
  if (courseCount === 0) return translate(lang, 'disciplines.deleteMessageEmpty', { name });
  return translate(lang, 'disciplines.deleteMessage', { name, count: courseCount });
}

/** ARU-83: the teacher's "Delete discipline", below the COURSES list. After a confirmation it deletes the discipline
 *  and every course in it, then goes back to the Courses tab (its Disciplines view is kept by going back). */
export function DeleteDisciplineButton({ discipline }: { discipline: Discipline }) {
  const { currentUser, courses, deleteDiscipline } = useStore();
  const { busy, error, run } = useAction();
  const { t, lang } = useI18n();
  // Set from the first tap until the delete ends, so a double tap opens one confirmation and sends one request.
  const pending = useRef(false);
  if (!canManageDisciplines(currentUser)) return null;

  function onPress() {
    if (busy || pending.current) return;
    pending.current = true;
    const target = discipline;
    // The teacher's list has every course, hidden ones too, so N counts all the courses the delete removes.
    const count = coursesInDiscipline(target.id, courses).length;
    confirmDestructive(
      t('disciplines.deleteTitle'),
      deleteDisciplineMessage(target.name, count, lang),
      t('disciplines.deleteConfirm'),
    )
      .then(async (ok) => {
        if (!ok) return;
        await run(async () => {
          await deleteDiscipline(target.id);
          // Right away, before the refetch turns this screen into "Discipline not found".
          if (router.canGoBack()) router.back();
          else router.replace('/courses');
        });
      })
      .finally(() => {
        pending.current = false;
      });
  }

  return (
    <View style={{ gap: 8, marginTop: 12 }}>
      <ErrorText error={error} />
      <Button title={busy ? t('disciplines.deleting') : t('disciplines.deleteTitle')} variant="danger" disabled={busy} onPress={onPress} />
    </View>
  );
}
