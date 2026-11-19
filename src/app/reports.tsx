import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Text } from '@/components/AppText';
import { Button, Card, EmptyState, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { confirmDestructive } from '@/lib/confirm';
import { stars, starsLabel } from '@/lib/feedback';
import { font } from '@/lib/fonts';
import { REPORT_REASONS, sortReports } from '@/lib/reports';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import type { ContentReport } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/**
 * ARU-158 AC 5-9: the teacher's Reports list. Open reports oldest first, then those resolved in the last 30 days,
 * newest first. Delete content (with a confirmation) or Dismiss each open report; a report about the teacher's own
 * content has no Dismiss (only the operator dismisses it). Refetched whenever the screen opens.
 */
export default function ReportsScreen() {
  const { currentUser, contentReports, loadReports } = useStore();
  const { t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadReports().catch(() => {});
    }, [loadReports]),
  );

  if (currentUser?.role !== 'teacher') return <EmptyState title={t('db.report_teacher_only')} />;
  const { open, resolved } = sortReports(contentReports);

  async function refresh() {
    setRefreshing(true);
    try {
      await loadReports();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {open.length === 0 && resolved.length === 0 ? (
        <EmptyState title={t('reports.none')} />
      ) : (
        <>
          {open.length > 0 && (
            <View style={{ gap: 12 }} testID="reports-open">
              <Text style={styles.label}>{t('reports.open')}</Text>
              {open.map((r) => (
                <ReportCard key={r.id} report={r} />
              ))}
            </View>
          )}
          {resolved.length > 0 && (
            <View style={{ gap: 12 }} testID="reports-resolved">
              <Text style={styles.label}>{t('reports.resolved')}</Text>
              {resolved.map((r) => (
                <ReportCard key={r.id} report={r} />
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function ReportCard({ report }: { report: ContentReport }) {
  const { currentUser, getUser, getCourse, dismissReport, deleteReportedContent } = useStore();
  const { t, lang, formatDate, formatDateTime } = useI18n();
  const remove = useAction();
  const dismiss = useAction();
  const busy = remove.busy || dismiss.busy;
  const nameOf = (id: string | null) => (id ? (getUser(id)?.name ?? t('common.unknown')) : t('common.deletedAccount'));
  // AC 9: a report about the teacher's own content.
  const own = !!currentUser && report.authorId === currentUser.id;
  const reason = REPORT_REASONS.find((r) => r.value === report.reason);

  function onDelete() {
    confirmDestructive(t('reports.deleteTitle'), t('reports.deleteMessage'), t('reports.deleteContent')).then((ok) => {
      if (ok) remove.run(() => deleteReportedContent(report));
    });
  }

  return (
    <Card testID={`report-${report.id}`}>
      <View style={{ gap: 2 }}>
        <Text style={{ ...font(600), color: colors.text }}>{t(`reports.kind.${report.kind}`)}</Text>
        <Text style={styles.muted}>{placeOf(report, getCourse(report.courseId)?.title, t, formatDateTime)}</Text>
      </View>
      {/* AC 4: the content as it was when reported. */}
      <View style={{ gap: 4, borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: 10 }}>
        {report.title ? <Text style={{ ...font(500), color: colors.text }}>{report.title}</Text> : null}
        {report.rating ? (
          <Text style={{ color: colors.star, fontSize: 16 }} accessibilityLabel={starsLabel(report.rating, lang)}>
            {stars(report.rating)}
          </Text>
        ) : null}
        {report.text ? <Text style={styles.body}>{report.text}</Text> : null}
      </View>
      <Text style={styles.body}>{t('reports.author', { name: nameOf(report.authorId) })}</Text>
      <Text style={styles.muted}>
        {t('reports.reportedBy', { name: nameOf(report.reporterId), date: formatDateTime(report.createdAt) })}
      </Text>
      <Text style={styles.body}>{t('reports.reason', { reason: reason ? t(reason.label) : report.reason })}</Text>
      {report.comment ? <Text style={styles.body}>{t('reports.comment', { comment: report.comment })}</Text> : null}
      {report.status === 'open' ? (
        <View style={{ gap: 8 }}>
          {own ? <Text style={[styles.muted, { color: colors.warning }]}>{t('reports.operatorNote')}</Text> : null}
          <ErrorText error={remove.error ?? dismiss.error} />
          <Button
            title={remove.busy ? t('reports.deleting') : t('reports.deleteContent')}
            variant="danger"
            disabled={busy}
            onPress={onDelete}
          />
          {!own && (
            <Button
              title={t('reports.dismiss')}
              variant="secondary"
              disabled={busy}
              onPress={() => dismiss.run(() => dismissReport(report.id))}
            />
          )}
        </View>
      ) : (
        <Text style={styles.muted} testID="report-status">
          {t(report.status === 'removed' ? 'reports.statusRemoved' : 'reports.statusDismissed', {
            date: formatDate(report.resolvedAt ?? report.createdAt),
          })}
        </Text>
      )}
    </Card>
  );
}

/** AC 6: where the content is: its course, the general chat, a meeting, the Blog or the Knowledge base. The course's
 *  current title when it still exists, else its title when reported. */
function placeOf(
  report: ContentReport,
  currentTitle: string | undefined,
  t: (id: string, params?: Record<string, string | number>) => string,
  formatDateTime: (value: string) => string,
) {
  const course = currentTitle ?? report.courseTitle ?? t('common.unknown');
  switch (report.kind) {
    case 'general_message':
      return t('reports.place.generalChat');
    case 'blog_post':
      return t('reports.place.blog');
    case 'pdf':
      return report.courseId ? `${t('reports.place.knowledgeBase')} · ${course}` : t('reports.place.knowledgeBase');
    case 'meeting_note':
      return report.meetingAt ? t('reports.place.meeting', { course, date: formatDateTime(report.meetingAt) }) : course;
    default:
      return course;
  }
}
