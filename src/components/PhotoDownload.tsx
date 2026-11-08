import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { Button, ErrorText, styles } from '@/components/ui';
import { deletionWarningText, PHOTO_ZIP_MAX, PHOTOS_ZIP_ERROR } from '@/lib/photoRetention';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';

/** A second tap within this window is ignored, so a double tap asks for one link only. */
const TAP_GUARD_MS = 800;

/**
 * ARU-107 AC 5 / AC 6 / AC 9: download a ZIP of the user's own photos. With more than PHOTO_ZIP_MAX stored photos and
 * no course given, opens Download by course instead. The link opens the same way as a photo's Download (ARU-18).
 */
export function usePhotoZipDownload(totalPhotos: number) {
  const { requestPhotoZip } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTap = useRef(0);

  async function download(input?: { courseId: string; part: number }) {
    const now = Date.now();
    if (busy || now - lastTap.current < TAP_GUARD_MS) return;
    lastTap.current = now;
    if (!input && totalPhotos > PHOTO_ZIP_MAX) {
      router.push('/homework/photos');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const url = await requestPhotoZip(input);
      await Linking.openURL(url);
    } catch {
      setError(PHOTOS_ZIP_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, download };
}

/** AC 5: "Download my photos" on the Checked list. Hidden without stored photos. */
export function DownloadMyPhotosButton({ totalPhotos }: { totalPhotos: number }) {
  const { busy, error, download } = usePhotoZipDownload(totalPhotos);
  if (totalPhotos === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Button
        title={busy ? 'Preparing…' : 'Download my photos'}
        variant="secondary"
        disabled={busy}
        onPress={() => void download()}
      />
      <ErrorText error={error} />
    </View>
  );
}

/** AC 4: the warning banner with its own Download photos button. */
export function PhotoDeletionBanner({
  warning,
  totalPhotos,
}: {
  warning: { count: number; date: string };
  totalPhotos: number;
}) {
  const { busy, error, download } = usePhotoZipDownload(totalPhotos);
  return (
    <View
      testID="photo-deletion-banner"
      accessibilityRole="alert"
      style={[styles.card, { gap: 10, borderColor: colors.danger, backgroundColor: colors.card }]}>
      <Text style={styles.body}>{deletionWarningText(warning)}</Text>
      <Button title={busy ? 'Preparing…' : 'Download photos'} disabled={busy} onPress={() => void download()} />
      <ErrorText error={error} />
    </View>
  );
}
