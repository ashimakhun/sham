import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';

import { dueText } from '@/components/AssignmentCard';
import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, EmptyState, ErrorText, Field, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
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
  const { t, lang } = useI18n();

  // Only an assignment of a course I am a listener of (ARU-14/ARU-32; also enforced by RLS).
  const course = getCourse(assignment?.courseId);
  const isListener = !!course && courseMembers.some((m) => m.courseId === course.id && m.userId === currentUser?.id);
  if (!assignment || !course || !isListener) {
    return <EmptyState title={t('homework.noAssignmentTitle')} hint={t('homework.noAssignmentHint')} />;
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
        <Text style={styles.label}>{t('homework.courseLabel')}</Text>
        <Text style={styles.body}>{course.title}</Text>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>{t('homework.assignmentLabel')}</Text>
        <Text style={styles.body}>{assignment.title}</Text>
        <Text style={styles.muted}>
          {meeting ? `${t('homework.meetingAt', { date: formatDateTime(meeting.startsAt) })} · ` : ''}
          {dueText(assignment, lang)}
        </Text>
      </View>
      <Field
        label={t('homework.titleLabel')}
        placeholder={t('homework.titlePlaceholder')}
        value={title}
        onChangeText={setTitle}
      />
      <Field
        label={t('homework.descriptionLabel')}
        placeholder={t('homework.descriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>{t('homework.photoLabel')}</Text>
        {/* ARU-107 AC 8 */}
        <Text style={styles.muted}>{t('homework.photoRule')}</Text>
        {photoUri && (
          <Image
            testID="homework-photo-preview"
            accessibilityLabel={t('homework.attachedPhoto')}
            source={{ uri: photoUri }}
            style={{ width: '100%', height: 220, borderRadius: 10 }}
          />
        )}
        <Button
          title={
            preparing
              ? t('homework.preparingPhoto')
              : photoUri
                ? t('homework.changePhoto')
                : t('homework.attachPhoto')
          }
          variant="secondary"
          onPress={pickPhoto}
          disabled={preparing || busy}
        />
        <ErrorText error={pickError} />
      </View>
      <ErrorText error={error} />
      <Button
        title={busy ? t('homework.sending') : t('homework.sendToMentor')}
        onPress={submit}
        disabled={!title.trim() || busy || preparing}
      />
      <Text style={[styles.muted, { textAlign: 'center' }]}>
        {/* The course owner is its mentor; any mentor or the teacher may check (ARU-14), so no "will check it". */}
        {owner ? t('homework.mentorLine', { name: owner.name }) : null}
      </Text>
    </KeyboardForm>
  );
}
