import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, SectionList, View } from 'react-native';

import { Text } from '@/components/AppText';

import { CourseCard } from '@/components/CourseCard';
import { DisciplineCard } from '@/components/Disciplines';
import { Button, EmptyState, styles } from '@/components/ui';
import { canManageDisciplines } from '@/lib/disciplines';
import { canCreateCourse } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { Course } from '@/lib/types';
import { usePaymentDues } from '@/lib/usePaymentDues';

/** ARU-63: "Courses" (was "My courses", plus courses with no discipline) and "Disciplines" (replaces "All courses"). */
type CoursesView = 'courses' | 'disciplines';

const myEmpty: Record<string, { title: string; hint: string }> = {
  student: { title: 'You are not in any course yet', hint: 'Ask your teacher or mentor to add you.' },
  mentor: { title: "You don't own or attend any course yet", hint: 'Create one with "+ New course" or ask to be added.' },
  teacher: { title: "You don't own any course yet", hint: 'Create one with "+ New course".' },
};

type Section = { key: string; title?: string; data: Course[] };

export default function CoursesScreen() {
  const { currentUser, courseMembers, loading, refresh, courses, disciplines } = useStore();
  const role = currentUser?.role ?? 'student';
  const me = currentUser?.id;
  const canCreate = canCreateCourse(currentUser?.role);
  const [view, setView] = useState<CoursesView>('courses');

  // "Courses" is selected each time the tab is opened, but not when coming back from a course, a discipline or
  // "+ New course" / "+ New discipline" opened from here.
  const openedFromHere = useRef(false);
  const openFromHere = () => {
    openedFromHere.current = true;
  };
  // ARU-66: the listener's own payment deadlines; reloaded on every focus (and by the hook on foreground / new day).
  const { dues, reload: reloadDues } = usePaymentDues();
  useFocusEffect(
    useCallback(() => {
      reloadDues();
      if (openedFromHere.current) openedFromHere.current = false;
      else setView('courses');
    }, [reloadDues]),
  );

  // Courses I own (current owner) win over memberships, so no course is ever listed twice.
  const owned = courses.filter((c) => c.createdById === me);
  const listening = courses.filter(
    (c) => c.createdById !== me && courseMembers.some((m) => m.courseId === c.id && m.userId === me),
  );

  // ARU-63 AC 8: then every other course the user can read that has no discipline, newest first (as "All courses"
  // was). Courses with a discipline that the user neither owns nor attends aren't listed. Hidden courses are already
  // limited by RLS (ARU-40).
  const mine = new Set([...owned, ...listening].map((c) => c.id));
  const noDiscipline = courses.filter((c) => !mine.has(c.id) && !c.disciplineId);

  const sections: Section[] = [
    { key: 'in', title: "Courses I'm in", data: listening },
    // A student can't own a course, so the section is only for teachers and mentors.
    ...(canCreate ? [{ key: 'own', title: 'Courses I own', data: owned }] : []),
    { key: 'none', title: 'No discipline', data: noDiscipline },
  ].filter((s) => s.data.length > 0); // no empty headings; with no sections the empty state shows

  const header = (
    <View style={{ gap: 12 }}>
      <ViewSwitch value={view} onChange={setView} />
      {view === 'courses' && canCreate && (
        <Button
          title="+ New course"
          onPress={() => {
            openFromHere();
            router.push('/courses/new');
          }}
        />
      )}
      {view === 'disciplines' && canManageDisciplines(currentUser) && (
        <Button
          title="+ New discipline"
          onPress={() => {
            openFromHere();
            router.push('/disciplines/new');
          }}
        />
      )}
    </View>
  );

  if (view === 'disciplines') {
    return (
      <FlatList
        style={styles.screen}
        contentContainerStyle={[styles.content, { gap: 12 }]}
        data={disciplines}
        keyExtractor={(d) => d.id}
        // Also how students and mentors pick up a discipline the teacher hid (ARU-63 AC 12).
        refreshing={loading}
        onRefresh={() => refresh().catch(() => {})}
        ListHeaderComponent={header}
        renderItem={({ item }) => <DisciplineCard discipline={item} onOpen={openFromHere} />}
        ListEmptyComponent={
          canManageDisciplines(currentUser) ? (
            <EmptyState title="No disciplines yet" hint={'Tap "+ New discipline" to create the first one.'} />
          ) : (
            <EmptyState title="No disciplines yet" />
          )
        }
      />
    );
  }

  return (
    <SectionList
      style={styles.screen}
      contentContainerStyle={styles.content}
      sections={sections}
      refreshing={loading}
      onRefresh={() => refresh().catch(() => {})}
      keyExtractor={(c) => c.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      renderSectionHeader={({ section }) =>
        section.title ? <Text style={[styles.label, { marginTop: 8 }]}>{section.title.toUpperCase()}</Text> : null
      }
      renderItem={({ item, section }) => (
        <CourseCard course={item} onOpen={openFromHere} paymentDue={dues.get(item.id)} />
      )}
      ListEmptyComponent={<EmptyState {...myEmpty[role]} />}
    />
  );
}

/** "Courses" / "Disciplines" switch (ARU-63): two tabs built from existing styles (no new package). */
function ViewSwitch({ value, onChange }: { value: CoursesView; onChange: (v: CoursesView) => void }) {
  const options: { value: CoursesView; label: string }[] = [
    { value: 'courses', label: 'Courses' },
    { value: 'disciplines', label: 'Disciplines' },
  ];
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && styles.segmentActive]}>
            <Text style={[styles.segmentText, selected && { color: colors.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
