import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';

import { HomeworkCard } from '@/components/HomeworkCard';
import { Button, EmptyState, Segmented, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import type { HomeworkStatus } from '@/lib/types';

/** 'mine' = homework I sent (mentors who are listeners); the others are what I can check. */
type Filter = 'all' | HomeworkStatus | 'mine';

const emptyText: Record<string, { title: string; hint: string }> = {
  student: { title: 'No homework yet', hint: 'Tap "Add homework" to send your work to your course mentor.' },
  mentor: { title: 'Nothing to check', hint: 'Homework sent by course listeners will appear here.' },
  teacher: { title: 'No homework yet', hint: 'Homework sent by course listeners will appear here.' },
  mine: { title: 'No homework sent yet', hint: 'Tap "Add homework" to send work for a course you attend.' },
  // A student in no course has no "+ Add homework" button (ARU-19 AC 3).
  studentNoCourse: { title: 'No homework yet', hint: 'You are not in any course yet — ask your teacher or mentor to add you.' },
};

export default function HomeworkScreen() {
  const { currentUser, courses, courseMembers, loading, refresh, visibleHomework } = useStore();
  const role = currentUser?.role ?? 'student';
  const me = currentUser?.id;
  // Mentors and the teacher check homework (ARU-14: any course, never their own); students see their own.
  const isChecker = role === 'mentor' || role === 'teacher';
  const isListener = courseMembers.some((m) => m.userId === me);
  // Students: only while a listener of a loaded course, the same rule as the Add homework form's course list, so the
  // button and the form never disagree (ARU-19). Mentors: only as listeners (ARU-14). The teacher: never.
  const inLoadedCourse = courses.some((c) => courseMembers.some((m) => m.courseId === c.id && m.userId === me));
  const canSubmit = (role === 'student' && inLoadedCourse) || (role === 'mentor' && isListener);
  const [filter, setFilter] = useState<Filter>(isChecker ? 'submitted' : 'all');

  const mine = visibleHomework.filter((h) => h.studentId === me);
  // For checkers the status filters cover homework they can check, i.e. not their own.
  const base = isChecker ? visibleHomework.filter((h) => h.studentId !== me) : visibleHomework;
  const data = filter === 'mine' ? mine : filter === 'all' ? base : base.filter((h) => h.status === filter);
  const waiting = base.filter((h) => h.status === 'submitted').length;

  const options: { value: Filter; label: string }[] = [
    { value: 'submitted', label: `To check (${waiting})` },
    { value: 'checked', label: 'Checked' },
    { value: 'all', label: 'All' },
  ];
  if (role === 'mentor' && (isListener || mine.length > 0)) options.push({ value: 'mine', label: 'My homework' });

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={data}
      refreshing={loading}
      onRefresh={() => refresh().catch(() => {})}
      keyExtractor={(h) => h.id}
      renderItem={({ item }) => <HomeworkCard item={item} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {canSubmit && <Button title="+ Add homework" onPress={() => router.push('/homework/new')} />}
          <Segmented<Filter> value={filter} onChange={setFilter} options={options} />
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          {...emptyText[filter === 'mine' ? 'mine' : role === 'student' && !inLoadedCourse ? 'studentNoCourse' : role]}
        />
      }
    />
  );
}
