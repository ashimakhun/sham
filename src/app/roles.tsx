import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, Switch, Text, TextInput, View } from 'react-native';

import { Button, EmptyState, ErrorText, RoleBadge, styles } from '@/components/ui';
import type { TextId } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { confirmDestructive } from '@/lib/confirm';
import { canManageRoles } from '@/lib/roles';
import { useStore } from '@/lib/store';
import { colors, formatDate } from '@/lib/theme';
import type { AccessRequest, Role, User } from '@/lib/types';
import { useAction } from '@/lib/useAction';

// Catalog ids, not texts, so the titles follow the chosen language (ARU-113).
const SECTIONS: { role: Role; title: TextId }[] = [
  { role: 'teacher', title: 'roles.sectionTeacher' },
  { role: 'mentor', title: 'roles.sectionMentors' },
  { role: 'student', title: 'roles.sectionStudents' },
];

// ARU-114: request icons sit in 36 pt circles 8 pt apart; hit slop 4 makes each touch area 44×44 pt, and
// 4 + 4 = the 8 pt gap, so the two touch areas meet but never overlap.
const ICON_SIZE = 36;
const ICON_GAP = 8;
const ICON_HIT_SLOP = 4;
const DANGER_SOFT = '#FEF2F2'; // as the danger Button's background
const iconCircle = {
  width: ICON_SIZE,
  height: ICON_SIZE,
  borderRadius: ICON_SIZE / 2,
  alignItems: 'center',
  justifyContent: 'center',
} as const;

type Row ={ kind: 'user'; user: User } | { kind: 'request'; request: AccessRequest };

/**
 * The teacher accepts or declines new accounts (ARU-43: Requests first, Declined last) and switches users between
 * student and mentor (ARU-13). set_access_status() and set_user_role() enforce every rule.
 */
export default function RolesScreen() {
  const {
    currentUser,
    users,
    courses,
    dataLoaded,
    loading,
    refresh,
    setUserRole,
    accessRequests,
    setAccessStatus,
    setAccountant,
  } = useStore();
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const { busy, error, run } = useAction();

  // While the store is still loading, show a spinner rather than the denial.
  if (!dataLoaded) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!canManageRoles(currentUser?.role)) {
    return <EmptyState title={t('roles.onlyTeacher')} />;
  }

  const q = query.trim().toLowerCase();
  // Requests and Declined come oldest first from access_requests(); the search filters them by name too.
  const requests = (status: AccessRequest['status']) =>
    accessRequests
      .filter((r) => r.status === status && r.name.toLowerCase().includes(q))
      .map((request): Row => ({ kind: 'request', request }));
  const sections = [
    { title: t('roles.sectionRequests'), data: requests('pending') },
    ...SECTIONS.map((s) => ({
      title: t(s.title),
      data: users
        .filter((u) => u.role === s.role && u.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((user): Row => ({ kind: 'user', user })),
    })),
    { title: t('roles.sectionDeclined'), data: requests('rejected') },
  ].filter((s) => s.data.length > 0); // a section with no rows is hidden

  // At once, without a confirmation (ARU-43 AC 6); a retry is a no-op in the database.
  function accept(r: AccessRequest) {
    run(() => setAccessStatus(r.id, 'approved'));
  }

  function decline(r: AccessRequest) {
    run(async () => {
      const ok = await confirmDestructive(
        t('roles.rejectTitle'),
        t('roles.rejectMessage', { name: r.name }),
        t('roles.reject'),
      );
      if (ok) await setAccessStatus(r.id, 'rejected');
    });
  }

  function makeMentor(user: User) {
    run(async () => {
      const ok = await confirmDestructive(
        t('roles.makeMentor'),
        t('roles.makeMentorMessage', { name: user.name }),
        t('roles.makeMentor'),
      );
      if (ok) await setUserRole(user.id, 'mentor');
    });
  }

  function makeStudent(user: User) {
    run(async () => {
      // Friendly early refusal from the loaded courses; the database is the authority if this list is stale.
      const owned = courses
        .filter((c) => c.createdById === user.id)
        .map((c) => c.title)
        .sort((a, b) => a.localeCompare(b));
      if (owned.length) {
        throw new Error(t('roles.ownsCourses', { name: user.name, count: owned.length, titles: owned.join(', ') }));
      }
      const ok = await confirmDestructive(
        t('roles.makeStudent'),
        t('roles.makeStudentMessage', { name: user.name }),
        t('roles.makeStudent'),
      );
      if (ok) await setUserRole(user.id, 'student');
    });
  }

  return (
    <SectionList
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      sections={sections}
      initialNumToRender={30}
      refreshing={loading}
      onRefresh={() => refresh().catch(() => {})}
      keyExtractor={(row) => (row.kind === 'user' ? row.user.id : `request-${row.request.id}`)}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
          <TextInput
            accessibilityLabel={t('roles.searchLabel')}
            placeholder={t('roles.searchPlaceholder')}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            style={styles.input}
          />
          <ErrorText error={error} />
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={[styles.label, { marginTop: 8 }]}>{section.title.toUpperCase()}</Text>
      )}
      renderItem={({ item: row }) => {
        if (row.kind === 'request') {
          const r = row.request;
          return (
            <View testID={`request-${r.id}`} style={[styles.input, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.body} numberOfLines={2}>
                  {r.name}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {r.email}
                </Text>
                <Text style={styles.muted}>{t('roles.signedUp', { date: formatDate(r.createdAt) })}</Text>
                {r.status === 'rejected' && (
                  <View style={[styles.badge, { backgroundColor: DANGER_SOFT, alignSelf: 'flex-start' }]}>
                    <Text style={[styles.badgeText, { color: colors.danger }]}>{t('roles.declinedBadge')}</Text>
                  </View>
                )}
              </View>
              {/* ARU-114: icons instead of text buttons; disabled for every row while any action runs. */}
              {r.status === 'pending' ? (
                <View style={{ flexDirection: 'row', gap: ICON_GAP }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('roles.acceptLabel', { name: r.name })}
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    hitSlop={ICON_HIT_SLOP}
                    testID={`accept-request-${r.id}`}
                    style={[iconCircle, { backgroundColor: colors.successSoft, opacity: busy ? 0.4 : 1 }]}
                    onPress={() => accept(r)}>
                    <Ionicons name="checkmark" size={20} color={colors.success} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('roles.rejectLabel', { name: r.name })}
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    hitSlop={ICON_HIT_SLOP}
                    testID={`reject-request-${r.id}`}
                    style={[iconCircle, { backgroundColor: DANGER_SOFT, opacity: busy ? 0.4 : 1 }]}
                    onPress={() => decline(r)}>
                    <Ionicons name="close" size={20} color={colors.danger} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('roles.acceptLabel', { name: r.name })}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  hitSlop={6}
                  testID={`accept-request-${r.id}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    minHeight: 32,
                    paddingHorizontal: 12,
                    borderRadius: 16,
                    backgroundColor: colors.successSoft,
                    opacity: busy ? 0.4 : 1,
                  }}
                  onPress={() => accept(r)}>
                  <Ionicons name="checkmark" size={16} color={colors.success} />
                  <Text style={{ color: colors.success, fontSize: 14, fontWeight: '600' }}>{t('roles.accept')}</Text>
                </Pressable>
              )}
            </View>
          );
        }
        const item = row.user;
        return (
          <View testID={`user-${item.id}`} style={[styles.input, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
            <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}>
              <Text style={styles.body} numberOfLines={2}>
                {item.name}
              </Text>
              <RoleBadge role={item.role} />
            </View>
            {/* The teacher's row has no action: nothing in the app makes anyone a teacher. */}
            {item.role === 'student' && (
              <Button title={t('roles.makeMentor')} variant="secondary" disabled={busy} onPress={() => makeMentor(item)} />
            )}
            {item.role === 'mentor' && (
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Button title={t('roles.makeStudent')} variant="secondary" disabled={busy} onPress={() => makeStudent(item)} />
                {/* ARU-65: the teacher turns Accountant on or off for a mentor (set_accountant() checks it). */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.muted}>{t('roles.accountant')}</Text>
                  <Switch
                    accessibilityLabel={t('roles.accountantLabel', { name: item.name })}
                    value={!!item.isAccountant}
                    disabled={busy}
                    onValueChange={(on) => run(() => setAccountant(item.id, on))}
                  />
                </View>
              </View>
            )}
          </View>
        );
      }}
      ListEmptyComponent={
        q ? (
          <EmptyState title={t('roles.noMatch', { query: query.trim() })} />
        ) : (
          <EmptyState title={t('roles.empty')} />
        )
      }
    />
  );
}
