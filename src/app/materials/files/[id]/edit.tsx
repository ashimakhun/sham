import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { KeyboardForm } from '@/components/KeyboardForm';
import { MaterialFileFields } from '@/components/MaterialFileFields';
import { Button, EmptyState, ErrorText } from '@/components/ui';
import { useStore } from '@/lib/store';
import type { MaterialFile } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/** Edit a Knowledge base item's name, description and course (ARU-30 AC 6): the author only. */
export default function EditMaterialFileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { materialFiles, currentUser } = useStore();
  const item = materialFiles.find((f) => f.id === id);
  if (!item) return <EmptyState title="Material not found" />;
  const isAuthor =
    currentUser?.id === item.authorId && (currentUser.role === 'teacher' || currentUser.role === 'mentor');
  if (!isAuthor) return <EmptyState title="Only the author can edit this file." />;
  return <EditForm item={item} />;
}

function EditForm({ item }: { item: MaterialFile }) {
  const { updateMaterialFile } = useStore();
  const { busy, error, run } = useAction();
  // Prefilled once: a live update from another device doesn't overwrite what is being typed.
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description);
  const [courseId, setCourseId] = useState(item.courseId);
  // Kept when the course changes; saved as Everyone with "No course" (ARU-42).
  const [courseOnly, setCourseOnly] = useState(!!item.courseOnly);

  function save() {
    if (busy) return;
    run(async () => {
      // Without courseOnly the store saves Everyone, so switching back to Everyone or to "No course" clears it.
      await updateMaterialFile(item.id, { name, description, courseId, ...(courseId && courseOnly ? { courseOnly: true } : {}) });
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/materials/files/[id]', params: { id: item.id } });
    });
  }

  return (
    <KeyboardForm>
      <MaterialFileFields
        name={name}
        onName={setName}
        description={description}
        onDescription={setDescription}
        courseId={courseId}
        onCourse={setCourseId}
        courseOnly={courseOnly}
        onCourseOnly={setCourseOnly}
      />
      <ErrorText error={error} />
      <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy || !name.trim()} />
    </KeyboardForm>
  );
}
