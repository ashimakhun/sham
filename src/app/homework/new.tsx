import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';

import { dueText } from '@/components/AssignmentCard';
import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, EmptyState, ErrorText, Field, styles } from '@/components/ui';
import { preparePhoto } from '@/lib/compressPhoto';
import { newId } from '@/lib/id';
import { useStore } from '@/lib/store';
import { formatDateTime } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

/** Send homework for an assignment (ARU-32): opened from a card in New, with the course and assignment fixed. */
export default function NewHomeworkScreen() {
  const { assignmentId } = useLocalSearchParams<{ assignmentId?: string }>();
  const { addHomework, currentUser, getUser, getCourse, courseMembers, assignments, meetings } = useStore();
  const assignment = assignments.find((a) => a.id === assignmentId);
  const [title, setTitle] = useState(assignment?.title ?? '');
  const [description, setDescription] = useState('');
  const [photoUri, setPhotoUri] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  // One id per form: a retry after a network error cannot save the homework twice.
  const [id] = useState(newId);
  const { busy, error, run } = useAction();

  // Only an assignment of a course I am a listener of (ARU-14/ARU-32; also enforced by RLS).
  const course = getCourse(assignment?.courseId);
  const isListener = !!course && courseMembers.some((m) => m.courseId === course.id && m.userId === currentUser?.id);
  if (!assignment || !course || !isListener) {
    return <EmptyState title="No assignment" hint="Open a homework assignment from New to send homework." />;
  }
  const meeting = meetings.find((m) => m.id === assignment.meetingId);
  // The course owner is its mentor (ARU-14 AC 4 / ARU-9 AC 11).
  const owner = getUser(course.createdById);

  async function pickPhoto() {
    // iOS: "Compatible" hands over HEIC as JPEG. Full quality here: the one compression is preparePhoto's (ARU-105).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || !result.assets?.length) return;
    setPickError(null);
    setPreparing(true);
    try {
      // ARU-105 AC 1–3: resized and compressed now, so the preview is exactly what is uploaded.
      const photo = await preparePhoto(result.assets[0].uri);
      setPhotoUri(photo.uri);
    } catch (e) {
      // AC 6: nothing new is attached; an earlier photo stays.
      setPickError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(false);
    }
  }

  function submit() {
    run(async () => {
      await addHomework({ id, courseId: course!.id, assignmentId: assignment!.id, title, description, photoUri });
      if (router.canGoBack()) router.back();
      else router.replace('/homework');
    });
  }

  return (
    <KeyboardForm>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Course</Text>
        <Text style={styles.body}>{course.title}</Text>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Assignment</Text>
        <Text style={styles.body}>{assignment.title}</Text>
        <Text style={styles.muted}>
          {meeting ? `Meeting ${formatDateTime(meeting.startsAt)} · ` : ''}
          {dueText(assignment)}
        </Text>
      </View>
      <Field label="Title" placeholder="e.g. Fractions — exercises 1–10" value={title} onChangeText={setTitle} />
      <Field
        label="Description"
        placeholder="What did you do? Any questions for your mentor?"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>Photo (optional)</Text>
        {photoUri && (
          <Image
            testID="homework-photo-preview"
            accessibilityLabel="Attached photo"
            source={{ uri: photoUri }}
            style={{ width: '100%', height: 220, borderRadius: 10 }}
          />
        )}
        <Button
          title={preparing ? 'Preparing photo…' : photoUri ? 'Change photo' : 'Attach a photo'}
          variant="secondary"
          onPress={pickPhoto}
          disabled={preparing || busy}
        />
        <ErrorText error={pickError} />
      </View>
      <ErrorText error={error} />
      <Button
        title={busy ? 'Sending…' : 'Send to mentor'}
        onPress={submit}
        disabled={!title.trim() || busy || preparing}
      />
      <Text style={[styles.muted, { textAlign: 'center' }]}>
        {/* The course owner is its mentor; any mentor or the teacher may check (ARU-14), so no "will check it". */}
        {owner ? `Mentor: ${owner.name}` : null}
      </Text>
    </KeyboardForm>
  );
}
