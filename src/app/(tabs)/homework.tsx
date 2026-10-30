import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { AssignmentCard } from '@/components/AssignmentCard';
import { HomeworkCard } from '@/components/HomeworkCard';
import { EmptyState, Segmented, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { Homework, HomeworkAssignment, HomeworkStatus } from '@/lib/types';
import { useNow } from '@/lib/useNow';

/** Listener views (ARU-32): New (assignments not sent yet) · Waiting · Checked. Checkers: To check · Checked. */
type Filter = 'new' | HomeworkStatus;
/** ARU-23: mentors switch between homework they check (Owner) and homework they sent (Listener). */
type Tab = 'owner' | 'listener';

const NO_COURSE_HINT = 'You are not in any course yet — ask your teacher or mentor to add you.';
const SENT_HINT = 'Homework you send will appear here.';
const emptyText: Record<string, { title: string; hint: string }> = {
  new: { title: 'No new homework', hint: 'Homework your mentor assigns after a meeting will appear here.' },
  newNoCourse: { title: 'No new homework', hint: NO_COURSE_HINT },
  student: { title: 'No homework yet', hint: SENT_HINT },
  mentor: { title: 'Nothing to check', hint: 'Homework sent by course listeners will appear here.' },
  teacher: { title: 'No homework yet', hint: 'Homework sent by course listeners will appear here.' },
  mine: { title: 'No homework sent yet', hint: SENT_HINT },
  studentNoCourse: { title: 'No homework yet', hint: NO_COURSE_HINT },
  mineNoCourse: { title: 'No homework sent yet', hint: NO_COURSE_HINT },
};

export default function HomeworkScreen() {
  const { currentUser, courses, courseMembers, loading, refresh, visibleHomework, assignments } = useStore();
  const role = currentUser?.role ?? 'student';
  const me = currentUser?.id;
  const now = useNow();
  // Mentors and the teacher check homework (ARU-14: any course, never their own); students see their own.
  const isChecker = role === 'mentor' || role === 'teacher';
  // Courses I am a listener of (loaded), as in the Add homework rules (ARU-19, ARU-23 analysis note 2).
  const myCourseIds = new Set(
    courses.filter((c) => courseMembers.some((m) => m.courseId === c.id && m.userId === me)).map((c) => c.id),
  );
  const inLoadedCourse = myCourseIds.size > 0;

  const mine = visibleHomework.filter((h) => h.studentId === me);
  // For checkers the Owner lists cover homework they can check, i.e. not their own.
  const base = isChecker ? visibleHomework.filter((h) => h.studentId !== me) : visibleHomework;
  // New (ARU-32): assignments of my courses I haven't sent homework for, newest first. The teacher has none.
  const sentFor = new Set(mine.map((h) => h.assignmentId).filter(Boolean));
  const fresh =
    role === 'teacher'
      ? []
      : assignments
          .filter((a) => myCourseIds.has(a.courseId) && !sentFor.has(a.id))
          .sort((x, y) => y.createdAt.localeCompare(x.createdAt));

  // Owner | Listener only for mentors who attend a course or have sent homework (AC 1, AC 7).
  const showSwitcher = role === 'mentor' && (inLoadedCourse || mine.length > 0);
  const [selectedTab, setSelectedTab] = useState<Tab>('owner');
  const [filter, setFilter] = useState<Filter>(isChecker ? 'submitted' : 'new');
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
    // Each tab opens on its default filter: Listener on New (ARU-32), Owner on To check.
    setFilter(next === 'listener' ? 'new' : 'submitted');
  }

  const onListener = isChecker && tab === 'listener';
  const listenerView = !isChecker || onListener;
  const list = onListener ? mine : base;
  const waiting = list.filter((h) => h.status === 'submitted').length;
  // A checker never has "new" (e.g. right after the switcher went away); show their default list.
  const shown: Filter = filter === 'new' && !listenerView ? 'submitted' : filter;
  const data: (Homework | HomeworkAssignment)[] = shown === 'new' ? fresh : list.filter((h) => h.status === shown);

  const options: { value: Filter; label: string }[] = listenerView
    ? [
        { value: 'new', label: `New (${fresh.length})` },
        { value: 'submitted', label: `Waiting (${waiting})` },
        { value: 'checked', label: 'Checked' },
      ]
    : [
        { value: 'submitted', label: `To check (${waiting})` },
        { value: 'checked', label: 'Checked' },
      ];

  const empty =
    shown === 'new'
      ? emptyText[inLoadedCourse ? 'new' : 'newNoCourse']
      : onListener
        ? emptyText[inLoadedCourse ? 'mine' : 'mineNoCourse']
        : emptyText[role === 'student' && !inLoadedCourse ? 'studentNoCourse' : role];

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={data}
      refreshing={loading}
      onRefresh={() => refresh().catch(() => {})}
      keyExtractor={(h) => h.id}
      renderItem={({ item }) =>
        'meetingId' in item ? <AssignmentCard item={item} now={now} /> : <HomeworkCard item={item} />
      }
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {showSwitcher && <TabSwitch value={tab} onChange={switchTab} />}
          <Segmented<Filter> value={shown} onChange={setFilter} options={options} />
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
