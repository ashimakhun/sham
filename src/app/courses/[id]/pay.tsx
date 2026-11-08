import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, EmptyState, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { localMonth } from '@/lib/billing';
import { preparePhoto } from '@/lib/compressPhoto';
import { isAllowedProof, PHOTO_PERMISSION, PROOF_RULE } from '@/lib/paymentProof';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { PickedProof } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/**
 * ARU-99 AC 2 / AC 3: a listener attaches one proof of payment (a photo or a PDF, up to 10 MB) and sends it to the
 * accountant. With a request already sent this month, sending replaces it (one request per course and month).
 * Opened from Pay / Send again on course details, which shows only while the course is due.
 */
export default function PayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCourse, currentUser, courseMembers, sendPaymentRequest } = useStore();
  const [proof, setProof] = useState<PickedProof | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const { busy, error, run } = useAction();
  const { t } = useI18n();

  const course = getCourse(id);
  if (!course) return <EmptyState title={t('courses.notFound')} />;
  const isListener = courseMembers.some((m) => m.courseId === course.id && m.userId === currentUser?.id);
  if (!isListener) return <EmptyState title={t('courses.notAllowed')} hint={t('payments.notListenerHint')} />;

  function accept(picked: PickedProof) {
    if (!isAllowedProof(picked)) {
      setPickError(PROOF_RULE);
      return;
    }
    setPickError(null);
    setProof(picked);
  }

  async function pickPhoto() {
    setPickError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPickError(PHOTO_PERMISSION);
        return;
      }
      // iOS: "Compatible" hands over HEIC as JPEG. Full quality here: the one compression is preparePhoto's.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled || !result.assets?.length) return;
      const a = result.assets[0];
      // ARU-105 AC 5 / AC 6: compressed when picked; the 10 MB rule applies to the compressed file. If it can't be
      // prepared, the earlier proof stays attached.
      setPreparing(true);
      let photo;
      try {
        photo = await preparePhoto(a.uri);
      } finally {
        setPreparing(false);
      }
      accept({ uri: photo.uri, kind: 'image', name: a.fileName, mimeType: 'image/jpeg', size: photo.size });
    } catch (e) {
      setPickError(e instanceof Error ? e.message : t('payments.photosError'));
    }
  }

  async function pickPdf() {
    setPickError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        base64: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const f = result.assets[0];
      accept({ uri: f.uri, kind: 'pdf', name: f.name, mimeType: f.mimeType, size: f.size });
    } catch (e) {
      setPickError(e instanceof Error ? e.message : t('payments.pickerError'));
    }
  }

  function send() {
    if (!proof) return;
    const courseId = course!.id;
    run(async () => {
      // The month of the listener's device-local date (one request per course and month).
      await sendPaymentRequest(courseId, localMonth(), proof);
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/courses/[id]', params: { id: courseId } });
    });
  }

  return (
    <KeyboardForm>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>{t('payments.courseLabel')}</Text>
        <Text style={styles.body}>{course.title}</Text>
      </View>
      <Text style={styles.muted}>{t('payments.intro')}</Text>
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>{t('payments.proofLabel')}</Text>
        {proof ? (
          <View testID="proof-preview" style={{ gap: 8 }}>
            {proof.kind === 'image' ? (
              <Image
                testID="proof-thumbnail"
                accessibilityLabel={t('payments.attachedPhoto')}
                source={{ uri: proof.uri }}
                style={{ width: '100%', height: 220, borderRadius: 10 }}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.body} numberOfLines={2}>
                {proof.name || t('payments.defaultPdfName')}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('payments.removeProof')}
              disabled={busy}
              hitSlop={8}
              onPress={() => setProof(null)}
              style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
              <Text style={{ color: colors.danger, fontWeight: '600', opacity: busy ? 0.4 : 1 }}>{t('payments.remove')}</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.muted}>{t('payments.nothingAttached')}</Text>
        )}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              title={
                preparing
                  ? t('payments.preparing')
                  : proof?.kind === 'image'
                    ? t('payments.replacePhoto')
                    : t('payments.attachPhoto')
              }
              variant="secondary"
              disabled={busy || preparing}
              onPress={pickPhoto}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={proof?.kind === 'pdf' ? t('payments.replacePdf') : t('payments.attachPdf')}
              variant="secondary"
              disabled={busy || preparing}
              onPress={pickPdf}
            />
          </View>
        </View>
      </View>
      <ErrorText error={pickError} />
      <ErrorText error={error} />
      <Button title={busy ? t('payments.sending') : t('payments.sendRequest')} onPress={send} disabled={!proof || busy || preparing} />
    </KeyboardForm>
  );
}
