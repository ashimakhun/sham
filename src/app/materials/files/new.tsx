import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';

import { MaterialFileFields } from '@/components/MaterialFileFields';
import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
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
  const { busy, error, run } = useAction();
  // One id per screen: a retry after an error reuses the uploaded file and never saves the item twice.
  const [id] = useState(newId);
  const [name, setName] = useState(() => nameFromFile(params.name));
  const [description, setDescription] = useState('');
  const [courseId, setCourseId] = useState<string | undefined>();
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
    confirmAction('Discard upload?', 'The file will not be added to the Knowledge base.', 'Discard', {
      destructive: true,
      cancelText: 'Keep uploading',
    }).then((discard) => {
      if (!discard) return;
      cancelled.current = true;
      leave.current = repeat;
      setLeaving(true);
    });
  });

  if (!params.uri) return <EmptyState title="No file selected" hint="Pick a PDF on the Knowledge base." />;
  const file = { uri: params.uri, name: params.name ?? '', size, mimeType: params.mimeType || undefined };

  function upload() {
    if (busy) return;
    run(async () => {
      await addMaterialFile(
        { id, file, name, description, courseId },
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
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { gap: 16 }]}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic">
        <Card>
          <Text style={styles.title}>{params.name || 'Untitled'}</Text>
          <Text style={styles.muted}>PDF · {formatSize(size)}</Text>
        </Card>
        <MaterialFileFields
          name={name}
          onName={setName}
          description={description}
          onDescription={setDescription}
          courseId={courseId}
          onCourse={setCourseId}
        />
        <ErrorText error={error} />
        <Button title={busy ? 'Uploading…' : 'Upload'} onPress={upload} disabled={busy || !name.trim()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
