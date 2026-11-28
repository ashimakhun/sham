// ARU-194: the course card's 2-line description preview, its "Show description" button and the pop-up with the full
// description. The pop-up's text is drawn only by CourseDescriptionText, so ARU-195 (formatted descriptions) changes
// that one component.
import { type Ref, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type TextInstance,
  type ViewInstance,
} from 'react-native';

import { Text } from '@/components/AppText';

import { styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { font } from '@/lib/fonts';
import { colors } from '@/lib/theme';

/** Lines the card shows before cutting the description short. */
export const PREVIEW_LINES = 2;

/** Moves screen reader focus (native) or keyboard focus (web) to a view. iOS usually does this by itself. */
function focusView(view: unknown) {
  if (!view) return;
  if (Platform.OS === 'web') {
    (view as { focus?: () => void }).focus?.();
    return;
  }
  try {
    AccessibilityInfo.sendAccessibilityEvent(view as never, 'focus');
  } catch {
    // Focus is a courtesy: never let it break closing the pop-up.
  }
}

/**
 * The card's description, cut at 2 lines. `onTruncatedChange` tells whether it is cut short, measured on the real
 * layout on iOS, Android and web: the clamped text's height is compared with a hidden, unclamped copy at the same
 * width and style (`onTextLayout` is not implemented on web). It follows rotation, window resizes and text size.
 */
export function DescriptionPreview({
  text,
  onTruncatedChange,
}: {
  text: string;
  onTruncatedChange: (truncated: boolean) => void;
}) {
  const [clamped, setClamped] = useState<number | null>(null);
  const [full, setFull] = useState<number | null>(null);
  const last = useRef<boolean | null>(null);

  const report = (c: number | null, f: number | null) => {
    if (c == null || f == null) return;
    // 1 pt of slack for sub-pixel rounding, so a description of exactly 2 lines isn't "cut short".
    const truncated = f > c + 1;
    if (last.current === truncated) return;
    last.current = truncated;
    onTruncatedChange(truncated);
  };
  const onClamped = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setClamped(h);
    report(h, full);
  };
  const onFull = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setFull(h);
    report(clamped, h);
  };

  return (
    <View>
      <Text testID="course-description-preview" style={styles.body} numberOfLines={PREVIEW_LINES} onLayout={onClamped}>
        {text}
      </Text>
      {/* Measuring copy: invisible, untouchable and hidden from screen readers. */}
      <View
        pointerEvents="none"
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={s.measure}>
        <Text testID="course-description-measure" style={styles.body} onLayout={onFull}>
          {text}
        </Text>
      </View>
    </View>
  );
}

/** The link-style "Show description" button under a cut-short description. At least 44 × 44 pt. */
export function ShowDescriptionButton({
  title,
  onPress,
  ref,
}: {
  title: string;
  onPress: () => void;
  ref?: Ref<ViewInstance>;
}) {
  const { t } = useI18n();
  return (
    <Pressable
      ref={ref}
      testID="course-show-description"
      accessibilityRole="button"
      accessibilityLabel={t('courses.showDescriptionLabel', { title })}
      onPress={onPress}
      style={({ pressed }) => [s.link, pressed && { opacity: 0.6 }]}>
      <Text style={s.linkText}>{t('courses.showDescription')}</Text>
    </Pressable>
  );
}

/** The full description as plain text with its line breaks (ARU-194). ARU-195 switches this to formatted text. */
export function CourseDescriptionText({ text }: { text: string }) {
  return (
    <Text testID="course-description-full" style={styles.body} selectable>
      {text}
    </Text>
  );
}

/**
 * The pop-up with the course title as heading and the full description, which scrolls inside it. Closes with Close,
 * a tap outside, Android back or Escape on the web (core `Modal`'s onRequestClose). Never past the screen edges;
 * centred with a maximum width on wide windows.
 */
export function CourseDescriptionDialog({
  visible,
  title,
  description,
  onClose,
}: {
  visible: boolean;
  title: string;
  description: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const heading = useRef<TextInstance>(null);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      // The heading is read first (AC 8).
      onShow={() => focusView(heading.current)}>
      <View style={s.backdrop}>
        {/* Tap outside: close. Touch only; screen readers use the Close button, so the heading is the first stop. */}
        <Pressable
          testID="course-description-backdrop"
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
          aria-hidden
          style={StyleSheet.absoluteFill}
        />
        <View testID="course-description-dialog" style={s.sheet} accessibilityViewIsModal aria-modal>
          <Text ref={heading} style={s.heading} accessibilityRole="header">
            {title}
          </Text>
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
            <CourseDescriptionText text={description} />
          </ScrollView>
          <Pressable
            testID="course-description-close"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [s.close, pressed && { opacity: 0.6 }]}>
            <Text style={s.closeText}>{t('courses.descriptionClose')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** After the pop-up's fade-out, focus goes back to the Show description button (AC 8). */
export function focusAfterClose(view: { current: unknown }) {
  setTimeout(() => focusView(view.current), 350);
}

const s = StyleSheet.create({
  measure: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  link: {
    alignSelf: 'flex-start',
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    marginVertical: -8,
  },
  linkText: { fontSize: 15, ...font(500), color: colors.primary },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    // Clear of the status bar and home indicator; the sheet stays inside the screen and its text scrolls (AC 3).
    paddingVertical: 64,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 480,
    maxHeight: '100%',
    borderRadius: 14,
    backgroundColor: colors.card,
    paddingTop: 16,
    paddingBottom: 8,
    overflow: 'hidden',
  },
  heading: {
    fontSize: 17,
    ...font(600),
    color: colors.text,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 8 },
  close: {
    alignSelf: 'flex-end',
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  closeText: { fontSize: 15, ...font(600), color: colors.primary },
});
