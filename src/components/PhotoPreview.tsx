import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n/context';
import { photoFileName } from '@/lib/photo';
import { useStore } from '@/lib/store';

type UrlLoader = (path: string, options?: { expiresIn?: number; download?: string }) => Promise<string>;

type Props = {
  /** Path in the bucket; the preview fetches its own fresh link, so an expired one never shows. */
  path: string;
  onClose: () => void;
} & (
  | {
      /** A homework photo (the "homework" bucket), downloaded as "<title>-<id>.jpg". */
      homeworkId: string;
      title: string;
      loadUrl?: undefined;
      fileName?: undefined;
      errorText?: undefined;
    }
  | {
      /** ARU-99: another private bucket (e.g. a payment proof): its signed-link loader and the download name. */
      loadUrl: UrlLoader;
      fileName: string;
      errorText?: string;
      homeworkId?: undefined;
      title?: undefined;
    }
);

/** Full-screen photo with Download (ARU-18; ARU-99 for payment proofs). Close with ✕, Android back or Esc on web. */
export function PhotoPreview({ path, homeworkId, title, loadUrl, fileName, errorText, onClose }: Props) {
  const { getPhotoUrl: homeworkUrl } = useStore();
  const { t } = useI18n();
  const getPhotoUrl: UrlLoader = loadUrl ?? homeworkUrl;
  const downloadName = fileName ?? photoFileName(title ?? '', homeworkId ?? '');
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // A fresh 1-hour link when the preview opens (AC 7). Live updates elsewhere don't touch it (no flash).
  useEffect(() => {
    let alive = true;
    getPhotoUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // The loader is stable for homework (useCallback); a caller's inline loader must not refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Web: Esc closes the preview.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as { document?: Document }).document;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    doc?.addEventListener('keydown', onKey);
    return () => doc?.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function download() {
    if (downloading) return;
    setDownloading(true);
    try {
      // A short-lived link made on tap, served as an attachment with a readable file name (AC 5, analysis note 3).
      const link = await getPhotoUrl(path, { expiresIn: 60, download: downloadName });
      await Linking.openURL(link);
    } catch {
      setFailed(true);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View testID="photo-preview" style={[s.backdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={s.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('homework.photoClose')} onPress={onClose} hitSlop={12} style={s.close}>
            <Text style={s.closeText}>✕</Text>
          </Pressable>
        </View>
        <View style={s.body}>
          {failed ? (
            <Text style={s.error}>{errorText ?? t('photo.loadError')}</Text>
          ) : (
            <>
              {url && (
                <Image
                  testID="photo-preview-image"
                  source={{ uri: url }}
                  resizeMode="contain"
                  style={s.image}
                  onLoad={() => setLoaded(true)}
                  onError={() => setFailed(true)}
                />
              )}
              {!loaded && <ActivityIndicator testID="photo-preview-loading" color="#fff" style={StyleSheet.absoluteFill} />}
            </>
          )}
        </View>
        <View style={s.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('homework.photoDownload')}
            accessibilityState={{ disabled: downloading }}
            disabled={downloading}
            onPress={download}
            style={({ pressed }) => [s.download, (pressed || downloading) && { opacity: 0.6 }]}>
            <Text style={s.downloadText}>{downloading ? t('homework.photoPreparing') : t('homework.photoDownload')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  bar: { flexDirection: 'row', justifyContent: 'flex-end', padding: 12 },
  close: { padding: 8 },
  closeText: { color: '#fff', fontSize: 24, fontWeight: '600' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '100%' },
  error: { color: '#fff', fontSize: 15, textAlign: 'center', paddingHorizontal: 24 },
  download: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  downloadText: { fontSize: 15, fontWeight: '600', color: '#000' },
});
