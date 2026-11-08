import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';

import { KeyboardForm } from '@/components/KeyboardForm';
import { MaterialFileFields } from '@/components/MaterialFileFields';
import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { confirmAction } from '@/lib/confirm';
import { formatSize, nameFromFile } from '@/lib/files';
import { newId } from '@/lib/id';
import { useStore } from '@/lib/store';
import { useAction } from '@/lib/useAction';

type Params = { uri?: string; name?: string; size?: string; mimeType?: string };

/** Upload screen for a PDF picked on the Knowledge base (ARU-30 AC 2–4). */
export default function UploadMaterialFileScreen() {
  const params = useLocalSearchParams<Params>();
  const { addMaterialFile } = useStore();
  const { t, lang } = useI18n();
  const { busy, error, run } = useAction();
  // One id per screen: a retry after an error reuses the uploaded file and never saves the item twice.
  const [id] = useState(newId);
  const [name, setName] = useState(() => nameFromFile(params.name));
  const [description, setDescription] = useState('');
  const [courseId, setCourseId] = useState<string | undefined>();
  // Who can see it (ARU-42): Everyone by default; only sent with a course.
  const [courseOnly, setCourseOnly] = useState(false);
  const size = params.size ? Number(params.size) : undefined;

  // Set when the user leaves mid-upload and confirms: the upload's result is ignored and its file removed.
  const cancelled = useRef(false);
  // Leaving (after the upload, or "Discard"): first turn the prompt off, then navigate on the next render.
  const [leaving, setLeaving] = useState(false);
  const leave = useRef<() => void>(undefined);
  useEffect(() => {
    if (leaving) leave.current?.();
  }, [leaving]);

  usePreventRemove(busy && !leaving, ({ repeat }) => {
    confirmAction(t('files.discardTitle'), t('files.discardMessage'), t('files.discard'), {
      destructive: true,
      cancelText: t('files.keepUploading'),
    }).then((discard) => {
      if (!discard) return;
      cancelled.current = true;
      leave.current = repeat;
      setLeaving(true);
    });
  });

  if (!params.uri) return <EmptyState title={t('files.noFileSelected')} hint={t('files.noFileSelectedHint')} />;
  const file = { uri: params.uri, name: params.name ?? '', size, mimeType: params.mimeType || undefined };

  function upload() {
    if (busy) return;
    run(async () => {
      await addMaterialFile(
        // courseOnly only when chosen with a course; the store saves everything else as Everyone.
        { id, file, name, description, courseId, ...(courseId && courseOnly ? { courseOnly: true } : {}) },
        { isCancelled: () => cancelled.current },
      );
      if (cancelled.current) return;
      leave.current = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/materials');
      };
      setLeaving(true);
    });
  }

  return (
    <KeyboardForm>
      <Card>
        <Text style={styles.title}>{params.name || t('files.untitled')}</Text>
        <Text style={styles.muted}>PDF · {formatSize(size, lang)}</Text>
      </Card>
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
      <Button title={busy ? t('files.uploading') : t('files.upload')} onPress={upload} disabled={busy || !name.trim()} />
    </KeyboardForm>
  );
}
