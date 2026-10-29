import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PHOTO_ERROR, photoFileName } from '@/lib/photo';
import { useStore } from '@/lib/store';

type Props = {
  /** Path in the "homework" bucket; the preview fetches its own fresh link, so an expired one never shows. */
  path: string;
  homeworkId: string;
  title: string;
  onClose: () => void;
};

/** Full-screen homework photo with Download (ARU-18). Close with ✕, Android back or Esc on web. */
export function PhotoPreview({ path, homeworkId, title, onClose }: Props) {
  const { getPhotoUrl } = useStore();
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
  }, [getPhotoUrl, path]);

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
      const link = await getPhotoUrl(path, { expiresIn: 60, download: photoFileName(title, homeworkId) });
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
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12} style={s.close}>
            <Text style={s.closeText}>✕</Text>
          </Pressable>
        </View>
        <View style={s.body}>
          {failed ? (
            <Text style={s.error}>{PHOTO_ERROR}</Text>
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
            accessibilityLabel="Download"
            accessibilityState={{ disabled: downloading }}
            disabled={downloading}
            onPress={download}
            style={({ pressed }) => [s.download, (pressed || downloading) && { opacity: 0.6 }]}>
            <Text style={s.downloadText}>{downloading ? 'Preparing…' : 'Download'}</Text>
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
