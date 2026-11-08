import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { AssignmentCard } from '@/components/AssignmentCard';
import { AuthorFilter } from '@/components/AuthorFilter';
import { HomeworkCard } from '@/components/HomeworkCard';
import { DownloadMyPhotosButton, PhotoDeletionBanner } from '@/components/PhotoDownload';
import { EmptyState, Segmented, styles, UnreadBadge } from '@/components/ui';
import { deletionWarning, storedOwnPhotos } from '@/lib/photoRetention';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { Homework, HomeworkAssignment, HomeworkStatus } from '@/lib/types';
import { listenerTabLabel } from '@/lib/unread';
import { useNow } from '@/lib/useNow';

/** Listener views (ARU-32): New (assignments not sent yet) · Waiting · Checked. Checkers: To check · Checked. */
type Filter = 'new' | HomeworkStatus;
/** ARU-23: mentors switch between homework they check (Owner) and homework they sent (Listener). */
type Tab = 'owner' | 'listener';

/** ARU-80: the course filter's "All courses" entry. Not a uuid, so it can never be a course id. */
const ALL_COURSES = 'all';
/** Homework without a course id: one "No course" entry. Also not a uuid. */
const NO_COURSE = 'none';
const courseKey = (h: Homework) => h.courseId ?? NO_COURSE;

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
  const { currentUser, courses, courseMembers, loading, refresh, visibleHomework, assignments, getCourse, photoDeletionStart } =
    useStore();
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
  // ARU-80 AC 8: the Checked list's course choice, kept per tab while the app is open (students and the teacher use
  // only the 'owner' slot). Switching tabs resets the status list, never this.
  const [courseChoice, setCourseChoice] = useState<Record<Tab, string>>({ owner: ALL_COURSES, listener: ALL_COURSES });

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
  const byStatus: (Homework | HomeworkAssignment)[] =
    shown === 'new' ? fresh : list.filter((h) => h.status === shown);

  // ARU-80: course filter on Checked only (AC 3, AC 4). Options are the courses of the current Checked list, by
  // course id (same-title courses stay separate), sorted by title case-insensitively (AC 5). Filtering narrows the
  // loaded list only, in its existing order (AC 6). A choice whose course left the list counts as All courses during
  // render, so there is never an empty filtered list (AC 7), and the choice itself is reset to All courses then, so
  // the old course coming back later doesn't silently re-apply the filter.
  const checked = list.filter((h) => h.status === 'checked');
  const courseOptions = [...new Set(checked.map(courseKey))]
    .map((id) => ({ value: id, label: (id === NO_COURSE ? undefined : getCourse(id)?.title) ?? 'No course' }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || a.value.localeCompare(b.value));
  const chosen = courseChoice[tab];
  const courseFilter = courseOptions.some((o) => o.value === chosen) ? chosen : ALL_COURSES;
  if (courseFilter !== chosen) setCourseChoice((c) => ({ ...c, [tab]: ALL_COURSES }));
  const filterByCourse = shown === 'checked';
  const data: (Homework | HomeworkAssignment)[] =
    filterByCourse && courseFilter !== ALL_COURSES
      ? checked.filter((h) => courseKey(h) === courseFilter)
      : byStatus;

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

  // ARU-107: the user's own stored photos (any status), the 30-day warning (AC 4) and Download my photos (AC 5). Only
  // in the sender's views: students' lists, and mentors' Listener side. All courses, whatever the course filter.
  const myPhotos = listenerView ? storedOwnPhotos(visibleHomework, me) : [];
  const warning = listenerView ? deletionWarning(visibleHomework, me, photoDeletionStart, new Date(now)) : null;

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
        'meetingId' in item ? (
          <AssignmentCard item={item} now={now} />
        ) : (
          // ARU-90 / ARU-91: every list here already names the status, so cards never show the badge; Checked cards
          // show the checker's comment instead.
          <HomeworkCard item={item} showStatus={false} />
        )
      }
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {showSwitcher && <TabSwitch value={tab} onChange={switchTab} newCount={fresh.length} />}
          {warning && <PhotoDeletionBanner warning={warning} totalPhotos={myPhotos.length} />}
          <Segmented<Filter> value={shown} onChange={setFilter} options={options} />
          {listenerView && shown === 'checked' && <DownloadMyPhotosButton totalPhotos={myPhotos.length} />}
          {filterByCourse && (
            <AuthorFilter
              noun="course"
              options={[{ value: ALL_COURSES, label: 'All courses' }, ...courseOptions]}
              value={courseFilter}
              onChange={(v) => setCourseChoice((c) => ({ ...c, [tab]: v }))}
            />
          )}
        </View>
      }
      ListEmptyComponent={<EmptyState {...empty} />}
    />
  );
}

/**
 * "Owner" / "Listener" switch for mentors (ARU-23), styled like the Courses tab's view switch. ARU-73: Listener shows
 * the New (N) count as a badge right after its label, on both tabs; none at 0. Inline (not absolute), so it never
 * overlaps the label or gets clipped by the segment's corners.
 */
function TabSwitch({ value, onChange, newCount }: { value: Tab; onChange: (v: Tab) => void; newCount: number }) {
  const options: { value: Tab; label: string; badge: number; a11y: string }[] = [
    { value: 'owner', label: 'Owner', badge: 0, a11y: 'Owner' },
    { value: 'listener', label: 'Listener', badge: newCount, a11y: listenerTabLabel(newCount) },
  ];
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityLabel={o.a11y}
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[
              styles.segment,
              { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingHorizontal: 6 },
              selected && styles.segmentActive,
            ]}>
            <Text style={[styles.segmentText, { flexShrink: 1 }, selected && { color: colors.text }]} numberOfLines={1}>
              {o.label}
            </Text>
            {/* Negative margin: the 20 pt badge doesn't make the segment taller than its neighbour. */}
            <UnreadBadge count={o.badge} style={{ marginVertical: -2 }} />
          </Pressable>
        );
      })}
    </View>
  );
}
