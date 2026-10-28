import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';

import { CourseCard } from '@/components/CourseCard';
import { Button, EmptyState, styles } from '@/components/ui';
import { canCreateCourse } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { Course } from '@/lib/types';

type CoursesView = 'mine' | 'all';

const myEmpty: Record<string, { title: string; hint: string }> = {
  student: { title: 'You are not in any course yet', hint: 'Ask your teacher or mentor to add you.' },
  mentor: { title: "You don't own or attend any course yet", hint: 'Create one with "+ New course" or ask to be added.' },
  teacher: { title: "You don't own any course yet", hint: 'Create one with "+ New course".' },
};

type Section = { key: string; title?: string; tag?: string; data: Course[] };

export default function CoursesScreen() {
  const { currentUser, courseMembers, loading, refresh, courses } = useStore();
  const role = currentUser?.role ?? 'student';
  const me = currentUser?.id;
  const canCreate = canCreateCourse(currentUser?.role);
  const [view, setView] = useState<CoursesView>('mine');

  // "My courses" is selected each time the tab is opened, but not when coming back from a course or
  // "+ New course" opened from here.
  const openedFromHere = useRef(false);
  const openFromHere = () => {
    openedFromHere.current = true;
  };
  useFocusEffect(
    useCallback(() => {
      if (openedFromHere.current) openedFromHere.current = false;
      else setView('mine');
    }, []),
  );

  // Courses I own (current owner) win over memberships, so no course is ever listed twice.
  const owned = courses.filter((c) => c.createdById === me);
  const listening = courses.filter(
    (c) => c.createdById !== me && courseMembers.some((m) => m.courseId === c.id && m.userId === me),
  );

  const sections: Section[] = (
    view === 'all'
      ? [{ key: 'all', data: courses }]
      : [
          { key: 'in', title: "Courses I'm in", tag: 'Listener', data: listening },
          // A student can't own a course, so the section is only for teachers and mentors.
          ...(canCreate ? [{ key: 'own', title: 'Courses I own', tag: 'Owner', data: owned }] : []),
        ]
  ).filter((s) => s.data.length > 0); // no empty headings; with no sections the empty state shows

  const empty =
    view === 'all' ? (
      <EmptyState
        title="No courses yet"
        hint={canCreate ? 'Tap "+ New course" to create the first one.' : 'Your teacher or mentor has not created any courses yet.'}
      />
    ) : (
      <EmptyState {...myEmpty[role]} />
    );

  return (
    <SectionList
      style={styles.screen}
      contentContainerStyle={styles.content}
      sections={sections}
      refreshing={loading}
      onRefresh={() => refresh().catch(() => {})}
      keyExtractor={(c) => c.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <ViewSwitch value={view} onChange={setView} />
          {canCreate && (
            <Button
              title="+ New course"
              onPress={() => {
                openFromHere();
                router.push('/courses/new');
              }}
            />
          )}
        </View>
      }
      renderSectionHeader={({ section }) =>
        section.title ? <Text style={[styles.label, { marginTop: 8 }]}>{section.title.toUpperCase()}</Text> : null
      }
      renderItem={({ item, section }) => <CourseCard course={item} tag={section.tag} onOpen={openFromHere} />}
      ListEmptyComponent={empty}
    />
  );
}

/** "My courses" / "All courses" switch: two tabs built from existing styles (no new package). */
function ViewSwitch({ value, onChange }: { value: CoursesView; onChange: (v: CoursesView) => void }) {
  const options: { value: CoursesView; label: string }[] = [
    { value: 'mine', label: 'My courses' },
    { value: 'all', label: 'All courses' },
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
