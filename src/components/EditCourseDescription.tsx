import { useRef, useState } from 'react';
import { View } from 'react-native';

import { canChangeCourseDiscipline } from '@/components/Disciplines';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { useStore } from '@/lib/store';
import type { Course } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/**
 * ARU-182: the Description section of Edit course. Shown to the same people who can change the discipline (the
 * course owner, and the teacher on any course); everyone else gets nothing (AC 2). Everything else is the live store,
 * so losing ownership hides the section on the next update (AC 8).
 *
 * The field keeps what I typed: a realtime reload (someone else saving meanwhile) only replaces the text while I haven't
 * changed it. Save compares against the latest saved description (AC 3).
 */
export function EditCourseDescriptionSection({ course }: { course: Course }) {
  const { currentUser, setCourseDescription } = useStore();
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  // What I typed; null while I haven't changed anything, so the field follows the saved value (another device's save,
  // or ours after the reload).
  const [draft, setDraft] = useState<string | null>(null);
  // Blocks a second tap before the busy state has rendered, so a double tap sends one save (AC 7).
  const saving = useRef(false);

  if (!canChangeCourseDiscipline(currentUser, course)) return null;

  const text = draft ?? course.description;
  const trimmed = text.trim();
  const canSave = !busy && trimmed !== course.description;

  const save = () => {
    if (!canSave || saving.current) return;
    saving.current = true;
    run(async () => {
      try {
        await setCourseDescription(course.id, trimmed);
        // AC 4: the store has reloaded, so the field shows the saved (trimmed) text and follows it again.
        setDraft(null);
      } finally {
        saving.current = false;
      }
    });
  };

  return (
    <Card style={{ gap: 8 }}>
      <Field
        label={t('courses.descriptionLabel')}
        placeholder={t('courses.descriptionPlaceholder')}
        value={text}
        onChangeText={setDraft}
        multiline
        editable={!busy}
        testID="edit-course-description"
      />
      <ErrorText error={error} />
      <View>
        <Button title={busy ? t('common.saving') : t('common.save')} onPress={save} disabled={!canSave} />
      </View>
    </Card>
  );
}
