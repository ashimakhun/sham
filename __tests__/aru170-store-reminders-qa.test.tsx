// QA ARU-170: gaps in aru170-store-reminders.test.tsx, same harness (copied): a live update and coming back to the
// foreground reschedule (AC 1); no person's name ever reaches a reminder (story goal); a mentor gets reminders only as a
// listener and the teacher none (AC 5, Roles); a declined account and a permission turned off later cancel them (AC 2);
// the Homework due soon switch flipped on this phone reschedules (AC 1 / AC 9).
// Harness notes from the dev test: the real StoreProvider against a fake Supabase client and the in-memory expo-notifications mock
// (jest.setup.js): reminders are scheduled after a load (AC 1), moved by a reload, a switch flip or a language change,
// not rescheduled when nothing changed, retried after a failure; nothing for a declined permission, a waiting account
// or the web, and earlier ones are cancelled (AC 2); sign-out and account deletion cancel them first, also offline,
// and the next account gets only its own (AC 3). Notifications this app didn't schedule as reminders are never touched.
import { act, render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { AppState, Platform, Text } from 'react-native';

import { __resetReminderScheduler } from '@/lib/reminderScheduler';
import { REMINDER_DEBOUNCE_MS, StoreProvider, useStore } from '@/lib/store';

const H = 60 * 60 * 1000;
const inHours = (h: number) => new Date(Date.now() + h * H).toISOString();

type Row = Record<string, unknown>;
const mockLive: { table: string; handler: (p: unknown) => void }[] = [];
const appStateHandlers: ((s: string) => void)[] = [];
const mockState = {
  me: 'S',
  tables: {} as Record<string, Row[]>,
  settings: [] as Row[],
  calls: [] as string[],
  rpcs: [] as { name: string; args: unknown }[],
  failRpc: null as string | null,
  authListener: null as null | ((event: string, session: unknown) => void),
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'update', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve({
        data:
          table === 'notification_settings'
            ? mockState.settings
            : table === 'profiles'
              ? (mockState.tables.profiles ?? []).filter((p) => p.id === mockState.me || p.access_status === 'approved')
              : (mockState.tables[table] ?? []),
        error: null,
      });
    return q;
  };
  const channel = () => {
    const c: Record<string, unknown> = {};
    c.on = (_type: string, filter: { table?: string }, handler: (p: unknown) => void) => {
      mockLive.push({ table: filter?.table ?? '', handler });
      return c;
    };
    c.subscribe = () => c;
    return c;
  };
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: mockState.me } } }),
        onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
          mockState.authListener = listener;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        getUser: () => ok({ user: { id: mockState.me } }),
        signOut: () => {
          mockState.calls.push('auth.signOut');
          return Promise.resolve({ error: null });
        },
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: unknown) => {
        mockState.rpcs.push({ name, args });
        mockState.calls.push(name);
        if (name === mockState.failRpc) return Promise.reject(new TypeError('Network request failed'));
        return ok(name.endsWith('unread_counts') || name.endsWith('unread_count') ? [] : null);
      },
      functions: {
        invoke: () => {
          mockState.calls.push('delete-account');
          return ok({ ok: true });
        },
      },
      channel,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
    },
  };
});

type Scheduled = { identifier: string; content: { title?: string; body?: string; data?: Row }; trigger: Row };
const N = Notifications as unknown as {
  __setPermission: (p: Record<string, unknown>) => void;
  __reset: () => void;
  __scheduled: () => Scheduled[];
  __addScheduled: (r: Scheduled) => void;
};
const scheduled = () => N.__scheduled().map((r) => r.identifier).sort();
const reminders = () => N.__scheduled().filter((r) => r.identifier.startsWith('sham-reminder:'));
const scheduleMock = Notifications.scheduleNotificationAsync as jest.Mock;

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.users.length}</Text>;
}
const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await act(async () => {});
};
/** Lets the debounce run out and the scheduler finish. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, REMINDER_DEBOUNCE_MS + 100));
  });
  await flush();
  // The switches load first (one debounce), then the reminders are scheduled (another).
  await act(async () => {
    await new Promise((r) => setTimeout(r, REMINDER_DEBOUNCE_MS + 100));
  });
  await flush();
}
async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
  await settle();
}

const FOREIGN: Scheduled = { identifier: 'push-or-other', content: { title: 'Other', data: {} }, trigger: { type: 'date' } };

beforeEach(() => {
  N.__reset();
  N.__setPermission({ status: 'granted', ios: { status: 2 } });
  N.__addScheduled({ ...FOREIGN });
  scheduleMock.mockClear();
  (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockClear();
  __resetReminderScheduler();
  mockState.me = 'S';
  mockState.settings = [];
  mockState.calls = [];
  mockState.rpcs = [];
  mockState.failRpc = null;
  mockState.tables = {
    profiles: [
      { id: 'S', full_name: 'Samal Studentova', role: 'student', access_status: 'approved' },
      { id: 'S2', full_name: 'Dana Serikova', role: 'student', access_status: 'approved' },
      { id: 'O', full_name: 'Aigerim Nurlanovna', role: 'mentor', access_status: 'approved' },
    ],
    courses: [
      { id: 'A', title: 'Algebra', description: '', created_by: 'O', created_at: '2026-01-01' },
      { id: 'B', title: 'Biology', description: '', created_by: 'O', created_at: '2026-01-01' },
    ],
    course_members: [
      { course_id: 'A', user_id: 'S', added_by: 'O', added_at: '2026-01-01' },
      { course_id: 'B', user_id: 'S2', added_by: 'O', added_at: '2026-01-01' },
    ],
    course_meetings: [
      { id: 'm1', course_id: 'A', starts_at: inHours(3), topic: '', status: 'scheduled', created_by: 'O', created_at: '2026-01-01' },
      { id: 'm2', course_id: 'B', starts_at: inHours(4), topic: '', status: 'scheduled', created_by: 'O', created_at: '2026-01-01' },
    ],
    homework_assignments: [],
    homework: [],
  };
  mockLive.length = 0;
  appStateHandlers.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, handler) => {
    appStateHandlers.push(handler as (s: string) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  Platform.OS = 'ios';
});


const live = async (table: string) => {
  const hs = mockLive.filter((l) => l.table === table);
  expect(hs.length).toBeGreaterThan(0);
  await act(async () => {
    for (const h of hs) h.handler({ eventType: 'UPDATE', new: {}, old: {} });
  });
  await settle();
};
const toForeground = async () => {
  await act(async () => {
    for (const h of [...appStateHandlers]) h('background');
  });
  await act(async () => {
    for (const h of [...appStateHandlers]) h('active');
  });
  await flush();
  await settle();
};
const ids = () => reminders().map((r) => r.identifier).sort();

it('AC 1 / AC 6: a live update (the owner moves the meeting) moves the reminder without a manual refresh', async () => {
  await mount();
  mockState.tables.course_meetings[0].starts_at = inHours(9);
  await live('course_meetings');
  expect((reminders()[0].trigger.date as Date).toISOString()).toBe(mockState.tables.course_meetings[0].starts_at);
});

it('AC 1 / AC 6: a live update that cancels the meeting removes the reminder', async () => {
  await mount();
  mockState.tables.course_meetings[0].status = 'canceled';
  await live('course_meetings');
  expect(reminders()).toEqual([]);
  expect(scheduled()).toEqual(['push-or-other']);
});

it('AC 6: a live update removing me from the course removes its reminder', async () => {
  await mount();
  mockState.tables.course_members = mockState.tables.course_members.filter((m) => m.user_id !== 'S');
  await live('course_members');
  expect(reminders()).toEqual([]);
});

it('AC 1 / AC 8: a live update with a new due time moves the Homework due soon reminder', async () => {
  mockState.tables.homework_assignments = [
    { id: 'a1', meeting_id: 'm1', course_id: 'A', title: 'Fractions', description: '', due_at: inHours(30), created_by: 'O', created_at: '2026-01-01' },
  ];
  await mount();
  mockState.tables.homework_assignments[0].due_at = inHours(50);
  await live('homework_assignments');
  const due = reminders().find((r) => r.identifier === 'sham-reminder:due:a1')!;
  expect((due.trigger.date as Date).getTime()).toBe(Date.parse(mockState.tables.homework_assignments[0].due_at as string) - 24 * H);
});

it('AC 1: coming back to the foreground reloads and reschedules', async () => {
  await mount();
  mockState.tables.course_meetings[0].starts_at = inHours(7);
  await toForeground();
  expect((reminders()[0].trigger.date as Date).toISOString()).toBe(mockState.tables.course_meetings[0].starts_at);
});

it('AC 2: notification permission turned off in phone settings → cancelled on the next foreground load', async () => {
  await mount();
  expect(reminders()).toHaveLength(1);
  N.__setPermission({ status: 'denied', ios: { status: 1 } });
  mockState.tables.course_meetings[0].starts_at = inHours(8);
  await toForeground();
  expect(reminders()).toEqual([]);
  expect(scheduled()).toEqual(['push-or-other']);
});

it('AC 2: a declined account gets none, and earlier ones are cancelled', async () => {
  mockState.tables.profiles[0].access_status = 'declined';
  N.__addScheduled({ identifier: 'sham-reminder:meeting:old', content: { data: { sham: 'reminder' } }, trigger: {} });
  await mount();
  expect(scheduled()).toEqual(['push-or-other']);
  expect(scheduleMock).not.toHaveBeenCalled();
});

it('AC 1 / AC 9: flipping Homework due soon off on this phone removes only that reminder; on brings it back', async () => {
  mockState.tables.homework_assignments = [
    { id: 'a1', meeting_id: 'm1', course_id: 'A', title: 'Fractions', description: '', due_at: inHours(30), created_by: 'O', created_at: '2026-01-01' },
  ];
  await mount();
  expect(ids()).toEqual(['sham-reminder:due:a1', 'sham-reminder:meeting:m1']);
  await act(async () => {
    await store.setNotification('homework_due', false);
  });
  await settle();
  expect(mockState.rpcs).toContainEqual({ name: 'set_notification', args: { kind: 'homework_due', enabled: false } });
  expect(ids()).toEqual(['sham-reminder:meeting:m1']);
  await act(async () => {
    await store.setNotification('homework_due', true);
  });
  await settle();
  expect(ids()).toEqual(['sham-reminder:due:a1', 'sham-reminder:meeting:m1']);
});

it('story goal: no person\'s name is in any reminder (meeting, homework due, photo deletion)', async () => {
  const old = new Date(Date.now() - 170 * 24 * H).toISOString();
  mockState.tables.app_settings = [{ photo_deletion_start: '2020-01-01' }];
  mockState.tables.homework_assignments = [
    { id: 'a1', meeting_id: 'm1', course_id: 'A', title: 'Fractions', description: '', due_at: inHours(30), created_by: 'O', created_at: '2026-01-01' },
  ];
  mockState.tables.homework = [
    { id: 'h1', student_id: 'S', course_id: 'A', title: '', description: '', status: 'checked', checked_by: 'O', checked_at: old, photo_path: 'S/h1.jpg', created_at: old },
    { id: 'h2', student_id: 'S2', course_id: 'B', title: '', description: '', status: 'submitted', created_at: old, assignment_id: 'a1' },
  ];
  await mount();
  expect(ids().map((i) => i.split(':')[1])).toEqual(['due', 'meeting', 'photos']);
  const texts = reminders().map((r) => JSON.stringify(r.content));
  for (const name of ['Samal', 'Studentova', 'Dana', 'Serikova', 'Aigerim', 'Nurlanovna']) {
    for (const t of texts) expect(t).not.toContain(name);
  }
});

it('AC 5 / Roles: a mentor gets reminders only for the course they listen to, not the one they own', async () => {
  mockState.me = 'O';
  mockState.tables.course_members.push({ course_id: 'B', user_id: 'O', added_by: 'S2', added_at: '2026-01-01' });
  mockState.tables.courses[1].created_by = 'S2';
  await mount();
  expect(ids()).toEqual(['sham-reminder:meeting:m2']);
});

it('AC 5 / Roles: the teacher gets none', async () => {
  mockState.tables.profiles.push({ id: 'T', full_name: 'Tima Teacher', role: 'teacher', access_status: 'approved' });
  mockState.me = 'T';
  mockState.tables.course_members.push({ course_id: 'A', user_id: 'T', added_by: 'O', added_at: '2026-01-01' });
  await mount();
  expect(reminders()).toEqual([]);
  expect(scheduleMock).not.toHaveBeenCalled();
});
