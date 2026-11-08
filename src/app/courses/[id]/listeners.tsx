import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Button, EmptyState, ErrorText, RoleBadge, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { canManageListeners } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { useAction } from '@/lib/useAction';

export default function AddListenersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser, users, courseMembers, getCourse, addListeners } = useStore();
  const { t } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const { busy, error, run } = useAction();

  const course = getCourse(id);
  if (currentUser && !canManageListeners(currentUser.role)) {
    return <EmptyState title={t('courses.notAllowed')} hint={t('listeners.addNotAllowedHint')} />;
  }
  if (!course) return <EmptyState title={t('courses.notFound')} />;

  const inCourse = new Set(courseMembers.filter((m) => m.courseId === course.id).map((m) => m.userId));
  // Students and mentors who are not yet listeners; never the owner or the teacher (also enforced by RLS).
  const candidates = users
    .filter((u) => (u.role === 'student' || u.role === 'mentor') && u.id !== course.createdById && !inCourse.has(u.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Someone may have been added by another user meanwhile: only send ids that are still candidates.
  const toAdd = selected.filter((uid) => candidates.some((c) => c.id === uid));

  function toggle(uid: string) {
    setSelected((s) => (s.includes(uid) ? s.filter((x) => x !== uid) : [...s, uid]));
  }

  const courseId = course.id;

  function submit() {
    run(async () => {
      await addListeners(courseId, toAdd);
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/courses/[id]', params: { id: courseId } });
    });
  }

  return (
    <View style={styles.screen}>
      <FlatList
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        data={candidates}
        keyExtractor={(u) => u.id}
        ListHeaderComponent={
          <Text style={styles.muted} numberOfLines={2}>
            {t('listeners.addIntro', { title: course.title })}
          </Text>
        }
        renderItem={({ item }) => {
          const isSelected = selected.includes(item.id);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              onPress={() => toggle(item.id)}
              style={[
                styles.input,
                { flexDirection: 'row', alignItems: 'center', gap: 10 },
                isSelected && { borderColor: colors.primary, backgroundColor: colors.primarySoft },
              ]}>
              <Text style={{ color: isSelected ? colors.primary : colors.muted, fontSize: 18 }}>
                {isSelected ? '☑' : '☐'}
              </Text>
              <Text style={[styles.body, { flex: 1 }]} numberOfLines={2}>
                {item.name}
              </Text>
              <RoleBadge role={item.role} />
            </Pressable>
          );
        }}
        ListEmptyComponent={<EmptyState title={t('listeners.everyoneIn')} />}
      />
      <View style={[styles.content, { paddingTop: 0 }]}>
        <ErrorText error={error} />
        <Button
          title={
            busy
              ? t('listeners.adding')
              : toAdd.length > 1
                ? t('listeners.addCount', { count: toAdd.length })
                : t('listeners.addOne')
          }
          onPress={submit}
          disabled={!toAdd.length || busy}
        />
      </View>
    </View>
  );
}
