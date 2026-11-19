import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text, TextInput } from '@/components/AppText';
import { KeyboardForm } from '@/components/KeyboardForm';
import { Button, EmptyState, ErrorText, styles } from '@/components/ui';
import { useI18n } from '@/i18n/context';
import { notify } from '@/lib/confirm';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { isContentKind, REPORT_COMMENT_MAX, REPORT_REASONS } from '@/lib/reports';
import type { ReportReason } from '@/lib/types';
import { useAction } from '@/lib/useAction';

/**
 * ARU-158 AC 2-4: report one piece of content (`?kind=…&id=…`): four reasons (none chosen), an optional comment and
 * Send report, enabled once a reason is chosen. The database checks the rest (duplicates, own or unseen content, gone).
 */
export default function ReportScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const { reportContent } = useStore();
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');

  if (!id || !isContentKind(kind)) return <EmptyState title={t('db.report_content_missing')} />;
  const contentKind = kind;

  function send() {
    if (!reason || busy) return;
    run(async () => {
      await reportContent({ kind: contentKind, contentId: id, reason, comment });
      notify(t('report.thanks'));
      if (router.canGoBack()) router.back();
      else router.replace('/');
    });
  }

  return (
    <KeyboardForm contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('report.reasonHeading')}</Text>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {REPORT_REASONS.map((r) => {
          const selected = reason === r.value;
          return (
            <Pressable
              key={r.value}
              testID={`reason-${r.value}`}
              accessibilityRole="radio"
              accessibilityLabel={t(r.label)}
              accessibilityState={{ checked: selected, disabled: busy }}
              disabled={busy}
              onPress={() => setReason(r.value)}
              style={[
                styles.card,
                { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 12 },
                selected && { borderColor: colors.primary, backgroundColor: colors.primarySoft },
              ]}>
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={selected ? colors.primary : colors.muted}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={[styles.body, { flexShrink: 1 }]}>{t(r.label)}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>{t('report.commentLabel')}</Text>
        <TextInput
          testID="report-comment"
          accessibilityLabel={t('report.commentLabel')}
          placeholder={t('report.commentPlaceholder')}
          placeholderTextColor={colors.muted}
          value={comment}
          onChangeText={setComment}
          maxLength={REPORT_COMMENT_MAX}
          multiline
          editable={!busy}
          style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
        />
        <Text style={[styles.muted, { alignSelf: 'flex-end' }]} testID="report-comment-count">
          {t('report.commentCount', { count: comment.length, max: REPORT_COMMENT_MAX })}
        </Text>
      </View>
      <ErrorText error={error} />
      <Button title={busy ? t('report.sending') : t('report.send')} onPress={send} disabled={!reason || busy} />
    </KeyboardForm>
  );
}
