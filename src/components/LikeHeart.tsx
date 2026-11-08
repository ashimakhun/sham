import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { type Language, translate } from '@/i18n';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { MaterialLike, User } from '@/lib/types';
import { useAction } from '@/lib/useAction';

// User-visible texts of the like heart (ARU-120), from the EN/RU catalog (ARU-132), with Russian plurals.
export const likeTexts = {
  /** "1 like" / "N likes" ("1 лайк" / "2 лайка" / "5 лайков"). */
  count: (n: number, lang: Language = 'en') => translate(lang, 'materials.likes', { count: n }),
  /** Screen reader label of the heart: "Like" at 0, else "Like, N likes" / "Unlike, N likes". */
  label: (liked: boolean, n: number, lang: Language = 'en') =>
    n === 0
      ? translate(lang, 'materials.likeLabel')
      : translate(lang, liked ? 'materials.heartUnlike' : 'materials.heartLike', { count: n }),
};

/**
 * Likes of one post (ARU-52), newest first. Only likers whose profile loads count: the app only loads approved
 * accounts, so likes of accounts that are waiting or declined are not shown. The Blog card and the post page both
 * use this, so they always agree.
 */
export function likesOf(
  materialId: string,
  materialLikes: MaterialLike[],
  getUser: (id: string) => User | undefined,
  currentUserId: string | undefined,
) {
  const likers = materialLikes
    .filter((l) => l.materialId === materialId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((l) => getUser(l.userId))
    .filter((u): u is User => u !== undefined);
  return { likers, count: likers.length, liked: likers.some((u) => u.id === currentUserId) };
}

/**
 * ARU-120: a row with `children` ("author · date") on the left and the like heart with its count on the right, plus
 * the like error under it. The heart is a plain icon (no background or border) with a 44×44 touch area. It always
 * takes the touch, even while saving, so a tap on it never falls through to the Blog card and opens the post.
 */
export function LikeRow({
  materialId,
  liked,
  count,
  children,
}: {
  materialId: string;
  liked: boolean;
  count: number;
  children: ReactNode;
}) {
  const { likeMaterial, unlikeMaterial } = useStore();
  const { busy, error, run } = useAction();
  const { lang } = useI18n();
  const color = liked ? colors.primary : colors.muted;

  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, flexShrink: 1 }}>{children}</View>
        <Pressable
          testID={`like-${materialId}`}
          accessibilityRole="button"
          accessibilityLabel={likeTexts.label(liked, count, lang)}
          accessibilityState={{ selected: liked, disabled: busy }}
          hitSlop={12}
          onPress={() => {
            if (busy) return;
            run(() => (liked ? unlikeMaterial(materialId) : likeMaterial(materialId)));
          }}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24, minWidth: 24 },
            (pressed || busy) && { opacity: busy ? 0.4 : 0.7 },
          ]}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={color} />
          {count > 0 && <Text style={[styles.muted, { color }]}>{count}</Text>}
        </Pressable>
      </View>
      <ErrorText error={error} />
    </View>
  );
}

/** ARU-120: one liker in the post page's list: the name, and a filled heart that is only decoration. */
export function LikerRow({ name }: { name: string }) {
  return (
    <View
      accessible
      accessibilityLabel={name}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text style={[styles.body, { flexShrink: 1 }]}>{name}</Text>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="heart" size={18} color={colors.primary} />
      </View>
    </View>
  );
}
