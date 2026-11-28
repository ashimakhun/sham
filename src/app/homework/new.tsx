import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import { Text } from '@/components/AppText';

import { dueText } from '@/components/AssignmentCard';
import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, EmptyState, ErrorText, Field, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { PHOTO_PREPARE_ERROR, preparePhoto } from '@/lib/compressPhoto';
import { newId } from '@/lib/id';
import { MAX_HOMEWORK_PHOTOS } from '@/lib/photo';
import { useStore } from '@/lib/store';
import { colors, formatDateTime } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

/** Send homework for an assignment (ARU-32): opened from a card in New, with the course and assignment fixed. */
export default function NewHomeworkScreen() {
  const { assignmentId } = useLocalSearchParams<{ assignmentId?: string }>();
  const { addHomework, currentUser, getUser, getCourse, courseMembers, assignments, meetings } = useStore();
  const assignment = assignments.find((a) => a.id === assignmentId);
  const [title, setTitle] = useState(assignment?.title ?? '');
  const [description, setDescription] = useState('');
  // ARU-191: up to 10 prepared photos, in the order picked. Each has its own key: the same photo may be picked twice.
  const [photos, setPhotos] = useState<{ key: string; uri: string }[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  // AC 2: more were picked than fit.
  const [overLimit, setOverLimit] = useState(false);
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

  const free = MAX_HOMEWORK_PHOTOS - photos.length;

  async function pickPhotos() {
    if (free <= 0) return;
    // iOS: "Compatible" hands over HEIC as JPEG. Full quality here: the one compression is preparePhoto's (ARU-105).
    // ARU-191 AC 1: several at once, up to the number still free, in the order selected.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      allowsMultipleSelection: true,
      selectionLimit: free,
      orderedSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;
    setPickError(null);
    // AC 2: the first ones up to 10 are kept (web and some pickers don't apply the limit).
    const picked = result.assets.slice(0, free);
    setOverLimit(result.assets.length > free);
    setPreparing(true);
    try {
      // ARU-105 AC 1–3: resized and compressed now, so the thumbnails are exactly what is uploaded. A photo that
      // can't be prepared is left out with the usual message; the others are attached (edge case).
      const prepared: { key: string; uri: string }[] = [];
      let failed = false;
      for (const asset of picked) {
        try {
          const photo = await preparePhoto(asset.uri);
          prepared.push({ key: newId(), uri: photo.uri });
        } catch {
          failed = true;
        }
      }
      if (prepared.length) setPhotos((list) => [...list, ...prepared].slice(0, MAX_HOMEWORK_PHOTOS));
      if (failed) setPickError(PHOTO_PREPARE_ERROR);
    } finally {
      setPreparing(false);
    }
  }

  function removePhoto(key: string) {
    setPhotos((list) => list.filter((p) => p.key !== key));
    setOverLimit(false);
  }

  function submit() {
    run(async () => {
      await addHomework({
        id,
        courseId: course!.id,
        assignmentId: assignment!.id,
        title,
        description,
        photoUris: photos.map((p) => p.uri),
      });
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
        <Text style={styles.label}>{t('homework.photosLabel')}</Text>
        {/* ARU-107 AC 8 */}
        <Text style={styles.muted}>{t('homework.photoRule')}</Text>
        {photos.length > 0 && (
          // ARU-191 AC 3: thumbnails in the order picked, each with its own ✕.
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {photos.map((p, i) => (
              <View key={p.key} style={{ width: 96, height: 96 }}>
                <Image
                  testID="homework-photo-preview"
                  accessibilityLabel={t('homework.attachedPhotoNumber', { n: i + 1 })}
                  source={{ uri: p.uri }}
                  style={{ width: 96, height: 96, borderRadius: 10, backgroundColor: colors.border }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('homework.removePhotoNumber', { n: i + 1 })}
                  hitSlop={8}
                  disabled={busy}
                  onPress={() => removePhoto(p.key)}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Text style={{ color: '#fff', fontSize: 14, lineHeight: 16 }}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <Button
          title={
            preparing
              ? t('homework.preparingPhoto')
              : photos.length
                ? t('homework.addPhotos')
                : t('homework.attachPhotos')
          }
          variant="secondary"
          onPress={pickPhotos}
          disabled={preparing || busy || free <= 0}
        />
        {free <= 0 || overLimit ? <Text style={styles.muted}>{t('homework.photoLimit')}</Text> : null}
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
