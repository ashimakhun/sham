import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { HomeworkCard } from '@/components/HomeworkCard';
import { Button, EmptyState, Segmented, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { HomeworkStatus } from '@/lib/types';

/** Students: 'all' or a status. Checkers (mentor, teacher): a status only (ARU-23 removed "All"). */
type Filter = 'all' | HomeworkStatus;
/** ARU-23: mentors switch between homework they check (Owner) and homework they sent (Listener). */
type Tab = 'owner' | 'listener';

const NO_COURSE_HINT = 'You are not in any course yet — ask your teacher or mentor to add you.';
const emptyText: Record<string, { title: string; hint: string }> = {
  student: { title: 'No homework yet', hint: 'Tap "Add homework" to send your work to your course mentor.' },
  mentor: { title: 'Nothing to check', hint: 'Homework sent by course listeners will appear here.' },
  teacher: { title: 'No homework yet', hint: 'Homework sent by course listeners will appear here.' },
  mine: { title: 'No homework sent yet', hint: 'Tap "Add homework" to send work for a course you attend.' },
  // Without a course there is no "+ Add homework" button (ARU-19 AC 3, ARU-23 AC 11).
  studentNoCourse: { title: 'No homework yet', hint: NO_COURSE_HINT },
  mineNoCourse: { title: 'No homework sent yet', hint: NO_COURSE_HINT },
};

export default function HomeworkScreen() {
  const { currentUser, courses, courseMembers, loading, refresh, visibleHomework } = useStore();
  const role = currentUser?.role ?? 'student';
  const me = currentUser?.id;
  // Mentors and the teacher check homework (ARU-14: any course, never their own); students see their own.
  const isChecker = role === 'mentor' || role === 'teacher';
  // A listener of a loaded course: the same rule as the Add homework form's course list, so the button, the
  // switcher and the form never disagree (ARU-19, ARU-23 analysis note 2).
  const inLoadedCourse = courses.some((c) => courseMembers.some((m) => m.courseId === c.id && m.userId === me));

  const mine = visibleHomework.filter((h) => h.studentId === me);
  // For checkers the Owner lists cover homework they can check, i.e. not their own.
  const base = isChecker ? visibleHomework.filter((h) => h.studentId !== me) : visibleHomework;

  // Owner | Listener only for mentors who attend a course or have sent homework (AC 1, AC 7).
  const showSwitcher = role === 'mentor' && (inLoadedCourse || mine.length > 0);
  const [selectedTab, setSelectedTab] = useState<Tab>('owner');
  const [filter, setFilter] = useState<Filter>(isChecker ? 'submitted' : 'all');
  const tab: Tab = showSwitcher ? selectedTab : 'owner';

  // The switcher disappeared while on Listener (last course and homework gone): back to Owner / To check
  // (analysis note 3), so a Listener filter never stays applied to the Owner list. Adjusted during render.
  const [hadSwitcher, setHadSwitcher] = useState(showSwitcher);
  if (hadSwitcher !== showSwitcher) {
    setHadSwitcher(showSwitcher);
    if (!showSwitcher && selectedTab === 'listener') {
      setSelectedTab('owner');
      setFilter('submitted');
    }
  }

  function switchTab(next: Tab) {
    setSelectedTab(next);
    setFilter('submitted'); // each tab opens on its default filter (AC 9)
  }

  const onListener = isChecker && tab === 'listener';
  const list = onListener ? mine : base;
  const data = filter === 'all' ? list : list.filter((h) => h.status === filter);
  const waiting = list.filter((h) => h.status === 'submitted').length;

  const options: { value: Filter; label: string }[] = !isChecker
    ? [
        { value: 'submitted', label: `Waiting (${waiting})` },
        { value: 'checked', label: 'Checked' },
        { value: 'all', label: 'All' },
      ]
    : [
        { value: 'submitted', label: `${onListener ? 'Waiting' : 'To check'} (${waiting})` },
        { value: 'checked', label: 'Checked' },
      ];

  // Students while in a course (ARU-19); mentors only on the Listener tab while in a course (ARU-23 AC 3, 5, 6);
  // the teacher never.
  const canSubmit = (role === 'student' && inLoadedCourse) || (onListener && inLoadedCourse);

  const empty = onListener
    ? emptyText[canSubmit ? 'mine' : 'mineNoCourse']
    : emptyText[role === 'student' && !inLoadedCourse ? 'studentNoCourse' : role];

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
          {showSwitcher && <TabSwitch value={tab} onChange={switchTab} />}
          {canSubmit && <Button title="+ Add homework" onPress={() => router.push('/homework/new')} />}
          <Segmented<Filter> value={filter} onChange={setFilter} options={options} />
        </View>
      }
      ListEmptyComponent={<EmptyState {...empty} />}
    />
  );
}

/** "Owner" / "Listener" switch for mentors (ARU-23), styled like the Courses tab's view switch. */
function TabSwitch({ value, onChange }: { value: Tab; onChange: (v: Tab) => void }) {
  const options: { value: Tab; label: string }[] = [
    { value: 'owner', label: 'Owner' },
    { value: 'listener', label: 'Listener' },
  ];
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && styles.segmentActive]}>
            <Text style={[styles.segmentText, selected && { color: colors.text }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
