import { router } from 'expo-router';
import { Text } from 'react-native';

import { Card, StatusBadge, styles } from '@/components/ui';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { Homework } from '@/lib/types';

/** ARU-90: a checker's comment as one line for the card preview; null when there is nothing to show. */
export function commentPreview(comment: string | null | undefined): string | null {
  const text = (comment ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

/**
 * A homework in a list. `showStatus={false}` hides the status badge (the Homework tab, whose lists already name the
 * status: ARU-90 / ARU-91); a checked homework then shows the checker's comment preview instead (ARU-90).
 */
export function HomeworkCard({ item, showStatus = true }: { item: Homework; showStatus?: boolean }) {
  const { currentUser, getUser, getCourse } = useStore();
  const showStudent = currentUser?.role !== 'student';
  const showComment = !showStatus && item.status === 'checked';
  const comment = showComment ? commentPreview(item.mentorComment) : null;

  return (
    <Card onPress={() => router.push({ pathname: '/homework/[id]', params: { id: item.id } })}>
      <Text style={styles.title} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={[styles.label, { color: colors.primary }]} numberOfLines={2}>
        {getCourse(item.courseId)?.title ?? 'No course'}
      </Text>
      <Text style={styles.muted}>
        {showStudent ? `${getUser(item.studentId)?.name ?? 'Unknown student'} · ` : ''}
        {formatDate(item.createdAt)}
        {item.photoUrl ? ' · 📎 photo' : ''}
      </Text>
      {showComment &&
        (comment ? (
          // One Text with the name nested: the 2-line ellipsis covers both, and screen readers hear "Name: comment".
          <Text testID="homework-comment-preview" style={commentStyle} numberOfLines={2} ellipsizeMode="tail">
            <Text style={{ fontWeight: '600' }}>{`${getUser(item.checkedById)?.name ?? 'Unknown'}:`}</Text>
            {` ${comment}`}
          </Text>
        ) : (
          <Text testID="homework-comment-preview" style={commentStyle} numberOfLines={2}>
            Checked without a comment
          </Text>
        ))}
      {showStatus && <StatusBadge status={item.status} />}
    </Card>
  );
}

const commentStyle = [styles.body, { color: colors.muted }];
